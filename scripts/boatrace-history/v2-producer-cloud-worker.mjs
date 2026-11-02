import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createV2ProducerCloudDescriptor} from './v2-producer-cloud-plan.mjs';
import {runV2ProducerCloudCandidate} from './v2-producer-cloud-runner.mjs';
import {V2_PRODUCER_CLOUD_CONTROLLER_POLICY,v2ProducerCloudHeartbeatFresh} from './v2-producer-cloud-controller.mjs';

const fail=code=>{throw Error(`v2_producer_cloud_worker_${code}`);};
function proc(pid){try{const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),end=raw.lastIndexOf(')'),a=raw.slice(end+2).trim().split(/\s+/);return{state:a[0],ppid:Number(a[1]),pgrp:Number(a[2]),session:Number(a[3]),startTicks:a[19]};}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return null;throw e;}}
function send(message){return new Promise((resolve,reject)=>{if(typeof process.send!=='function')return reject(Error('ipc_unavailable'));process.send(message,error=>error?reject(error):resolve());});}
async function receiveScope(){
  if(typeof process.send!=='function'||!process.connected)fail('ipc_unavailable');
  await send({type:'ready'});
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(Error('scope_handshake_timeout'));},15000);timeout.unref?.();
    const onMessage=m=>{if(m?.type==='heartbeat')return;if(m?.type!=='owned_scope'){cleanup();reject(Error('scope_handshake_message'));return;}cleanup();resolve(m);};
    const onDisconnect=()=>{cleanup();reject(Error('supervisor_disconnected'));};
    function cleanup(){clearTimeout(timeout);process.off('message',onMessage);process.off('disconnect',onDisconnect);}
    process.on('message',onMessage);process.once('disconnect',onDisconnect);
  });
}

export async function runV2ProducerCloudWorker({ports}={}){
  if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()!==1000||!/^22\./.test(process.versions.node)||!process.connected)fail('environment');
  const scopeMessage=await receiveScope(),worker=proc(process.pid),controller=proc(process.ppid),memoryMax=Number(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim());
  if(!worker||!controller||scopeMessage.pid!==process.pid||scopeMessage.pgid!==process.pid||scopeMessage.session!==process.pid||
    scopeMessage.controllerPid!==process.ppid||controller.startTicks!==scopeMessage.controllerStartTicks||worker.ppid!==process.ppid||
    worker.pgrp!==process.pid||worker.session!==process.pid||scopeMessage.memoryMaxBytes!==memoryMax||memoryMax<V2_PRODUCER_CLOUD_CONTROLLER_POLICY.workerRSSLimitBytes*4||
    scopeMessage.parentDeathSignal!=='SIGKILL'||typeof scopeMessage.runId!=='string'||! /^[a-f0-9]{64}$/.test(scopeMessage.attemptNonce??'')||
    !/^[a-f0-9]{64}$/.test(scopeMessage.descriptorSHA??''))fail('scope_binding');
  let lastHeartbeat=Date.now(),disconnected=false;
  const onMessage=m=>{if(m?.type==='heartbeat'&&Number.isSafeInteger(m.at))lastHeartbeat=Date.now();};
  process.on('message',onMessage);process.once('disconnect',()=>{disconnected=true;});
  const scope={status:'OWNED_SCOPE_CONFIRMED',childTreeOwned:true,stopSupervisorActive:true,scopeId:`pid-group:${process.pid}`,
    memoryMaxBytes:memoryMax,isActive(){
      const w=proc(process.pid),p=proc(process.ppid);
      return !disconnected&&v2ProducerCloudHeartbeatFresh(lastHeartbeat)&&
        Boolean(w&&p&&w.startTicks===worker.startTicks&&w.pgrp===process.pid&&w.session===process.pid&&p.startTicks===controller.startTicks);
    }};
  if(!scope.isActive())fail('supervisor_inactive');
  const runId=scopeMessage.runId,descriptor=createV2ProducerCloudDescriptor({runId,attemptNonce:scopeMessage.attemptNonce});
  if(descriptor.descriptorSHA!==scopeMessage.descriptorSHA)fail('descriptor_scope_binding');
  const controllerAbort=new AbortController(),onStop=()=>controllerAbort.abort();process.once('SIGTERM',onStop);process.once('SIGINT',onStop);
  try{
    const result=await runV2ProducerCloudCandidate({descriptor,signal:controllerAbort.signal},{...ports,readOwnedScope:async()=>scope});
    await send({type:'result',result});return result;
  }finally{process.off('SIGTERM',onStop);process.off('SIGINT',onStop);process.off('message',onMessage);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runV2ProducerCloudWorker().catch(async error=>{try{await send({type:'worker_error',reason:/^[a-z0-9_]{1,100}$/.test(error.message)?error.message:'worker_failure'});}catch{}process.exitCode=1;}).finally(()=>{if(process.connected)process.disconnect();});
}
