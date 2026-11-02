import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getHeapStatistics} from 'node:v8';
import {acquireMonthlyFileLock} from './monthly-analysis.mjs';
import {producePinnedActualOneDayArtifacts} from './actual-reader-one-day-producer.mjs';
import {assertV2ProducerCloudDescriptor,assessV2ProducerCloudPreflight,V2_PRODUCER_CLOUD_POLICY,v2ProducerCloudOwnershipMarker} from './v2-producer-cloud-plan.mjs';
import {loadFixedV2ProducerInputs} from './v2-producer-cloud-inputs.mjs';

const fail=code=>{throw Error(`v2_producer_cloud_runner_${code}`);};
const ROOT='/app/apps/kelly-edge/data/keirin-history/boatrace-history';
const sha=b=>createHash('sha256').update(b).digest('hex');
const missing=e=>e?.code==='ENOENT';
const safeName=n=>typeof n==='string'&&/^(?:report|manifest|producer-receipt)\.json$|^day-2026-(?:02|04|05|06|07|08|09)-\d{2}-receipt\.json$/.test(n);

async function checkedDirectory(io,directory,{create=false}={}){
  try{const st=await io.lstat(directory);if(st.isSymbolicLink()||!st.isDirectory()||await io.realpath(directory)!==directory)fail('unsafe_directory');}
  catch(e){if(!missing(e)||!create)throw e;await io.mkdir(directory,{mode:0o700});const st=await io.lstat(directory);if(st.isSymbolicLink()||!st.isDirectory()||await io.realpath(directory)!==directory)fail('unsafe_directory');}
}
async function readResources(io,directory){
  const [cg,stat]=await Promise.all([io.readFile('/sys/fs/cgroup/memory.current','utf8'),io.statfs(directory)]);
  const cgroupBytes=Number(cg.trim()),volumeBytes=Number(stat.blocks)*Number(stat.bsize),volumeFreeBytes=Number(stat.bavail)*Number(stat.bsize),heapUsedBytes=process.memoryUsage().heapUsed;
  if(![cgroupBytes,volumeBytes,volumeFreeBytes,heapUsedBytes].every(Number.isSafeInteger))fail('resource_measurement');
  if(getHeapStatistics().heap_size_limit>V2_PRODUCER_CLOUD_POLICY.workerV8HeapLimitBytes)fail('worker_heap_limit_not_configured');
  return {cgroupBytes,volumeBytes,volumeFreeBytes,heapUsedBytes};
}
async function writeExclusive(io,directory,name,bytes){
  if(!safeName(name)||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>2*1024**2)fail('output_file');
  const file=path.posix.join(directory,name),handle=await io.open(file,'wx',0o400);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  const verify=await io.readFile(file);if(!verify.equals(bytes))fail('output_readback');
  return {name,bytes:bytes.length,sha256:sha(verify)};
}
async function syncDirectory(io,directory){const h=await io.open(directory,'r');try{await h.sync();}finally{await h.close();}}
async function assertOwnedMarker(io,runId,expected){
  const file=path.posix.join(ROOT,'research',`.v2-producer-cloud-owner-${runId}.json`),st=await io.lstat(file);
  if(st.isSymbolicLink()||!st.isFile()||await io.realpath(file)!==file||(await io.readFile(file)).toString('utf8')!==expected)fail('owner_marker_mismatch');
}
async function boundedRemove(io,directory,namespace,runId){
  const parent=path.posix.dirname(directory);if(path.posix.dirname(parent)!==ROOT+'/research'||path.posix.basename(parent)!=='actual-one-day-v2-candidates')fail('cleanup_scope');
  if(![`.staging-${runId}`,runId].includes(path.posix.basename(directory)))fail('cleanup_run_identity');
  try{const st=await io.lstat(directory);if(st.isSymbolicLink()||!st.isDirectory()||await io.realpath(directory)!==directory)fail('cleanup_identity');await io.rm(directory,{recursive:true,force:false});await syncDirectory(io,namespace);}catch(e){if(!missing(e))throw e;}
  try{await io.lstat(directory);fail('cleanup_unconfirmed');}catch(e){if(!missing(e))throw e;}
}

/** Called only by the owning cloud controller after its worker tree is confirmed gone. */
export async function cleanupV2ProducerCloudStaging(runId,{io=fs,attemptNonce,descriptorSHA}={}){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId??''))fail('cleanup_run_id');
  const marker=v2ProducerCloudOwnershipMarker({runId,attemptNonce,descriptorSHA});
  const namespace=path.posix.join(ROOT,'research','actual-one-day-v2-candidates');
  await assertOwnedMarker(io,runId,marker);
  await boundedRemove(io,path.posix.join(namespace,`.staging-${runId}`),namespace,runId);
  return {stagingAbsent:true,scope:'this_run_staging_only'};
}

/** Moves an unacknowledged final run out of the discoverable candidate namespace after its worker is gone. */
export async function quarantineV2ProducerCloudOutput(runId,{io=fs,attemptNonce,expectedCandidateSHA,expectedDescriptorSHA}={}){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId??''))fail('quarantine_run_id');
  if(expectedCandidateSHA!==undefined&&!/^[a-f0-9]{64}$/.test(expectedCandidateSHA))fail('quarantine_candidate_sha');
  const ownerMarker=v2ProducerCloudOwnershipMarker({runId,attemptNonce,descriptorSHA:expectedDescriptorSHA});
  const candidates=path.posix.join(ROOT,'research','actual-one-day-v2-candidates'),quarantines=path.posix.join(ROOT,'research','actual-one-day-v2-candidates-quarantine'),
    from=path.posix.join(candidates,runId),to=path.posix.join(quarantines,runId);
  await checkedDirectory(io,path.posix.join(ROOT,'research'));await checkedDirectory(io,candidates,{create:true});await checkedDirectory(io,quarantines,{create:true});
  try{const st=await io.lstat(from);if(st.isSymbolicLink()||!st.isDirectory()||await io.realpath(from)!==from)fail('quarantine_identity');}
  catch(e){if(e?.code==='ENOENT')return {status:'NO_FINAL_CANDIDATE',candidatePath:`research/actual-one-day-v2-candidates/${runId}`};throw e;}
  const receiptBytes=await io.readFile(path.posix.join(from,'candidate.json'));
  if(expectedCandidateSHA!==undefined&&sha(receiptBytes)!==expectedCandidateSHA)fail('quarantine_candidate_sha_mismatch');
  let receipt;try{receipt=JSON.parse(receiptBytes.toString('utf8'));}catch{fail('quarantine_candidate_receipt');}
  await assertOwnedMarker(io,runId,ownerMarker);
  if(receipt.runId!==runId||receipt.attemptNonce!==attemptNonce||receipt.descriptorSHA!==expectedDescriptorSHA||receipt.status!=='PENDING_INDEPENDENT_PIN_REVIEW'||receipt.autoAdmitted!==false||receipt.queueEligible!==false||receipt.actualPurchase!==false)fail('quarantine_candidate_ownership_mismatch');
  try{await io.lstat(to);fail('quarantine_target_exists');}catch(e){if(e?.code!=='ENOENT')throw e;}
  await io.rename(from,to);
  try{await syncDirectory(io,candidates);await syncDirectory(io,quarantines);return {status:'QUARANTINED_NOT_ADMITTED',quarantinePath:`research/actual-one-day-v2-candidates-quarantine/${runId}`};}
  catch{return {status:'QUARANTINE_DURABILITY_UNCONFIRMED',quarantinePath:`research/actual-one-day-v2-candidates-quarantine/${runId}`};}
}

/**
 * Executes the fixed producer exactly once after resource gates. `loadInputs` is a
 * server-owned adapter contract, not a CLI argument; it must return producer inputs
 * from the fixed pinned bundle. No default adapter is provided until its source
 * closure has been independently frozen.
 */
export async function runV2ProducerCloudCandidate({descriptor,signal,onProgress=()=>{}},ports={}){
  assertV2ProducerCloudDescriptor(descriptor);
  const io=ports.io??fs,now=ports.now??Date.now,runRoot=descriptor.root,namespace=path.posix.join(runRoot,descriptor.outputNamespace),
    finalDir=path.posix.join(runRoot,descriptor.outputRunDirectory),staging=path.posix.join(namespace,`.staging-${descriptor.runId}`),
    lockPath=path.posix.join(runRoot,'research','.actual-one-day-v2-producer.lock');
  if(runRoot!==ROOT||path.posix.dirname(namespace)!==path.posix.join(runRoot,'research')||path.posix.dirname(finalDir)!==namespace)fail('fixed_path');
  await checkedDirectory(io,runRoot);await checkedDirectory(io,path.posix.join(runRoot,'research'));
  const lock=await (ports.acquireLock??acquireMonthlyFileLock)(lockPath);
  if(!lock)return {status:'WAITING_RESOURCE_NOT_STARTED',reason:'shared_lock_unavailable',sourceReadStarted:false,financialActions:0};
  let timer=null,controller=null,polling=Promise.resolve(),stagingOwned=false,finalOwned=false,startedAt=now(),result=null;
  try{
    const initial=await (ports.readResources??readResources)(io,runRoot),preflight=assessV2ProducerCloudPreflight({...initial,lockHeld:lock.isHeld()});
    if(preflight.status!=='READY_FOR_SEPARATE_ROOT_REVIEW')return {...preflight,sourceReadStarted:false,financialActions:0};
    if(signal?.aborted||!lock.isHeld())return {status:'WAITING_RESOURCE_NOT_STARTED',reason:signal?.aborted?'cancelled_before_read':'lock_lost_before_read',sourceReadStarted:false,financialActions:0};
    const scope=await ports.readOwnedScope?.();
    if(!scope||scope.status!=='OWNED_SCOPE_CONFIRMED'||scope.childTreeOwned!==true||scope.stopSupervisorActive!==true||typeof scope.isActive!=='function'||
      typeof scope.scopeId!=='string'||!scope.scopeId||!Number.isSafeInteger(scope.memoryMaxBytes)||scope.memoryMaxBytes<V2_PRODUCER_CLOUD_POLICY.cgroupStopBytes)
      return {status:'WAITING_RESOURCE_NOT_STARTED',reason:'owned_scope_controller_unavailable',sourceReadStarted:false,financialActions:0};
    if(!scope.isActive())return {status:'WAITING_RESOURCE_NOT_STARTED',reason:'owned_scope_stop_supervisor_inactive',sourceReadStarted:false,financialActions:0};
    await checkedDirectory(io,namespace,{create:true});
    for(const p of [staging,finalDir]){try{await io.lstat(p);fail('run_directory_exists');}catch(e){if(!missing(e))throw e;}}
    await io.mkdir(staging,{mode:0o700});stagingOwned=true;await syncDirectory(io,namespace);
    controller=new AbortController();const runSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const check=async()=>{
      if(runSignal.aborted)fail('stopped');if(!scope.isActive())fail('owned_scope_stop_supervisor_lost');if(!lock.isHeld())fail('lock_lost');
      if(now()-startedAt>=V2_PRODUCER_CLOUD_POLICY.wallLimitMs)fail('wall_limit');
      const sample=await (ports.readResources??readResources)(io,runRoot);
      if(sample.cgroupBytes>=V2_PRODUCER_CLOUD_POLICY.cgroupStopBytes||sample.heapUsedBytes>=V2_PRODUCER_CLOUD_POLICY.heapStopBytes||
        sample.volumeFreeBytes/sample.volumeBytes<V2_PRODUCER_CLOUD_POLICY.volumeFreeFractionMinimum)fail('resource_stop');
      return sample;
    };
    timer=setInterval(()=>{polling=polling.then(async()=>{try{await check();}catch(e){controller.abort(e.message);}});},1000);timer.unref?.();
    await check();onProgress({phase:'loading_fixed_pins',runId:descriptor.runId,financialActions:0});
    const input=await (ports.loadInputs??loadFixedV2ProducerInputs)({descriptor,signal:runSignal,check});await check();
    if(!input||!Buffer.isBuffer(input.publicBytes)||!Buffer.isBuffer(input.manifestBytes)||!Buffer.isBuffer(input.metadataBytes)||
      typeof input.readBytes!=='function'||typeof input.verifyStable!=='function'||!input.model||!input.schema||!input.metadata||!input.report||!input.conditionReceipt)fail('producer_input_contract');
    result=await (ports.producer??producePinnedActualOneDayArtifacts)({...input,signal:runSignal});
    await check();if(result?.status!=='PRODUCED_PENDING_INDEPENDENT_PIN_REVIEW'||result.autoAdmitted!==false||result.independentApprovalRequired!==true||
      result.financialActions!==0||result.queueEligible!==false||result.actualPurchase!==false||result.privateRootRead!==false||
      result.candidateExternalPins?.reportSHA===undefined)fail('producer_result_contract');
    const files=[['report.json',result.artifacts?.reportBytes],['manifest.json',result.artifacts?.manifestBytes],['producer-receipt.json',result.artifacts?.producerReceiptBytes],
      ...[...(result.artifacts?.dayReceipts??new Map()).entries()]];
    if(files.length!==214)fail('artifact_count');
    let total=0;for(const [,bytes]of files){if(!Buffer.isBuffer(bytes))fail('artifact_bytes');total+=bytes.length;}
    if(total>V2_PRODUCER_CLOUD_POLICY.outputLimitBytes)fail('output_limit');
    const written=[];for(const [name,bytes]of files){await check();written.push(await writeExclusive(io,staging,name,bytes));}
    const candidate={version:'actual_one_day_producer_cloud_candidate_v1',status:'PENDING_INDEPENDENT_PIN_REVIEW',runId:descriptor.runId,attemptNonce:descriptor.attemptNonce,
      descriptorSHA:descriptor.descriptorSHA,producerStatus:result.status,sourceMode:result.sourceMode,inputSourcePins:result.inputSourcePins,
      candidateExternalPins:result.candidateExternalPins,artifactCount:written.length,artifactBytes:total,artifacts:written,
      sourceRows:result.sourceRows,a0Rows:result.a0Rows,days:result.days,privateBytesVerified:result.privateBytesVerified,
      sourceEvidence:result.sourceEvidence,rootExecutionEvidence:'NOT_PROVIDED',actualSuccessPathVerified:false,
      independentApprovalRequired:true,autoAdmitted:false,fitCalls:0,predictionCalls:0,queueWrites:0,financialActions:0,queueEligible:false,actualPurchase:false};
    const candidateBytes=Buffer.from(JSON.stringify(candidate));if(candidateBytes.length>256*1024)fail('candidate_receipt_bytes');
    const candidateFile=path.posix.join(staging,'candidate.json'),h=await io.open(candidateFile,'wx',0o400);try{await h.writeFile(candidateBytes);await h.sync();}finally{await h.close();}
    await syncDirectory(io,staging);await check();await input.verifyStable();await check();await io.rename(staging,finalDir);stagingOwned=false;finalOwned=true;await syncDirectory(io,namespace);
    finalOwned=false;
    return {status:'PENDING_INDEPENDENT_PIN_REVIEW',runId:descriptor.runId,attemptNonce:descriptor.attemptNonce,descriptorSHA:descriptor.descriptorSHA,candidateSHA:sha(candidateBytes),
      candidatePath:descriptor.outputRunDirectory,artifactCount:written.length,artifactBytes:total,sourceRows:result.sourceRows,a0Rows:result.a0Rows,
      queueEligible:false,financialActions:0,actualPurchase:false,autoAdmitted:false};
  }catch(error){
    if(stagingOwned)try{await boundedRemove(io,staging,namespace,descriptor.runId);}catch{throw Error('v2_producer_cloud_runner_cleanup_unconfirmed');}
    if(finalOwned)try{await boundedRemove(io,finalDir,namespace,descriptor.runId);}catch{throw Error('v2_producer_cloud_runner_cleanup_unconfirmed');}
    throw error;
  }finally{
    if(timer)clearInterval(timer);await polling;
    await lock.release();
  }
}
