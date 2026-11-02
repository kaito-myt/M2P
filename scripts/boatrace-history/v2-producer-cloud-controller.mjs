import * as fs from 'node:fs';
import path from 'node:path';
import {spawn as nodeSpawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {V2_PRODUCER_CLOUD_POLICY,assessV2ProducerCloudPreflight,createV2ProducerCloudDescriptor,v2ProducerCloudOwnershipMarker} from './v2-producer-cloud-plan.mjs';
import {cleanupV2ProducerCloudStaging,quarantineV2ProducerCloudOutput} from './v2-producer-cloud-runner.mjs';
import {verifyV2ProducerCloudRuntimeClosure} from './v2-producer-cloud-closure.mjs';

const fail=code=>{throw Error(`v2_producer_cloud_controller_${code}`);};
const REPO=fileURLToPath(new URL('../../',import.meta.url));
const VOLUME='/app/apps/kelly-edge/data/keirin-history/boatrace-history';
export const V2_PRODUCER_CLOUD_CONTROLLER_POLICY=Object.freeze({
  pollMs:1000,heartbeatMs:500,heartbeatMaxAgeMs:3000,termGraceMs:5000,killWaitMs:5000,
  workerRSSLimitBytes:1536*1024**2,stdoutLimitBytes:256*1024,stderrLimitBytes:4096,
  scratchPrefix:'/tmp/kelly-v2-producer-cloud-',workerHeapMiB:1024
});

function parseProcStat(raw,pid){const end=raw.lastIndexOf(')');if(end<0)fail('proc_stat');const a=raw.slice(end+2).trim().split(/\s+/);
  const rec={pid, state:a[0], ppid:Number(a[1]), pgrp:Number(a[2]), session:Number(a[3]), startTicks:a[19]};
  if(!/^[A-Z]$/.test(rec.state)||![rec.ppid,rec.pgrp,rec.session].every(Number.isSafeInteger)||!/^\d+$/.test(rec.startTicks))fail('proc_identity');return rec;}
function readProc(pid){try{return parseProcStat(fs.readFileSync(`/proc/${pid}/stat`,'utf8'),pid);}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return null;throw e;}}
function processSnapshot(){const rows=[];for(const name of fs.readdirSync('/proc'))if(/^\d+$/.test(name)){const row=readProc(Number(name));if(row)rows.push(row);}
  const byPid=new Map(rows.map(r=>[r.pid,r])),children=new Set(),todo=[process.pid];while(todo.length){const parent=todo.pop();for(const row of rows)if(row.ppid===parent&&!children.has(row.pid)){children.add(row.pid);todo.push(row.pid);}}
  return {rows,byPid,descendants:rows.filter(r=>children.has(r.pid))};}
function rssBytes(pid){try{const status=fs.readFileSync(`/proc/${pid}/status`,'utf8'),kb=Number(status.match(/^VmRSS:\s+(\d+) kB$/m)?.[1]);if(!Number.isSafeInteger(kb))fail('proc_rss');return kb*1024;}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return 0;throw e;}}
function active(row){return row&&!['Z','X'].includes(row.state);}
function processTreeGone(pid,expectedStartTicks,ports,known=[]){
  const leader=ports.readProcess(pid);if(leader&&leader.startTicks!==expectedStartTicks)fail('worker_pid_reused');
  const snap=ports.readProcesses(),owned=snap.filter(r=>r.pid===pid||isDescendant(r,pid,snap));
  for(const saved of known){const row=ports.readProcess(saved.pid);if(row&&row.startTicks!==saved.startTicks)fail('worker_descendant_pid_reused');if(active(row))owned.push(row);}
  return !owned.some(active);
}
function isDescendant(row,root,snapshot){const by=new Map(snapshot.map(r=>[r.pid,r]));let p=row.ppid,steps=0;while(Number.isSafeInteger(p)&&p>1&&steps++<256){if(p===root)return true;p=by.get(p)?.ppid;}return false;}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
export function v2ProducerCloudHeartbeatFresh(lastHeartbeatAt,now=Date.now(),maxAgeMs=V2_PRODUCER_CLOUD_CONTROLLER_POLICY.heartbeatMaxAgeMs){
  return Number.isSafeInteger(lastHeartbeatAt)&&Number.isSafeInteger(now)&&Number.isSafeInteger(maxAgeMs)&&maxAgeMs>0&&now>=lastHeartbeatAt&&now-lastHeartbeatAt<=maxAgeMs;
}

function defaultPorts(){return {
  platform:process.platform,uid:typeof process.getuid==='function'?process.getuid():null,nodeVersion:process.versions.node,
  spawn:nodeSpawn,readProcess:readProc,readProcesses:()=>processSnapshot().rows,
  readTreeRss(pid,startTicks){const leader=readProc(pid);if(leader&&leader.startTicks!==startTicks)fail('worker_pid_reused');const rows=processSnapshot().rows,tree=rows.filter(r=>r.pid===pid||isDescendant(r,pid,rows));return tree.filter(active).reduce((sum,r)=>sum+rssBytes(r.pid),0);},
  signalProcess(pid,startTicks,signal){const row=readProc(pid);if(row&&row.startTicks!==startTicks)fail('descendant_pid_reused');if(row&&active(row))process.kill(pid,signal);},
  async readResources(){
    const currentText=fs.readFileSync('/sys/fs/cgroup/memory.current','utf8').trim(),maxText=fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim();
    const stat=fs.statfsSync(VOLUME),cgroupBytes=Number(currentText),memoryMaxBytes=Number(maxText),volumeBytes=Number(stat.blocks)*Number(stat.bsize),volumeFreeBytes=Number(stat.bavail)*Number(stat.bsize);
    if(![cgroupBytes,memoryMaxBytes,volumeBytes,volumeFreeBytes].every(Number.isSafeInteger)||memoryMaxBytes<1)fail('resource_measurement');
    return {cgroupBytes,memoryMaxBytes,volumeBytes,volumeFreeBytes,heapUsedBytes:process.memoryUsage().heapUsed,
      memoryEvents:fs.readFileSync('/sys/fs/cgroup/memory.events','utf8').trim()};
  },
  makeScratch(runId){const at=V2_PRODUCER_CLOUD_CONTROLLER_POLICY.scratchPrefix+runId;fs.mkdirSync(at,{mode:0o700});return at;},
  removeScratch(at,runId){const expected=V2_PRODUCER_CLOUD_CONTROLLER_POLICY.scratchPrefix+runId;if(at!==expected||path.dirname(at)!=='/tmp'||fs.lstatSync(at).isSymbolicLink()||fs.realpathSync(at)!==at)fail('scratch_cleanup_scope');fs.rmSync(at,{recursive:true,force:false});},
  async cleanupStaging(runId,proof){return cleanupV2ProducerCloudStaging(runId,proof);},
  async quarantineCandidate(runId,proof){return quarantineV2ProducerCloudOutput(runId,proof);},
  candidatePathsAvailable(runId){
    const namespace=path.posix.join(VOLUME,'research','actual-one-day-v2-candidates');
    for(const p of [path.posix.join(namespace,runId),path.posix.join(namespace,`.staging-${runId}`),path.posix.join(VOLUME,'research','actual-one-day-v2-candidates-quarantine',runId)]){
      try{fs.lstatSync(p);return false;}catch(e){if(e?.code!=='ENOENT')throw e;}
    }
    return true;
  },
  reserveRunId(runId,attemptNonce,descriptorSHA){
    const research=path.posix.join(VOLUME,'research'),marker=path.posix.join(research,`.v2-producer-cloud-owner-${runId}.json`),bytes=v2ProducerCloudOwnershipMarker({runId,attemptNonce,descriptorSHA});
    const st=fs.lstatSync(research);if(st.isSymbolicLink()||!st.isDirectory()||fs.realpathSync(research)!==research)fail('reservation_namespace');
    let fd;try{fd=fs.openSync(marker,'wx',0o600);}catch(e){if(e?.code==='EEXIST')return false;throw e;}
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);const dir=fs.openSync(research,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}return true;}
    catch(e){try{fs.closeSync(fd);}catch{}try{fs.unlinkSync(marker);}catch{}throw e;}
    finally{try{fs.closeSync(fd);}catch{}}
  },
  releaseRunId(runId,attemptNonce,descriptorSHA){
    const research=path.posix.join(VOLUME,'research'),marker=path.posix.join(research,`.v2-producer-cloud-owner-${runId}.json`),bytes=v2ProducerCloudOwnershipMarker({runId,attemptNonce,descriptorSHA});
    const st=fs.lstatSync(marker);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(marker)!==marker||fs.readFileSync(marker,'utf8')!==bytes)fail('reservation_release_ownership');
    fs.unlinkSync(marker);const dir=fs.openSync(research,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  },
  validateParentDeathSignal(){
    const at='/usr/bin/setpriv',st=fs.lstatSync(at);if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o111)===0||fs.realpathSync(at)!==at)fail('pdeathsig_helper');
    execFileSync(at,['--pdeathsig','SIGKILL','--',process.execPath,'-e','process.exit(0)'],{timeout:5000,stdio:'ignore',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',TZ:'UTC'}});return true;
  },
  send(child,message){child.send(message);},
  signalGroup(pid,signal){process.kill(-pid,signal);},
  wait
};}

async function terminateOwnedTree(pid,startTicks,ports,known=[],policy=V2_PRODUCER_CLOUD_CONTROLLER_POLICY){
  const target=ports.readProcess(pid);if(target&&target.startTicks!==startTicks)fail('worker_pid_reused');
  const snapshot=ports.readProcesses(),knownRows=[];for(const saved of known){const row=ports.readProcess(saved.pid);if(row&&row.startTicks!==saved.startTicks)fail('worker_descendant_pid_reused');if(row)knownRows.push(row);}
  const desc=[...new Map([...snapshot.filter(r=>r.pid===pid||isDescendant(r,pid,snapshot)),...knownRows].map(r=>[r.pid,r])).values()].filter(active);
  const groupRows=snapshot.filter(r=>r.pgrp===pid&&r.session===pid&&active(r)),ownedIds=new Set(desc.map(r=>r.pid));
  const groupSafe=groupRows.length>0&&groupRows.every(r=>ownedIds.has(r.pid));
  if(groupSafe)try{ports.signalGroup(pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')fail('worker_group_term_failed');}
  if(!groupSafe)for(const r of desc){try{ports.signalProcess(r.pid,r.startTicks,'SIGTERM');}catch{fail('worker_descendant_term_failed');}}
  else for(const r of desc)if(r.pgrp!==pid){try{ports.signalProcess(r.pid,r.startTicks,'SIGTERM');}catch{fail('worker_descendant_term_failed');}}
  const end=Date.now()+policy.termGraceMs;
  while(Date.now()<end){if(processTreeGone(pid,startTicks,ports,known))return true;await ports.wait(100);}
  const snap2=ports.readProcesses(),remaining=[...new Map([...snap2.filter(r=>r.pid===pid||isDescendant(r,pid,snap2)),...known.map(s=>ports.readProcess(s.pid)).filter(Boolean)].map(r=>[r.pid,r])).values()].filter(active);
  const ownSecond=new Set(remaining.map(r=>r.pid)),members=snap2.filter(r=>r.pgrp===pid&&r.session===pid&&active(r)),groupSafeSecond=members.length>0&&members.every(r=>ownSecond.has(r.pid));
  if(groupSafeSecond)try{ports.signalGroup(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')fail('worker_group_kill_failed');}
  if(!groupSafeSecond)for(const r of remaining){try{ports.signalProcess(r.pid,r.startTicks,'SIGKILL');}catch{fail('worker_descendant_kill_failed');}}
  else for(const r of remaining)if(r.pgrp!==pid){try{ports.signalProcess(r.pid,r.startTicks,'SIGKILL');}catch{fail('worker_descendant_kill_failed');}}
  const killEnd=Date.now()+policy.killWaitMs;
  while(Date.now()<killEnd){if(processTreeGone(pid,startTicks,ports,known))return true;await ports.wait(100);}
  return processTreeGone(pid,startTicks,ports,known);
}

/** Owns a detached worker process group and refuses private reads unless its live supervisor proof reaches the worker. */
export async function runV2ProducerCloudController({runId=randomUUID(),approved=false}={},providedPorts={}){
  const ports={...defaultPorts(),...providedPorts};
  if(approved!==true)return {status:'NOT_STARTED_NEEDS_EXPLICIT_APPROVAL',sourceReadStarted:false,financialActions:0};
  if(ports.platform!=='linux'||ports.uid!==1000||!/^22\./.test(ports.nodeVersion??'')||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId))fail('environment');
  const initial=await ports.readResources();
  if(initial.memoryMaxBytes<V2_PRODUCER_CLOUD_POLICY.cgroupStopBytes)fail('cgroup_hard_limit_below_stop_threshold');
  const gate=assessV2ProducerCloudPreflight({...initial,lockHeld:true});
  if(gate.status!=='READY_FOR_SEPARATE_ROOT_REVIEW')return {...gate,sourceReadStarted:false,controllerStarted:false};
  if(await (ports.validateParentDeathSignal??defaultPorts().validateParentDeathSignal)()!==true)fail('pdeathsig_unavailable');
  await (ports.verifyRuntimeClosure??verifyV2ProducerCloudRuntimeClosure)(REPO);
  if(await (ports.candidatePathsAvailable??defaultPorts().candidatePathsAvailable)(runId)!==true)
    return {status:'RUN_ID_COLLISION_NOT_STARTED',runId,sourceReadStarted:false,existingCandidatePreserved:true,financialActions:0,queueEligible:false,actualPurchase:false};
  const attemptNonce=randomBytes(32).toString('hex'),descriptor=createV2ProducerCloudDescriptor({runId,attemptNonce});
  const reserved=await (ports.reserveRunId??defaultPorts().reserveRunId)(runId,attemptNonce,descriptor.descriptorSHA);
  if(reserved!==true)return {status:'RUN_ID_RESERVATION_CONFLICT',runId,sourceReadStarted:false,existingCandidatePreserved:true,financialActions:0,queueEligible:false,actualPurchase:false};
  if(await (ports.candidatePathsAvailable??defaultPorts().candidatePathsAvailable)(runId)!==true){
    await (ports.releaseRunId??defaultPorts().releaseRunId)(runId,attemptNonce,descriptor.descriptorSHA);
    return {status:'RUN_ID_COLLISION_NOT_STARTED',runId,sourceReadStarted:false,existingCandidatePreserved:true,financialActions:0,queueEligible:false,actualPurchase:false};}
  let scratch=null;const workerPath=path.join(REPO,'scripts/boatrace-history/v2-producer-cloud-worker.mjs');
  let child=null,workerStartTicks=null,ready=false,scopeSent=false,result=null,stopReason=null,stdoutBytes=0,stderrBytes=0,monitor,heartbeat,wallTimer,closed=null,treeGone=false,cleanup=null,quarantine=null,lastResources=initial,termination=null,stopUnconfirmed=false;
  const knownDescendants=new Map();
  const started=Date.now();
  try{
    scratch=ports.makeScratch(runId);
    child=ports.spawn('/usr/bin/setpriv',['--pdeathsig','SIGKILL','--',process.execPath,'--max-old-space-size=1024',workerPath],{cwd:REPO,detached:true,env:{PATH:'/usr/bin:/bin',HOME:scratch,TMPDIR:scratch,LANG:'C.UTF-8',TZ:'UTC'},stdio:['ignore','pipe','pipe','ipc']});
    const earlyMessages=[];let handleMessage=null;
    child.on('message',m=>handleMessage?handleMessage(m):earlyMessages.push(m));
    child.once('close',(code,signal)=>{closed={code,signal};});
    child.stdout.on('data',b=>{stdoutBytes+=b.length;if(stdoutBytes>V2_PRODUCER_CLOUD_CONTROLLER_POLICY.stdoutLimitBytes&&workerStartTicks)stop('worker_stdout_limit');});
    child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes>V2_PRODUCER_CLOUD_CONTROLLER_POLICY.stderrLimitBytes&&workerStartTicks)stop('worker_stderr_limit');});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('spawn_failed')));});
    const identity=ports.readProcess(child.pid);workerStartTicks=identity?.startTicks;if(!identity||identity.ppid!==process.pid||identity.pgrp!==child.pid||identity.session!==child.pid)fail('worker_scope_identity');
    const stop=reason=>{if(stopReason)return;stopReason=reason;termination=terminateOwnedTree(child.pid,workerStartTicks,ports,[...knownDescendants.values()],ports.terminationPolicy??V2_PRODUCER_CLOUD_CONTROLLER_POLICY).then(gone=>{treeGone=gone;return gone;}).catch(()=>{treeGone=false;return false;});};
    handleMessage=message=>{
      if(!message||typeof message!=='object')return stop('worker_message_invalid');
      if(message.type==='ready'&&!ready){ready=true;const scope=ports.readProcess(child.pid),snapshot=ports.readProcesses(),tree=snapshot.filter(r=>r.pid===child.pid||isDescendant(r,child.pid,snapshot)),group=snapshot.filter(r=>r.pgrp===child.pid&&r.session===child.pid);
        if(!scope||scope.startTicks!==workerStartTicks||tree.some(r=>r.pgrp!==child.pid||r.session!==child.pid)||group.some(r=>!tree.some(t=>t.pid===r.pid)))return stop('worker_tree_scope_invalid');
        scopeSent=true;ports.send(child,{type:'owned_scope',runId,attemptNonce,descriptorSHA:descriptor.descriptorSHA,pid:child.pid,startTicks:workerStartTicks,pgid:child.pid,session:child.pid,
          controllerPid:process.pid,controllerStartTicks:ports.readProcess(process.pid)?.startTicks,memoryMaxBytes:initial.memoryMaxBytes,parentDeathSignal:'SIGKILL',scopeId:`pid-group:${child.pid}`});
      }else if(message.type==='result'&&scopeSent&&!result)result=message.result;
      else if(message.type==='worker_error')stop('worker_error');else stop('worker_message_order');
    };
    for(const message of earlyMessages.splice(0))handleMessage(message);
    const sample=async()=>{
      if(closed||stopReason)return;try{
        lastResources=await ports.readResources();const snapshot=ports.readProcesses(),tree=snapshot.filter(r=>r.pid===child.pid||isDescendant(r,child.pid,snapshot)),group=snapshot.filter(r=>r.pgrp===child.pid&&r.session===child.pid);
        for(const row of tree)knownDescendants.set(row.pid,{pid:row.pid,startTicks:row.startTicks});
        if(!tree.length||tree.length!==1||tree.some(r=>r.pgrp!==child.pid||r.session!==child.pid)||group.some(r=>!tree.some(t=>t.pid===r.pid))){stop('worker_tree_scope_lost');return;}
        const treeRss=await ports.readTreeRss(child.pid,workerStartTicks);
        if(lastResources.cgroupBytes>=V2_PRODUCER_CLOUD_POLICY.cgroupStopBytes)stop('cgroup_stop_threshold');
        else if(lastResources.volumeFreeBytes/lastResources.volumeBytes<V2_PRODUCER_CLOUD_POLICY.volumeFreeFractionMinimum)stop('volume_reserve_below_20_percent');
        else if(treeRss>V2_PRODUCER_CLOUD_CONTROLLER_POLICY.workerRSSLimitBytes)stop('worker_rss_limit');
      }catch{stop('resource_monitor_failed');}
    };
    monitor=setInterval(()=>void sample(),V2_PRODUCER_CLOUD_CONTROLLER_POLICY.pollMs);monitor.unref?.();
    heartbeat=setInterval(()=>{if(!closed&&!stopReason&&scopeSent)try{ports.send(child,{type:'heartbeat',at:Date.now()});}catch{stop('heartbeat_send_failed');}},V2_PRODUCER_CLOUD_CONTROLLER_POLICY.heartbeatMs);heartbeat.unref?.();
    wallTimer=setTimeout(()=>stop('wall_limit'),V2_PRODUCER_CLOUD_POLICY.wallLimitMs);wallTimer.unref?.();
    await sample();
    while(!closed){
      if(stopReason&&termination){const ended=await Promise.race([termination.then(gone=>({gone})),ports.wait(100).then(()=>null)]);
        if(ended&&!ended.gone){stopUnconfirmed=true;return {status:'STOP_UNCONFIRMED',reason:stopReason,runId,sourceReadStarted:scopeSent,workerTreeGone:false,
          cleanup:{status:'NOT_ATTEMPTED_WORKER_MAY_STILL_BE_ACTIVE'},financialActions:0,queueEligible:false,actualPurchase:false};}
        if(ended?.gone){treeGone=true;const closeDeadline=Date.now()+2000;while(!closed&&Date.now()<closeDeadline)await ports.wait(100);
          if(!closed){stopUnconfirmed=true;try{cleanup=await (ports.cleanupStaging??defaultPorts().cleanupStaging)(runId,{attemptNonce,descriptorSHA:descriptor.descriptorSHA});}catch{cleanup={status:'UNCONFIRMED'};}
            try{quarantine=await (ports.quarantineCandidate??quarantineV2ProducerCloudOutput)(runId,{attemptNonce,expectedDescriptorSHA:descriptor.descriptorSHA,
              expectedCandidateSHA:result?.descriptorSHA===descriptor.descriptorSHA?result.candidateSHA:undefined});}catch{quarantine={status:'QUARANTINE_UNCONFIRMED'};}
            return {status:'STOP_UNCONFIRMED',reason:'worker_terminal_event_unconfirmed',runId,sourceReadStarted:scopeSent,workerTreeGone:true,cleanup,quarantine,financialActions:0,queueEligible:false,actualPurchase:false};}}
      }
      if(!closed)await ports.wait(V2_PRODUCER_CLOUD_CONTROLLER_POLICY.pollMs);
    }
    if(!treeGone){termination=terminateOwnedTree(child.pid,workerStartTicks,ports,[...knownDescendants.values()],ports.terminationPolicy??V2_PRODUCER_CLOUD_CONTROLLER_POLICY);treeGone=await termination;}
    if(!treeGone){stopUnconfirmed=true;return {status:'STOP_UNCONFIRMED',reason:'worker_tree_stop_unconfirmed',runId,sourceReadStarted:scopeSent,workerTreeGone:false,
      cleanup:{status:'NOT_ATTEMPTED_WORKER_MAY_STILL_BE_ACTIVE'},financialActions:0,queueEligible:false,actualPurchase:false};}
    const candidateOK=!stopReason&&closed.code===0&&result?.status==='PENDING_INDEPENDENT_PIN_REVIEW'&&result.runId===runId&&
      result.attemptNonce===attemptNonce&&result.descriptorSHA===descriptor.descriptorSHA&&
      result.candidatePath===`research/actual-one-day-v2-candidates/${runId}`&&result.artifactCount===214&&/^[a-f0-9]{64}$/.test(result.candidateSHA??'')&&
      result.autoAdmitted===false&&result.financialActions===0&&result.queueEligible===false&&result.actualPurchase===false;
    if(!candidateOK){try{cleanup=await (ports.cleanupStaging??defaultPorts().cleanupStaging)(runId,{attemptNonce,descriptorSHA:descriptor.descriptorSHA});}catch{cleanup={status:'STAGING_CLEANUP_UNCONFIRMED'};}
      try{quarantine=await (ports.quarantineCandidate??quarantineV2ProducerCloudOutput)(runId,{attemptNonce,expectedDescriptorSHA:descriptor.descriptorSHA,
        expectedCandidateSHA:result?.descriptorSHA===descriptor.descriptorSHA?result.candidateSHA:undefined});}
      catch{quarantine={status:'QUARANTINE_UNCONFIRMED',reason:'ownership_proof_or_durability_failed'};}}
    const unverifiedCandidate=Boolean(quarantine&&['QUARANTINED_NOT_ADMITTED','QUARANTINE_DURABILITY_UNCONFIRMED','QUARANTINE_UNCONFIRMED'].includes(quarantine.status))||
      cleanup?.status==='STAGING_CLEANUP_UNCONFIRMED';
    return {status:candidateOK?'PENDING_INDEPENDENT_PIN_REVIEW':unverifiedCandidate?'WORKER_STOPPED_UNVERIFIED_CANDIDATE':'WORKER_STOPPED_NO_CANDIDATE',reason:stopReason,runId,
      sourceReadStarted:scopeSent,workerTreeGone:treeGone,cleanup,quarantine,terminal:closed,resource:lastResources,
      output:candidateOK?{candidatePath:result.candidatePath,artifactCount:result.artifactCount,candidateSHA:result.candidateSHA}:null,
      financialActions:0,queueEligible:false,actualPurchase:false};
  }finally{
    clearInterval(monitor);clearInterval(heartbeat);clearTimeout(wallTimer);
    if(child&&!closed&&!stopUnconfirmed){if(workerStartTicks)treeGone=await terminateOwnedTree(child.pid,workerStartTicks,ports,[...knownDescendants.values()],ports.terminationPolicy??V2_PRODUCER_CLOUD_CONTROLLER_POLICY);else stopUnconfirmed=true;}
    if(!stopUnconfirmed&&(treeGone||!child)){
      if(scratch)ports.removeScratch(scratch,runId);
      await (ports.releaseRunId??defaultPorts().releaseRunId)(runId,attemptNonce,descriptor.descriptorSHA);
    }
  }
}

export const v2ProducerCloudControllerInternals=Object.freeze({parseProcStat,isDescendant,processTreeGone,terminateOwnedTree});
