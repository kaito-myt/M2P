import {mkdir,lstat,readFile,writeFile,rename,unlink,link,statfs} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {inspectDay} from './capacity.mjs';
import {collectLegacyDay,archiveSourceForDate,LEGACY_SOURCE} from './legacy-archive.mjs';

export const BODY_LIMIT=32*1024*1024;
const META_LIMIT=512*1024;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const jstDay=now=>new Date(now+9*3600000).toISOString().slice(0,10);
export function collectionLimits(mode='audit'){
 if(mode==='audit')return {maxDays:8,maxRequests:8,dailyLimit:24,maxMs:300000};
 if(mode==='backfill')return {maxDays:366,maxRequests:400,dailyLimit:400,maxMs:2700000};
 throw Error('invalid_boat_mode');
}
export function validateDates(dates,now=Date.now(),mode='audit'){
 const {maxDays}=collectionLimits(mode);
 if(!Array.isArray(dates)||dates.length<1||dates.length>maxDays||new Set(dates).size!==dates.length||dates.some(v=>typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'2025-10-01'||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v||v>=jstDay(now)))throw Error('invalid_boat_dates');
 return [...dates].sort();
}
export function dateRange(from,to,now=Date.now()){
 validateDates([from],now,'backfill');validateDates([to],now,'backfill');
 if(from>to)throw Error('invalid_boat_dates');
 const count=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000+1;
 if(count>366)throw Error('invalid_boat_dates');
 return validateDates(Array.from({length:count},(_,i)=>new Date(Date.parse(from+'T00:00:00Z')+i*86400000).toISOString().slice(0,10)),now,'backfill');
}
export const sourceUrl=date=>{if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'2026-01-01'||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('invalid_boat_date');return `https://turnmark.github.io/api/v1/${date.slice(0,4)}/${date.replaceAll('-','')}.json`;};
export function storageSafe(stats){const size=Number(stats.blocks)*Number(stats.bsize),free=Number(stats.bavail)*Number(stats.bsize);return size>0&&free>=100*1024*1024&&free/size>.2;}
async function regular(file){try{const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('unsafe_boat_file');return stat;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function ensureDirectory(directory){
 const absolute=path.resolve(directory);let cursor=path.parse(absolute).root;
 for(const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);try{await mkdir(cursor);}catch(error){if(error.code!=='EEXIST')throw error;}const stat=await lstat(cursor);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('unsafe_boat_directory');}
}
async function bytes(file,limit=META_LIMIT){const stat=await regular(file);if(!stat)return null;if(stat.size>limit)throw Error('boat_file_limit');const body=await readFile(file);if(body.length>limit)throw Error('boat_file_limit');return body;}
async function json(file,fallback){const value=await bytes(file);if(value===null)return fallback;const parsed=JSON.parse(value.toString('utf8'));if(!object(parsed))throw Error('invalid_boat_metadata');return parsed;}
async function atomic(file,body,exclusive=false){
 await regular(file);const temp=file+'.'+randomUUID()+'.tmp';
 try{await writeFile(temp,body,{flag:'wx'});if(exclusive){await link(temp,file);await unlink(temp);}else await rename(temp,file);}finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function saveJson(file,value){const body=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(body)>META_LIMIT)throw Error('boat_metadata_limit');await atomic(file,body);}
export function coverageBytes(value){const body=Buffer.from(JSON.stringify(value)+'\n');if(body.length>128*1024)throw Error('boat_coverage_limit');return body;}
const digest=body=>createHash('sha256').update(body).digest('hex');
async function limitedBody(response){
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>BODY_LIMIT))throw Error('boat_body_limit');
 const reader=response.body?.getReader();if(!reader)throw Error('boat_body_missing');let size=0;const chunks=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>BODY_LIMIT)throw Error('boat_body_limit');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
 return Buffer.concat(chunks,size);
}
const publicReason=error=>['boat_body_limit','boat_body_missing','boat_storage_limit','unsafe_boat_file','unsafe_boat_directory','boat_original_integrity','boat_original_orphan'].includes(error?.message)?error.message:error?.name==='TimeoutError'?'request_timeout':'source_error';
export async function collectDates({directory,dates,collectionMode='audit',retryUnsuccessful=false,fetchImpl=fetch,now=()=>Date.now(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),signal,storageStats=()=>statfs(directory),maxRequests,dailyLimit,maxMs,onProgress=()=>{}}){
 if(typeof retryUnsuccessful!=='boolean')throw Error('invalid_boat_retry_policy');
 const limits=collectionLimits(collectionMode);maxRequests??=limits.maxRequests;dailyLimit??=limits.dailyLimit;maxMs??=limits.maxMs;
 dates=validateDates(dates,now(),collectionMode);
 if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>limits.maxRequests||!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>limits.dailyLimit||!Number.isInteger(maxMs)||maxMs<1000||maxMs>limits.maxMs)throw Error('invalid_boat_limits');
 await ensureDirectory(directory);
 const fixed=name=>path.join(directory,name),lock=fixed('collector.lock'),sources=[...new Set(dates.map(archiveSourceForDate))].sort();
 let ownsLock=false,requests=0,lastStart=null,reason='complete';const start=now(),manifests=[];
 try{
  await regular(lock);await writeFile(lock,JSON.stringify({pid:process.pid,startedAt:new Date(start).toISOString()})+'\n',{flag:'wx'});ownsLock=true;
  const blocked=await json(fixed('access-block.json'),null);
  if(blocked){reason='access_blocked';}
  let budget=await json(fixed('request-budget.json'),{date:jstDay(now()),requests:0});
  if(typeof budget.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(budget.date)||!Number.isFinite(Date.parse(budget.date+'T00:00:00Z'))||new Date(budget.date+'T00:00:00Z').toISOString().slice(0,10)!==budget.date||budget.date>jstDay(now())||!Number.isSafeInteger(budget.requests)||budget.requests<0)throw Error('invalid_boat_budget');
  if(budget.date!==jstDay(now()))budget={date:jstDay(now()),requests:0};
  const coverage=async(final=false)=>{
   const aggregate={schemaVersion:1,source:sources.length===1?sources[0]:'mixed_boatrace_archives',generatedAt:new Date(now()).toISOString(),status:reason==='complete'?(manifests.length===dates.length?'complete':'running'):'stopped',reason,requestedDates:dates,requestedDays:dates.length,collectedDays:0,downloadedDays:0,missingDays:0,unsupportedDays:0,failedDays:0,requestsThisRun:requests,dailyRequests:budget.requests,races:0,completeEntryRaces:0,completeTrifectaRaces:0,resultShapeRaces:0,refundShapeRaces:0,trifectaPayoutShapeRaces:0,invalidIdentityNodes:0,timingVerifiedRaces:0,analysisReady:false,crossSourceEqualityVerified:false,fieldPathLimit:384,fieldsTruncated:false,fieldsIncompleteDays:0,omittedFieldObservations:0,fields:[],days:[],limitations:['reference_archive_only','field_presence_not_semantics_or_pre_decision_evidence','non_official_source','no_model_or_financial_validation']};
   const fields=new Map(),incompleteDates=new Set();
   for(const manifest of manifests){aggregate.days.push({date:manifest.date,status:manifest.status,httpStatus:manifest.httpStatus,races:manifest.audit?.races??0});if(['collected','unsupported'].includes(manifest.status))aggregate.downloadedDays++;if(manifest.status==='collected')aggregate.collectedDays++;if(manifest.status==='missing')aggregate.missingDays++;if(manifest.status==='unsupported')aggregate.unsupportedDays++;if(manifest.status==='failed')aggregate.failedDays++;
    if(!manifest.audit)continue;for(const key of ['races','completeEntryRaces','completeTrifectaRaces','resultShapeRaces','refundShapeRaces','trifectaPayoutShapeRaces','invalidIdentityNodes'])aggregate[key]+=manifest.audit[key];
    if(manifest.audit.fieldsTruncated){aggregate.fieldsTruncated=true;incompleteDates.add(manifest.date);aggregate.omittedFieldObservations+=manifest.audit.omittedFieldObservations;}
    for(const field of manifest.audit.fields){if(fields.size>=aggregate.fieldPathLimit&&!fields.has(field.path)){aggregate.fieldsTruncated=true;incompleteDates.add(manifest.date);aggregate.omittedFieldObservations+=field.present;continue;}const row=fields.get(field.path)??{path:field.path,grain:field.grain,present:0,nonNull:0,total:0};for(const k of ['present','nonNull','total'])row[k]+=field[k];fields.set(field.path,row);}
   }
   Object.assign(aggregate,{collectionMode,from:dates[0],to:dates.at(-1),processedDays:manifests.length,unprocessedDays:dates.length-manifests.length});
   aggregate.fieldsIncompleteDays=incompleteDates.size;
   aggregate.fields=[...fields.values()].map(field=>({...field,total:aggregate.races*(field.grain==='boat'?6:1)})).sort((a,b)=>a.path.localeCompare(b.path));
   await atomic(fixed('coverage.json'),coverageBytes(aggregate));await onProgress(aggregate,{final:final||aggregate.status==='stopped'});return aggregate;
  };
  for(const date of dates){
   if(signal?.aborted){reason='cancelled';break;}
   if(now()-start>=maxMs){reason='time_limit';break;}
   const source=archiveSourceForDate(date),folder=path.join(directory,'manifests',source,date.slice(0,4));await ensureDirectory(folder);
   const manifestFile=path.join(folder,date.replaceAll('-','')+'.json'),rawDirectory=path.join(directory,'raw',source,date.slice(0,4));await ensureDirectory(rawDirectory);
   const rawFile=path.join(rawDirectory,date.replaceAll('-','')+'.json.gz');
   const old=await json(manifestFile,null);
   if(source===LEGACY_SOURCE){
    const request=async url=>{
     if(reason==='access_blocked')throw Error('access_blocked');if(signal?.aborted){reason='cancelled';throw Error(reason);}if(now()-start>=maxMs){reason='time_limit';throw Error(reason);}if(requests>=maxRequests){reason='request_limit';throw Error(reason);}
     if(budget.date!==jstDay(now()))budget={date:jstDay(now()),requests:0};if(budget.requests>=dailyLimit){reason='daily_limit';throw Error(reason);}if(!storageSafe(await storageStats())){reason='boat_storage_limit';throw Error(reason);}
     if(lastStart!==null){const delay=Math.max(0,2000-(now()-lastStart));if(delay)await wait(delay);}if(signal?.aborted){reason='cancelled';throw Error(reason);}if(now()-start>=maxMs){reason='time_limit';throw Error(reason);}
     if(budget.date!==jstDay(now()))budget={date:jstDay(now()),requests:0};if(budget.requests>=dailyLimit){reason='daily_limit';throw Error(reason);}budget.requests++;await saveJson(fixed('request-budget.json'),budget);requests++;lastStart=now();const retrievedAt=new Date(now()).toISOString();
     let response;try{response=await fetchImpl(url,{redirect:'manual',credentials:'omit',headers:{accept:'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      if([403,429].includes(response.status)){reason='access_blocked';await saveJson(fixed('access-block.json'),{schemaVersion:1,source:LEGACY_SOURCE,httpStatus:response.status,at:retrievedAt});}
      if(response.status!==200){await response.body?.cancel();return {status:response.status,retrievedAt};}const body=await limitedBody(response);return {status:200,bytes:body,retrievedAt};
     }catch(error){await response?.body?.cancel().catch(()=>{});if(signal?.aborted){reason='cancelled';throw Error(reason);}throw Error(publicReason(error));}
    };
    const partFile=kind=>path.join(rawDirectory,date.replaceAll('-','')+'.'+kind+'.json.gz');
    const manifest=await collectLegacyDay({date,old,retryUnsuccessful,now,readRaw:kind=>bytes(partFile(kind),BODY_LIMIT),writeRaw:async(kind,body)=>{if(!storageSafe(await storageStats())){reason='boat_storage_limit';throw Error(reason);}await atomic(partFile(kind),gzipSync(body),true);},saveManifest:value=>saveJson(manifestFile,value),request});
    manifests.push(manifest);await saveJson(fixed('checkpoint.json'),{schemaVersion:1,source:sources.length===1?sources[0]:'mixed_boatrace_archives',requestedDates:dates,completedDates:manifests.map(m=>m.date),updatedAt:new Date(now()).toISOString()});await coverage();if(reason!=='complete')break;continue;
   }
   if(old){
    if(old.date!==date||old.source!=='turnmark_v1'||!['collected','unsupported','missing','failed'].includes(old.status))throw Error('invalid_boat_manifest');
    if(['collected','unsupported'].includes(old.status)){const compressed=await bytes(rawFile,BODY_LIMIT);if(!compressed)throw Error('boat_original_integrity');const raw=gunzipSync(compressed,{maxOutputLength:BODY_LIMIT});if(digest(raw)!==old.sha256)throw Error('boat_original_integrity');try{old.audit=inspectDay(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),date);}catch{old.audit=inspectDay(null,date);}old.status=old.audit.schemaKnown?'collected':'unsupported';}
    if(!retryUnsuccessful||!['missing','failed'].includes(old.status)){manifests.push(old);await coverage();continue;}
    if(await regular(rawFile))throw Error('boat_original_integrity');
   }
   if(reason==='access_blocked')break;
   if(signal?.aborted){reason='cancelled';break;}
   if(now()-start>=maxMs){reason='time_limit';break;}
   if(requests>=maxRequests){reason='request_limit';break;}
   if(budget.date!==jstDay(now()))budget={date:jstDay(now()),requests:0};
   if(budget.requests>=dailyLimit){reason='daily_limit';break;}
   if(!storageSafe(await storageStats())){reason='boat_storage_limit';break;}
   if(await regular(rawFile))throw Error('boat_original_orphan');
   if(lastStart!==null){const delay=Math.max(0,2000-(now()-lastStart));if(delay)await wait(delay);}
   if(signal?.aborted){reason='cancelled';break;}
   if(now()-start>=maxMs){reason='time_limit';break;}
   if(budget.date!==jstDay(now()))budget={date:jstDay(now()),requests:0};
   budget.requests++;await saveJson(fixed('request-budget.json'),budget);requests++;lastStart=now();
   const manifest={schemaVersion:1,source:'turnmark_v1',date,url:sourceUrl(date),retrievedAt:new Date(now()).toISOString(),httpStatus:null,status:'failed',bytes:0,sha256:null,audit:null,error:null,...(old?{retryOf:{status:old.status,retrievedAt:old.retrievedAt??null,httpStatus:old.httpStatus??null,error:old.error??null}}:{})};
   let response;
   try{
    response=await fetchImpl(manifest.url,{redirect:'manual',credentials:'omit',headers:{accept:'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});manifest.httpStatus=response.status;
    if(response.status===403||response.status===429){reason='access_blocked';manifest.error='access_blocked';await saveJson(fixed('access-block.json'),{schemaVersion:1,source:'turnmark_v1',httpStatus:response.status,at:manifest.retrievedAt});await response.body?.cancel();}
    else if(response.status===404){manifest.status='missing';manifest.error='http_missing';await response.body?.cancel();}
    else if(response.status!==200){manifest.error='http_unavailable';await response.body?.cancel();}
    else{
     const body=await limitedBody(response);manifest.bytes=body.length;manifest.sha256=digest(body);
     let audit;try{audit=inspectDay(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)),date);}catch{audit=inspectDay(null,date);manifest.error='invalid_json';}
     manifest.audit=audit;manifest.status=audit.schemaKnown?'collected':'unsupported';
     if(!storageSafe(await storageStats()))throw Error('boat_storage_limit');
     await atomic(rawFile,gzipSync(body),true);
    }
   }catch(error){await response?.body?.cancel().catch(()=>{});manifest.error=signal?.aborted?'cancelled':publicReason(error);manifest.status='failed';if(signal?.aborted)reason='cancelled';else if(error?.message==='boat_storage_limit')reason='boat_storage_limit';}
   await saveJson(manifestFile,manifest);manifests.push(manifest);await saveJson(fixed('checkpoint.json'),{schemaVersion:1,source:'turnmark_v1',requestedDates:dates,completedDates:manifests.map(m=>m.date),updatedAt:new Date(now()).toISOString()});await coverage();
   if(reason!=='complete')break;
  }
  return await coverage(true);
 }finally{if(ownsLock)await unlink(lock);}
}
