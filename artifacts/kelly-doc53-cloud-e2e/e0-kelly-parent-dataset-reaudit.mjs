import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const H = b => createHash('sha256').update(b).digest('hex');
export const DIRECTORY = '/app/apps/kelly-edge/data/keirin-history/boatrace-history';
const META_SHA = '7f42900cdd6ff802ad57e1be6d4b3e3e60c1b9672cd1d0f038eccb1880470512';
const SOURCE = Object.freeze({
  'quality-audit.mjs':'3f77d5d0a52c2f9dd5d1969ed14f30a003f0cfadd6ce266f165eafccc0c47450',
  'normalize.mjs':'1cb391847b0d9614202c994d0611fc33d366c33d3b7d8df9191625eb90ddcff9',
  'legacy-archive.mjs':'f20c068173b9e5e851821e83c049cf829f2722ac3ce77ff721f31ecee3548e72',
  'joint-dataset.mjs':'70fc93d38a96b0c6f0e7d97649dc574a6fef4f146b7c85f14f8e199a9ff03137'
});
const fail = s => {throw Error('parent_reaudit_' + s);};
export function fixedDates() {return Array.from({length:365}, (_,i)=>new Date(Date.UTC(2025,9,1+i)).toISOString().slice(0,10));}
export function dayFiles(date) {
  if (!fixedDates().includes(date)) fail('date');
  const source = date < '2026-01-01' ? 'boatrace_legacy_v3' : 'turnmark_v1', stem=date.replaceAll('-',''), base=source+'/'+date.slice(0,4)+'/'+stem;
  return [{name:'manifests/'+base+'.json',cap:131072}, ...(source==='turnmark_v1' ? [''] : ['.programs','.results','.previews']).map(s=>({name:'raw/'+base+s+'.json.gz',cap:33554432}))];
}
const identityKeys=['dev','ino','size','mtimeNs','ctimeNs'];
export async function stableRead(file,cap) {
  for(let p=file;p!=='/';p=path.dirname(p)){const s=await fs.lstat(p);if(s.isSymbolicLink())fail('symlink');}
  const before=await fs.lstat(file,{bigint:true});
  if(!before.isFile()||before.size<1n||before.size>BigInt(cap)||await fs.realpath(file)!==file)fail('file');
  const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const opened=await fd.stat({bigint:true}),bytes=await fd.readFile(),after=await fd.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});
    if(bytes.length>cap||BigInt(bytes.length)!==before.size||identityKeys.some(k=>before[k]!==opened[k]||before[k]!==after[k]||before[k]!==named[k]))fail('changed');
    return {bytes,stamp:identityKeys.map(k=>String(before[k])).join(':')+':'+H(bytes)};
  } finally {await fd.close();}
}
async function core({metadata,dates,ports,signal,now=Date.now,synthetic=false}) {
  const start=now(),deadline=start+2700000,check=()=>{if(signal?.aborted||now()>=deadline)fail('stopped');};
  const builder=ports.builder({maxRaces:75000,maxBytes:48*1024*1024,splits:metadata.splitBounds}),snap=createHash('sha256'),seen=new Set(),records=new Map();
  let callbackError=null,processed=0;
  const capture=async ref=>{check();const r=await ports.read(DIRECTORY+'/'+ref.name,ref.cap);return r.stamp;};
  for(const date of dates){check();const refs=dayFiles(date);for(const ref of refs)records.set(ref.name,{ref,stamp:await capture(ref)});
    let callbacks=0;
    const q=await ports.audit({directory:DIRECTORY,dates:[date],signal,now,onNormalizedDay(day,evidence){
      try {check();if(seen.has(date)||evidence?.date!==date||day?.date!==date||day.status!=='normalized'||!Array.isArray(day.races)||!/^[a-f0-9]{64}$/.test(evidence.sha256)||day.races.some(r=>r.date!==date))fail('callback');
        seen.add(date);callbacks++;snap.update(date+':'+evidence.sha256+'\n');for(const row of day.races)builder.append(row);
      }catch(e){callbackError=e;throw e;}
    }});
    if(callbackError)throw callbackError;
    if(callbacks!==1||q.status!=='complete'||q.failedDays!==0||q.notCollectedDays!==0||q.verifiedRawDays!==1||q.processedDays!==1)fail('incomplete');
    for(const ref of refs)if(await capture(ref)!==records.get(ref.name).stamp)fail('changed');processed++;
  }
  // Recheck earlier days too: per-day equality alone misses later modifications.
  for(const {ref,stamp} of records.values())if(await capture(ref)!==stamp)fail('changed');
  check();if(seen.size!==dates.length||processed!==dates.length)fail('incomplete');
  const dataset=builder.finish(),digest=ports.digest(dataset),parts=ports.split(dataset,metadata.splitBounds),counts=Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,v.length])),snapshot=snap.digest('hex');
  if(snapshot!==metadata.sourceSnapshotSha256)fail('snapshot');
  if(digest!==metadata.datasetDigest||dataset.size!==metadata.eligibleRaces)fail('digest');
  if(JSON.stringify(counts)!==JSON.stringify(metadata.splitCounts))fail('split');
  return {version:'kelly_parent_dataset_reaudit_v1',status:synthetic?'synthetic_contract_only':'original_dataset_reaudited_not_money_verified',runId:metadata.runId,sourceSnapshotSha256:snapshot,datasetDigest:digest,rows:dataset.size,days:processed,splitCounts:counts,filesChecked:records.size,currentRawDatasetReaudited:!synthetic,moneyUnitsVerified:false,featureUnitsVerified:false,featureTimingVerified:false,newPolicyCalibrationAvailable:false,operationalQualified:false,financialActions:0,fitCalls:0,predictCalls:0,originalRunWrites:0,checkpointReads:0,elapsedMs:now()-start};
}
// Explicit synthetic entry: injected evidence can never publish actual re-audit.
export const exerciseSyntheticReaudit = args => core({...args,synthetic:true});
export async function reauditAcceptedParent({metadataBytes,signal,now=Date.now}) {
  if(!Buffer.isBuffer(metadataBytes)||H(metadataBytes)!==META_SHA)fail('metadata');
  const metadata=JSON.parse(metadataBytes),dates=fixedDates();
  if(metadata.currentRawDatasetReaudited!==false||metadata.range.days!==365||metadata.modelArtifactSha256!=='5c0b174d5ae4a801fa7ce1f1f475883c191bca4428eee7797e6cae35fe13cfa5')fail('metadata');
  const parents=metadata.files.map(ref=>({...ref,file:DIRECTORY+'/research/joint/'+metadata.runId+'/'+ref.name})),parentBefore=new Map();
  for(const ref of parents){const r=await stableRead(ref.file,131072);if(r.bytes.length!==ref.bytes||H(r.bytes)!==ref.sha256)fail('parent');parentBefore.set(ref.file,r.stamp);}
  const files=Object.keys(SOURCE).map(name=>({name,file:fileURLToPath(new URL('../../scripts/boatrace-history/'+name,import.meta.url))})),before=new Map();
  for(const ref of files){const r=await stableRead(ref.file,131072);if(H(r.bytes)!==SOURCE[ref.name])fail('source');before.set(ref.file,r.stamp);}
  const audit=await import('../../scripts/boatrace-history/quality-audit.mjs'),data=await import('../../scripts/boatrace-history/joint-dataset.mjs');
  const result=await core({metadata,dates,signal,now,ports:{read:stableRead,audit:audit.auditStoredDays,builder:data.createJointDatasetBuilder,digest:data.digestJointDataset,split:data.splitJointDataset}});
  for(const ref of files)if((await stableRead(ref.file,131072)).stamp!==before.get(ref.file))fail('source_changed');
  for(const ref of parents)if((await stableRead(ref.file,131072)).stamp!==parentBefore.get(ref.file))fail('parent_changed');
  const bytes=Buffer.from(JSON.stringify({...result,sourceFiles:SOURCE,metadataSHA:META_SHA}));if(bytes.length>131072)fail('output');return bytes;
}
