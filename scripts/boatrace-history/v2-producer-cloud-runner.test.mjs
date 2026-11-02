import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createV2ProducerCloudDescriptor,v2ProducerCloudOwnershipMarker} from './v2-producer-cloud-plan.mjs';
import {runV2ProducerCloudCandidate,cleanupV2ProducerCloudStaging,quarantineV2ProducerCloudOutput} from './v2-producer-cloud-runner.mjs';

const ROOT='/app/apps/kelly-edge/data/keirin-history/boatrace-history';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function memoryIo({failWriteAt=0,failRename=false,failNamespaceSyncAt=0,failRm=false}={}){
  const entries=new Map([[ROOT,{directory:true}],[`${ROOT}/research`,{directory:true}],[`${ROOT}/research/actual-one-day-v2-candidates`,{directory:true}]]),syncs=new Map();let writes=0;
  const missing=()=>Object.assign(Error('missing'),{code:'ENOENT'}),entry=p=>entries.get(p);
  const io={entries,
    async lstat(p){const e=entry(p);if(!e)throw missing();return {isSymbolicLink:()=>false,isDirectory:()=>Boolean(e.directory),isFile:()=>!e.directory,size:e.bytes?.length??0};},
    async realpath(p){if(!entry(p))throw missing();return p;},
    async mkdir(p){if(entry(p))throw Object.assign(Error('exists'),{code:'EEXIST'});if(!entry(pathPosixDirname(p)))throw missing();entries.set(p,{directory:true});},
    async open(p,flags){
      const e=entry(p);
      if(flags==='r'){if(!e?.directory)throw missing();return {async sync(){const n=(syncs.get(p)??0)+1;syncs.set(p,n);if(p.endsWith('/actual-one-day-v2-candidates')&&failNamespaceSyncAt===n)throw Error('synthetic_dirsync_failure');},async close(){}};}
      if(flags==='wx'){if(e)throw Object.assign(Error('exists'),{code:'EEXIST'});if(!entry(pathPosixDirname(p))?.directory)throw missing();const file={directory:false,bytes:Buffer.alloc(0)};entries.set(p,file);return {async writeFile(value){writes++;if(failWriteAt===writes)throw Error('synthetic_write_failure');file.bytes=Buffer.from(value);},async sync(){},async close(){}};}
      throw Error('unexpected_open');
    },
    async readFile(p){const e=entry(p);if(!e||e.directory)throw missing();return Buffer.from(e.bytes);},
    async rename(from,to){if(failRename)throw Error('synthetic_rename_failure');if(!entry(from)||entry(to))throw Error('synthetic_rename_identity');const moves=[...entries.keys()].filter(p=>p===from||p.startsWith(from+'/')).sort((a,b)=>a.length-b.length);for(const p of moves){const suffix=p.slice(from.length);entries.set(to+suffix,entries.get(p));entries.delete(p);}},
    async rm(p,{recursive}={}){if(failRm)throw Error('synthetic_cleanup_failure');const e=entry(p);if(!e)throw missing();if(!recursive&&e.directory)throw Error('not_recursive');for(const name of [...entries.keys()])if(name===p||name.startsWith(p+'/'))entries.delete(name);}
  };return io;
}
const pathPosixDirname=p=>p.slice(0,p.lastIndexOf('/'))||'/';
const input={publicBytes:Buffer.from('public'),manifestBytes:Buffer.from('manifest'),metadataBytes:Buffer.from('metadata'),
  readBytes:async()=>Buffer.from(''),verifyStable:async()=>{},model:{},schema:{},metadata:{},report:{},conditionReceipt:{}};
const dates=()=>{const out=[];for(let t=Date.UTC(2026,1,1);t<Date.UTC(2026,9,1);t+=86400000){const d=new Date(t).toISOString().slice(0,10);if(!d.startsWith('2026-03'))out.push(d);}return out;};
function artifacts(){const dayReceipts=new Map(dates().map(d=>[`day-${d}-receipt.json`,Buffer.from('{}')]));return {reportBytes:Buffer.from('{}'),manifestBytes:Buffer.from('{}'),producerReceiptBytes:Buffer.from('{}'),dayReceipts};}
function producerResult(){return {status:'PRODUCED_PENDING_INDEPENDENT_PIN_REVIEW',sourceMode:'PINNED_SOURCE_BYTES',autoAdmitted:false,independentApprovalRequired:true,financialActions:0,queueEligible:false,actualPurchase:false,privateRootRead:false,candidateExternalPins:{reportSHA:'a'.repeat(64)},inputSourcePins:{},sourceRows:1,a0Rows:1,days:211,privateBytesVerified:1,sourceEvidence:'PINNED_INPUT_BYTES_ONLY',artifacts:artifacts()};}
function runnerPorts({io=memoryIo(),runId=uuid(200),producer=async()=>producerResult(),loadInputs=async()=>input,acquireLock=async()=>({isHeld:()=>true,release:async()=>{}}),readOwnedScope=async()=>({status:'OWNED_SCOPE_CONFIRMED',childTreeOwned:true,stopSupervisorActive:true,scopeId:'synthetic-scope',memoryMaxBytes:7*1024**3,isActive:()=>true}),readResources=async()=>({cgroupBytes:1024,heapUsedBytes:1,volumeBytes:1000,volumeFreeBytes:800})}={}){
 return {io,runId,producer,loadInputs,acquireLock,readOwnedScope,readResources};
}
async function execute(ports){const descriptor=createV2ProducerCloudDescriptor({runId:ports.runId});return runV2ProducerCloudCandidate({descriptor},ports);}

test('resource refusal occurs before the fixed private-source adapter is invoked',async()=>{
  const descriptor=createV2ProducerCloudDescriptor({runId:'00000000-0000-4000-8000-000000000123'});
  let sourceRead=false;
  const io={async lstat(){return {isSymbolicLink:()=>false,isDirectory:()=>true};},async realpath(p){return p;}};
  const result=await runV2ProducerCloudCandidate({descriptor},{io,acquireLock:async()=>({isHeld:()=>true,release:async()=>{}}),
    readResources:async()=>({cgroupBytes:3*1024**3,heapUsedBytes:1,volumeBytes:10,volumeFreeBytes:10}),
    loadInputs:async()=>{sourceRead=true;throw Error('unexpected_private_read');}});
  assert.equal(result.status,'WAITING_RESOURCE_NOT_STARTED');assert.equal(result.sourceReadStarted,false);assert.equal(sourceRead,false);
});

test('missing owned-scope stop supervisor blocks before source loading',async()=>{
  const descriptor=createV2ProducerCloudDescriptor({runId:'00000000-0000-4000-8000-000000000124'});let sourceRead=false;
  const io={async lstat(){return {isSymbolicLink:()=>false,isDirectory:()=>true};},async realpath(p){return p;}};
  const result=await runV2ProducerCloudCandidate({descriptor},{io,acquireLock:async()=>({isHeld:()=>true,release:async()=>{}}),
    readResources:async()=>({cgroupBytes:1024,heapUsedBytes:1,volumeBytes:10,volumeFreeBytes:10}),
    loadInputs:async()=>{sourceRead=true;throw Error('unexpected_private_read');}});
  assert.equal(result.reason,'owned_scope_controller_unavailable');assert.equal(result.sourceReadStarted,false);assert.equal(sourceRead,false);
});

test('complete synthetic run publishes exactly 214 files in its own candidate directory',async()=>{
  const ports=runnerPorts(),result=await execute(ports),folder=`${ROOT}/research/actual-one-day-v2-candidates/${ports.runId}`;
  assert.equal(result.status,'PENDING_INDEPENDENT_PIN_REVIEW');assert.equal(result.artifactCount,214);assert.equal(result.queueEligible,false);
  assert.equal(ports.io.entries.get(folder)?.directory,true);assert.equal(ports.io.entries.get(`${folder}/candidate.json`)?.bytes.length>0,true);
  assert.equal([...ports.io.entries.keys()].filter(p=>p.startsWith(folder+'/')).length,215);
});

test('same-UUID retry refuses before private reads and leaves the prior candidate byte-for-byte intact',async()=>{
  const ports=runnerPorts({runId:uuid(208)}),namespace=`${ROOT}/research/actual-one-day-v2-candidates`,finalDir=`${namespace}/${ports.runId}`;
  ports.io.entries.set(finalDir,{directory:true});ports.io.entries.set(`${finalDir}/candidate.json`,{directory:false,bytes:Buffer.from('prior-good-candidate')});
  let privateRead=false;ports.loadInputs=async()=>{privateRead=true;throw Error('must_not_read');};const before=[...ports.io.entries].map(([k,v])=>[k,v.bytes?Buffer.from(v.bytes):v]).sort(([a],[b])=>a.localeCompare(b));
  await assert.rejects(()=>execute(ports),/run_directory_exists/);
  const after=[...ports.io.entries].map(([k,v])=>[k,v.bytes?Buffer.from(v.bytes):v]).sort(([a],[b])=>a.localeCompare(b));
  assert.equal(privateRead,false);assert.deepEqual(after,before);
});

test('producer stop removes only this run staging directory',async()=>{
  const ports=runnerPorts({runId:uuid(201),producer:async()=>{throw Error('synthetic_stop');}}),namespace=`${ROOT}/research/actual-one-day-v2-candidates`;
  ports.io.entries.set(`${namespace}/keep`,{directory:true});await assert.rejects(()=>execute(ports),/synthetic_stop/);
  assert.equal(ports.io.entries.has(`${namespace}/.staging-${ports.runId}`),false);assert.equal(ports.io.entries.has(`${namespace}/keep`),true);
});

test('cleanup failure is reported as unconfirmed and never removes neighboring runs',async()=>{
  const ports=runnerPorts({io:memoryIo({failRm:true}),runId:uuid(206),producer:async()=>{throw Error('synthetic_stop');}}),namespace=`${ROOT}/research/actual-one-day-v2-candidates`;
  ports.io.entries.set(`${namespace}/keep`,{directory:true});await assert.rejects(()=>execute(ports),/cleanup_unconfirmed/);
  assert.equal(ports.io.entries.has(`${namespace}/.staging-${ports.runId}`),true);assert.equal(ports.io.entries.has(`${namespace}/keep`),true);
});

test('external staging cleanup requires the exact reservation ownership token',async()=>{
  const io=memoryIo(),run=uuid(209),nonce='9'.repeat(64),descriptorSHA='8'.repeat(64),stage=`${ROOT}/research/actual-one-day-v2-candidates/.staging-${run}`,neighbor=`${ROOT}/research/actual-one-day-v2-candidates/neighbor`;
  io.entries.set(stage,{directory:true});io.entries.set(`${stage}/part`,{directory:false,bytes:Buffer.from('private')});io.entries.set(neighbor,{directory:true});
  io.entries.set(`${ROOT}/research/.v2-producer-cloud-owner-${run}.json`,{directory:false,bytes:Buffer.from(v2ProducerCloudOwnershipMarker({runId:run,attemptNonce:nonce,descriptorSHA}))});
  await assert.rejects(()=>cleanupV2ProducerCloudStaging(run,{io,attemptNonce:'7'.repeat(64),descriptorSHA}),/owner_marker_mismatch/);
  assert.equal(io.entries.has(stage),true);assert.equal(io.entries.has(neighbor),true);
  const result=await cleanupV2ProducerCloudStaging(run,{io,attemptNonce:nonce,descriptorSHA});
  assert.equal(result.stagingAbsent,true);assert.equal(io.entries.has(stage),false);assert.equal(io.entries.has(neighbor),true);
});

test('quarantine requires matching worker receipt proof and preserves neighbors',async()=>{
  const io=memoryIo(),namespace=`${ROOT}/research/actual-one-day-v2-candidates`,run=uuid(207),from=`${namespace}/${run}`,neighbor=`${namespace}/neighbor`;
  const descriptorSHA='d'.repeat(64),attemptNonce='e'.repeat(64),receiptBytes=Buffer.from(JSON.stringify({runId:run,attemptNonce,descriptorSHA,status:'PENDING_INDEPENDENT_PIN_REVIEW',autoAdmitted:false,queueEligible:false,actualPurchase:false}));
  const candidateSHA=createHash('sha256').update(receiptBytes).digest('hex');
  io.entries.set(from,{directory:true});io.entries.set(`${from}/candidate.json`,{directory:false,bytes:receiptBytes});io.entries.set(neighbor,{directory:true});
  io.entries.set(`${ROOT}/research/.v2-producer-cloud-owner-${run}.json`,{directory:false,bytes:Buffer.from(v2ProducerCloudOwnershipMarker({runId:run,attemptNonce,descriptorSHA}))});
  await assert.rejects(()=>quarantineV2ProducerCloudOutput(run,{io,attemptNonce:'a'.repeat(64),expectedDescriptorSHA:descriptorSHA}),/owner_marker_mismatch/);
  assert.equal(io.entries.has(from),true);assert.equal(io.entries.has(neighbor),true);
  const result=await quarantineV2ProducerCloudOutput(run,{io,attemptNonce,expectedCandidateSHA:candidateSHA,expectedDescriptorSHA:descriptorSHA});assert.equal(result.status,'QUARANTINED_NOT_ADMITTED');
  assert.equal(io.entries.has(from),false);assert.equal(io.entries.has(`${ROOT}/research/actual-one-day-v2-candidates-quarantine/${run}`),true);assert.equal(io.entries.has(neighbor),true);
});

test('write, rename and post-rename directory sync failures clean only owned candidate data',async t=>{
  for(const [name,options]of [['write',{failWriteAt:4}],['rename',{failRename:true}],['post_rename_fsync',{failNamespaceSyncAt:2}]])await t.test(name,async()=>{
    const ports=runnerPorts({io:memoryIo(options),runId:uuid(name==='write'?202:name==='rename'?203:204)}),namespace=`${ROOT}/research/actual-one-day-v2-candidates`;
    await assert.rejects(()=>execute(ports));
    assert.equal([...ports.io.entries.keys()].some(p=>p.includes('.staging-')),false);
    assert.equal([...ports.io.entries.keys()].some(p=>p.startsWith(namespace+'/')&&p.includes(ports.runId)),false);
  });
});

test('lock contention leaves an existing separate namespace untouched',async()=>{
  const ports=runnerPorts({runId:uuid(205),acquireLock:async()=>null}),namespace=`${ROOT}/research/actual-one-day-v2-candidates`;
  ports.io.entries.set(namespace,{directory:true});ports.io.entries.set(`${namespace}/unrelated-run`,{directory:true});
  const before=[...ports.io.entries.keys()].sort();const result=await execute(ports);
  assert.equal(result.reason,'shared_lock_unavailable');assert.deepEqual([...ports.io.entries.keys()].sort(),before);
});
