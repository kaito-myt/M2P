import {createHash} from 'node:crypto';
import {JOINT_SPLITS,jointInputAt,normalizeJointSplits,resolveJointDatasetSplits} from './joint-dataset.mjs';
import {predictJoint,JOINT_COMBINATIONS,jointPathLogits,jointLogProbabilityFromPath,withJointTemperature,indexOfJointTriple} from './joint-model.mjs';
import {createCoverageAccumulator} from './joint-ticket-coverage.mjs';

export const JOINT_EVALUATION_VERSION='boat_joint_evaluation_v1';
export const PROBABILITY_BIN_EDGES=Object.freeze([0,.02,.05,.1,.2,.4,.6,.8,1]);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const targetAt=(d,i)=>Array.from(d.targets.subarray(i*3,i*3+3));
function control({signal,now=()=>Date.now(),deadlineMs=Infinity,yieldControl=()=>new Promise(resolve=>setImmediate(resolve))}){
 const deadline=Math.min(now()+45*60*1000,deadlineMs);
 if(typeof deadlineMs!=='number'||Number.isNaN(deadlineMs))throw Error('invalid_joint_evaluation_deadline');
 const check=()=>{if(signal?.aborted)throw Error('joint_evaluation_cancelled');if(now()>=deadline)throw Error('joint_evaluation_timeout');};
 return async(index,force=false)=>{if(force||index%64===0){check();await yieldControl();check();}};
}
function checkIndices(dataset,indices,phase,splits){
 const bounds=resolveJointDatasetSplits(dataset,splits)[phase];if(!bounds||!ArrayBuffer.isView(indices)||indices instanceof DataView||new Set(indices).size!==indices.length)throw Error('invalid_joint_evaluation_indices');
 for(const i of indices)if(!Number.isSafeInteger(i)||i<0||i>=dataset.size||typeof dataset.dates[i]!=='string'||dataset.dates[i]<bounds.from||dataset.dates[i]>=bounds.to)throw Error('invalid_joint_evaluation_indices');
}
function evaluationSplits(model,dataset,splits){const effective=resolveJointDatasetSplits(dataset,splits??dataset?.splits??model?.featureSpec?.splits??JOINT_SPLITS);if(model?.featureSpec&&JSON.stringify(normalizeJointSplits(model.featureSpec.splits??JOINT_SPLITS))!==JSON.stringify(effective))throw Error('joint_split_policy_mismatch');return effective;}
export function wilsonJoint(hits,n){if(!n)return {lower:null,upper:null,width:null};const z=1.959963984540054,p=hits/n,d=1+z*z/n,mid=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d,lower=Math.max(0,mid-half),upper=Math.min(1,mid+half);return {lower,upper,width:upper-lower};}
export async function fitJointTemperature(model,dataset,indices,{minSamples=200,path=jointPathLogits,logProbability=jointLogProbabilityFromPath,attach=withJointTemperature,signal,now,deadlineMs,yieldControl,onProgress=()=>{},splits}={}){
 checkIndices(dataset,indices,'calibration',evaluationSplits(model,dataset,splits));if(!Number.isSafeInteger(minSamples)||minSamples<1||minSamples>100000)throw Error('invalid_joint_calibration_policy');
 const checkpoint=control({signal,now,deadlineMs,yieldControl});await checkpoint(0,true);
 if(indices.length<minSamples)return {model:attach(model,1),calibration:{status:'insufficient',samples:indices.length,minSamples,temperature:1,gridSize:21,meanLogLoss:null}};
 const grid=Array.from({length:21},(_,i)=>Math.exp(Math.log(.5)+i/20*Math.log(4))),losses=new Float64Array(grid.length);
 for(let j=0;j<indices.length;j++){await checkpoint(j);const i=indices[j],paths=path(model,jointInputAt(dataset,i),targetAt(dataset,i));for(let k=0;k<grid.length;k++){const log=logProbability(paths,{temperature:grid[k]});if(!finite(log)||log>1e-9)throw Error('invalid_joint_calibration_probability');losses[k]-=log;}if((j+1)%256===0)onProgress({phase:'calibration',evaluated:j+1,total:indices.length});}
 await checkpoint(indices.length,true);
 let best=0;for(let k=1;k<grid.length;k++){const delta=losses[k]-losses[best];if(delta< -1e-10||Math.abs(delta)<=1e-10&&(Math.abs(grid[k]-1)<Math.abs(grid[best]-1)||Math.abs(grid[k]-1)===Math.abs(grid[best]-1)&&grid[k]<grid[best]))best=k;}
 return {model:attach(model,grid[best]),calibration:{status:'fitted',samples:indices.length,minSamples,temperature:grid[best],gridSize:21,meanLogLoss:losses[best]/indices.length}};
}
const aggregate=()=>({samples:0,hits:0,sumP:0,sumP2:0,binary:0,multiclass:0,nll:0,probabilities:[],bins:PROBABILITY_BIN_EDGES.slice(0,-1).map(()=>({samples:0,hits:0,sumP:0}))});
function add(a,p,hit,binary,multiclass,nll){a.samples++;a.hits+=hit;a.sumP+=p;a.sumP2+=p*p;a.binary+=binary;a.multiclass+=multiclass;a.nll+=nll;a.probabilities.push(p);const index=Math.min(a.bins.length-1,PROBABILITY_BIN_EDGES.slice(1).findIndex(edge=>p<edge));const bin=a.bins[index<0?a.bins.length-1:index];bin.samples++;bin.hits+=hit;bin.sumP+=p;}
function summarize(a){
 const n=a.samples,sorted=a.probabilities.sort((x,y)=>x-y),quantile=q=>n?sorted[Math.floor((n-1)*q)]:null;
 const bins=a.bins.map((b,i)=>{const mean=b.samples?b.sumP/b.samples:null,rate=b.samples?b.hits/b.samples:null;return {from:PROBABILITY_BIN_EDGES[i],to:PROBABILITY_BIN_EDGES[i+1],samples:b.samples,hits:b.hits,meanProbability:mean,accuracy:rate,absoluteError:b.samples?Math.abs(mean-rate):null,interval95:wilsonJoint(b.hits,b.samples),support:b.samples>=100?'sufficient':'insufficient'};});
 return {samples:n,hits:a.hits,accuracy:n?a.hits/n:null,interval95:wilsonJoint(a.hits,n),meanProbability:n?a.sumP/n:null,probabilityStd:n?Math.sqrt(Math.max(0,a.sumP2/n-(a.sumP/n)**2)):null,probabilityQuantiles:{p10:quantile(.1),p50:quantile(.5),p90:quantile(.9)},binaryBrier:n?a.binary/n:null,multiclassBrier:n?a.multiclass/n:null,jointLogLoss:n?a.nll/n:null,ece:n?bins.reduce((sum,b)=>sum+(b.samples/n)*(b.absoluteError??0),0):null,bins};
}
/** Aggregates variable probabilities; never substitutes a cohort's mean for p_i. */
export function createJointMetricsAccumulator(){
 const state=aggregate();let finished=false;
 return {add({probability,hit,multiclassBrier,jointLogLoss}){if(finished)throw Error('joint_metrics_finished');if(!finite(probability)||probability<0||probability>1||![0,1,false,true].includes(hit)||!finite(multiclassBrier)||multiclassBrier<0||multiclassBrier>2||!finite(jointLogLoss)||jointLogLoss<0)throw Error('invalid_joint_metric_row');const y=Number(hit);add(state,probability,y,(probability-y)**2,multiclassBrier,jointLogLoss);},finish(){if(finished)throw Error('joint_metrics_finished');finished=true;return summarize(state);}};
}
export async function evaluateJointModel(model,dataset,indices,{phase='holdout',predict=predictJoint,path=jointPathLogits,logProbability=jointLogProbabilityFromPath,onProgress=()=>{},signal,now,deadlineMs,yieldControl,splits}={}){
 const effective=evaluationSplits(model,dataset,splits);checkIndices(dataset,indices,phase,effective);if(!['selection','holdout'].includes(phase))throw Error('invalid_joint_evaluation_phase');
 const checkpoint=control({signal,now,deadlineMs,yieldControl});await checkpoint(0,true);
 const coverage=createCoverageAccumulator(),all=aggregate(),months={},paired={samples:0,bothCorrect:0,selfOnly:0,marketOnly:0,neither:0,marketMissing:0,tiedMarketRows:0},cohort=createHash('sha256');
 for(let j=0;j<indices.length;j++){
  await checkpoint(j);
  const i=indices[j],input=jointInputAt(dataset,i),target=targetAt(dataset,i),actual=target.join('-'),prediction=predict(model,input),at=indexOfJointTriple(actual);
  if(at<0||!prediction?.probabilities||prediction.probabilities.length!==120||!finite(prediction.topProbability)||prediction.topProbability<0||prediction.topProbability>1)throw Error('invalid_joint_prediction');
  let sum=0,squares=0;for(const p of prediction.probabilities){if(!finite(p)||p<0||p>1)throw Error('invalid_joint_prediction');sum+=p;squares+=p*p;}if(Math.abs(sum-1)>1e-8)throw Error('invalid_joint_prediction');
  const predictedAt=indexOfJointTriple(prediction.topTriple);if(predictedAt<0||Math.abs(prediction.probabilities[predictedAt]-prediction.topProbability)>1e-9)throw Error('invalid_joint_prediction');
  const probability=prediction.topProbability,hit=Number(prediction.topTriple===actual),binary=(probability-hit)**2,multiclass=Math.max(0,Math.min(2,squares-2*prediction.probabilities[at]+1));
  const trueProbability=prediction.probabilities[at],nll=prediction.logProbabilities?-prediction.logProbabilities[at]:trueProbability>0?-Math.log(trueProbability):-logProbability(path(model,input,target),{temperature:model.temperature});if(!finite(nll)||nll< -1e-9)throw Error('invalid_joint_prediction');
  add(all,probability,hit,binary,multiclass,nll);const month=dataset.dates[i].slice(0,7);add(months[month]??=aggregate(),probability,hit,binary,multiclass,nll);cohort.update(dataset.keys[i]+'\n');
  coverage.add({combinations:JOINT_COMBINATIONS,probabilities:prediction.probabilities,actual,date:dataset.dates[i]});
  const market=dataset.marketReferenceTriples?.[i];if(indexOfJointTriple(market)<0)paired.marketMissing++;else{paired.samples++;const marketHit=market===actual;if(hit&&marketHit)paired.bothCorrect++;else if(hit)paired.selfOnly++;else if(marketHit)paired.marketOnly++;else paired.neither++;if((dataset.marketTieCounts?.[i]??0)>1)paired.tiedMarketRows++;}
  if((j+1)%256===0)onProgress({phase,evaluated:j+1,total:indices.length});
 }
 await checkpoint(indices.length,true);
 const n=paired.samples;
 return {version:JOINT_EVALUATION_VERSION,phase,modelDigest:model.modelDigest,parameterDigest:model.parameterDigest??null,variant:model.variant,temperature:model.temperature,cohortDigest:cohort.digest('hex'),...(effective!==JOINT_SPLITS?{splitBounds:effective}:{}),metrics:summarize(all),ticketCoverage:coverage.finish(),monthly:Object.fromEntries(Object.entries(months).map(([month,a])=>[month,summarize(a)])),marketReference:{...paired,selfAccuracy:n?(paired.bothCorrect+paired.selfOnly)/n:null,marketAccuracy:n?(paired.bothCorrect+paired.marketOnly)/n:null,accuracyDifference:n?(paired.selfOnly-paired.marketOnly)/n:null,marketBrier:null,marketLogLoss:null,phase:'final_or_unknown',evaluationOnly:true},analysisReady:false,executionEvidencePassed:false,liveEligible:false,financialActions:0};
}
export function compareJointEvaluations(full,lane){
 if(full.phase!==lane.phase||full.cohortDigest!==lane.cohortDigest||full.metrics.samples!==lane.metrics.samples||JSON.stringify(normalizeJointSplits(full.splitBounds??JOINT_SPLITS))!==JSON.stringify(normalizeJointSplits(lane.splitBounds??JOINT_SPLITS)))throw Error('joint_comparison_cohort_mismatch');
 const f=full.metrics,b=lane.metrics,reasons=[];
 if(f.samples<1000)reasons.push('support_below_1000');
 if(f.jointLogLoss===null||b.jointLogLoss===null||b.jointLogLoss-f.jointLogLoss<.01)reasons.push('joint_log_loss_gain_below_001');
 if(f.multiclassBrier===null||b.multiclassBrier===null||f.multiclassBrier>b.multiclassBrier)reasons.push('multiclass_brier_not_better');
 if(f.ece===null||f.ece>.03)reasons.push('calibration_error_above_003');
 if(f.probabilityStd===null||f.probabilityStd<.01)reasons.push('probability_resolution_below_001');
 if(f.bins.some(bin=>bin.samples>=100&&bin.absoluteError>.05))reasons.push('supported_probability_bin_error_above_005');
 return {phase:full.phase,status:reasons.length?'criteria_not_met':'reference_criteria_met',reasons,samples:f.samples,jointLogLossGain:f.jointLogLoss!==null&&b.jointLogLoss!==null?b.jointLogLoss-f.jointLogLoss:null,multiclassBrierGain:f.multiclassBrier!==null&&b.multiclassBrier!==null?b.multiclassBrier-f.multiclassBrier:null,binaryBrierComparableAcrossModels:false,unsupportedBins:f.bins.filter(bin=>bin.samples<100).map(bin=>({from:bin.from,to:bin.to,samples:bin.samples})),entireProbabilityRangeVerified:f.bins.every(bin=>bin.samples>=100),analysisReady:false,executionEvidencePassed:false,liveEligible:false,financialActions:0};
}
