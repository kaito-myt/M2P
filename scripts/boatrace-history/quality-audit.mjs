import {constants} from 'node:fs';
import {open,lstat,writeFile,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {normalizeTurnmarkDay,NORMALIZER_VERSION} from './normalize.mjs';
import {normalizeLegacyDay,LEGACY_SOURCE,LEGACY_NORMALIZER_VERSION,LEGACY_KINDS,legacySnapshot,archiveSourceForDate,legacyUrl} from './legacy-archive.mjs';

const LIMIT=32*1024*1024;
async function readRegular(file,limit){
 const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>limit)throw Error('unsafe_quality_input');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw Error('unsafe_quality_input');const bytes=await handle.readFile();if(bytes.length>limit)throw Error('quality_input_limit');return bytes;}finally{await handle.close();}
}
async function checkParents(directory,file){
 const relative=path.relative(directory,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('unsafe_quality_path');
 let cursor=path.resolve(directory);for(const part of ['',...path.dirname(relative).split(path.sep).filter(p=>p&&p!=='.')]){if(part)cursor=path.join(cursor,part);const stat=await lstat(cursor);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('unsafe_quality_directory');}
}
/** Read-only retrospective data-quality audit. No network, predictions or orders. */
export async function auditStoredDays({directory,dates,now=()=>Date.now(),signal,onProgress=()=>{},onNormalizedDay=()=>{}}){
 const todayJst=new Date(now()+9*3600000).toISOString().slice(0,10);
 if(!Array.isArray(dates)||!dates.length||dates.length>366||new Set(dates).size!==dates.length||dates.some(date=>typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'2025-10-01'||date>=todayJst||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))throw Error('invalid_quality_dates');
 const sources=[...new Set(dates.map(archiveSourceForDate))],mixed=sources.includes(LEGACY_SOURCE),started=now(),report={schemaVersion:1,normalizerVersion:mixed?NORMALIZER_VERSION+'+'+LEGACY_NORMALIZER_VERSION:NORMALIZER_VERSION,source:sources.length===1?sources[0]:'mixed_boatrace_archives',generatedAt:null,status:'running',requestedDays:dates.length,processedDays:0,verifiedRawDays:0,notCollectedDays:0,failedDays:0,races:0,normalStructureRaces:0,incidentRaces:0,lowerPlaceTieRaces:0,resultStates:{},rejectedNodes:0,months:{},failures:[],analysisReady:false,executionEvidencePassed:false,liveEligible:false,financialActions:0,networkRequests:0,limitations:['retrospective_structure_audit_only','not_prediction_or_profit_validation','payout_basis_unverified','historical_t60_not_proven']};
 for(const date of dates){
  if(signal?.aborted||now()-started>45*60*1000){report.status='stopped';break;}
  try{
   const source=archiveSourceForDate(date),name=date.replaceAll('-',''),manifestFile=path.join(directory,'manifests',source,date.slice(0,4),name+'.json');await checkParents(directory,manifestFile);
   const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readRegular(manifestFile,128*1024)));
   if(manifest.source!==source||manifest.date!==date||!['collected','unsupported','missing','failed'].includes(manifest.status))throw Error('quality_manifest_identity');
   if(manifest.status!=='collected')report.notCollectedDays++;
   else{
    let normalized;
    if(source===LEGACY_SOURCE){
     if(!manifest.parts||Object.keys(manifest.parts).sort().join('|')!==[...LEGACY_KINDS].sort().join('|')||manifest.sha256!==legacySnapshot(manifest.parts))throw Error('quality_raw_integrity');const bundle={};let totalBytes=0;
     for(const kind of LEGACY_KINDS){const meta=manifest.parts[kind],rawFile=path.join(directory,'raw',source,date.slice(0,4),name+'.'+kind+'.json.gz');await checkParents(directory,rawFile);const raw=gunzipSync(await readRegular(rawFile,LIMIT),{maxOutputLength:LIMIT});if(meta.url!==legacyUrl(kind,date)||meta.bytes!==raw.length||createHash('sha256').update(raw).digest('hex')!==meta.sha256)throw Error('quality_raw_integrity');totalBytes+=raw.length;bundle[kind]=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}
     if(totalBytes!==manifest.bytes)throw Error('quality_raw_integrity');normalized=normalizeLegacyDay(bundle,manifest);
    }else{
     const rawFile=path.join(directory,'raw',source,date.slice(0,4),name+'.json.gz');await checkParents(directory,rawFile);const raw=gunzipSync(await readRegular(rawFile,LIMIT),{maxOutputLength:LIMIT});if(raw.length!==manifest.bytes||createHash('sha256').update(raw).digest('hex')!==manifest.sha256)throw Error('quality_raw_integrity');normalized=normalizeTurnmarkDay(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),manifest);
    }
    if(normalized.status!=='normalized')throw Error('quality_normalization_failed');
    report.verifiedRawDays++;report.races+=normalized.races.length;report.rejectedNodes+=normalized.rejectedNodes.length;
    const month=report.months[date.slice(0,7)]??={days:0,races:0,normalStructureRaces:0};month.days++;month.races+=normalized.races.length;
    for(const race of normalized.races){if(race.quality.normalStructure){report.normalStructureRaces++;month.normalStructureRaces++;}if(race.result.incident)report.incidentRaces++;if(race.result.lowerPlaceTie)report.lowerPlaceTieRaces++;const state=race.result.state;report.resultStates[state]=(report.resultStates[state]??0)+1;}
    await onNormalizedDay(normalized,{date,sha256:manifest.sha256});
   }
  }catch(error){report.failedDays++;report.failures.push({date,reason:['quality_manifest_identity','quality_raw_integrity','quality_normalization_failed','unsafe_quality_input','unsafe_quality_directory','quality_input_limit'].includes(error?.message)?error.message:error?.code==='ENOENT'?'not_stored':'quality_read_or_parse_failure'});}
  report.processedDays++;onProgress({processedDays:report.processedDays,requestedDays:report.requestedDays,races:report.races,normalStructureRaces:report.normalStructureRaces,failedDays:report.failedDays});
 }
 if(report.status==='running')report.status='complete';report.generatedAt=new Date(now()).toISOString();return report;
}
async function saveReport(directory,report,name){
 const target=path.join(directory,name);await checkParents(directory,target);
 try{const stat=await lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw Error('unsafe_quality_output');}catch(error){if(error.code!=='ENOENT')throw error;}
 const bytes=Buffer.from(JSON.stringify(report)+'\n');if(bytes.length>128*1024)throw Error('quality_report_limit');
 const temporary=target+'.'+randomUUID()+'.tmp';await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,target);
}
export const saveQualityReport=(directory,report)=>saveReport(directory,report,'quality-audit.json');
export const saveResearchReport=(directory,report)=>saveReport(directory,report,'retrospective-research.json');
export const saveRoleResearchReport=(directory,report)=>saveReport(directory,report,'role-domain-research.json');
