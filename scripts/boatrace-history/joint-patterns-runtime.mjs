import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {auditStoredDays} from './quality-audit.mjs';
import {validateDates,storageSafe} from './collector.mjs';
import {JOINT_RUNTIME_DIRECTORY} from './joint-runtime.mjs';
import {createJointDatasetBuilder,splitJointDataset,digestJointDataset,fitJointFeatureSpec,acceptJointFeatureSpec,jointInputAt,normalizeJointSplits} from './joint-dataset.mjs';
import {predictJoint,conditionalDistribution,withJointTemperature,indexOfJointTriple,JOINT_MODEL_VERSION} from './joint-model.mjs';
import {compactResearchRace,RESEARCH_FEATURES} from './pattern-research.mjs';

const ROOT='/app/apps/kelly-edge/data/keirin-history';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const LIMIT=128*1024,MAX_MS=45*60*1000,MAX_ROWS=75000,TYPED_BYTES=48*1024*1024,BYTE_LIMIT=96*1024*1024,CHUNK=4096,WIDTH=RESEARCH_FEATURES.length;
const COMPACT_ENTRY_OVERHEAD=96,VARIANTS=['full','lane_only'],SPLIT_NAMES=['train','calibration','selection','holdout'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>sha(JSON.stringify(value));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const plain=v=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const missing=error=>error?.code==='ENOENT';
const flags={analysisReady:false,executionEvidencePassed:false,liveEligible:false,financialActions:0,networkRequests:0};
const PROFILE_OVERRIDES=Object.freeze({standard:Object.freeze({}),large:Object.freeze({maxCandidates:131072,beamWidth:256,maxDepth:8})});
export function jointPatternProfile(name='standard'){
 if(typeof name!=='string'||!Object.hasOwn(PROFILE_OVERRIDES,name))throw Error('invalid_boat_joint_patterns_profile');
 return {name,overrides:PROFILE_OVERRIDES[name]};
}

// ---------- parent artifact acceptance (read-only, fail closed, never fits) ----------
async function safeDirectory(io,file){const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isDirectory())throw Error('joint_artifact_rejected');}
async function readArtifactFile(io,file){
 const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>LIMIT)throw Error('joint_artifact_rejected');
 let bytes;
 if(typeof io.open==='function'){
  const handle=await io.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>LIMIT)throw Error('joint_artifact_rejected');bytes=await handle.readFile();}finally{await handle.close();}
 }else bytes=await io.readFile(file);
 if(bytes.length>LIMIT)throw Error('joint_artifact_rejected');return Buffer.from(bytes);
}
const parseJson=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
function restoreVariant(stored,variant,input,report){
 const reject=()=>{throw Error('joint_artifact_rejected');};
 if(!plain(stored)||stored.version!==JOINT_MODEL_VERSION||stored.status!=='complete'||stored.heads!==3||stored.featureCount!==318||stored.variant!==variant||stored.trainingPolicy?.variant!==variant||stored.datasetDigest!==input.datasetDigest)reject();
 if(!Array.isArray(stored.weights)||stored.weights.length!==954||!stored.weights.every(finite)||!finite(stored.temperature)||stored.temperature<=0||!HASH.test(stored.modelDigest??'')||!HASH.test(stored.parameterDigest??''))reject();
 const featureSpec=acceptJointFeatureSpec(stored.featureSpec,{splits:normalizeJointSplits(input.splitBounds)});if(featureSpec.digest!==input.featureSpecDigest)reject();
 const summary=report.models?.[variant];if(!plain(summary)||summary.modelDigest!==stored.modelDigest||summary.parameterDigest!==undefined&&summary.parameterDigest!==stored.parameterDigest||summary.temperature!==undefined&&summary.temperature!==stored.temperature)reject();
 const recomputed=withJointTemperature({...stored,weights:Float64Array.from(stored.weights),featureSpec},stored.temperature);
 if(recomputed.modelDigest!==stored.modelDigest||recomputed.parameterDigest!==stored.parameterDigest)reject();
 return Object.freeze(recomputed);
}
async function acceptUnchecked({directory,runId,expected,io}){
 const reject=()=>{throw Error('joint_artifact_rejected');};
 if(directory!==JOINT_RUNTIME_DIRECTORY||typeof runId!=='string'||!UUID.test(runId)||!plain(expected)||!HASH.test(expected.inputDigest??'')||!HASH.test(expected.modelArtifactSha256??''))reject();
 const runDirectory=path.posix.join(directory,'research','joint',runId);
 for(const file of [ROOT,directory,path.posix.join(directory,'research'),path.posix.join(directory,'research','joint'),runDirectory])await safeDirectory(io,file);
 const inputBytes=await readArtifactFile(io,path.posix.join(runDirectory,'input.json')),modelBytes=await readArtifactFile(io,path.posix.join(runDirectory,'model.json')),reportBytes=await readArtifactFile(io,path.posix.join(runDirectory,'report.json'));
 const input=parseJson(inputBytes),model=parseJson(modelBytes),report=parseJson(reportBytes);
 if(!plain(input)||!plain(model)||!plain(report))reject();
 if(report.status!=='complete'||report.schemaVersion!==1||report.runId!==runId||report.inputDigest!==expected.inputDigest||report.modelArtifactSha256!==expected.modelArtifactSha256)reject();
 const {inputDigest,...inputBody}=input;
 if(inputDigest!==expected.inputDigest||hash(inputBody)!==expected.inputDigest||input.schemaVersion!==1||input.runId!==runId)reject();
 if(!HASH.test(input.sourceSnapshotSha256??'')||!HASH.test(input.datasetDigest??'')||!HASH.test(input.featureSpecDigest??'')||!plain(input.range)||typeof input.range.from!=='string'||typeof input.range.to!=='string'||!Number.isSafeInteger(input.range.days)||!Number.isSafeInteger(input.eligibleRaces)||input.eligibleRaces<1||input.eligibleRaces>MAX_ROWS)reject();
 if(report.sourceSnapshotSha256!==undefined&&report.sourceSnapshotSha256!==input.sourceSnapshotSha256)reject();
 if(sha(modelBytes)!==expected.modelArtifactSha256||model.inputDigest!==expected.inputDigest||model.runId!==runId||model.featureSpecDigest!==undefined&&model.featureSpecDigest!==input.featureSpecDigest||!plain(model.models))reject();
 const models={};for(const variant of VARIANTS)models[variant]=restoreVariant(model.models[variant],variant,input,report);
 return {runId,input:Object.freeze(input),report,models:Object.freeze(models),modelArtifactSha256:expected.modelArtifactSha256};
}
/** Accepts a previously trained joint run without retraining; any deviation rejects. */
export async function acceptJointArtifact({directory,runId,expected,io=fs}){
 try{return await acceptUnchecked({directory,runId,expected,io});}catch{throw Error('joint_artifact_rejected');}
}

// ---------- row dataset (minimal safe join) ----------
function scoreDistribution(distribution,actual){
 const probabilities=distribution?.probabilities,logs=distribution?.logProbabilities;
 if(probabilities?.length!==120||logs?.length!==120)throw Error('joint_patterns_prediction_invalid');
 let squares=0;for(let i=0;i<120;i++)squares+=probabilities[i]*probabilities[i];
 const logLoss=-logs[actual],brier=Math.min(2,Math.max(0,squares-2*probabilities[actual]+1));
 if(!finite(logLoss)||!finite(brier))throw Error('joint_patterns_prediction_invalid');return {logLoss,brier};
}
const resourceError=error=>/(byte|row)_limit$/.test(error?.message??'')?Error('joint_patterns_byte_limit'):error;

/** Rebuilds the parent's typed dataset, verifies it against the artifact and attaches per-row predictions. */
export async function buildJointPatternRows({directory,dates,artifact,signal,deadlineMs=Infinity,onProgress=()=>{}},ports={}){
 const now=ports.now??Date.now,audit=ports.audit??auditStoredDays,builderFactory=ports.datasetBuilder??createJointDatasetBuilder,compact=ports.compact??compactResearchRace,split=ports.split??splitJointDataset,datasetDigest=ports.datasetDigest??digestJointDataset,fitSpec=ports.fitSpec??fitJointFeatureSpec,inputAt=ports.inputAt??jointInputAt,predict=ports.predict??predictJoint,conditional=ports.conditional??conditionalDistribution,yieldControl=ports.yieldControl??(()=>new Promise(resolve=>setImmediate(resolve)));
 const rowsBuilderFactory=ports.rowsBuilder??(await import('./joint-patterns.mjs')).createJointPatternRowsBuilder;
 const check=()=>{if(signal?.aborted)throw Error('joint_patterns_cancelled');if(now()>=deadlineMs)throw Error('joint_patterns_timeout');};
 const mismatch=()=>Error('joint_patterns_join_mismatch');
 const input=artifact?.input,models=artifact?.models;
 if(!Array.isArray(dates)||!dates.length||!plain(input)||!models?.full||!models?.lane_only)throw mismatch();
 check();
 const splits=normalizeJointSplits(input.splitBounds);let builder=builderFactory({maxRaces:MAX_ROWS,maxBytes:TYPED_BYTES,splits});
 const requested=new Set(dates),verified=new Set(),snapshot=createHash('sha256'),compactIndex=new Map(),compactDates=[],chunks=[];
 let compactRows=0,compactIneligible=0,compactBytes=0,callbackFailure=null;
 // Until finish() the typed dataset is bounded by its own 48MiB ceiling; the exact figure is rechecked afterwards.
 const storeCompact=row=>{
  if(typeof row.key!=='string'||compactIndex.has(row.key))throw mismatch();if(compactRows>=MAX_ROWS)throw Error('joint_patterns_byte_limit');
  const chunk=Math.floor(compactRows/CHUNK),offset=(compactRows%CHUNK)*WIDTH,added=(chunks[chunk]?0:CHUNK*WIDTH*8)+Buffer.byteLength(row.key)+Buffer.byteLength(String(row.date))+COMPACT_ENTRY_OVERHEAD;
  if(TYPED_BYTES+compactBytes+added>BYTE_LIMIT)throw Error('joint_patterns_byte_limit');compactBytes+=added;if(!chunks[chunk])chunks[chunk]=new Float64Array(CHUNK*WIDTH);
  for(let f=0;f<WIDTH;f++){const value=row.context?.[RESEARCH_FEATURES[f].id];chunks[chunk][offset+f]=finite(value)?value:NaN;}
  compactIndex.set(row.key,compactRows);compactDates.push(row.date);compactRows++;
 };
 const quality=await audit({directory,dates,signal,now,
  onProgress:p=>{if(callbackFailure)throw callbackFailure;const safe={phase:'normalizing'};for(const key of ['processedDays','requestedDays','races','normalStructureRaces','failedDays'])if(finite(p?.[key]))safe[key]=p[key];onProgress(safe);},
  onNormalizedDay:(day,evidence)=>{try{
   check();
   if(typeof evidence?.date!=='string'||!requested.has(evidence.date)||verified.has(evidence.date)||!HASH.test(evidence.sha256??'')||day?.date!==evidence.date||day.status!=='normalized'||!Array.isArray(day.races)||day.races.some(race=>race?.date!==evidence.date))throw mismatch();
   verified.add(evidence.date);snapshot.update(evidence.date+':'+evidence.sha256+'\n');
   for(const race of day.races){
    try{builder.append(race);}catch(error){throw resourceError(error);}
    const row=compact(race);
    if(row?.eligible===true){if(row.key!==race.raceKey||row.date!==evidence.date)throw mismatch();storeCompact(row);}else compactIneligible++;
   }
  }catch(error){callbackFailure=error;throw error;}}});
 check();if(callbackFailure)throw callbackFailure;
 if(quality?.status!=='complete'||quality.failedDays!==0||quality.verifiedRawDays!==dates.length||quality.processedDays!==dates.length||verified.size!==dates.length)throw mismatch();
 const sourceSnapshotSha256=snapshot.digest('hex');if(sourceSnapshotSha256!==input.sourceSnapshotSha256)throw mismatch();
 let dataset;try{dataset=builder.finish();}catch(error){throw resourceError(error);}builder=null;
 if(datasetDigest(dataset)!==input.datasetDigest||dataset.size!==input.eligibleRaces)throw mismatch();
 const partitions=split(dataset,splits);let specDigest;try{specDigest=fitSpec(dataset,partitions.train,{splits}).digest;}catch{throw mismatch();}
 if(specDigest!==input.featureSpecDigest||specDigest!==models.full.featureSpec?.digest)throw mismatch();
 const typedBytes=dataset.memoryBytesEstimate;if(!finite(typedBytes)||typedBytes<0||typedBytes+compactBytes>=BYTE_LIMIT)throw Error('joint_patterns_byte_limit');
 const splitOf=new Int8Array(dataset.size).fill(-1);SPLIT_NAMES.forEach((name,code)=>{for(const index of partitions[name]??[])splitOf[index]=code;});
 let rowsBuilder;try{rowsBuilder=rowsBuilderFactory({maxRows:MAX_ROWS,maxBytes:Math.min(TYPED_BYTES,BYTE_LIMIT-typedBytes-compactBytes),splits});}catch(error){throw resourceError(error);}
 const joinStats={typedRows:dataset.size,compactRows,compactIneligible,compactMissing:0,typedMissing:0,joined:0,outsideSplits:0};let matched=0;
 onProgress({phase:'predicting',rows:0,total:dataset.size});
 for(let i=0;i<dataset.size;i++){
  if(i%256===0){check();await yieldControl();if(i)onProgress({phase:'predicting',rows:i,total:dataset.size});}
  const at=compactIndex.get(dataset.keys[i]);if(at===undefined){joinStats.compactMissing++;continue;}
  if(compactDates[at]!==dataset.dates[i])throw mismatch();matched++;
  if(splitOf[i]<0){joinStats.outsideSplits++;continue;}
  const chunk=chunks[Math.floor(at/CHUNK)],offset=(at%CHUNK)*WIDTH,context=Float64Array.from(chunk.subarray(offset,offset+WIDTH));
  const modelInput=inputAt(dataset,i),actualTriple=indexOfJointTriple(dataset.targets.subarray(i*3,i*3+3));
  const full=predict(models.full,modelInput),predictedTriple=indexOfJointTriple(full?.topTriple);
  if(actualTriple<0||predictedTriple<0||!finite(full.topProbability))throw Error('joint_patterns_prediction_invalid');
  const raw=predict(models.full,modelInput,{temperature:1}),head=conditional(models.full,modelInput,0,[],{temperature:1});
  const firstLane=Number(String(full.topTriple).split('-')[0]),laneIndex=Array.from(head?.lanes??[]).indexOf(firstLane),firstHeadProbability=laneIndex<0?NaN:head.probabilities[laneIndex];
  if(!finite(raw?.topProbability)||!finite(firstHeadProbability))throw Error('joint_patterns_prediction_invalid');
  const fullScore=scoreDistribution(full,actualTriple),laneScore=scoreDistribution(predict(models.lane_only,modelInput),actualTriple);
  const marketTriple=indexOfJointTriple(dataset.marketReferenceTriples?.[i]??null),marketTieCount=marketTriple<0?0:dataset.marketTieCounts?.[i]??0;
  try{rowsBuilder.append({key:dataset.keys[i],date:dataset.dates[i],split:splitOf[i],context,predictedTriple,actualTriple,probability:full.topProbability,confidence:raw.topProbability,firstHeadProbability,fullJointLogLoss:fullScore.logLoss,fullMulticlassBrier:fullScore.brier,laneJointLogLoss:laneScore.logLoss,laneMulticlassBrier:laneScore.brier,marketTriple,marketTieCount});}catch(error){throw resourceError(error);}
  joinStats.joined++;
 }
 check();joinStats.typedMissing=compactRows-matched;
 let rows;try{rows=rowsBuilder.finish();}catch(error){throw resourceError(error);}
 if(!finite(rows?.memoryBytesEstimate)||typedBytes+compactBytes+rows.memoryBytesEstimate>BYTE_LIMIT)throw Error('joint_patterns_byte_limit');
 const datasetDigestValue=input.datasetDigest;dataset=null;chunks.length=0;compactIndex.clear();
 return {rows,joinStats,sourceSnapshotSha256,datasetDigest:datasetDigestValue};
}

// ---------- storage ----------
function patternsContext(directory,runId){if(directory!==JOINT_RUNTIME_DIRECTORY||typeof runId!=='string'||!UUID.test(runId))throw Error('joint_patterns_storage_context_invalid');return path.posix.join(directory,'research','joint-patterns',runId);}
async function regularTarget(io,file){try{const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isFile())throw Error('joint_patterns_storage_unsafe_target');}catch(error){if(!missing(error))throw error;}}
async function directoryTarget(io,file,{create=false,exclusive=false}={}){
 try{const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isDirectory())throw Error('joint_patterns_storage_unsafe_parent');if(exclusive)throw Error('joint_patterns_storage_run_exists');}
 catch(error){if(!missing(error))throw error;if(!create)throw Error('joint_patterns_storage_parent_missing');try{await io.mkdir(file,{mode:0o700});}catch(created){if(created?.code!=='EEXIST'||exclusive)throw created;}const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isDirectory())throw Error('joint_patterns_storage_unsafe_parent');}
}
export function createJointPatternStorage({directory,runId,io=fs,uuid=randomUUID}){
 const runDirectory=patternsContext(directory,runId),research=path.posix.join(directory,'research'),parent=path.posix.join(research,'joint-patterns');let ready=false;
 const base=async()=>{for(const file of [ROOT,directory])await directoryTarget(io,file);};
 const capacity=async()=>{await base();if(!storageSafe(await io.statfs(directory)))throw Error('joint_patterns_storage_limit');};
 const ensure=async()=>{if(ready){await base();for(const file of [research,parent,runDirectory])await directoryTarget(io,file);return;}await capacity();for(const file of [research,parent])await directoryTarget(io,file,{create:true});await directoryTarget(io,runDirectory,{create:true,exclusive:true});ready=true;};
 const atomic=async(file,value)=>{await capacity();const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>LIMIT)throw Error('joint_patterns_artifact_limit');await regularTarget(io,file);const suffix=uuid();if(!UUID.test(suffix))throw Error('joint_patterns_storage_context_invalid');const temporary=file+'.'+suffix+'.tmp';await io.writeFile(temporary,bytes,{flag:'wx',mode:0o600});await io.rename(temporary,file);return sha(bytes);};
 return {runDirectory,capacity,ensure,
  async write(name,value){if(!['input.json','report.json'].includes(name))throw Error('joint_patterns_storage_name_invalid');await ensure();return atomic(path.posix.join(runDirectory,name),value);},
  async latest(status,digest){if(!['complete','stopped','failed'].includes(status)||!HASH.test(digest))throw Error('joint_patterns_pointer_invalid');await ensure();return atomic(path.posix.join(directory,'joint-patterns-latest.json'),{runId,digest,status});}};
}
async function acquireLock(io,file,runId,ownerToken,now){
 try{await regularTarget(io,file);await io.writeFile(file,Buffer.from(JSON.stringify({runId,ownerToken,startedAt:new Date(now()).toISOString()})+'\n'),{flag:'wx',mode:0o600});}
 catch(error){if(error?.code==='EEXIST')throw Error('joint_patterns_locked');throw error;}
}
async function releaseLock(io,file,runId,ownerToken){
 try{const info=await io.lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>4096)return false;const bytes=await io.readFile(file);if(bytes.length>4096)return false;const lock=JSON.parse(bytes.toString('utf8'));if(lock.runId!==runId||lock.ownerToken!==ownerToken)return false;await io.unlink(file);return true;}catch{return false;}
}

// ---------- orchestration ----------
const reportBytes=report=>Buffer.byteLength(JSON.stringify(report)+'\n');
const auditMetrics=metrics=>plain(metrics)?Object.fromEntries(['samples','hits','meanProbability','ece'].map(key=>[key,metrics[key]??null])):null;
function frozenAuditOf(report){
 const tracks=Object.fromEntries(['nll_gain','hit_rate'].map(track=>{
  const source=report.tracks?.[track],candidates=Array.isArray(source?.candidates)?source.candidates:[];
  return [track,{frozenDigest:source?.frozenDigest??null,candidates:candidates.map(candidate=>({
   id:candidate.id,rank:candidate.rank,
   periods:Object.fromEntries(['train','selection','holdout'].map(period=>[period,auditMetrics(candidate[period])])),
   gates:Object.fromEntries(['train','selection','holdout'].map(period=>[period,candidate.gates?.[period]??null])),
   holdoutWilson:candidate.holdout?.wilson95??null,
   monthly:Object.fromEntries(Object.entries(candidate.holdoutMonthly??{}).map(([month,m])=>[month,Object.fromEntries(['samples','hits','meanProbability','signedCalibrationError','binaryBrier','wilson95','support'].map(key=>[key,m[key]??null]))]))
  }))}];
 }));
 return {schemaVersion:1,scope:'candidates_present_before_size_trimming',totalCandidates:Object.values(tracks).reduce((n,track)=>n+track.candidates.length,0),tracks};
}
/** Deterministically trims a report over the artifact limit: diagnostics from the end first, then lowest-ranked frozen candidates, recording every omission. */
export function fitJointPatternReport(report,limit=LIMIT){
 if(!Number.isSafeInteger(limit)||limit<1)throw Error('joint_patterns_artifact_limit');
 const fitted=JSON.parse(JSON.stringify(report)),tracks=['nll_gain','hit_rate'];
 fitted.frozenAudit=frozenAuditOf(fitted);
 if(reportBytes(fitted.frozenAudit)>limit)throw Error('joint_patterns_audit_limit');
 if(plain(fitted.diagnostics))fitted.omittedDiagnostics=Object.fromEntries(tracks.map(track=>[track,0]));
 const longest=(lists)=>{let best=null;for(const track of tracks){const length=lists(track)?.length??0;if(length&&(!best||length>best.length))best={track,length};}return best?.track??null;};
 while(reportBytes(fitted)>limit){
  const diagnostic=plain(fitted.diagnostics)?longest(track=>Array.isArray(fitted.diagnostics[track])?fitted.diagnostics[track]:null):null;
  if(diagnostic){fitted.diagnostics[diagnostic].pop();fitted.omittedDiagnostics[diagnostic]++;continue;}
  const candidate=plain(fitted.tracks)?longest(track=>Array.isArray(fitted.tracks[track]?.candidates)?fitted.tracks[track].candidates:null):null;
  if(!candidate)break;
  const entry=fitted.tracks[candidate];entry.candidates.pop();entry.omittedCandidates=(Number.isSafeInteger(entry.omittedCandidates)?entry.omittedCandidates:0)+1;
 }
 if(reportBytes(fitted)>limit)throw Error('joint_patterns_artifact_limit');
 return fitted;
}
const stoppedReason=error=>({joint_patterns_cancelled:'cancelled',joint_patterns_timeout:'time_limit',joint_patterns_storage_limit:'storage_limit',joint_patterns_byte_limit:'byte_limit',joint_patterns_join_mismatch:'join_mismatch',joint_artifact_rejected:'artifact_rejected'}[error?.message]??null);
const failureReason=error=>['joint_patterns_artifact_limit','joint_patterns_audit_limit','joint_patterns_policy_mismatch','joint_patterns_profile_conflict','joint_patterns_storage_unsafe_target','joint_patterns_storage_unsafe_parent','joint_patterns_storage_run_exists','joint_patterns_storage_parent_missing','joint_patterns_prediction_invalid'].includes(error?.message)?error.message:'joint_patterns_failure';
const PROGRESS_KEYS=['processedDays','requestedDays','races','normalStructureRaces','failedDays','rows','total','typedRows','compactRows','compactMissing','joined','attempted','depth','evaluated'];

/** Server-only exploratory re-analysis on a frozen parent joint run; never trains, orders or logs weights. */
export async function runJointPatternResearch({directory,dates,parentRunId,expected,profile='standard',splits,signal,onProgress=()=>{}},ports={}){
 const selectedProfile=jointPatternProfile(profile);
 const now=ports.now??Date.now,uuid=ports.uuid??randomUUID,runId=uuid(),ownerToken=uuid();patternsContext(directory,runId);if(!UUID.test(ownerToken))throw Error('joint_patterns_storage_context_invalid');
 const requested=validateDates(dates,now(),'backfill'),started=now(),deadlineMs=started+MAX_MS,io=ports.io??fs;
 const storage=createJointPatternStorage({directory,runId,io,uuid}),accept=ports.accept??acceptJointArtifact,buildRows=ports.buildRows??buildJointPatternRows;
 const timeout=new AbortController(),abortSignal=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal,timer=setTimeout(()=>timeout.abort('time_limit'),MAX_MS);
 const lockFile=path.posix.join(directory,'joint-patterns.lock');let phase='starting',inputDigest=null,parent=null,lastProgress={},ownsLock=false;
 const check=()=>{if(signal?.aborted)throw Error('joint_patterns_cancelled');if(timeout.signal.aborted||now()>=deadlineMs)throw Error('joint_patterns_timeout');};
 const emit=(next,details={})=>{check();phase=next;const safe={};for(const key of PROGRESS_KEYS)if(finite(details[key]))safe[key]=details[key];const usage=process.memoryUsage();lastProgress={runId,phase,elapsedMs:now()-started,rssBytes:usage.rss,heapUsedBytes:usage.heapUsed,...safe};onProgress(lastProgress);};
 const saveReport=async report=>{const digest=await storage.write('report.json',report);await storage.latest(report.status,digest);return digest;};
 try{
  check();await storage.capacity();await acquireLock(io,lockFile,runId,ownerToken,now);ownsLock=true;await storage.ensure();
  emit('accepting');
  const artifact=await accept({directory,runId:parentRunId,expected,io});check();
  const range={from:requested[0],to:requested.at(-1),days:requested.length};
  parent={runId:artifact.runId,inputDigest:artifact.input.inputDigest,modelArtifactSha256:artifact.modelArtifactSha256,fullModelDigest:artifact.models.full.modelDigest,laneModelDigest:artifact.models.lane_only.modelDigest,fullTemperature:artifact.models.full.temperature,laneTemperature:artifact.models.lane_only.temperature,sourceSnapshotSha256:artifact.input.sourceSnapshotSha256,datasetDigest:artifact.input.datasetDigest,featureSpecDigest:artifact.input.featureSpecDigest,range:artifact.input.range,globalReferenceCriteriaStatus:artifact.report.referenceCriteriaStatus??null};
  if(parent.range?.from!==range.from||parent.range?.to!==range.to||parent.range?.days!==range.days)throw Error('joint_patterns_join_mismatch');
  const patterns=ports.research&&ports.rowsBuilder?null:await import('./joint-patterns.mjs');
 const research=ports.research??patterns.researchJointPatternsAsync,rowsBuilder=ports.rowsBuilder??patterns.createJointPatternRowsBuilder,basePolicy=ports.policy??patterns?.DEFAULT_JOINT_PATTERN_POLICY??null;
  const internalOverrides=ports.researchOverrides??{};if(!plain(internalOverrides)||!plain(basePolicy))throw Error('joint_patterns_profile_conflict');
  for(const [key,value] of Object.entries(selectedProfile.overrides))if(Object.hasOwn(internalOverrides,key)&&internalOverrides[key]!==value)throw Error('joint_patterns_profile_conflict');
  const parentSplits=normalizeJointSplits(artifact.input.splitBounds);
  if(splits!==undefined&&hash(normalizeJointSplits(splits))!==hash(parentSplits)||internalOverrides.splits!==undefined&&hash(normalizeJointSplits(internalOverrides.splits))!==hash(parentSplits))throw Error('joint_patterns_policy_mismatch');
  const overrides={...internalOverrides,...selectedProfile.overrides};
  if(basePolicy.splits!==undefined||splits!==undefined||artifact.input.splitBounds!==undefined)overrides.splits=parentSplits;
  const policy={...basePolicy,...overrides};
  const input={schemaVersion:1,runId,kind:'exploratory_reanalysis',parent,range,experimentProfile:selectedProfile.name,policy,...flags};inputDigest=hash(input);await storage.write('input.json',{...input,inputDigest});
  emit('normalizing');
  const built=await buildRows({directory,dates:requested,artifact,signal:abortSignal,deadlineMs,onProgress:p=>emit(p?.phase==='predicting'?'predicting':'normalizing',p??{})},{...ports,rowsBuilder,now});
  check();emit('researching',{rows:built.rows.size});
  const body=await research(built.rows,overrides,{signal:abortSignal,deadlineMs,now,onProgress:p=>emit('researching',p)});check();
  if(!plain(body))throw Error('joint_patterns_failure');
  if(!plain(body.policy)||hash(body.policy)!==hash(policy))throw Error('joint_patterns_policy_mismatch');
  const splitCounts={train:0,calibration:0,selection:0,holdout:0};for(const code of built.rows.split??[])if(SPLIT_NAMES[code])splitCounts[SPLIT_NAMES[code]]++;
  const report={...body,schemaVersion:1,version:body.version??'boat_joint_patterns_v3',runId,status:'complete',kind:'exploratory_reanalysis',experimentProfile:selectedProfile.name,generatedAt:new Date(now()).toISOString(),elapsedMs:now()-started,inputDigest,parent,dataset:{...(plain(body.dataset)?body.dataset:{}),rows:built.rows.size,rowsDigest:built.rows.rowsDigest,splitCounts,joinStats:built.joinStats,memoryBytesEstimate:built.rows.memoryBytesEstimate},...flags};
  check();const fitted=fitJointPatternReport(report);await saveReport(fitted);emit('complete');return fitted;
 }catch(error){
  if(error?.message==='joint_patterns_locked')return {schemaVersion:1,runId,status:'blocked',reason:'concurrent_or_stale_joint_patterns_lock',artifactSaved:false,...flags};
  const reason=signal?.aborted?'cancelled':timeout.signal.aborted||now()>=deadlineMs?'time_limit':stoppedReason(error),report={schemaVersion:1,version:'boat_joint_patterns_v3',runId,status:reason?'stopped':'failed',reason:reason??failureReason(error),kind:'exploratory_reanalysis',experimentProfile:selectedProfile.name,phase,inputDigest,parent,elapsedMs:now()-started,progress:lastProgress,...flags};
  try{await saveReport(report);return {...report,artifactSaved:true};}catch{return {...report,artifactSaved:false};}
 }finally{clearTimeout(timer);if(ownsLock&&!await releaseLock(io,lockFile,runId,ownerToken))onProgress({runId,phase:'lock_release_failed',reason:'owner_mismatch_or_io_error',...flags});}
}
