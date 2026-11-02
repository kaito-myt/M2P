import {createHash,randomBytes} from 'node:crypto';
import {ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS} from './actual-reader-one-day-producer.mjs';

const DIRECTORY='/app/apps/kelly-edge/data/keirin-history/boatrace-history';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=reason=>{throw Error(`v2_producer_cloud_${reason}`);};
const cloneFreeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))cloneFreeze(v);Object.freeze(value);}return value;};

export const V2_PRODUCER_CLOUD_POLICY=cloneFreeze({
  version:'actual_one_day_producer_cloud_policy_v1',
  workerHeapLimitBytes:1024**3,
  workerV8HeapLimitBytes:1275068416,
  heapStopBytes:900*1024**2,
  cgroupStartBytes:3*1024**3,
  cgroupStopBytes:6*1024**3,
  volumeFreeFractionMinimum:.2,
  wallLimitMs:45*60*1000,
  outputLimitBytes:512*1024**2,
  sourceLimitBytes:512*1024**2,
  concurrency:1,
  producerCalls:1,
  fits:0,predictions:0,queueWrites:0,financialActions:0,actualPurchase:false,autoAdmitted:false
});

export function createV2ProducerCloudDescriptor({runId,attemptNonce=randomBytes(32).toString('hex'),reason='fixed_source_readonly_candidate'}={}){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId??'')||typeof reason!=='string'||!reason.trim()||reason.length>200)fail('descriptor');
  if(!/^[a-f0-9]{64}$/.test(attemptNonce??''))fail('descriptor_attempt_nonce');
  const body={version:'actual_one_day_producer_cloud_descriptor_v1',runId,attemptNonce,reason,
    root:DIRECTORY,sourceRoot:DIRECTORY+'/research/parent-prefit-v1/8dd59e8d-136f-4f04-97a5-227ff988c744',
    sourcePins:Object.freeze({...ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS}),
    publicResultSHA:ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS.publicSHA,
    manifestSHA:ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS.manifestSHA,
    metadataSHA:ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS.metadataSHA,
    outputNamespace:'research/actual-one-day-v2-candidates',
    outputRunDirectory:`research/actual-one-day-v2-candidates/${runId}`,
    producer:{module:'scripts/boatrace-history/actual-reader-one-day-producer.mjs',
      pinnedExport:'producePinnedActualOneDayArtifacts',syntheticExport:'produceSyntheticOneDayArtifacts',
      requiredInputs:['publicBytes:Buffer','manifestBytes:Buffer','metadataBytes:Buffer','readBytes(name,{maxBytes}):Promise<Buffer>',
        'verifyStable():Promise<void>','model','schema','metadata','report','conditionReceipt','signal?','decode?'],
      callerPathsAllowed:false},
    policy:V2_PRODUCER_CLOUD_POLICY,
    sourceMode:'PINNED_SOURCE_BYTES',outputStatus:'PRODUCED_PENDING_INDEPENDENT_PIN_REVIEW',
    sourceRootWrite:false,existingRunsMutated:false,queueEligible:false,actualPurchase:false,autoAdmitted:false};
  return cloneFreeze({...body,descriptorSHA:createHash('sha256').update(JSON.stringify(body)).digest('hex')});
}

export function v2ProducerCloudOwnershipMarker({runId,attemptNonce,descriptorSHA}={}){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId??'')||
    !/^[a-f0-9]{64}$/.test(attemptNonce??'')||!sha(descriptorSHA))fail('ownership_marker');
  return JSON.stringify({version:'v2_producer_cloud_owned_attempt_v1',runId,attemptNonce,descriptorSHA});
}

export function assessV2ProducerCloudPreflight({cgroupBytes,heapUsedBytes,volumeBytes,volumeFreeBytes,lockHeld=true}={}){
  if(![cgroupBytes,heapUsedBytes,volumeBytes,volumeFreeBytes].every(Number.isSafeInteger)||
    cgroupBytes<0||heapUsedBytes<0||volumeBytes<1||volumeFreeBytes<0||volumeFreeBytes>volumeBytes||typeof lockHeld!=='boolean')fail('preflight_measurement');
  const freeFraction=volumeFreeBytes/volumeBytes,reasons=[];
  if(!lockHeld)reasons.push('shared_lock_unavailable');
  if(cgroupBytes>=V2_PRODUCER_CLOUD_POLICY.cgroupStartBytes)reasons.push('cgroup_start_threshold');
  if(heapUsedBytes>=V2_PRODUCER_CLOUD_POLICY.heapStopBytes)reasons.push('heap_start_threshold');
  if(freeFraction<V2_PRODUCER_CLOUD_POLICY.volumeFreeFractionMinimum)reasons.push('volume_reserve_below_20_percent');
  return Object.freeze({status:reasons.length?'WAITING_RESOURCE_NOT_STARTED':'READY_FOR_SEPARATE_ROOT_REVIEW',reasons,
    measured:{cgroupBytes,heapUsedBytes,volumeBytes,volumeFreeBytes,freeFraction},
    actualRunAllowed:false,sourceReadStarted:false,financialActions:0,queueEligible:false});
}

export function assertV2ProducerCloudDescriptor(descriptor){
  if(!descriptor||descriptor.version!=='actual_one_day_producer_cloud_descriptor_v1'||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(descriptor.runId??'')||
    descriptor.root!==DIRECTORY||descriptor.sourceRoot!==DIRECTORY+'/research/parent-prefit-v1/8dd59e8d-136f-4f04-97a5-227ff988c744'||
    descriptor.outputNamespace!=='research/actual-one-day-v2-candidates'||
    descriptor.outputRunDirectory!==`research/actual-one-day-v2-candidates/${descriptor.runId}`||
    !/^[a-f0-9]{64}$/.test(descriptor.attemptNonce??'')||
    descriptor.sourceMode!=='PINNED_SOURCE_BYTES'||descriptor.autoAdmitted!==false||descriptor.queueEligible!==false||
    descriptor.actualPurchase!==false||!sha(descriptor.descriptorSHA)||
    JSON.stringify(descriptor.sourcePins)!==JSON.stringify(ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS)||
    JSON.stringify(descriptor.policy)!==JSON.stringify(V2_PRODUCER_CLOUD_POLICY))fail('descriptor_binding');
  const {descriptorSHA,...body}=descriptor;
  if(createHash('sha256').update(JSON.stringify(body)).digest('hex')!==descriptorSHA)fail('descriptor_digest');
  return descriptor;
}
