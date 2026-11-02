import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {collectDates,dateRange,storageSafe} from './collector.mjs';
import {JOINT_RUNTIME_DIRECTORY,runJointResearch} from './joint-runtime.mjs';
import {runJointPatternResearch,acceptJointArtifact} from './joint-patterns-runtime.mjs';
import {normalizeJointSplits} from './joint-dataset.mjs';
import {COVERAGE_POLICY} from './joint-ticket-coverage.mjs';

const ROOT='/app/apps/kelly-edge/data/keirin-history',FLOOR='2025-10-01',LIMIT=128*1024,LEASE_MS=10*60000;
export const MONTHLY_POLICY_VERSION='monthly_six_month_holdout_v2';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const flags={financialActions:0,liveEligible:false,analysisReady:false,executionEvidencePassed:false};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),missing=e=>e?.code==='ENOENT';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const iso=n=>new Date(n).toISOString();
const monthDate=(month,offset=0)=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('invalid_monthly_month');const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,10);};
const dueOf=month=>Date.parse(monthDate(month)+'T00:00:00Z')-6*3600000;

export function monthlyPlan(now=Date.now()){
 if(!Number.isFinite(now))throw Error('invalid_monthly_clock');
 const current=new Date(now+9*3600000).toISOString().slice(0,7),beforeDue=now<dueOf(current),targetMonth=monthDate(current,beforeDue?-2:-1).slice(0,7);
 const end=monthDate(targetMonth,1),requestedFrom=monthDate(targetMonth,-11),from=requestedFrom<FLOOR?FLOOR:requestedFrom,to=new Date(Date.parse(end+'T00:00:00Z')-864e5).toISOString().slice(0,10);
 const calibrationFrom=monthDate(targetMonth,-7),selectionFrom=monthDate(targetMonth,-6),holdoutFrom=monthDate(targetMonth,-5);
 const trainMonths=(Number(calibrationFrom.slice(0,4))-Number(from.slice(0,4)))*12+Number(calibrationFrom.slice(5,7))-Number(from.slice(5,7));
 const splits=trainMonths>=3?normalizeJointSplits({trainFrom:from,calibrationFrom,selectionFrom,holdoutFrom,holdoutTo:end}):null;
 const policyDigest=digest({version:MONTHLY_POLICY_VERSION,lookbackMonths:12,holdoutMonths:6,minTrainMonths:3,sourceFloor:FLOOR,sourcePolicy:'legacy_v3_2025_oct_dec_then_turnmark_v1',legacyLabels:'legacy_three_archive_label_only_v1',coverageVersion:COVERAGE_POLICY.version,profile:'standard'});
 return {policyVersion:MONTHLY_POLICY_VERSION,policyDigest,holdoutMonths:6,targetMonth,dueAt:iso(dueOf(monthDate(targetMonth,1).slice(0,7))),nextDueAt:iso(dueOf(beforeDue?current:monthDate(current,1).slice(0,7))),requestedRange:{from:requestedFrom,to},availableRange:{from,to},limitedHistory:from!==requestedFrom,trainMonths,splits,eligible:trainMonths>=3&&from<=to};
}

export function monthlyConfig(env){
 if(env.KELLY_BOAT_MONTHLY_ANALYSIS_ENABLED!=='true')return null;
 if(env.RAILWAY_PROJECT_ID!=='c4001a55-2b65-4500-a020-3f9ed6044999'||env.RAILWAY_SERVICE_ID!=='b8677845-6549-4ab3-9970-aa885969e2c4'||env.RAILWAY_ENVIRONMENT_ID!=='4f8f4624-6ebf-4da2-b30d-bb9bbbe36df0'||env.RAILWAY_VOLUME_MOUNT_PATH!==ROOT)throw Error('invalid_monthly_runtime_context');
 return {directory:JOINT_RUNTIME_DIRECTORY,maxAttempts:3,retryMs:3600000,pollMs:60000,profile:'standard'};
}

async function checkedDirectory(io,file,{create=false}={}){
 try{const s=await io.lstat(file);if(s.isSymbolicLink()||!s.isDirectory())throw Error('monthly_unsafe_directory');}
 catch(e){if(!missing(e)||!create)throw e;try{await io.mkdir(file,{mode:0o700});}catch(created){if(created?.code!=='EEXIST')throw created;}const s=await io.lstat(file);if(s.isSymbolicLink()||!s.isDirectory())throw Error('monthly_unsafe_directory');}
}
async function jsonFile(io,file){
 try{const s=await io.lstat(file);if(s.isSymbolicLink()||!s.isFile()||s.size>LIMIT)throw Error('monthly_unsafe_file');let bytes;
  if(io.open){const h=await io.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const f=await h.stat();if(!f.isFile()||f.size>LIMIT)throw Error('monthly_unsafe_file');bytes=await h.readFile();}finally{await h.close();}}
  else bytes=await io.readFile(file);if(bytes.length>LIMIT)throw Error('monthly_file_limit');return JSON.parse(bytes.toString('utf8'));
 }catch(e){if(missing(e))return null;throw e;}
}
async function artifactJson(io,directory,kind,runId,name){
 if(directory!==JOINT_RUNTIME_DIRECTORY||!['joint','joint-patterns'].includes(kind)||!UUID.test(runId??'')||!['input.json','report.json'].includes(name))throw Error('monthly_unsafe_file');
 const folder=path.posix.join(directory,'research',kind,runId);try{for(const p of [ROOT,directory,path.posix.join(directory,'research'),path.posix.join(directory,'research',kind),folder])await checkedDirectory(io,p);}catch(error){if(missing(error))return null;throw error;}
 return jsonFile(io,path.posix.join(folder,name));
}
export async function acquireMonthlyFileLock(file,{spawnProcess=spawn}={}){
 const child=spawnProcess('/usr/bin/flock',['--nonblock','--conflict-exit-code','75',file,process.execPath,'-e',"process.stdout.write('ready\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],{stdio:['pipe','pipe','pipe']});
 let exited=false;const exit=new Promise(resolve=>child.once('exit',code=>{exited=true;resolve(code);}));child.stdin.on('error',()=>{});child.stderr.resume();
 const acquired=await new Promise((resolve,reject)=>{let text='',settled=false;const timer=setTimeout(()=>{child.kill('SIGTERM');done(Error('monthly_os_lock_unavailable'));},10000),done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};child.once('error',()=>done(Error('monthly_os_lock_unavailable')));child.stdout.on('data',data=>{text+=data.toString();if(text.includes('ready\n'))done(null,true);});exit.then(code=>{if(!settled)code===75?done(null,false):done(Error('monthly_os_lock_unavailable'));});});
 if(!acquired)return null;
 return {isHeld:()=>!exited,async release(){if(exited)return;child.stdin.end();let timer;await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(()=>{child.kill('SIGTERM');resolve();},5000);})]);clearTimeout(timer);}};
}
export function createMonthlyStore({directory,io=fs,uuid=randomUUID,now=Date.now,acquireFileLock=acquireMonthlyFileLock}){
 if(directory!==JOINT_RUNTIME_DIRECTORY)throw Error('invalid_monthly_directory');
 const root=path.posix.join(directory,'research','monthly'),lock=path.posix.join(root,'lock.json');
 const ensure=async()=>{for(const p of [ROOT,directory])await checkedDirectory(io,p);if(!storageSafe(await io.statfs(directory)))throw Error('monthly_storage_limit');await checkedDirectory(io,path.posix.join(directory,'research'),{create:true});await checkedDirectory(io,root,{create:true});};
 const write=async(file,value)=>{await ensure();const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>LIMIT)throw Error('monthly_file_limit');const s=await io.lstat(file).catch(e=>{if(!missing(e))throw e;return null;});if(s&&(s.isSymbolicLink()||!s.isFile()))throw Error('monthly_unsafe_file');const token=uuid();if(!UUID.test(token))throw Error('invalid_monthly_uuid');const tmp=file+'.'+token+'.tmp';await io.writeFile(tmp,bytes,{flag:'wx',mode:0o600});await io.rename(tmp,file);};
 const file=name=>{if(!['status.json','last-success.json'].includes(name)&&!/^\d{4}-(0[1-9]|1[0-2])(?:\.[a-f0-9]{64})?\.json$/.test(name))throw Error('invalid_monthly_file');return path.posix.join(root,name);};
 return {root,io,ensure,read:async name=>{await ensure();return jsonFile(io,file(name));},write:async(name,value)=>write(file(name),value),
  async acquire(owner){await ensure();if(!UUID.test(owner))throw Error('invalid_monthly_uuid');let recovered=false;const guardFile=path.posix.join(root,'process.lock');
   try{await io.writeFile(guardFile,'',{flag:'wx',mode:0o600});}catch(error){if(error?.code!=='EEXIST')throw error;const stat=await io.lstat(guardFile);if(stat.isSymbolicLink()||!stat.isFile())throw Error('monthly_unsafe_file');}
   const guard=await acquireFileLock(guardFile);if(!guard)return null;
   const value=()=>({schemaVersion:1,owner,pid:process.pid,heartbeatAt:iso(now()),leaseUntil:now()+LEASE_MS});
   try{try{await io.writeFile(lock,JSON.stringify(value())+'\n',{flag:'wx',mode:0o600});}
    catch(e){if(e?.code!=='EEXIST')throw e;const prior=await jsonFile(io,lock);if(!prior||!UUID.test(prior.owner)||!Number.isFinite(prior.leaseUntil))throw Error('monthly_invalid_lock');const target=lock+'.interrupted.'+owner;await io.rename(lock,target);recovered=true;await io.writeFile(lock,JSON.stringify(value())+'\n',{flag:'wx',mode:0o600});}
   }catch(error){await guard.release();throw error;}
   const check=async()=>{if(guard.isHeld?.()===false)throw Error('monthly_lock_lost');const current=await jsonFile(io,lock);if(current?.owner!==owner||current.leaseUntil<now())throw Error('monthly_lock_lost');};
   return {owner,recovered,check,async renew(){await check();await write(lock,value());},async release(){try{const current=await jsonFile(io,lock);if(current?.owner===owner)await io.unlink(lock);}finally{await guard.release();}}};
  },
  async recoverOwnedLocks(state,lease){if(!lease.recovered||!state?.attempts?.length)return [];const previous=state.attempts.at(-1),recovered=[];
   for(const [name,key] of [['joint-research.lock','modelRunId'],['joint-patterns.lock','patternRunId'],['collector.lock',null]]){await lease.check();const target=path.posix.join(directory,name),v=await jsonFile(io,target);if(!v)continue;const owned=key?v.runId===previous[key]:v.pid===previous.pid&&Date.parse(v.startedAt)>=Date.parse(previous.startedAt);if(!owned)continue;await io.rename(target,target+'.interrupted.'+lease.owner);recovered.push(name);}
   return recovered;
  }
 };
}

const stageError=(phase,reason)=>Object.assign(Error(reason),{phase});
async function verifyModel(directory,meta,plan,ports){
 if(!meta||!UUID.test(meta.runId??'')||!HASH.test(meta.inputDigest??'')||!HASH.test(meta.modelArtifactSha256??''))throw Error('monthly_model_checkpoint_invalid');
 const accepted=await (ports.acceptModel??acceptJointArtifact)({directory,runId:meta.runId,expected:{inputDigest:meta.inputDigest,modelArtifactSha256:meta.modelArtifactSha256},io:ports.io??fs});
 if(!plain(accepted?.input)||digest(normalizeJointSplits(accepted.input.splitBounds))!==digest(plan.splits)||accepted.input.range?.from!==plan.availableRange.from||accepted.input.range?.to!==plan.availableRange.to||accepted.input.minimumTrainingMonths!==3||!Array.isArray(accepted.input.trainingMonths)||new Set(accepted.input.trainingMonths).size<3||accepted.input.trainingMonths.some(month=>typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<plan.splits.trainFrom.slice(0,7)||month>=plan.splits.calibrationFrom.slice(0,7))||!plain(accepted.input.coveragePolicy)||digest(accepted.input.coveragePolicy)!==digest(COVERAGE_POLICY))throw Error('monthly_model_checkpoint_invalid');return accepted;
}
function analysisMeta(report,model,plan){
 if(report?.status!=='complete'||!UUID.test(report.runId??'')||!HASH.test(report.inputDigest??'')||report.parent?.inputDigest!==model.inputDigest||report.parent?.modelArtifactSha256!==model.modelArtifactSha256||!plain(report.policy?.splits)||digest(report.policy.splits)!==digest(plan.splits)||report.financialActions!==0||report.liveEligible!==false||!plain(report.frozenAudit))throw Error('monthly_analysis_checkpoint_invalid');
 const audit=report.frozenAudit,total=Object.values(audit.tracks??{}).reduce((n,t)=>n+(t.candidates?.length??0),0);if(total!==audit.totalCandidates)throw Error('monthly_analysis_checkpoint_invalid');
 const candidates=Object.values(audit.tracks).flatMap(t=>t.candidates??[]),passed=candidates.filter(c=>c.gates?.selection?.referenceCriteria==='reference_criteria_met'&&c.gates?.holdout?.referenceCriteria==='reference_criteria_met').length;
 const baselineHoldout=Object.fromEntries(['samples','hits','meanProbability','accuracy','ece','binaryBrier','jointLogLossGain'].map(key=>[key,report.baseline?.holdout?.[key]??null]));
 return {runId:report.runId,inputDigest:report.inputDigest,reportSha256:createHash('sha256').update(JSON.stringify(report)+'\n').digest('hex'),dataset:report.dataset,baselineHoldout,totalFrozen:total,referencePassed:passed,precisionStatus:passed?'reference_criteria_met':'criteria_not_met',elapsedMs:report.elapsedMs??null};
}
async function verifiedAnalysis(directory,report,model,plan,ports){
 if(ports.acceptAnalysis)return ports.acceptAnalysis(report,model,plan);
 const metadata=analysisMeta(report,model,plan),input=await artifactJson(ports.io??fs,directory,'joint-patterns',report.runId,'input.json');
 if(!input||input.runId!==report.runId||input.inputDigest!==report.inputDigest||input.parent?.inputDigest!==model.inputDigest||input.parent?.modelArtifactSha256!==model.modelArtifactSha256||!plain(input.policy?.splits)||digest(input.policy.splits)!==digest(plan.splits))throw Error('monthly_analysis_checkpoint_invalid');
 const {inputDigest,...body}=input;if(digest(body)!==inputDigest)throw Error('monthly_analysis_checkpoint_invalid');return metadata;
}
const plannedUuid=(first,uuid)=>{let used=false;return ()=>{if(!used){used=true;return first;}return uuid();};};
const safeReason=e=>typeof e?.message==='string'&&/^[a-z_0-9]+$/.test(e.message)?e.message:'monthly_stage_failure';
export function collectionDiagnostics(coverage,requestedDays=null,origin='collector_result'){
 const value=plain(coverage)?coverage:{},count=v=>Number.isSafeInteger(v)&&v>=0?v:null,code=v=>typeof v==='string'&&/^[a-z_0-9]{1,80}$/.test(v)?v:null;
 const summary={schemaVersion:1,origin:origin==='saved_coverage'?'saved_coverage':'collector_result',status:['running','complete','stopped','failed'].includes(value.status)?value.status:'unrecognized',reason:code(value.reason),source:['turnmark_v1','boatrace_legacy_v3','mixed_boatrace_archives'].includes(value.source)?value.source:null};
 for(const key of ['processedDays','requestedDays','collectedDays','downloadedDays','missingDays','failedDays','unsupportedDays','unprocessedDays','requestsThisRun','dailyRequests','races'])summary[key]=count(value[key]);
 summary.requestedDays??=count(requestedDays)??count(value.days);summary.days=summary.requestedDays;summary.requests=summary.requestsThisRun??count(value.requests);return summary;
}
function dailyQuotaRetry(state,now){
 if(state?.status!=='failed'||state.error?.phase!=='collecting'||state.collection?.reason!=='daily_limit')return null;
 const started=Date.parse(state.attempts?.at(-1)?.startedAt??'');if(!Number.isFinite(started))return null;
 const offset=9*3600000,reset=Math.floor((started+offset)/86400000)*86400000+86400000-offset;
 return now<reset?reset+60000:null;
}

export async function runMonthlyAnalysis(config,{signal,onProgress=()=>{}},ports={}){
 const now=ports.now??Date.now,uuid=ports.uuid??randomUUID,plan=monthlyPlan(now()),store=ports.store??createMonthlyStore({directory:config.directory,io:ports.io??fs,uuid,now});
 const lease=await store.acquire(uuid());if(!lease)return {status:'blocked',reason:'monthly_locked',targetMonth:plan.targetMonth,...flags};
 const stateFile=plan.targetMonth+'.'+plan.policyDigest+'.json',policyStatus={policyVersion:plan.policyVersion,policyDigest:plan.policyDigest,holdoutMonths:plan.holdoutMonths};
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;let state,lastSuccess=null,previousSuccess=null,previousPolicySuccess=null,heartbeat=null,heartbeatPending=false,heartbeatTask=null;
 const check=async()=>{if(combined.aborted)throw Error('monthly_cancelled');await lease.check();};
 const save=async()=>{await check();state.updatedAt=iso(now());await store.write(stateFile,state);};
 const status=async phase=>{await check();const attempt=state?.attempts?.at(-1);const out={schemaVersion:1,enabled:true,phase,targetMonth:plan.targetMonth,nextDueAt:plan.nextDueAt,updatedAt:iso(now()),lastSuccess:lastSuccess??null,previousPolicySuccess,collection:state?.collection?collectionDiagnostics(state.collection,null,state.collection.origin):null,retry:{attempt:state?.attempts?.length??0,maxAttempts:config.maxAttempts,nextAt:phase==='retry_exhausted'||(state?.attempts?.length??0)>=config.maxAttempts?null:state?.nextRetryAt??null},error:state?.error??null,requestedRange:plan.requestedRange,availableRange:plan.availableRange,limitedHistory:plan.limitedHistory,splits:plan.splits,...policyStatus,...flags};await store.write('status.json',out);onProgress({event:'boatrace_monthly_progress',...out,modelRunId:attempt?.modelRunId??null,patternRunId:attempt?.patternRunId??null});};
 try{
  previousSuccess=await store.read('last-success.json');lastSuccess=previousSuccess?.policyDigest===plan.policyDigest?previousSuccess:null;
  if(previousSuccess&&!lastSuccess)previousPolicySuccess={targetMonth:previousSuccess.targetMonth,completedAt:previousSuccess.completedAt,policyVersion:previousSuccess.policyVersion??'legacy_three_month_holdout',holdoutMonths:previousSuccess.holdoutMonths??3};
  heartbeat=setInterval(()=>{if(heartbeatPending)return;heartbeatPending=true;heartbeatTask=(async()=>{try{await lease.renew();}catch{controller.abort('lease_lost');}finally{heartbeatPending=false;}})();},30000);
  state=await store.read(stateFile);
  if(state&&(!plain(state)||state.targetMonth!==plan.targetMonth||!Array.isArray(state.attempts)||state.attempts.length>config.maxAttempts||!['running','failed','complete'].includes(state.status)||state.attempts.some(a=>!UUID.test(a.attemptId??'')||!UUID.test(a.modelRunId??'')||!UUID.test(a.patternRunId??'')||!Number.isFinite(Date.parse(a.startedAt)))))throw Error('monthly_invalid_state');
  if(state&&state.policyDigest!==plan.policyDigest)throw Error('monthly_policy_checkpoint_mismatch');
  if(state?.status==='failed'&&state.error?.phase==='collecting'&&!state.collection){
   try{const saved=await jsonFile(ports.io??fs,path.posix.join(config.directory,'coverage.json')),startedAt=Date.parse(state.attempts.at(-1)?.startedAt??'');
    if(saved?.from===plan.availableRange.from&&saved?.to===plan.availableRange.to&&Number.isFinite(startedAt)&&Date.parse(saved.generatedAt)>=startedAt&&Date.parse(saved.generatedAt)<=now()+60000){state.collection=collectionDiagnostics(saved,null,'saved_coverage');await save();}
   }catch{onProgress({event:'boatrace_monthly_collection_diagnostic_unavailable',targetMonth:plan.targetMonth,reason:'stored_coverage_unavailable'});}
  }
  if(state?.status==='complete'){
   if(!UUID.test(state.analysis?.runId??'')||!HASH.test(state.analysis?.reportSha256??''))throw Error('monthly_analysis_checkpoint_invalid');
   await verifyModel(config.directory,state.model,plan,ports);const raw=await artifactJson(ports.io??fs,config.directory,'joint-patterns',state.analysis.runId,'report.json'),analysis=await verifiedAnalysis(config.directory,raw,state.model,plan,ports);
   if(analysis.reportSha256!==state.analysis.reportSha256)throw Error('monthly_analysis_checkpoint_invalid');
   lastSuccess={targetMonth:state.targetMonth,completedAt:state.completedAt,modelRunId:state.model.runId,patternRunId:analysis.runId,analysis,...policyStatus};await store.write('last-success.json',lastSuccess);await status('waiting');return {status:'skipped',reason:'month_already_complete',targetMonth:plan.targetMonth,nextDueAt:plan.nextDueAt,...policyStatus,...flags};
  }
  if(state?.status==='failed'&&state.attempts.length<config.maxAttempts){const reset=dailyQuotaRetry(state,now());if(reset!==null&&(!state.nextRetryAt||Date.parse(state.nextRetryAt)<reset)){state.nextRetryAt=iso(reset);await save();}}
  if(state?.attempts?.length>=config.maxAttempts){await status('retry_exhausted');return {status:'stopped',reason:'monthly_retry_exhausted',targetMonth:plan.targetMonth,...flags};}
  if(state?.nextRetryAt&&Date.parse(state.nextRetryAt)>now()){await status('retry_wait');return {status:'waiting',reason:'monthly_retry_wait',targetMonth:plan.targetMonth,nextRetryAt:state.nextRetryAt,...flags};}
  const recoveredLocks=await store.recoverOwnedLocks(state,lease);state??={schemaVersion:1,targetMonth:plan.targetMonth,plan,attempts:[],createdAt:iso(now()),...policyStatus};
  const previousAttempt=state.attempts.at(-1);if(previousAttempt?.status==='running')previousAttempt.status='interrupted';
  const attempt={attemptId:uuid(),pid:process.pid,startedAt:iso(now()),status:'running',modelRunId:uuid(),patternRunId:uuid(),recoveredLocks};state.attempts.push(attempt);state.status='running';state.error=null;state.nextRetryAt=null;state.phase='planning';await save();await status('planning');
  if(!plan.eligible)throw Error('monthly_insufficient_training_months');
  const dates=dateRange(plan.availableRange.from,plan.availableRange.to,now());
  state.phase='collecting';await save();await status('collecting');
  let coverage;try{coverage=await (ports.collect??collectDates)({directory:config.directory,dates,collectionMode:'backfill',retryUnsuccessful:true,now,signal:combined,onProgress:()=>{}});}
  catch(error){state.collection=collectionDiagnostics({status:'failed',reason:safeReason(error)},dates.length);await save();await status('collecting');throw error;}
  state.collection=collectionDiagnostics(coverage,dates.length);await save();await status('collecting');
  await check();if(coverage?.status!=='complete'||coverage.failedDays||coverage.missingDays||coverage.unsupportedDays||coverage.processedDays!==dates.length)throw stageError('collecting','monthly_collection_incomplete');
  let meta=state.model;
  if(!meta&&previousAttempt?.modelRunId){const recovered=await artifactJson(ports.io??fs,config.directory,'joint',previousAttempt.modelRunId,'report.json');if(recovered?.status==='complete')meta={runId:recovered.runId,inputDigest:recovered.inputDigest,modelArtifactSha256:recovered.modelArtifactSha256};}
  if(meta){state.phase='verifying_model';await status(state.phase);await verifyModel(config.directory,meta,plan,ports);}
  else{
   state.phase='training';await save();await status('training');const result=await (ports.train??runJointResearch)({directory:config.directory,dates,splits:plan.splits,minimumTrainingMonths:3,signal:combined,onProgress:p=>onProgress({event:'boatrace_monthly_model_progress',targetMonth:plan.targetMonth,...p})},{...(ports.modelPorts??{}),uuid:plannedUuid(attempt.modelRunId,uuid)});
   await check();if(result.status!=='complete')throw stageError('training','monthly_model_'+(result.reason??result.status));meta={runId:result.runId,inputDigest:result.inputDigest,modelArtifactSha256:result.modelArtifactSha256};await verifyModel(config.directory,meta,plan,ports);
  }
  state.model=meta;attempt.modelRunId=meta.runId;state.phase='model_complete';await save();
  let result=null;if(previousAttempt?.patternRunId){const candidate=await artifactJson(ports.io??fs,config.directory,'joint-patterns',previousAttempt.patternRunId,'report.json');if(candidate?.status==='complete')result=candidate;}
  if(!result){state.phase='conditions';await save();await status('conditions');result=await (ports.analyze??runJointPatternResearch)({directory:config.directory,dates,parentRunId:meta.runId,expected:{inputDigest:meta.inputDigest,modelArtifactSha256:meta.modelArtifactSha256},profile:'standard',splits:plan.splits,signal:combined,onProgress:p=>onProgress({event:'boatrace_monthly_condition_progress',targetMonth:plan.targetMonth,...p})},{...(ports.patternPorts??{}),uuid:plannedUuid(attempt.patternRunId,uuid)});}
  await check();if(result?.status!=='complete')throw stageError('conditions','monthly_conditions_'+(result?.reason??result?.status??'missing'));const analysis=await verifiedAnalysis(config.directory,result,meta,plan,ports);state.analysis=analysis;attempt.patternRunId=analysis.runId;state.phase='complete';state.status='complete';state.completedAt=iso(now());attempt.status='complete';attempt.completedAt=state.completedAt;
  state.comparison={kind:previousSuccess&&previousSuccess.policyDigest!==plan.policyDigest?'different_policy_and_cohort_reference':'different_cohort_monthly_reference',previous:previousSuccess?.analysis??null,current:analysis,notCausal:true};await save();
  const success={targetMonth:plan.targetMonth,completedAt:state.completedAt,modelRunId:meta.runId,patternRunId:analysis.runId,analysis,...policyStatus};await store.write('last-success.json',success);
  await store.write('status.json',{schemaVersion:1,enabled:true,phase:'waiting',targetMonth:plan.targetMonth,nextDueAt:plan.nextDueAt,updatedAt:iso(now()),lastSuccess:success,previousPolicySuccess,retry:{attempt:state.attempts.length,maxAttempts:config.maxAttempts,nextAt:null},error:null,requestedRange:plan.requestedRange,availableRange:plan.availableRange,limitedHistory:plan.limitedHistory,splits:plan.splits,...policyStatus,...flags});
  const report={schemaVersion:1,status:'complete',targetMonth:plan.targetMonth,attemptId:attempt.attemptId,plan,collection:state.collection,model:meta,analysis,comparison:state.comparison,nextDueAt:plan.nextDueAt,...policyStatus,...flags};onProgress({event:'boatrace_monthly_complete',report});return report;
 }catch(error){
  if(state&&state.status!=='complete'){const reason=safeReason(error);state.status='failed';state.error={reason,phase:error.phase??state.phase};state.nextRetryAt=state.attempts.length>=config.maxAttempts?null:iso(Math.max(now()+config.retryMs,dailyQuotaRetry(state,now())??0));const a=state.attempts.at(-1);if(a){a.status='failed';a.reason=reason;}try{await lease.check();state.updatedAt=iso(now());await store.write(stateFile,state);await status('failed');}catch{}}
  else try{await lease.check();await store.write('status.json',{schemaVersion:1,enabled:true,phase:'checkpoint_invalid',targetMonth:plan.targetMonth,nextDueAt:plan.nextDueAt,updatedAt:iso(now()),lastSuccess:lastSuccess??null,previousPolicySuccess,retry:{attempt:state?.attempts?.length??0,maxAttempts:config.maxAttempts,nextAt:null},error:{reason:safeReason(error),phase:state?.phase??'starting'},requestedRange:plan.requestedRange,availableRange:plan.availableRange,limitedHistory:plan.limitedHistory,splits:plan.splits,...policyStatus,...flags});}catch{}
  return {schemaVersion:1,status:'failed',reason:safeReason(error),targetMonth:plan.targetMonth,phase:state?.phase??'starting',...flags};
 }finally{if(heartbeat)clearInterval(heartbeat);if(heartbeatTask)await heartbeatTask;try{await lease.release();}catch{}}
}
