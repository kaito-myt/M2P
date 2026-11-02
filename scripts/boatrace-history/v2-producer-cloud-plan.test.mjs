import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2ProducerCloudDescriptor,assertV2ProducerCloudDescriptor,assessV2ProducerCloudPreflight,V2_PRODUCER_CLOUD_POLICY} from './v2-producer-cloud-plan.mjs';

const id='00000000-0000-4000-8000-000000000123';
const sample={cgroupBytes:2*1024**3,heapUsedBytes:100*1024**2,volumeBytes:20*1024**3,volumeFreeBytes:4*1024**3,lockHeld:true};

test('descriptor binds fixed source pins, API signature and a separate non-admitted output namespace',()=>{
  const descriptor=createV2ProducerCloudDescriptor({runId:id});
  assert.equal(assertV2ProducerCloudDescriptor(descriptor),descriptor);
  assert.equal(descriptor.sourceRoot,'/app/apps/kelly-edge/data/keirin-history/boatrace-history/research/parent-prefit-v1/8dd59e8d-136f-4f04-97a5-227ff988c744');
  assert.equal(descriptor.outputNamespace,'research/actual-one-day-v2-candidates');
  assert.ok(descriptor.producer.requiredInputs.includes('readBytes(name,{maxBytes}):Promise<Buffer>'));
  assert.equal(descriptor.producer.callerPathsAllowed,false);
  assert.equal(descriptor.autoAdmitted,false);assert.equal(descriptor.queueEligible,false);assert.equal(descriptor.actualPurchase,false);
});

test('descriptor tampering and unsafe execution identity are refused',()=>{
  const d=createV2ProducerCloudDescriptor({runId:id});
  assert.throws(()=>createV2ProducerCloudDescriptor({runId:'not-a-uuid'}),/descriptor/);
  assert.throws(()=>assertV2ProducerCloudDescriptor({...d,outputNamespace:'research/joint'}),/descriptor_binding/);
  assert.throws(()=>assertV2ProducerCloudDescriptor({...d,autoAdmitted:true}),/descriptor_binding/);
});

test('3 GiB start and 20 percent volume reserve are strict preflight gates',()=>{
  assert.equal(assessV2ProducerCloudPreflight(sample).status,'READY_FOR_SEPARATE_ROOT_REVIEW');
  assert.equal(assessV2ProducerCloudPreflight({...sample,cgroupBytes:V2_PRODUCER_CLOUD_POLICY.cgroupStartBytes}).reasons[0],'cgroup_start_threshold');
  assert.equal(assessV2ProducerCloudPreflight({...sample,volumeFreeBytes:V2_PRODUCER_CLOUD_POLICY.volumeFreeFractionMinimum*sample.volumeBytes-1}).status,'WAITING_RESOURCE_NOT_STARTED');
  assert.equal(assessV2ProducerCloudPreflight({...sample,lockHeld:false}).reasons[0],'shared_lock_unavailable');
});

test('worker heap boundary remains below one GiB and separate stop thresholds are present',()=>{
  assert.equal(V2_PRODUCER_CLOUD_POLICY.workerHeapLimitBytes,1024**3);
  assert.equal(V2_PRODUCER_CLOUD_POLICY.workerV8HeapLimitBytes,1275068416);
  assert.ok(V2_PRODUCER_CLOUD_POLICY.heapStopBytes<V2_PRODUCER_CLOUD_POLICY.workerHeapLimitBytes);
  assert.equal(V2_PRODUCER_CLOUD_POLICY.cgroupStopBytes,6*1024**3);
  assert.equal(V2_PRODUCER_CLOUD_POLICY.volumeFreeFractionMinimum,.2);
  assert.equal(V2_PRODUCER_CLOUD_POLICY.producerCalls,1);
});
