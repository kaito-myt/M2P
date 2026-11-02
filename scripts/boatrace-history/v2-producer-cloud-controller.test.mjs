import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {main} from './v2-producer-cloud-entry.mjs';
import {runV2ProducerCloudController,v2ProducerCloudControllerInternals as internals,v2ProducerCloudHeartbeatFresh,V2_PRODUCER_CLOUD_CONTROLLER_POLICY} from './v2-producer-cloud-controller.mjs';
import {verifyV2ProducerCloudRuntimeClosure} from './v2-producer-cloud-closure.mjs';

const runId='00000000-0000-4000-8000-000000000301',GiB=1024**3;
class FakeChild extends EventEmitter{constructor(pid,{noResult=false,holdOpen=false}={}){super();this.pid=pid;this.stdout=new PassThrough();this.stderr=new PassThrough();this.connected=true;this.sent=[];this.noResult=noResult;this.holdOpen=holdOpen;}
  send(message){this.sent.push(message);if(message.type==='owned_scope'){if(this.holdOpen)return;if(!this.noResult)this.emit('message',{type:'result',result:{status:'PENDING_INDEPENDENT_PIN_REVIEW',runId,attemptNonce:message.attemptNonce,descriptorSHA:message.descriptorSHA,candidatePath:`research/actual-one-day-v2-candidates/${runId}`,artifactCount:214,candidateSHA:'a'.repeat(64),autoAdmitted:false,financialActions:0,queueEligible:false,actualPurchase:false}});this.owner.finish(this.noResult?1:0,null);}}
}
function controllerPorts({startMemory=1*GiB,failHandshake=false,addEscapedDescendant=false,noResult=false,holdOpen=false,candidateFinal=false}={}){
  const child=new FakeChild(4401,{noResult,holdOpen}),log=[],state={alive:false,memory:startMemory,reservation:null,candidateFinal};child.owner={finish(code,signal){if(!state.alive)return;state.alive=false;setImmediate(()=>child.emit('close',code,signal));}};
  return {child,log,state,ports:{platform:'linux',uid:1000,nodeVersion:'22.10.0',
    readResources:async()=>({cgroupBytes:state.memory,memoryMaxBytes:8*GiB,heapUsedBytes:20,volumeBytes:100*GiB,volumeFreeBytes:80*GiB,memoryEvents:'oom 0'}),
    makeScratch:id=>`/tmp/kelly-v2-producer-cloud-${id}`,removeScratch:(at,id)=>log.push(['scratch_remove',at,id]),
    cleanupStaging:async(id,proof)=>{log.push(['staging_cleanup',id,proof]);return{stagingAbsent:true,scope:'this_run_staging_only'};},
    validateParentDeathSignal:async()=>true,verifyRuntimeClosure:async()=>({status:'RUNTIME_CLOSURE_VERIFIED'}),candidatePathsAvailable:()=>true,
    reserveRunId:(id,nonce,descriptorSHA)=>{if(state.reservation)return false;state.reservation={id,nonce,descriptorSHA};return true;},
    releaseRunId:(id,nonce,descriptorSHA)=>{assert.deepEqual(state.reservation,{id,nonce,descriptorSHA});log.push(['reservation_release',id,{...state.reservation}]);state.reservation=null;},
    quarantineCandidate:async(id,proof)=>{log.push(['quarantine',id,proof]);if(!state.candidateFinal)return{status:'NO_FINAL_CANDIDATE'};
      assert.deepEqual(state.reservation,{id,nonce:proof.attemptNonce,descriptorSHA:proof.expectedDescriptorSHA});return{status:'QUARANTINED_NOT_ADMITTED'};},
    spawn:(exe,args,opts)=>{assert.equal(exe,'/usr/bin/setpriv');assert.deepEqual(args.slice(0,3),['--pdeathsig','SIGKILL','--']);assert.equal(args[3],process.execPath);assert.equal(args[4],'--max-old-space-size=1024');assert.equal(opts.detached,true);assert.deepEqual(Object.keys(opts.env).sort(),['HOME','LANG','PATH','TMPDIR','TZ']);state.alive=true;setImmediate(()=>{child.emit('spawn');if(!failHandshake)setImmediate(()=>child.emit('message',{type:'ready'}));else setTimeout(()=>child.owner.finish(1,null),5);});return child;},
    readProcess:pid=>pid===child.pid?(state.alive?{pid,ppid:process.pid,pgrp:child.pid,session:child.pid,startTicks:'401',state:'S'}:null):pid===process.pid?{pid,ppid:1,pgrp:process.pid,session:process.pid,startTicks:'100',state:'S'}:null,
    readProcesses:()=>{const list=state.alive?[{pid:child.pid,ppid:process.pid,pgrp:child.pid,session:child.pid,startTicks:'401',state:'S'}]:[];if(state.alive&&addEscapedDescendant)list.push({pid:4402,ppid:child.pid,pgrp:4402,session:4402,startTicks:'402',state:'S'});return list;},
    readTreeRss:async()=>100,send:(c,m)=>c.send(m),signalGroup:(pid,sig)=>{log.push(['group',pid,sig]);child.owner.finish(143,sig);},signalProcess:(pid,ticks,sig)=>{log.push(['pid',pid,ticks,sig]);if(pid===child.pid)child.owner.finish(143,sig);},wait:ms=>new Promise(r=>setTimeout(r,Math.min(ms,2)))
  }};
}

test('entry does not spawn unless the explicit one-candidate flag is supplied',async()=>{
  const r=await main([],{spawn:()=>{throw Error('must_not_spawn');}});assert.equal(r.status,'NOT_STARTED_NEEDS_EXPLICIT_APPROVAL');assert.equal(r.sourceReadStarted,false);
});

test('fixed runtime closure matches its byte and SHA inventory',async()=>{
  const r=await verifyV2ProducerCloudRuntimeClosure();assert.equal(r.status,'RUNTIME_CLOSURE_VERIFIED');assert.equal(r.moduleCount,43);
});

test('dedicated entry verifies bootstrap pins before starting the supervised candidate',async()=>{
  const f=controllerPorts();f.ports.runId=runId;const r=await main(['--execute-one-fixed-candidate'],f.ports);
  assert.equal(r.status,'PENDING_INDEPENDENT_PIN_REVIEW');assert.equal(r.workerTreeGone,true);
});

test('controller refuses preflight resource failure before creating a worker',async()=>{
  const f=controllerPorts({startMemory:3*GiB});let spawned=0;const r=await runV2ProducerCloudController({runId,approved:true},{...f.ports,spawn:()=>{spawned++;}});
  assert.equal(r.status,'WAITING_RESOURCE_NOT_STARTED');assert.equal(spawned,0);assert.equal(r.sourceReadStarted,false);
});

test('existing same-UUID final or quarantine path refuses before spawn and preserves it',async()=>{
  const f=controllerPorts();let spawned=0;f.ports.candidatePathsAvailable=()=>false;f.ports.spawn=()=>{spawned++;throw Error('must_not_spawn');};
  const r=await runV2ProducerCloudController({runId,approved:true},f.ports);
  assert.equal(r.status,'RUN_ID_COLLISION_NOT_STARTED');assert.equal(r.existingCandidatePreserved,true);assert.equal(r.sourceReadStarted,false);
  assert.equal(spawned,0);assert.equal(f.log.some(x=>x[0]==='quarantine'||x[0]==='staging_cleanup'),false);
});

test('concurrent same-UUID controller is refused by the atomic reservation before spawn',async()=>{
  const f=controllerPorts();let spawned=0;const spawn=f.ports.spawn;f.ports.spawn=(...args)=>{spawned++;return spawn(...args);};
  const results=await Promise.all([runV2ProducerCloudController({runId,approved:true},f.ports),runV2ProducerCloudController({runId,approved:true},f.ports)]);
  assert.equal(results.filter(r=>r.status==='RUN_ID_RESERVATION_CONFLICT').length,1);assert.equal(spawned,1);
  assert.equal(results.filter(r=>r.sourceReadStarted).length,1);assert.equal(f.log.filter(x=>x[0]==='reservation_release').length,1);
});

test('worker closing without a supervisor handshake never starts private reads',async()=>{
  const f=controllerPorts({failHandshake:true}),r=await runV2ProducerCloudController({runId,approved:true},f.ports);
  assert.equal(r.status,'WORKER_STOPPED_NO_CANDIDATE');assert.equal(r.sourceReadStarted,false);assert.equal(r.cleanup.stagingAbsent,true);
});

test('worker receives an owned process-group proof and returns only after tree exit',async()=>{
  const f=controllerPorts(),r=await runV2ProducerCloudController({runId,approved:true},f.ports);
  assert.equal(r.status,'PENDING_INDEPENDENT_PIN_REVIEW');assert.equal(r.workerTreeGone,true);assert.equal(r.output.artifactCount,214);
  const scope=f.child.sent[0];assert.equal(scope.type,'owned_scope');assert.equal(scope.pgid,f.child.pid);assert.equal(scope.session,f.child.pid);assert.equal(scope.memoryMaxBytes,8*GiB);assert.equal(scope.parentDeathSignal,'SIGKILL');
  assert.ok(f.log.some(x=>x[0]==='scratch_remove'));assert.equal(f.log.some(x=>x[0]==='staging_cleanup'),false);
});

test('nonzero terminal exit without result does not quarantine an unowned final path',async()=>{
  const f=controllerPorts({noResult:true}),r=await runV2ProducerCloudController({runId,approved:true},f.ports);
  assert.equal(r.status,'WORKER_STOPPED_NO_CANDIDATE');
  assert.equal(r.actualPurchase,false);assert.equal(r.quarantine.status,'NO_FINAL_CANDIDATE');
  assert.equal(f.state.candidateFinal,false);
});

test('rename-before-IPC crash quarantines only final receipt bound to this attempt nonce',async()=>{
  const f=controllerPorts({noResult:true,candidateFinal:true}),r=await runV2ProducerCloudController({runId,approved:true},f.ports);
  const proof=f.log.find(x=>x[0]==='quarantine')?.[2],reservation=f.log.find(x=>x[0]==='reservation_release')?.[2];assert.equal(r.status,'WORKER_STOPPED_UNVERIFIED_CANDIDATE');
  assert.equal(proof.attemptNonce,reservation?.nonce);assert.equal(proof.expectedDescriptorSHA,reservation?.descriptorSHA);
  assert.equal(f.log.some(x=>x[0]==='reservation_release'),true);
});

test('controller stops the owned process group at 6 GiB and cleans only its run staging',async()=>{
  const f=controllerPorts(),read=f.ports.readResources;let n=0;f.ports.readResources=async()=>{const v=await read();if(++n>=2)f.state.memory=6*GiB;return {...v,cgroupBytes:f.state.memory};};
  const r=await runV2ProducerCloudController({runId,approved:true},f.ports);
  assert.equal(r.status,'WORKER_STOPPED_NO_CANDIDATE');assert.equal(r.reason,'cgroup_stop_threshold');assert.equal(r.workerTreeGone,true);
  assert.ok(f.log.some(x=>x[0]==='group'&&x[2]==='SIGTERM'));assert.ok(f.log.some(x=>x[0]==='staging_cleanup'&&x[1]===runId));
});

test('unexpected escaped descendant is individually signalled and reported as not admitted',async()=>{
  const f=controllerPorts({addEscapedDescendant:true}),r=await runV2ProducerCloudController({runId,approved:true},f.ports);
  assert.equal(r.status,'WORKER_STOPPED_NO_CANDIDATE');assert.equal(r.reason,'worker_tree_scope_lost');
  assert.ok(f.log.some(x=>x[0]==='pid'&&x[1]===4402));
});

test('controller avoids signalling an owned process group containing an unrelated member',async()=>{
  const f=controllerPorts(),read=f.ports.readProcesses;f.ports.readProcesses=()=>{const rows=read();if(f.state.alive)rows.push({pid:4499,ppid:1,pgrp:f.child.pid,session:f.child.pid,startTicks:'999',state:'S'});return rows;};
  const r=await runV2ProducerCloudController({runId,approved:true},f.ports);
  assert.equal(r.status,'WORKER_STOPPED_NO_CANDIDATE');assert.equal(r.reason,'worker_tree_scope_lost');
  assert.equal(f.log.some(x=>x[0]==='group'),false);assert.ok(f.log.some(x=>x[0]==='pid'&&x[1]===f.child.pid));
});

test('unreapable worker returns bounded STOP_UNCONFIRMED without claiming cleanup',async()=>{
  const f=controllerPorts({holdOpen:true}),read=f.ports.readResources;let n=0;f.ports.readResources=async()=>{const v=await read();if(++n>=2)f.state.memory=6*GiB;return {...v,cgroupBytes:f.state.memory};};
  f.ports.terminationPolicy={termGraceMs:10,killWaitMs:10};f.ports.signalGroup=(pid,sig)=>f.log.push(['group',pid,sig]);
  const r=await runV2ProducerCloudController({runId,approved:true},f.ports);
  assert.equal(r.status,'STOP_UNCONFIRMED');assert.equal(r.workerTreeGone,false);assert.equal(r.cleanup.status,'NOT_ATTEMPTED_WORKER_MAY_STILL_BE_ACTIVE');
  assert.equal(f.log.some(x=>x[0]==='staging_cleanup'),false);assert.equal(f.log.some(x=>x[0]==='scratch_remove'),false);
});

test('owned process group receives SIGTERM then SIGKILL if it does not exit',async()=>{
  let live=true;const events=[],rows=()=>live?[{pid:4401,ppid:process.pid,pgrp:4401,session:4401,startTicks:'1',state:'S'}]:[];
  const ports={readProcess:pid=>pid===4401&&live?{pid,startTicks:'1',state:'S'}:null,readProcesses:rows,
    signalGroup:(pid,sig)=>{events.push(sig);if(sig==='SIGKILL')live=false;},signalProcess(){throw Error('unexpected_pid_signal');},wait:ms=>new Promise(r=>setTimeout(r,Math.min(ms,2)))};
  const gone=await internals.terminateOwnedTree(4401,'1',ports,[],{termGraceMs:5,killWaitMs:30});assert.equal(gone,true);assert.deepEqual(events,['SIGTERM','SIGKILL']);
});

test('stale worker heartbeat cannot authorize the fixed-source runner',async()=>{
  const t=10000;assert.equal(v2ProducerCloudHeartbeatFresh(t,t),true);assert.equal(v2ProducerCloudHeartbeatFresh(t,t+3001),false);
  assert.equal(V2_PRODUCER_CLOUD_CONTROLLER_POLICY.heartbeatMaxAgeMs,3000);
});

test('Linux setpriv parent-death signal kills the detached worker after supervisor exit',{skip:process.platform!=='linux'||!fs.existsSync('/usr/bin/setpriv')},async()=>{
  const script=`const{spawn}=require('node:child_process');const code='process.stdout.write(String(process.pid)+"\\n");setInterval(()=>{},1000)';const c=spawn('/usr/bin/setpriv',['--pdeathsig','SIGKILL','--',process.execPath,'-e',code],{stdio:['ignore','pipe','ignore']});let done=false;c.stdout.once('data',b=>{if(done)return;done=true;process.stdout.write(b,()=>process.exit(0))});`;
  const parent=spawn(process.execPath,['-e',script],{stdio:['ignore','pipe','ignore']});let text='';parent.stdout.on('data',b=>text+=b);
  const code=await new Promise(resolve=>parent.once('close',resolve));assert.equal(code,0);const pid=Number(text.trim());assert.ok(Number.isSafeInteger(pid)&&pid>1);
  let stopped=false;for(let i=0;i<100;i++){try{const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),state=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/)[0];if(state==='Z'||state==='X')stopped=true;}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')stopped=true;else throw e;}if(stopped)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(stopped,true,'parent-death signal should stop worker without waiting for worker event loop');
});
