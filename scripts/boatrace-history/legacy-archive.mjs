import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

export const LEGACY_SOURCE='boatrace_legacy_v3',LEGACY_NORMALIZER_VERSION='legacy_three_archive_structure_v1';
export const LEGACY_KINDS=Object.freeze(['programs','results','previews']);
const LIMIT=32*1024*1024,HASH=/^[a-f0-9]{64}$/,object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),int=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
const sha=body=>createHash('sha256').update(body).digest('hex');
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v>='2025-10-01'&&v<'2026-01-01'&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(Date.parse(v+'T00:00:00Z')).toISOString().slice(0,10)===v;
export const archiveSourceForDate=date=>date<'2026-01-01'?LEGACY_SOURCE:'turnmark_v1';
export function legacyUrl(kind,date){if(!LEGACY_KINDS.includes(kind)||!validDate(date))throw Error('invalid_legacy_identity');return `https://boatraceopenapi.github.io/${kind}/v3/${date.slice(0,4)}/${date.replaceAll('-','')}.json`;}
export function legacySnapshot(parts){if(!object(parts)||LEGACY_KINDS.some(k=>!HASH.test(parts[k]?.sha256??'')))throw Error('legacy_parts_incomplete');return sha(JSON.stringify(LEGACY_KINDS.map(kind=>[kind,parts[kind].sha256])));}
const maps={
 program:{racer_branch_number:'branch_number',racer_birthplace_number:'birthplace_number',racer_age:'age',racer_weight:'weight',racer_flying_count:'flying_count',racer_late_count:'late_count',racer_average_start_timing:'average_start_timing',racer_national_top_1_percent:'national_win_rate',racer_national_top_2_percent:'national_top_2_percent',racer_national_top_3_percent:'national_top_3_percent',racer_local_top_1_percent:'local_win_rate',racer_local_top_2_percent:'local_top_2_percent',racer_local_top_3_percent:'local_top_3_percent',racer_assigned_motor_number:'motor_number',racer_assigned_motor_top_2_percent:'motor_top_2_percent',racer_assigned_motor_top_3_percent:'motor_top_3_percent',racer_assigned_boat_number:'boat_number',racer_assigned_boat_top_2_percent:'boat_top_2_percent',racer_assigned_boat_top_3_percent:'boat_top_3_percent'},
 preview:{racer_course_number:'course_number',racer_start_timing:'start_timing',racer_weight:'weight',racer_weight_adjustment:'weight_adjustment',racer_exhibition_time:'exhibition_time',racer_tilt_adjustment:'tilt_adjustment'},
 context:{closed_at:'closed_at',grade_number:'grade_number',title:'title',subtitle:'subtitle',distance:'distance'},
 weather:{wind_speed:'wind_speed',wind_direction_number:'wind_direction_number',wave_height:'wave_height',weather_number:'weather_number',air_temperature:'air_temperature',water_temperature:'water_temperature'}
};
function fields(row,mapping,rawPath){return Object.fromEntries(Object.entries(mapping).filter(([key])=>Object.hasOwn(row,key)).map(([source,key])=>{const value=row[source],valid=value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);return [key,{value:valid?value:null,rawPath:rawPath+'.'+source,sourceField:source,time:'retrospective_unverified',publishedAt:null,unit:'unverified',valueState:value===null?'null':valid?'recorded':'invalid'}];}));}
const identity=(row,date)=>object(row)&&row.date===date&&int(row.stadium_number,1,24)&&int(row.number,1,12);
const raceKey=row=>row.stadium_number+':'+row.number;
function indexPart(raw,kind,date){if(!Array.isArray(raw?.[kind])||raw[kind].length>288)throw Error('legacy_schema_invalid');const index=new Map();for(const row of raw[kind]){if(!identity(row,date)||index.has(raceKey(row)))throw Error('legacy_identity_invalid');index.set(raceKey(row),row);}return index;}
function boats(row,registration=false){return Array.isArray(row?.boats)&&row.boats.length===6&&row.boats.every(b=>object(b)&&int(b.racer_boat_number,1,6)&&(!registration||int(b.racer_number,1,99999)))&&new Set(row.boats.map(b=>b.racer_boat_number)).size===6&&(!registration||new Set(row.boats.map(b=>b.racer_number)).size===6);}

export function normalizeLegacyDay(bundle,manifest){
 const date=manifest?.date,report={schemaVersion:1,adapterVersion:LEGACY_NORMALIZER_VERSION,source:LEGACY_SOURCE,date,status:'invalid',races:[],rejectedNodes:[],counts:{identified:0,normalStructure:0,incomplete:0,refund:0,tie:0,cancelled:0,unresolved:0},issues:[],analysisReady:false,executionEvidencePassed:false,liveEligible:false,rawIntegrity:'caller_must_verify',sourceSchemaVersion:'v3',schemaUrl:'https://github.com/boatraceopenapi/programs',schemaHash:null};
 let manifestValid=false;try{manifestValid=validDate(date)&&manifest.source===LEGACY_SOURCE&&manifest.status==='collected'&&manifest.sha256===legacySnapshot(manifest.parts);}catch{}
 if(!manifestValid){report.issues.push('legacy_manifest_invalid');return report;}
 let indexed;try{indexed=Object.fromEntries(LEGACY_KINDS.map(k=>[k,indexPart(bundle[k],k,date)]));}catch(error){report.issues.push(error.message);return report;}
 report.status='normalized';
 for(const [key,program] of indexed.programs){
  const preview=indexed.previews.get(key),result=indexed.results.get(key),entriesValid=boats(program,true),previewValid=boats(preview),resultValid=boats(result,true),issues=[];
  const programPath='programs['+bundle.programs.programs.indexOf(program)+']',previewPath='previews['+bundle.previews.previews.indexOf(preview)+']';
  if(!entriesValid)issues.push('legacy_program_entries_invalid');if(!previewValid)issues.push('legacy_preview_missing_or_invalid');if(!resultValid)issues.push('legacy_result_missing_or_invalid');
  const byLane=new Map((Array.isArray(program.boats)?program.boats:[]).filter(object).map(b=>[b.racer_boat_number,b])),resultIdentity=resultValid&&entriesValid&&result.boats.every(b=>byLane.get(b.racer_boat_number)?.racer_number===b.racer_number),previewIdentity=previewValid&&entriesValid&&preview.boats.every(b=>b.racer_number===undefined||byLane.get(b.racer_boat_number)?.racer_number===b.racer_number);
  if(!resultIdentity)issues.push('legacy_result_registration_mismatch');
  if(!previewIdentity)issues.push('legacy_preview_registration_mismatch_or_missing');
  const placings=resultValid?result.boats.map(b=>({lane:b.racer_boat_number,registration:b.racer_number,placeNumber:b.racer_place_number??null})):[],normalPlaces=resultIdentity&&placings.every(p=>int(p.placeNumber,1,6))&&new Set(placings.map(p=>p.placeNumber)).size===6;
  const payouts=result?.payouts?.trifecta,winning=normalPlaces?[1,2,3].map(place=>placings.find(p=>p.placeNumber===place).lane).join('-'):null,payoutValid=Array.isArray(payouts)&&payouts.length===1&&payouts[0]?.combination===winning&&int(payouts[0]?.amount,1,Number.MAX_SAFE_INTEGER);
  const normalStructure=Boolean(entriesValid&&previewIdentity&&normalPlaces&&payoutValid);if(!normalPlaces)issues.push('legacy_non_normal_or_unknown_place');if(!payoutValid)issues.push('legacy_payout_mismatch_or_unavailable');
  const previewByLane=new Map((Array.isArray(preview?.boats)?preview.boats:[]).filter(object).map(b=>[b.racer_boat_number,b]));
  const entries=entriesValid?[...program.boats].sort((a,b)=>a.racer_boat_number-b.racer_boat_number).map(b=>({lane:b.racer_boat_number,registration:b.racer_number,fields:fields(b,maps.program,programPath+'.boats['+program.boats.indexOf(b)+']'),preview:previewValid?fields(previewByLane.get(b.racer_boat_number),maps.preview,previewPath+'.boats['+preview.boats.indexOf(previewByLane.get(b.racer_boat_number))+']'):{}})):[];
  const state=normalStructure?'normal':'unresolved',node={raceKey:LEGACY_SOURCE+':'+date+':'+key,date,venue:program.stadium_number,raceNumber:program.number,deadline:null,deadlineRaw:typeof program.closed_at==='string'?program.closed_at:null,settlementAt:null,entries,context:fields(program,maps.context,programPath),preview:previewValid?fields(preview,maps.weather,previewPath):{},odds:{},oddsPhase:'unavailable',oddsObservedAt:null,oddsAudit:{expected:120,observed:0,unavailable:120,invalid:0,complete:false},
   result:{state,winnerTriple:normalStructure?winning:null,payoutAmountYen:normalStructure?payouts[0].amount:null,payoutPer100Yen:null,payoutBasis:'unverified',refundLanes:null,incident:placings.some(p=>int(p.placeNumber,7,16)),lowerPlaceTie:false,placings,payouts:[],time:'result_only',settlementAt:null,issues},
   quality:{normalStructure,issues:[...issues,'legacy_market_reference_unavailable'],winnerOdds:null,payoutAmountYen:normalStructure?payouts[0].amount:null,oddsPayoutEquality:'not_assessed_unavailable_market',normalStructurePolicy:'legacy_three_archive_label_only_v1'},
   provenance:{source:LEGACY_SOURCE,rawSha256:manifest.sha256,partSha256:Object.fromEntries(LEGACY_KINDS.map(k=>[k,manifest.parts[k].sha256])),adapterVersion:LEGACY_NORMALIZER_VERSION,evidenceTime:'retrospective_unverified',rawIntegrity:'caller_must_verify'}};
  report.races.push(node);report.counts.identified++;report.counts[normalStructure?'normalStructure':'incomplete']++;if(!normalStructure)report.counts.unresolved++;
 }
 for(const kind of ['results','previews'])for(const key of indexed[kind].keys())if(!indexed.programs.has(key))report.rejectedNodes.push({path:kind+'.'+key,reason:'legacy_orphan_identity'});
 return report;
}
export function inspectLegacyDay(bundle,date,parts){
 const normalized=normalizeLegacyDay(bundle,{date,source:LEGACY_SOURCE,status:'collected',parts,sha256:legacySnapshot(parts)}),races=normalized.races;
 return {schemaKnown:normalized.status==='normalized',races:races.length,completeEntryRaces:races.filter(r=>r.entries.length===6).length,completeTrifectaRaces:0,resultShapeRaces:races.filter(r=>r.result.state==='normal').length,refundShapeRaces:0,trifectaPayoutShapeRaces:races.filter(r=>r.result.payoutAmountYen!==null).length,invalidIdentityNodes:normalized.rejectedNodes.length,fields:[],fieldsTruncated:false,fieldPathLimit:384,omittedFieldObservations:0,normalizerVersion:LEGACY_NORMALIZER_VERSION};
}

export async function collectLegacyDay({date,old,retryUnsuccessful=false,readRaw,writeRaw,saveManifest,request,now=Date.now}){
 if(!validDate(date))throw Error('invalid_legacy_identity');
 if(old&&(old.source!==LEGACY_SOURCE||old.date!==date||!['collected','unsupported','missing','failed'].includes(old.status)))throw Error('invalid_boat_manifest');
 const parts={...(old?.parts??{})},bundle={};if(Object.keys(parts).some(k=>!LEGACY_KINDS.includes(k)))throw Error('invalid_boat_manifest');
 for(const kind of LEGACY_KINDS){const compressed=await readRaw(kind),meta=parts[kind];if(meta){if(!compressed||meta.url!==legacyUrl(kind,date)||!HASH.test(meta.sha256??'')||!int(meta.bytes,1,LIMIT))throw Error('boat_original_integrity');const bytes=gunzipSync(compressed,{maxOutputLength:LIMIT});if(bytes.length!==meta.bytes||sha(bytes)!==meta.sha256)throw Error('boat_original_integrity');bundle[kind]=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}else if(compressed)throw Error('boat_original_orphan');}
 if(old&&['collected','unsupported'].includes(old.status)){if(LEGACY_KINDS.some(k=>!parts[k]))throw Error('boat_original_integrity');if(old.sha256!==legacySnapshot(parts)||old.bytes!==Object.values(parts).reduce((n,p)=>n+p.bytes,0))throw Error('boat_original_integrity');return {...old,audit:inspectLegacyDay(bundle,date,parts)};}
 if(old&&!retryUnsuccessful)return old;
 let manifest={schemaVersion:1,source:LEGACY_SOURCE,date,retrievedAt:new Date(now()).toISOString(),status:'failed',httpStatus:null,bytes:0,sha256:null,parts,audit:null,error:null};
 for(const kind of LEGACY_KINDS){if(parts[kind])continue;let response;
  try{response=await request(legacyUrl(kind,date));manifest.httpStatus=response.status;if(response.status!==200){manifest.status=response.status===404?'missing':'failed';manifest.error=response.status===404?'http_missing':[403,429].includes(response.status)?'access_blocked':'http_unavailable';break;}
   const bytes=response.bytes;if(!Buffer.isBuffer(bytes)||bytes.length>LIMIT)throw Error('boat_body_limit');const parsed=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));indexPart(parsed,kind,date);
   await writeRaw(kind,bytes);parts[kind]={url:legacyUrl(kind,date),bytes:bytes.length,sha256:sha(bytes),retrievedAt:response.retrievedAt??new Date(now()).toISOString()};bundle[kind]=parsed;manifest.parts=parts;await saveManifest(manifest);
  }catch(error){manifest.error=/^[a-z_]+$/.test(error?.message??'')?error.message:'legacy_request_failed';manifest.status='failed';break;}
 }
 manifest.bytes=Object.values(parts).reduce((sum,p)=>sum+p.bytes,0);
 if(LEGACY_KINDS.every(k=>parts[k])){manifest.sha256=legacySnapshot(parts);manifest.audit=inspectLegacyDay(bundle,date,parts);manifest.status=manifest.audit.schemaKnown?'collected':'unsupported';manifest.error=manifest.status==='collected'?null:'legacy_schema_invalid';}
 await saveManifest(manifest);return manifest;
}
