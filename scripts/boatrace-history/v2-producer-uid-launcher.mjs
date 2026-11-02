import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const REPO=fileURLToPath(new URL('../../',import.meta.url));
const VOLUME='/app/apps/kelly-edge/data/keirin-history/boatrace-history';
const SETPRIV='/usr/bin/setpriv',ENV='/usr/bin/env';
const GROUPS_LINE_RE='^Groups:[ \\t]*(.*)$';
const ENTRY=path.join(REPO,'scripts/boatrace-history/v2-producer-cloud-entry.mjs');
const SHA=x=>createHash('sha256').update(x).digest('hex');
const GiB=1024**3,MiB=1024**2;
export const V2_PRODUCER_UID_LAUNCHER_PINS=Object.freeze({
  entrySHA:'742ae1d6a8d08ceea25ed9c697c60995e4313834cb7ad2d4e8fe7045400cbe5c',
  closureModuleSHA:'21b45fea393d65d58c8b4af7e63f2f40416dff803e491ac6269189e4462fc112',
  closureManifestSHA:'ed30b1d7365bdcfe70d9c8e55e1e2943302299059bd643678773f3adaee9f53d'
});
export const V2_PRODUCER_UID_LAUNCHER_ENV=Object.freeze({PATH:'/usr/bin:/bin',HOME:'/tmp',TMPDIR:'/tmp',LANG:'C.UTF-8',TZ:'UTC'});
export const V2_PRODUCER_UID_LAUNCHER_POLICY=Object.freeze({uid:1000,gid:1000,startMemoryBytes:3*GiB,minCgroupBytes:6*GiB,minVolumeFreeFraction:0.20,heapMiB:1024,preflightHeapMiB:64});
const fail=reason=>({status:'NOT_STARTED_FAIL_CLOSED',reason,controllerStarted:false,producerStarted:false,privateSourceReads:0,financialActions:0,queueEligible:false,actualPurchase:false});

export function buildV2ProducerUidDropProbeArgs(nodePath=process.execPath){
  const identityCode=`const s=require('node:fs').readFileSync('/proc/self/status','utf8'),m=/^NoNewPrivs:\\s+(\\d+)$/m.exec(s),c=/^CapEff:\\s+([a-f0-9]+)$/mi.exec(s),g=new RegExp(${JSON.stringify(GROUPS_LINE_RE)},'m').exec(s);process.stdout.write(JSON.stringify({uid:process.getuid(),euid:process.geteuid(),gid:process.getgid(),egid:process.getegid(),groupsPresent:!!g,groups:g?(g[1].trim()?g[1].trim().split(/\\s+/).map(Number):[]):null,noNewPrivs:Number(m?.[1]),capEff:c?.[1]?.toLowerCase(),env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,TZ:process.env.TZ},envKeys:Object.keys(process.env).sort()}))`;
  return ['--pdeathsig','SIGKILL','--reuid=1000','--regid=1000','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',ENV,'-i',
    ...Object.entries(V2_PRODUCER_UID_LAUNCHER_ENV).map(([k,v])=>`${k}=${v}`),nodePath,'--max-old-space-size=64','-e',identityCode];
}

export function parseV2ProducerSupplementaryGroups(statusText){
  const match=new RegExp(GROUPS_LINE_RE,'m').exec(statusText);
  if(!match)throw Error('uid_launcher_groups_status_missing');
  return match[1].trim()?match[1].trim().split(/\s+/).map(Number):[];
}

export function assessV2ProducerUidDropProbe({platform,callerUid,exitCode,spawnError,stdout}={}){
  if(platform!=='linux')return {status:'UID_DROP_NOT_RUN_NON_LINUX',probeExecuted:false};
  if(!Number.isSafeInteger(callerUid))return {status:'UID_DROP_NOT_RUN_UID_UNKNOWN',probeExecuted:false};
  if(spawnError)return {status:callerUid===0?'UID_DROP_HELPER_ERROR':'NOT_CAPABLE_UNPRIVILEGED',probeExecuted:true,reason:spawnError};
  if(exitCode!==0)return {status:callerUid===0?'UID_DROP_CAPABILITY_FAILED':'NOT_CAPABLE_UNPRIVILEGED',probeExecuted:true,exitCode};
  let proof;try{proof=JSON.parse(stdout);}catch{return {status:'UID_DROP_IDENTITY_INVALID',probeExecuted:true};}
  const env=V2_PRODUCER_UID_LAUNCHER_ENV,keys=Object.keys(env).sort();
  const valid=proof?.uid===1000&&proof?.euid===1000&&proof?.gid===1000&&proof?.egid===1000&&proof?.groupsPresent===true&&Array.isArray(proof.groups)&&proof.groups.length===0&&
    proof.noNewPrivs===1&&proof.capEff==='0000000000000000'&&
    proof.envKeys?.length===keys.length&&proof.envKeys.every((k,i)=>k===keys[i])&&keys.every(k=>proof.env?.[k]===env[k]);
  return valid?{status:'UID_DROP_VERIFIED',probeExecuted:true,uid:proof.uid,gid:proof.gid,supplementaryGroupCount:0,environmentKeys:keys}:
    {status:'UID_DROP_IDENTITY_INVALID',probeExecuted:true};
}

export function runV2ProducerUidDropProbe({platform=process.platform,uid=typeof process.getuid==='function'?process.getuid():null,
  spawnSyncPort=spawnSync,nodePath=process.execPath,setprivPath=SETPRIV}={}){
  if(platform!=='linux')return assessV2ProducerUidDropProbe({platform,callerUid:uid});
  if(!Number.isSafeInteger(uid))return assessV2ProducerUidDropProbe({platform,callerUid:uid});
  const r=spawnSyncPort(setprivPath,buildV2ProducerUidDropProbeArgs(nodePath),{cwd:REPO,encoding:'utf8',timeout:5000,maxBuffer:16*1024,
    stdio:['ignore','pipe','ignore'],env:V2_PRODUCER_UID_LAUNCHER_ENV});
  return assessV2ProducerUidDropProbe({platform,callerUid:uid,exitCode:r.status,spawnError:r.error?.code??null,stdout:r.stdout??''});
}

export async function verifyV2ProducerUidLauncherPins({readFile=fs.promises.readFile,importClosure=specifier=>import(specifier)}={}){
  const entry=await readFile(ENTRY),closure=await readFile(path.join(REPO,'scripts/boatrace-history/v2-producer-cloud-closure.mjs')),
    manifest=await readFile(path.join(REPO,'scripts/boatrace-history/v2-producer-cloud-runtime-closure.json'));
  if(SHA(entry)!==V2_PRODUCER_UID_LAUNCHER_PINS.entrySHA||SHA(closure)!==V2_PRODUCER_UID_LAUNCHER_PINS.closureModuleSHA||
    SHA(manifest)!==V2_PRODUCER_UID_LAUNCHER_PINS.closureManifestSHA)throw Error('uid_launcher_source_pin');
  const closureModule=await importClosure('./v2-producer-cloud-closure.mjs');
  const verified=await closureModule.verifyV2ProducerCloudRuntimeClosure(REPO);
  if(verified.status!=='RUNTIME_CLOSURE_VERIFIED'||verified.moduleCount!==43||verified.manifestSHA!==V2_PRODUCER_UID_LAUNCHER_PINS.closureManifestSHA)
    throw Error('uid_launcher_runtime_closure');
  return {status:'UID_LAUNCHER_PINS_VERIFIED',entrySHA:V2_PRODUCER_UID_LAUNCHER_PINS.entrySHA,closureModuleSHA:V2_PRODUCER_UID_LAUNCHER_PINS.closureModuleSHA,
    closureManifestSHA:verified.manifestSHA,moduleCount:verified.moduleCount};
}

function readResourceSnapshot(){
  const current=Number(fs.readFileSync('/sys/fs/cgroup/memory.current','utf8').trim()),maxText=fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),
    memoryMax=maxText==='max'?null:Number(maxText),stat=fs.statfsSync(VOLUME),volumeBytes=Number(stat.blocks)*Number(stat.bsize),volumeFreeBytes=Number(stat.bavail)*Number(stat.bsize);
  if(![current,volumeBytes,volumeFreeBytes].every(Number.isSafeInteger)||current<0||volumeBytes<1||volumeFreeBytes<0||volumeFreeBytes>volumeBytes||
    memoryMax!==null&&(!Number.isSafeInteger(memoryMax)||memoryMax<1))throw Error('uid_launcher_resource_measurement');
  return {cgroupBytes:current,memoryMaxBytes:memoryMax,volumeBytes,volumeFreeBytes,heapUsedBytes:process.memoryUsage().heapUsed};
}

export function assessV2ProducerUidLauncherPreflight({platform,uid,gid,nodeVersion,setprivCanonical,resources}={}){
  if(platform!=='linux')return fail('linux_required');if(uid!==0)return fail('uid0_ssh_entry_required');if(!/^22\./.test(nodeVersion??''))return fail('node22_required');
  if(gid!==0)return fail('gid0_ssh_entry_required');if(setprivCanonical!==true)return fail('setpriv_helper_unavailable');
  if(!resources||![resources.cgroupBytes,resources.memoryMaxBytes,resources.volumeBytes,resources.volumeFreeBytes,resources.heapUsedBytes].every(Number.isSafeInteger))return fail('resource_measurement');
  if(resources.cgroupBytes>=V2_PRODUCER_UID_LAUNCHER_POLICY.startMemoryBytes)return fail('cgroup_start_threshold');
  if(resources.memoryMaxBytes<V2_PRODUCER_UID_LAUNCHER_POLICY.minCgroupBytes)return fail('cgroup_hard_limit_below_6gib');
  if(resources.volumeFreeBytes/resources.volumeBytes<V2_PRODUCER_UID_LAUNCHER_POLICY.minVolumeFreeFraction)return fail('volume_reserve_below_20_percent');
  if(resources.heapUsedBytes>=900*MiB)return fail('launcher_heap_start_threshold');
  return {status:'UID_DROP_PROBE_REQUIRED',controllerStarted:false,producerStarted:false,resources,financialActions:0,queueEligible:false,actualPurchase:false};
}

export function buildV2ProducerUidEntryArgs({nodePath=process.execPath,entryPath=ENTRY}={}){
  if(nodePath!==process.execPath||entryPath!==ENTRY)throw Error('uid_launcher_fixed_entry_only');
  return ['--pdeathsig','SIGKILL','--reuid=1000','--regid=1000','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',ENV,'-i',
    ...Object.entries(V2_PRODUCER_UID_LAUNCHER_ENV).map(([k,v])=>`${k}=${v}`),nodePath,`--max-old-space-size=${V2_PRODUCER_UID_LAUNCHER_POLICY.heapMiB}`,entryPath,'--execute-one-fixed-candidate'];
}

function defaultPorts(){
  let setprivCanonical=false;try{const st=fs.lstatSync(SETPRIV);setprivCanonical=st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o111)!==0&&fs.realpathSync(SETPRIV)===SETPRIV;}catch{}
  return {platform:process.platform,uid:typeof process.getuid==='function'?process.getuid():null,
    gid:typeof process.getgid==='function'?process.getgid():null,nodeVersion:process.versions.node,setprivCanonical,
    readResources:readResourceSnapshot,verifyPins:verifyV2ProducerUidLauncherPins,probeUidDrop:()=>runV2ProducerUidDropProbe(),spawn};
}

export async function launchV2ProducerUidEntry(argv=process.argv.slice(2),providedPorts={}){
  if(argv.length!==1||argv[0]!=='--launch-fixed-entry')return fail('explicit_fixed_entry_flag_required');
  const ports={...defaultPorts(),...providedPorts};
  if(ports.platform!=='linux')return fail('linux_required');if(ports.uid!==0||ports.gid!==0)return fail('uid0_ssh_entry_required');
  if(!/^22\./.test(ports.nodeVersion??''))return fail('node22_required');if(ports.setprivCanonical!==true)return fail('setpriv_helper_unavailable');
  let pins;try{pins=await ports.verifyPins();}catch{return fail('runtime_closure_pin_failed');}
  let resources;try{resources=await ports.readResources();}catch{return fail('resource_measurement');}
  const gate=assessV2ProducerUidLauncherPreflight({platform:ports.platform,uid:ports.uid,gid:ports.gid,nodeVersion:ports.nodeVersion,setprivCanonical:ports.setprivCanonical,resources});
  if(gate.status!=='UID_DROP_PROBE_REQUIRED')return gate;
  let probe;try{probe=await ports.probeUidDrop();}catch{return fail('uid_drop_probe_failed');}
  if(probe.status!=='UID_DROP_VERIFIED')return {...fail('uid_drop_not_verified'),uidDropProbe:probe,pins};
  const child=ports.spawn(SETPRIV,buildV2ProducerUidEntryArgs(),{cwd:REPO,detached:false,env:V2_PRODUCER_UID_LAUNCHER_ENV,stdio:'inherit'});
  const code=await new Promise(resolve=>{let settled=false;const done=value=>{if(settled)return;settled=true;resolve(value);};child.once('error',()=>done({error:true}));child.once('close',(exitCode,signal)=>done({exitCode,signal}));});
  return {status:code.error?'ENTRY_SPAWN_FAILED':'ENTRY_EXITED',controllerStarted:!code.error,producerStarted:'entry-dependent',sourceReadStarted:'entry-dependent',financialActions:0,
    queueEligible:false,actualPurchase:false,exitCode:code.exitCode??null,signal:code.signal??null,pins,uidDropProbe:probe};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  launchV2ProducerUidEntry().then(r=>{process.stdout.write(JSON.stringify(r)+'\n');if(r.status!=='ENTRY_EXITED')process.exitCode=1;})
    .catch(()=>{process.stderr.write('{"status":"NOT_STARTED_FAIL_CLOSED","reason":"launcher_error","producerStarted":false}\n');process.exitCode=1;});
}
