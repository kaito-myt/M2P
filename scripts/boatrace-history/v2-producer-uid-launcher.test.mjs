import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  V2_PRODUCER_UID_LAUNCHER_CLOSURE_MODULE_COUNT,V2_PRODUCER_UID_LAUNCHER_ENV,V2_PRODUCER_UID_LAUNCHER_PINS,
  assessV2ProducerUidDropProbe,assessV2ProducerUidLauncherPreflight,
  buildV2ProducerUidDropProbeArgs,buildV2ProducerUidEntryArgs,
  launchV2ProducerUidEntry,parseV2ProducerSupplementaryGroups,runV2ProducerUidDropProbe,verifyV2ProducerUidLauncherPins
} from './v2-producer-uid-launcher.mjs';

const GiB=1024**3,MiB=1024**2;
const healthy={cgroupBytes:2*GiB,memoryMaxBytes:8*GiB,volumeBytes:20*GiB,volumeFreeBytes:4*GiB,heapUsedBytes:8*MiB};
function fakePorts({uidDrop='UID_DROP_VERIFIED',resources=healthy,uid=0,gid=0,platform='linux',spawnFail=false}={}){
  const events=[],child=new EventEmitter();
  const ports={events,child,platform,uid,gid,nodeVersion:'22.23.4',setprivCanonical:true,
    verifyPins:async()=>({status:'UID_LAUNCHER_PINS_VERIFIED',moduleCount:44}),readResources:async()=>resources,
    probeUidDrop:async()=>({status:uidDrop,probeExecuted:true,uid:uidDrop==='UID_DROP_VERIFIED'?1000:undefined,gid:uidDrop==='UID_DROP_VERIFIED'?1000:undefined}),
    spawn:(exe,args,options)=>{events.push({exe,args,options});setImmediate(()=>spawnFail?child.emit('error',Error('synthetic_spawn_failure')):child.emit('close',0,null));return child;}};
  return ports;
}

test('cloud runtime source pins and full transitive module closure verify',async t=>{
  if(process.platform!=='linux')return t.skip('runtime closure is pinned to Linux LF git-blob bytes; validate it in synthetic Linux CI');
  const r=await verifyV2ProducerUidLauncherPins();
  assert.equal(r.status,'UID_LAUNCHER_PINS_VERIFIED');assert.equal(r.moduleCount,V2_PRODUCER_UID_LAUNCHER_CLOSURE_MODULE_COUNT);
  assert.equal(r.entrySHA,V2_PRODUCER_UID_LAUNCHER_PINS.entrySHA);
});

test('launcher rejects stale expected module count even when closure source pins match',async()=>{
  await assert.rejects(verifyV2ProducerUidLauncherPins({importClosure:async()=>({
    verifyV2ProducerCloudRuntimeClosure:async()=>({status:'RUNTIME_CLOSURE_VERIFIED',moduleCount:V2_PRODUCER_UID_LAUNCHER_CLOSURE_MODULE_COUNT-1,
      manifestSHA:V2_PRODUCER_UID_LAUNCHER_PINS.closureManifestSHA})
  })}),/uid_launcher_runtime_closure/);
});

test('launcher refuses a changed pinned entry before importing the cloud closure',async()=>{
  let imported=false;const real=fs.promises.readFile;
  await assert.rejects(verifyV2ProducerUidLauncherPins({readFile:async(...args)=>{
    const b=await real(...args);return String(args[0]).endsWith('v2-producer-cloud-entry.mjs')?Buffer.concat([b,Buffer.from('\n')]):b;
  },importClosure:async()=>{imported=true;return{};}}),/uid_launcher_source_pin/);
  assert.equal(imported,false);
});

test('UID drop invocation pins target IDs, clears supplementary groups, and resets environment',()=>{
  const args=buildV2ProducerUidDropProbeArgs();
  assert.deepEqual(args.slice(0,11),['--pdeathsig','SIGKILL','--reuid=1000','--regid=1000','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--','/usr/bin/env']);
  const i=args.indexOf('-i');assert.ok(i>0);assert.deepEqual(args.slice(i+1,i+6),Object.entries(V2_PRODUCER_UID_LAUNCHER_ENV).map(([k,v])=>`${k}=${v}`));
  assert.deepEqual(args.slice(-3,-1),['--max-old-space-size=64','-e']);
});

test('entry invocation is fixed and cannot accept an alternate script or arguments',()=>{
  const args=buildV2ProducerUidEntryArgs();assert.ok(args.includes('/usr/bin/env'));assert.ok(args.includes('-i'));
  assert.deepEqual(args.slice(0,11),['--pdeathsig','SIGKILL','--reuid=1000','--regid=1000','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--','/usr/bin/env']);
  assert.equal(args.at(-1),'--execute-one-fixed-candidate');assert.ok(args.some(a=>a.endsWith('v2-producer-cloud-entry.mjs')));
  assert.throws(()=>buildV2ProducerUidEntryArgs({entryPath:'/tmp/other.mjs'}),/fixed_entry_only/);
});

test('all fixed preflight thresholds remain fail-closed',()=>{
  const base={platform:'linux',uid:0,gid:0,nodeVersion:'22.23.4',setprivCanonical:true};
  assert.equal(assessV2ProducerUidLauncherPreflight({...base,resources:{...healthy,cgroupBytes:3*GiB}}).reason,'cgroup_start_threshold');
  assert.equal(assessV2ProducerUidLauncherPreflight({...base,resources:{...healthy,memoryMaxBytes:6*GiB-1}}).reason,'cgroup_hard_limit_below_6gib');
  assert.equal(assessV2ProducerUidLauncherPreflight({...base,resources:{...healthy,volumeFreeBytes:4*GiB-1}}).reason,'volume_reserve_below_20_percent');
  assert.equal(assessV2ProducerUidLauncherPreflight({...base,resources:healthy}).status,'UID_DROP_PROBE_REQUIRED');
});

test('launcher refuses missing approval, non-root entry, and stale resource state before spawn',async()=>{
  let f=fakePorts();assert.equal((await launchV2ProducerUidEntry([],f)).reason,'explicit_fixed_entry_flag_required');assert.equal(f.events.length,0);
  f=fakePorts({uid:1000,gid:1000});assert.equal((await launchV2ProducerUidEntry(['--launch-fixed-entry'],f)).reason,'uid0_ssh_entry_required');assert.equal(f.events.length,0);
  f=fakePorts({resources:{...healthy,cgroupBytes:3*GiB}});assert.equal((await launchV2ProducerUidEntry(['--launch-fixed-entry'],f)).reason,'cgroup_start_threshold');assert.equal(f.events.length,0);
});

test('positive synthetic UID proof launches only the pinned entry under the sanitized UID drop',async()=>{
  const f=fakePorts(),r=await launchV2ProducerUidEntry(['--launch-fixed-entry'],f);
  assert.equal(r.status,'ENTRY_EXITED');assert.equal(r.financialActions,0);assert.equal(r.queueEligible,false);assert.equal(f.events.length,1);
  const [call]=f.events;assert.equal(call.exe,'/usr/bin/setpriv');assert.equal(call.options.cwd,fileURLToPath(new URL('../../',import.meta.url)));
  assert.equal(call.options.detached,false);assert.deepEqual(call.options.env,V2_PRODUCER_UID_LAUNCHER_ENV);assert.equal(call.options.stdio,'inherit');
  assert.equal(call.args.at(-1),'--execute-one-fixed-candidate');
});

test('failed UID drop proof blocks entry launch',async()=>{
  const f=fakePorts({uidDrop:'NOT_CAPABLE_UNPRIVILEGED'}),r=await launchV2ProducerUidEntry(['--launch-fixed-entry'],f);
  assert.equal(r.reason,'uid_drop_not_verified');assert.equal(f.events.length,0);assert.equal(r.producerStarted,false);
});

test('UID drop proof accepts only uid/gid 1000, empty groups, no capabilities, no-new-privs, and exact clean environment',()=>{
  const proof={uid:1000,euid:1000,gid:1000,egid:1000,groupsPresent:true,groups:[],noNewPrivs:1,capEff:'0000000000000000',env:{...V2_PRODUCER_UID_LAUNCHER_ENV},envKeys:Object.keys(V2_PRODUCER_UID_LAUNCHER_ENV).sort()};
  assert.equal(assessV2ProducerUidDropProbe({platform:'linux',callerUid:0,exitCode:0,stdout:JSON.stringify(proof)}).status,'UID_DROP_VERIFIED');
  assert.equal(assessV2ProducerUidDropProbe({platform:'linux',callerUid:0,exitCode:0,stdout:JSON.stringify({...proof,groups:[0]})}).status,'UID_DROP_IDENTITY_INVALID');
  assert.equal(assessV2ProducerUidDropProbe({platform:'linux',callerUid:0,exitCode:0,stdout:JSON.stringify({...proof,capEff:'0000000000000001'})}).status,'UID_DROP_IDENTITY_INVALID');
  assert.equal(assessV2ProducerUidDropProbe({platform:'linux',callerUid:0,exitCode:0,stdout:JSON.stringify({...proof,noNewPrivs:0})}).status,'UID_DROP_IDENTITY_INVALID');
  assert.equal(assessV2ProducerUidDropProbe({platform:'linux',callerUid:0,exitCode:0,stdout:JSON.stringify({...proof,euid:0})}).status,'UID_DROP_IDENTITY_INVALID');
  const missingGroups={...proof};delete missingGroups.groupsPresent;
  assert.equal(assessV2ProducerUidDropProbe({platform:'linux',callerUid:0,exitCode:0,stdout:JSON.stringify(missingGroups)}).status,'UID_DROP_IDENTITY_INVALID');
  assert.equal(assessV2ProducerUidDropProbe({platform:'linux',callerUid:1001,exitCode:1}).status,'NOT_CAPABLE_UNPRIVILEGED');
  assert.equal(assessV2ProducerUidDropProbe({platform:'win32',callerUid:null}).status,'UID_DROP_NOT_RUN_NON_LINUX');
});

test('supplementary group parser treats an empty Groups line as empty without consuming the next status line',()=>{
  assert.deepEqual(parseV2ProducerSupplementaryGroups('Name:\tnode\nGroups:\nNoNewPrivs:\t1\n'),[]);
  assert.deepEqual(parseV2ProducerSupplementaryGroups('Name:\tnode\nGroups:\t1000 1001\nNoNewPrivs:\t1\n'),[1000,1001]);
  assert.throws(()=>parseV2ProducerSupplementaryGroups('Name:\tnode\nNoNewPrivs:\t1\n'),/groups_status_missing/);
});

test('Linux CI records real UID drop capability without silently skipping unprivileged runners',()=>{
  const result=runV2ProducerUidDropProbe();
  console.log('V2_UID_DROP_CI_EVIDENCE '+JSON.stringify({status:result.status,probeExecuted:result.probeExecuted??false,
    callerUid:typeof process.getuid==='function'?process.getuid():null,exitCode:result.exitCode??null,uid:result.uid??null,gid:result.gid??null}));
  if(process.platform==='linux'&&typeof process.getuid==='function'&&process.getuid()!==0){
    assert.equal(result.status,'NOT_CAPABLE_UNPRIVILEGED');assert.equal(result.probeExecuted,true);
  }else if(process.platform==='linux'&&typeof process.getuid==='function'&&process.getuid()===0){
    assert.equal(result.status,'UID_DROP_VERIFIED');assert.equal(result.uid,1000);assert.equal(result.gid,1000);
  }else {assert.equal(result.status,'UID_DROP_NOT_RUN_NON_LINUX');assert.equal(result.probeExecuted,false);}
});
