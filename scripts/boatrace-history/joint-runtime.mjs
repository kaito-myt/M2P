import * as fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {auditStoredDays} from './quality-audit.mjs';
import {validateDates,storageSafe} from './collector.mjs';
import {createJointDatasetBuilder,fitJointFeatureSpec,splitJointDataset,digestJointDataset,normalizeJointSplits,JOINT_SPLITS,JOINT_DATASET_VERSION} from './joint-dataset.mjs';
import {fitJointModel,DEFAULT_JOINT_POLICY,JOINT_MODEL_VERSION} from './joint-model.mjs';
import {fitJointTemperature,evaluateJointModel,compareJointEvaluations} from './joint-evaluation.mjs';
import {COVERAGE_POLICY} from './joint-ticket-coverage.mjs';

export const JOINT_RUNTIME_DIRECTORY='/app/apps/kelly-edge/data/keirin-history/boatrace-history';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const LIMIT=128*1024,MAX_MS=45*60*1000;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const flags={analysisReady:false,executionEvidencePassed:false,liveEligible:false,financialActions:0,networkRequests:0};
const missing=error=>error?.code==='ENOENT';
function context(directory,runId){if(directory!==JOINT_RUNTIME_DIRECTORY||!UUID.test(runId))throw Error('joint_storage_context_invalid');return path.posix.join(directory,'research','joint',runId);}
async function regularTarget(io,file){try{const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isFile())throw Error('joint_storage_unsafe_target');}catch(error){if(!missing(error))throw error;}}
async function directoryTarget(io,file,{create=false,exclusive=false}={}){
 try{const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isDirectory())throw Error('joint_storage_unsafe_parent');if(exclusive)throw Error('joint_storage_run_exists');}
 catch(error){if(!missing(error))throw error;if(!create)throw Error('joint_storage_parent_missing');try{await io.mkdir(file,{mode:0o700});}catch(created){if(created?.code!=='EEXIST'||exclusive)throw created;}const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isDirectory())throw Error('joint_storage_unsafe_parent');}
}
export function createJointRunStorage({directory,runId,io=fs,uuid=randomUUID}){
 const runDirectory=context(directory,runId);let ready=false;
 const base=async()=>{for(const file of ['/app/apps/kelly-edge/data/keirin-history',directory])await directoryTarget(io,file);};
 const ensure=async()=>{await base();if(ready){for(const file of [path.posix.join(directory,'research'),path.posix.join(directory,'research','joint'),runDirectory])await directoryTarget(io,file);return;}if(!storageSafe(await io.statfs(directory)))throw Error('joint_storage_limit');for(const file of [path.posix.join(directory,'research'),path.posix.join(directory,'research','joint')])await directoryTarget(io,file,{create:true});await directoryTarget(io,runDirectory,{create:true,exclusive:true});ready=true;};
 const capacity=async()=>{await base();if(!storageSafe(await io.statfs(directory)))throw Error('joint_storage_limit');};
 const atomic=async(file,value)=>{await capacity();const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>LIMIT)throw Error('joint_artifact_limit');await regularTarget(io,file);const suffix=uuid();if(!UUID.test(suffix))throw Error('joint_storage_context_invalid');const temporary=file+'.'+suffix+'.tmp';await io.writeFile(temporary,bytes,{flag:'wx',mode:0o600});await io.rename(temporary,file);return createHash('sha256').update(bytes).digest('hex');};
 return {runDirectory,capacity,ensure,async write(name,value){if(!['input.json','model.json','report.json'].includes(name))throw Error('joint_storage_name_invalid');await ensure();return atomic(path.posix.join(runDirectory,name),value);},async latest(status,digest){if(!['running','complete','stopped','failed'].includes(status)||!HASH.test(digest))throw Error('joint_pointer_invalid');await ensure();return atomic(path.posix.join(directory,'joint-research-latest.json'),{runId,digest,status});}};
}
const completeModel=(model,variant,datasetDigest)=>{
 if(model?.version!==JOINT_MODEL_VERSION||model.status!=='complete'||model.heads!==3||model.featureCount!==318||model.variant!==variant||model.trainingPolicy?.variant!==variant||model.datasetDigest!==datasetDigest||!(model.weights instanceof Float64Array)||model.weights.length!==954||model.weights.some(value=>!Number.isFinite(value))||!HASH.test(model.modelDigest??'')||!HASH.test(model.parameterDigest??''))throw Error('joint_model_artifact_invalid');
};
const stoppedReason=error=>({joint_research_cancelled:'cancelled',joint_evaluation_cancelled:'cancelled',joint_research_timeout:'time_limit',joint_evaluation_timeout:'time_limit',joint_storage_limit:'storage_limit',joint_dataset_byte_limit:'dataset_byte_limit',joint_dataset_row_limit:'dataset_row_limit',joint_dataset_incomplete:'dataset_incomplete',joint_training_empty:'training_data_empty',joint_training_months_insufficient:'training_months_insufficient'}[error?.message]??null);
const failureReason=error=>['joint_artifact_limit','joint_storage_unsafe_target','joint_storage_unsafe_parent','joint_storage_run_exists','joint_model_artifact_invalid','joint_comparison_cohort_mismatch','joint_dataset_mutated'].includes(error?.message)?error.message:'joint_research_failure';
async function acquireLock(io,file,runId,ownerToken,now){
 try{await regularTarget(io,file);await io.writeFile(file,Buffer.from(JSON.stringify({runId,ownerToken,startedAt:new Date(now()).toISOString()})+'\n'),{flag:'wx',mode:0o600});}
 catch(error){if(error?.code==='EEXIST')throw Error('joint_research_locked');throw error;}
}
async function releaseLock(io,file,runId,ownerToken){
 try{const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>4096)return false;const bytes=await io.readFile(file);if(bytes.length>4096)return false;const lock=JSON.parse(bytes.toString('utf8'));if(lock.runId!==runId||lock.ownerToken!==ownerToken)return false;await io.unlink(file);return true;}catch{return false;}
}

/** Server-only orchestration of retrospective probability research, never orders. */
export async function runJointResearch({directory,dates,splits=JOINT_SPLITS,minimumTrainingMonths=0,signal,onProgress=()=>{}},ports={}){
 if(!Number.isSafeInteger(minimumTrainingMonths)||minimumTrainingMonths<0||minimumTrainingMonths>12)throw Error('invalid_joint_training_months');
 splits=normalizeJointSplits(splits);
 const now=ports.now??Date.now,runId=(ports.uuid??randomUUID)(),ownerToken=(ports.uuid??randomUUID)();context(directory,runId);if(!UUID.test(ownerToken))throw Error('joint_storage_context_invalid');const requested=validateDates(dates,now(),'backfill'),started=now(),deadlineMs=started+MAX_MS,io=ports.io??fs;
 const storage=createJointRunStorage({directory,runId,io,uuid:ports.uuid??randomUUID}),audit=ports.audit??auditStoredDays,builderFactory=ports.builderFactory??createJointDatasetBuilder,fitSpec=ports.fitSpec??fitJointFeatureSpec,split=ports.split??splitJointDataset,datasetDigest=ports.datasetDigest??digestJointDataset,fit=ports.fit??fitJointModel,calibrate=ports.calibrate??fitJointTemperature,evaluate=ports.evaluate??evaluateJointModel,compare=ports.compare??compareJointEvaluations,yieldControl=ports.yieldControl??(()=>new Promise(resolve=>setImmediate(resolve)));
 const timeout=new AbortController(),abortSignal=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal,timer=setTimeout(()=>timeout.abort('time_limit'),MAX_MS);
 let phase='starting',inputDigest=null,quality=null,dataset=null,spec=null,reference=null,lastProgress={},ownsLock=false;const lockFile=path.posix.join(directory,'joint-research.lock'),models={},evaluations={},calibrations={},training={};
 const check=()=>{if(signal?.aborted)throw Error('joint_research_cancelled');if(timeout.signal.aborted||now()>=deadlineMs)throw Error('joint_research_timeout');};
 const emit=(next,details={})=>{check();phase=next;const safe={};for(const key of ['processedDays','requestedDays','races','normalStructureRaces','failedDays','epoch','batches','examplesProcessed','meanNll','evaluated','total','rows','features'])if(typeof details[key]==='number'&&Number.isFinite(details[key]))safe[key]=details[key];if(['full','lane_only'].includes(details.variant))safe.variant=details.variant;if(['selection','holdout'].includes(details.stage))safe.stage=details.stage;const usage=process.memoryUsage();lastProgress={runId,phase,elapsedMs:now()-started,rssBytes:usage.rss,heapUsedBytes:usage.heapUsed,...safe};onProgress(lastProgress);};
 const saveReport=async report=>{const digest=await storage.write('report.json',report);await storage.latest(report.status,digest);return digest;};
 try{
  check();await storage.capacity();await acquireLock(io,lockFile,runId,ownerToken,now);ownsLock=true;await storage.ensure();emit('normalizing');const builder=builderFactory({maxRaces:75000,maxBytes:48*1024*1024,splits}),snapshot=createHash('sha256'),verifiedDates=new Set();let callbackFailure=null;
  quality=await audit({directory,dates:requested,signal:abortSignal,now,onProgress:p=>{if(callbackFailure)throw callbackFailure;emit('normalizing',p);},onNormalizedDay:(day,evidence)=>{try{check();if(typeof evidence?.date!=='string'||!requested.includes(evidence.date)||verifiedDates.has(evidence.date)||!HASH.test(evidence.sha256??'')||day?.date!==evidence.date||day.status!=='normalized'||!Array.isArray(day.races)||day.races.some(row=>row.date!==evidence.date))throw Error('joint_dataset_incomplete');verifiedDates.add(evidence.date);snapshot.update(evidence.date+':'+evidence.sha256+'\n');for(const row of day.races)builder.append(row);}catch(error){callbackFailure=error;throw error;}}});
  check();if(quality.status!=='complete'||quality.failedDays!==0||quality.verifiedRawDays!==requested.length||quality.processedDays!==requested.length||verifiedDates.size!==requested.length)throw Error('joint_dataset_incomplete');
  dataset=builder.finish();const frozenDatasetDigest=datasetDigest(dataset);if(!HASH.test(frozenDatasetDigest))throw Error('joint_dataset_incomplete');const partitions=split(dataset,splits);if(!partitions.train.length)throw Error('joint_training_empty');
  const trainingMonths=Array.isArray(dataset.dates)?[...new Set(Array.from(partitions.train,index=>dataset.dates[index].slice(0,7)))].sort():[];if(trainingMonths.length<minimumTrainingMonths)throw Error('joint_training_months_insufficient');
  spec=fitSpec(dataset,partitions.train,{splits});const input={schemaVersion:1,runId,kind:'exploratory_reanalysis',source:quality.source??'turnmark_v1',normalizerVersion:quality.normalizerVersion??null,datasetVersion:dataset.version??JOINT_DATASET_VERSION,sourceSnapshotSha256:snapshot.digest('hex'),datasetDigest:frozenDatasetDigest,range:{from:requested[0],to:requested.at(-1),days:requested.length},splitBounds:splits,splitCounts:Object.fromEntries(Object.entries(partitions).map(([name,indices])=>[name,indices.length])),minimumTrainingMonths,trainingMonths,races:quality.races,eligibleRaces:dataset.size,exclusions:dataset.exclusions??{},allocatedBufferBytes:dataset.allocatedBufferBytes??null,memoryBytesEstimate:dataset.memoryBytesEstimate??null,featureSpecDigest:spec.digest,policy:DEFAULT_JOINT_POLICY,coveragePolicy:COVERAGE_POLICY,...flags};
  inputDigest=hash(input);await storage.write('input.json',{...input,inputDigest});await saveReport({schemaVersion:1,runId,status:'running',phase,inputDigest,...flags});
  for(const variant of ['full','lane_only']){
   check();await storage.capacity();emit('training',{variant,rows:partitions.train.length,features:spec.featureCount});
   let model=await fit(dataset,spec,{...DEFAULT_JOINT_POLICY,variant},{splits,signal:abortSignal,now,yieldControl,onProgress:p=>emit('training',{...p,variant})});check();
   if(model?.status==='stopped')throw Error(model.reason==='cancelled'?'joint_research_cancelled':model.reason==='time_limit'?'joint_research_timeout':'joint_model_artifact_invalid');completeModel(model,variant,frozenDatasetDigest);if(datasetDigest(dataset)!==frozenDatasetDigest)throw Error('joint_dataset_mutated');
   training[variant]=model.trainingSummary;emit('calibrating',{variant});
   const calibrated=await calibrate(model,dataset,partitions.calibration,{splits,signal:abortSignal,now,deadlineMs,yieldControl,onProgress:p=>emit('calibrating',{...p,variant})});check();model=calibrated.model;completeModel(model,variant,frozenDatasetDigest);if(datasetDigest(dataset)!==frozenDatasetDigest)throw Error('joint_dataset_mutated');calibrations[variant]=calibrated.calibration;models[variant]=model;
   evaluations[variant]={};for(const stage of ['selection','holdout']){check();emit('evaluating',{variant,stage,total:partitions[stage].length});evaluations[variant][stage]=await evaluate(model,dataset,partitions[stage],{phase:stage,splits,signal:abortSignal,now,deadlineMs,yieldControl,onProgress:p=>emit('evaluating',{...p,variant,stage})});check();}
   await yieldControl();
  }
  check();if(datasetDigest(dataset)!==frozenDatasetDigest)throw Error('joint_dataset_mutated');reference={selection:compare(evaluations.full.selection,evaluations.lane_only.selection),holdout:compare(evaluations.full.holdout,evaluations.lane_only.holdout)};
  const modelArtifact={schemaVersion:1,runId,inputDigest,featureSpecDigest:spec.digest,models:Object.fromEntries(Object.entries(models).map(([variant,model])=>[variant,{...model,weights:Array.from(model.weights)}])),...flags},modelArtifactSha256=await storage.write('model.json',modelArtifact);
  const calibrationInsufficient=Object.values(calibrations).some(value=>value.status!=='fitted'),report={schemaVersion:1,runId,status:'complete',kind:'exploratory_reanalysis',generatedAt:new Date(now()).toISOString(),inputDigest,modelArtifactSha256,sourceSnapshotSha256:input.sourceSnapshotSha256,dataset:{digest:frozenDatasetDigest,rows:dataset.size,races:quality.races,days:requested.length,splitCounts:input.splitCounts,allocatedBufferBytes:input.allocatedBufferBytes,memoryBytesEstimate:input.memoryBytesEstimate,exclusions:input.exclusions},featureSpec:{digest:spec.digest,featureCount:spec.featureCount,unlearned:spec.unlearned,contextUnlearned:spec.contextUnlearned,trainClipped:spec.trainClipped,contextTrainClipped:spec.contextTrainClipped},models:Object.fromEntries(Object.entries(models).map(([variant,model])=>[variant,{modelDigest:model.modelDigest,parameterDigest:model.parameterDigest,temperature:model.temperature,trainingPolicy:model.trainingPolicy,trainingSummary:training[variant],calibration:calibrations[variant],evaluations:evaluations[variant]}])),comparisons:reference,referenceCriteriaStatus:!calibrationInsufficient&&Object.values(reference).every(value=>value.status==='reference_criteria_met')?'reference_criteria_met':'criteria_not_met',calibrationInsufficient,selectedVariant:null,elapsedMs:now()-started,...flags,limitations:['historical_timing_and_units_unverified','previously_observed_holdout_exploratory_reanalysis','not_all_inventory_features_implemented','not_purchase_recommendations','no_profit_or_future_accuracy_guarantee','small_probability_bins_not_verified']};
  check();await saveReport(report);emit('complete');return report;
 }catch(error){
  if(error?.message==='joint_research_locked')return {schemaVersion:1,runId,status:'blocked',reason:'concurrent_or_stale_joint_lock',artifactSaved:false,...flags};
  const reason=signal?.aborted?'cancelled':timeout.signal.aborted||now()>=deadlineMs?'time_limit':stoppedReason(error),report={schemaVersion:1,runId,status:reason?'stopped':'failed',reason:reason??failureReason(error),phase,inputDigest,elapsedMs:now()-started,progress:lastProgress,completedVariants:Object.keys(models),...flags};
  try{await saveReport(report);return {...report,artifactSaved:true};}catch{return {...report,artifactSaved:false};}
 }finally{clearTimeout(timer);if(ownsLock&&!await releaseLock(io,lockFile,runId,ownerToken))onProgress({runId,phase:'lock_release_failed',reason:'owner_mismatch_or_io_error',...flags});}
}
