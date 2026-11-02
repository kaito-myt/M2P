import {createHash} from 'node:crypto';
import {JOINT_FEATURE_COUNT,buildJointFeatures,jointInputAt,splitJointDataset,digestJointDataset,digestJointTrainIndices,digestJointTrainInputs,acceptJointFeatureSpec,resolveJointDatasetSplits} from './joint-dataset.mjs';

export const JOINT_MODEL_VERSION='boat_joint_reference_v1';
export const DEFAULT_JOINT_POLICY=Object.freeze({version:JOINT_MODEL_VERSION,seed:1729,epochs:6,batchSize:128,learningRate:.01,l2:.001,maxRaces:75000,maxFeatures:320,maxMinutes:45,variant:'full'});
const triples=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(a!==b&&a!==c&&b!==c)triples.push(`${a}-${b}-${c}`);
export const JOINT_COMBINATIONS=Object.freeze(triples);
const tripleIndices=new Map(JOINT_COMBINATIONS.map((key,index)=>[key,index]));
export function indexOfJointTriple(value){const key=typeof value==='string'?value:ArrayBuffer.isView(value)||Array.isArray(value)?Array.from(value).join('-'):null;return tripleIndices.get(key)??-1;}
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function assertSpec(spec){return acceptJointFeatureSpec(spec);}
function assertTarget(target){if((!Array.isArray(target)&&!ArrayBuffer.isView(target))||target.length!==3||new Set(target).size!==3||Array.from(target).some(lane=>!Number.isInteger(lane)||lane<1||lane>6))throw Error('invalid_joint_target');}
function assertWeights(weights){if(!(weights instanceof Float64Array)||weights.length!==JOINT_FEATURE_COUNT*3||weights.some(value=>!finite(value)))throw Error('invalid_joint_weights');}
function assertTemperature(value){if(!finite(value)||value<=0||value>100)throw Error('invalid_joint_temperature');}
function assertModel(model){if(model?.version!==JOINT_MODEL_VERSION||model.status!=='complete'||model.heads!==3||!['full','lane_only'].includes(model.variant))throw Error('joint_model_incomplete');const featureSpec=assertSpec(model.featureSpec);assertWeights(model.weights);assertTemperature(model.temperature);return featureSpec===model.featureSpec?model:{...model,featureSpec};}
function policyOf(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(DEFAULT_JOINT_POLICY,key)))throw Error('invalid_joint_policy');
 const p={...DEFAULT_JOINT_POLICY,...input};
 if(p.version!==JOINT_MODEL_VERSION||!['full','lane_only'].includes(p.variant))throw Error('invalid_joint_policy');
 for(const [key,min,max] of [['seed',0,0xffffffff],['epochs',1,12],['batchSize',1,512],['maxRaces',1,75000],['maxFeatures',JOINT_FEATURE_COUNT,320],['maxMinutes',1,45]])if(!Number.isSafeInteger(p[key])||p[key]<min||p[key]>max)throw Error('invalid_joint_policy');
 if(!finite(p.learningRate)||p.learningRate<=0||p.learningRate>.1||!finite(p.l2)||p.l2<0||p.l2>1)throw Error('invalid_joint_policy');return p;
}
const featureBuffer=()=>({indices:new Uint16Array(27),values:new Float64Array(27)});
function featureVector(input,lane,prefix,spec,laneOnly,buffer){const f=buildJointFeatures(input,lane,prefix,spec,{laneOnly,buffer}),length=f?.length??f?.indices?.length;if(!f||!Number.isSafeInteger(length)||length<1||length>JOINT_FEATURE_COUNT||length>f.indices.length||length>f.values.length)throw Error('invalid_joint_sparse_features');return {...f,length};}
function prefixCheck(head,prefix){if(!Number.isInteger(head)||head<0||head>2||!Array.isArray(prefix)||prefix.length!==head||new Set(prefix).size!==prefix.length||prefix.some(lane=>!Number.isInteger(lane)||lane<1||lane>6))throw Error('invalid_joint_prefix');}
function logitsFor(weights,input,spec,laneOnly,head,prefix,{features=false,buffers=[featureBuffer()]}={}){
 prefixCheck(head,prefix);const lanes=[],logits=[],vectors=[],offset=head*JOINT_FEATURE_COUNT;
 for(let lane=1;lane<=6;lane++)if(!prefix.includes(lane)){
  const f=featureVector(input,lane,prefix,spec,laneOnly,features?buffers[lane-1]:buffers[0]);let score=0;
  for(let j=0;j<f.length;j++){const index=f.indices[j],value=f.values[j];if(index>=JOINT_FEATURE_COUNT||!finite(value))throw Error('invalid_joint_sparse_features');score+=weights[offset+index]*value;}
  if(!finite(score))throw Error('nonfinite_joint_score');lanes.push(lane);logits.push(score);if(features)vectors.push(f);
 }
 return {head,prefix:[...prefix],lanes:Uint8Array.from(lanes),logits:Float64Array.from(logits),...(features?{features:vectors}:{})};
}
function softmax(logits,temperature){
 assertTemperature(temperature);if(!logits.length||Array.from(logits).some(value=>!finite(value)))throw Error('invalid_joint_logits');
 const max=Math.max(...logits);let sum=0;const shifted=Float64Array.from(logits,value=>(value-max)/temperature);for(const value of shifted)sum+=Math.exp(value);
 if(!finite(sum)||sum<=0)throw Error('nonfinite_joint_probability');const normalizer=Math.log(sum),logProbabilities=Float64Array.from(shifted,value=>value-normalizer),probabilities=Float64Array.from(logProbabilities,Math.exp);
 return {probabilities,logProbabilities};
}
function distributionFor(model,input,head,prefix,temperature,buffers){const logits=logitsFor(model.weights,input,model.featureSpec,model.variant==='lane_only',head,prefix,{buffers});return {...logits,...softmax(logits.logits,temperature)};}
export function conditionalDistribution(model,input,head,prefix,{temperature=model?.temperature}={}){model=assertModel(model);return distributionFor(model,input,head,prefix,temperature,[featureBuffer()]);}
export function jointPathLogits(model,input,target){
 model=assertModel(model);assertTarget(target);const prefix=[],path=[],buffers=[featureBuffer()];
 for(let head=0;head<3;head++){path.push({...logitsFor(model.weights,input,model.featureSpec,model.variant==='lane_only',head,prefix,{buffers}),targetLane:target[head]});prefix.push(target[head]);}return path;
}
export function jointLogProbabilityFromPath(path,{temperature=1}={}){
 if(!Array.isArray(path)||path.length!==3)throw Error('invalid_joint_path');let result=0;const prefix=[];
 for(let head=0;head<3;head++){const row=path[head],expected=[1,2,3,4,5,6].filter(lane=>!prefix.includes(lane));if(row?.head!==head||row.lanes?.length!==6-head||row.logits?.length!==6-head||!Array.isArray(row.prefix)||row.prefix.join('-')!==prefix.join('-')||Array.from(row.lanes).some((lane,index)=>lane!==expected[index]))throw Error('invalid_joint_path');const index=Array.from(row.lanes).indexOf(row.targetLane);if(index<0)throw Error('invalid_joint_path');result+=softmax(row.logits,temperature).logProbabilities[index];prefix.push(row.targetLane);}return result;
}
export function jointTripleLogProbability(model,input,target,{temperature=model?.temperature}={}){return jointLogProbabilityFromPath(jointPathLogits(model,input,target),{temperature});}
export function predictJoint(model,input,{temperature=model?.temperature}={}){
 model=assertModel(model);assertTemperature(temperature);const buffers=[featureBuffer()],first=distributionFor(model,input,0,[],temperature,buffers),second=new Map(),third=new Map(),probabilities=new Float64Array(120),logProbabilities=new Float64Array(120);let topIndex=0,sum=0;
 for(let i=0;i<JOINT_COMBINATIONS.length;i++){
  const [a,b,c]=JOINT_COMBINATIONS[i].split('-').map(Number);let middle=second.get(a);if(!middle){middle=distributionFor(model,input,1,[a],temperature,buffers);second.set(a,middle);}const pair=a+'-'+b;let last=third.get(pair);if(!last){last=distributionFor(model,input,2,[a,b],temperature,buffers);third.set(pair,last);}
  logProbabilities[i]=first.logProbabilities[a-1]+middle.logProbabilities[Array.from(middle.lanes).indexOf(b)]+last.logProbabilities[Array.from(last.lanes).indexOf(c)];const p=Math.exp(logProbabilities[i]);probabilities[i]=p;sum+=p;if(p>probabilities[topIndex])topIndex=i;
 }
 if(!finite(sum)||Math.abs(sum-1)>1e-9)throw Error('joint_probability_not_normalized');
 return {combinations:JOINT_COMBINATIONS,probabilities,logProbabilities,topTriple:JOINT_COMBINATIONS[topIndex],topProbability:probabilities[topIndex],sum,temperature};
}
function accumulateGradient(weights,input,target,spec,laneOnly,gradient,buffers){
 assertTarget(target);const prefix=[];let loss=0;
 for(let head=0;head<3;head++){
  const row=logitsFor(weights,input,spec,laneOnly,head,prefix,{features:true,buffers}),distribution=softmax(row.logits,1),targetIndex=Array.from(row.lanes).indexOf(target[head]);if(targetIndex<0)throw Error('invalid_joint_target');loss-=distribution.logProbabilities[targetIndex];
  for(let i=0;i<row.lanes.length;i++){const delta=distribution.probabilities[i]-(i===targetIndex?1:0),f=row.features[i],offset=head*JOINT_FEATURE_COUNT;for(let j=0;j<f.length;j++)gradient[offset+f.indices[j]]+=delta*f.values[j];}
  prefix.push(target[head]);
 }return loss;
}
export function jointLossGradient(weights,input,target,spec,{laneOnly=false,l2=0}={}){
 spec=assertSpec(spec);assertWeights(weights);if(!finite(l2)||l2<0||l2>1)throw Error('invalid_joint_policy');const gradient=new Float64Array(weights.length);let loss=accumulateGradient(weights,input,target,spec,laneOnly,gradient,Array.from({length:6},featureBuffer));
 if(l2)for(let i=0;i<weights.length;i++){loss+=l2*.5*weights[i]**2;gradient[i]+=l2*weights[i];}return {loss,gradient};
}
function modelDigest(model){return hash({version:model.version,heads:model.heads,featureCount:JOINT_FEATURE_COUNT,variant:model.variant,featureSpecDigest:model.featureSpec.digest,weights:Array.from(model.weights),temperature:model.temperature,trainingPolicy:model.trainingPolicy,datasetDigest:model.datasetDigest});}
function parameterDigest(model){return hash({version:model.version,heads:model.heads,featureCount:JOINT_FEATURE_COUNT,variant:model.variant,featureSpecDigest:model.featureSpec.digest,weights:Array.from(model.weights),temperature:model.temperature,trainingPolicy:model.trainingPolicy});}
export function withJointTemperature(model,temperature){model=assertModel(model);assertTemperature(temperature);const calibrated={...model,temperature};return {...calibrated,parameterDigest:parameterDigest(calibrated),modelDigest:modelDigest(calibrated)};}
function randomSource(seed){let state=seed>>>0;return ()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
export async function fitJointModel(dataset,spec,overrides={},ports={}){
 const policy=policyOf(overrides);spec=assertSpec(spec);if(!dataset||!Number.isSafeInteger(dataset.size)||dataset.size<1||dataset.size>policy.maxRaces)throw Error('joint_dataset_size');
 const splitPolicy=resolveJointDatasetSplits(dataset,ports.splits??dataset.splits??spec.splits);acceptJointFeatureSpec(spec,{splits:splitPolicy});
 const splits=splitJointDataset(dataset,splitPolicy),indices=Uint32Array.from(splits.train);if(!indices.length)throw Error('joint_training_empty');
 const expectedSpecHash=digestJointTrainIndices(dataset,indices,{splits:splitPolicy});if(spec.trainIndicesDigest!==expectedSpecHash)throw Error('joint_training_indices_mismatch');
 if(spec.trainInputDigest!==digestJointTrainInputs(dataset,indices,{splits:splitPolicy}))throw Error('joint_training_inputs_mismatch');
 const datasetDigest=digestJointDataset(dataset),now=ports.now??Date.now,yieldControl=ports.yieldControl??(()=>new Promise(resolve=>setImmediate(resolve))),onProgress=ports.onProgress??(()=>{}),started=now(),weights=new Float64Array(JOINT_FEATURE_COUNT*3),moment1=new Float64Array(weights.length),moment2=new Float64Array(weights.length),gradient=new Float64Array(weights.length),random=randomSource(policy.seed),buffers=Array.from({length:6},featureBuffer);
 const summary={status:'training',trainRaces:indices.length,epochsCompleted:0,batches:0,examplesProcessed:0,gradientClipCount:0,weightClipCount:0,epochMeanNll:[],elapsedMs:0,policyDiffersFromDefault:Object.keys(policy).some(key=>key!=='variant'&&policy[key]!==DEFAULT_JOINT_POLICY[key])};
 const stopped=reason=>({version:JOINT_MODEL_VERSION,status:'stopped',reason,variant:policy.variant,trainingPolicy:policy,datasetDigest,trainingSummary:{...summary,status:'stopped',elapsedMs:now()-started},analysisReady:false,executionEvidencePassed:false,liveEligible:false,financialActions:0});
 const stopReason=()=>ports.signal?.aborted?'cancelled':now()-started>=policy.maxMinutes*60000?'time_limit':null;
 for(let epoch=0;epoch<policy.epochs;epoch++){
  for(let i=indices.length-1;i>0;i--){const j=Math.floor(random()*(i+1)),temporary=indices[i];indices[i]=indices[j];indices[j]=temporary;}
  let epochLoss=0,epochSamples=0;
  for(let begin=0;begin<indices.length;begin+=policy.batchSize){
   const reason=stopReason();if(reason)return stopped(reason);gradient.fill(0);const end=Math.min(begin+policy.batchSize,indices.length),batchSize=end-begin;
   for(let position=begin;position<end;position++){const row=indices[position],input=jointInputAt(dataset,row),target=dataset.targets.subarray(row*3,row*3+3);epochLoss+=accumulateGradient(weights,input,target,spec,policy.variant==='lane_only',gradient,buffers);epochSamples++;}
   let normSquared=0;for(let i=0;i<gradient.length;i++){gradient[i]=gradient[i]/batchSize+policy.l2*weights[i];normSquared+=gradient[i]**2;}
   const norm=Math.sqrt(normSquared),scale=norm>5?5/norm:1;if(scale<1)summary.gradientClipCount++;
   summary.batches++;const step=summary.batches,correction1=1-.9**step,correction2=1-.999**step;
   for(let i=0;i<weights.length;i++){const g=gradient[i]*scale;moment1[i]=.9*moment1[i]+.1*g;moment2[i]=.999*moment2[i]+.001*g*g;const updated=weights[i]-policy.learningRate*(moment1[i]/correction1)/(Math.sqrt(moment2[i]/correction2)+1e-8);if(!finite(updated))throw Error('nonfinite_joint_training');weights[i]=Math.max(-10,Math.min(10,updated));if(weights[i]!==updated)summary.weightClipCount++;}
   summary.examplesProcessed+=batchSize;if(summary.batches%32===0){onProgress({phase:'training',variant:policy.variant,epoch:epoch+1,batches:summary.batches,examplesProcessed:summary.examplesProcessed,elapsedMs:now()-started});await yieldControl();}
  }
  summary.epochsCompleted=epoch+1;summary.epochMeanNll.push(epochSamples?epochLoss/epochSamples:null);onProgress({phase:'epoch_complete',variant:policy.variant,epoch:epoch+1,meanNll:summary.epochMeanNll.at(-1),elapsedMs:now()-started});
 }
 const finalReason=stopReason();if(finalReason)return stopped(finalReason);summary.status='complete';summary.elapsedMs=now()-started;
 const model={version:JOINT_MODEL_VERSION,status:'complete',heads:3,featureCount:JOINT_FEATURE_COUNT,variant:policy.variant,weights,featureSpec:spec,temperature:1,trainingPolicy:policy,datasetDigest,trainingSummary:summary,analysisReady:false,executionEvidencePassed:false,liveEligible:false,financialActions:0};return {...model,parameterDigest:parameterDigest(model),modelDigest:modelDigest(model)};
}
