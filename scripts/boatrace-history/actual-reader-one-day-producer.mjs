import {createHash} from 'node:crypto';
import {authenticatePrefitManifest} from './joint-kelly-prefit-pending-admission.mjs';
import {scorePendingPredictionDay} from './joint-kelly-pending-prediction-score.mjs';
import {A0_COHORT_VERSION} from './joint-kelly-a0-cohort.mjs';
import {kellyPredictionDigest} from './joint-kelly-prediction-port.mjs';

export const ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS=Object.freeze({
  publicSHA:'1fc024710c1af48cd93cc8ca2e3c5e6b2edd39b3049623030362c25392181e83',
  manifestSHA:'139698240678c3d8646c132c07dc57fa803c99abd7f331956ed09377249593c5',
  metadataSHA:'7f42900cdd6ff802ad57e1be6d4b3e3e60c1b9672cd1d0f038eccb1880470512'
});

const SHA=/^[a-f0-9]{64}$/;
const fail=code=>{throw Error(`actual_reader_one_day_producer_${code}`);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const checkAbort=signal=>{if(signal?.aborted)fail('stopped');};
const dates=()=>{const result=[];for(let t=Date.UTC(2026,1,1);t<Date.UTC(2026,9,1);t+=86400000){const d=new Date(t).toISOString().slice(0,10);if(!d.startsWith('2026-03'))result.push(d);}return result;};
const parse=(bytes,cap,name)=>{if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>cap)fail(`${name}_bytes`);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(`${name}_json`);}};
function decodeChunk(bytes){
  let chunk;try{chunk=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes),(_key,value)=>{if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'numberState')){if(!exact(value,['numberState'])||value.numberState!=='NaN')fail('number_encoding');return NaN;}return value;});}catch(error){if(String(error?.message).startsWith('actual_reader_one_day_producer_'))throw error;fail('chunk_json');}
  if(!exact(chunk,['version','nonfiniteEncoding','records'])||chunk.version!=='prefit_record_chunk_v1'||chunk.nonfiniteEncoding!=='explicit_nan_object'||!Array.isArray(chunk.records)||chunk.records.length>1000)fail('chunk_shape');return chunk.records;
}
function addRecord(records,item){if(item?.kind==='decision')records.decisions.push(item.value);else if(item?.kind==='target')records.targets.push(item.value);else fail('record_kind');if(records.decisions.length>288||records.targets.length>288)fail('day_row_bound');}
function validOutputRef(ref){return ref&&exact(ref,['name','sha256','bytes'])&&typeof ref.name==='string'&&/^day-2026-(?:02|04|05|06|07|08|09)-\d{2}-\d{3}\.json$/.test(ref.name)&&SHA.test(ref.sha256)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=2*1024**2;}

async function produce({publicBytes,manifestBytes,metadataBytes,sourcePins,sourceMode,readBytes,verifyStable,model,schema,metadata,report,conditionReceipt,signal,decode=decodeChunk}){
  if(!exact(sourcePins,['publicSHA','manifestSHA','metadataSHA'])||!Object.values(sourcePins).every(x=>typeof x==='string'&&SHA.test(x))||!['PINNED_SOURCE_BYTES','SYNTHETIC_FIXTURE'].includes(sourceMode)||typeof readBytes!=='function'||typeof verifyStable!=='function'||typeof decode!=='function'||!model||!schema||!metadata||!report||!conditionReceipt)fail('contract');
  if(!Buffer.isBuffer(publicBytes)||publicBytes.length<1||publicBytes.length>256*1024||!Buffer.isBuffer(manifestBytes)||manifestBytes.length<1||manifestBytes.length>1024*1024||!Buffer.isBuffer(metadataBytes)||metadataBytes.length<1||metadataBytes.length>256*1024)fail('source_size');
  if(hash(publicBytes)!==sourcePins.publicSHA||hash(manifestBytes)!==sourcePins.manifestSHA||hash(metadataBytes)!==sourcePins.metadataSHA)fail('source_pin');
  const metadataValue=parse(metadataBytes,256*1024,'source_metadata');
  const authenticated=authenticatePrefitManifest({publicBytes,manifestBytes,expected:{publicSHA:sourcePins.publicSHA,manifestSHA:sourcePins.manifestSHA}}),sourceReport=authenticated.report,sourceManifest=authenticated.manifest;
  if(!sourceReport.prefit||sourceReport.prefit.version!==A0_COHORT_VERSION||sourceReport.prefit.days!==211||!Number.isSafeInteger(sourceReport.prefit.inputRows)||!Number.isSafeInteger(sourceReport.prefit.a0True)||!SHA.test(sourceReport.prefit.decisionDigest)||!SHA.test(sourceReport.sourceDigest)||sourceReport.privateManifestSHA!==sourcePins.manifestSHA||sourceManifest.sourceDigest!==sourceReport.sourceDigest||metadataValue.datasetDigest!==metadata.datasetDigest||metadataValue.modelArtifactSha256!==metadata.modelArtifactSha256||schema.sourceDigest!==metadata.datasetDigest||report.sourceDigest!==sourceReport.sourceDigest||!SHA.test(metadata.datasetDigest)||!SHA.test(metadata.modelArtifactSha256)||!SHA.test(schema.schemaDigest))fail('source_identity');
  const expectedDates=dates();if(expectedDates.length!==211)fail('date_policy');
  const byDay=new Map(expectedDates.map(d=>[d,[]]));let sourceBytesCap=0;
  for(const ref of sourceManifest.outputs){
    if(!validOutputRef(ref))continue;
    const day=ref.name.slice(4,14);if(!byDay.has(day))fail('unexpected_source_day');const list=byDay.get(day);if(list.length>=16||list.some(x=>x.name===ref.name))fail('duplicate_or_excess_chunk');list.push(ref);sourceBytesCap+=ref.bytes;
  }
  if(sourceBytesCap>512*1024**2||[...byDay.values()].some(list=>list.length===0))fail('source_day_inventory');
  for(const list of byDay.values())list.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  checkAbort(signal);await verifyStable();checkAbort(signal);
  const inputSourcePins={publicSHA:sourcePins.publicSHA,manifestSHA:sourcePins.manifestSHA,metadataSHA:sourcePins.metadataSHA},conditionReceiptDigest=kellyPredictionDigest(conditionReceipt),days=[],dayReceipts=new Map();
  let previousChain=kellyPredictionDigest({version:A0_COHORT_VERSION,decisions:[]}),totalRows=0,totalA0=0,privateBytes=0;
  for(const date of expectedDates){
    checkAbort(signal);const chunks=byDay.get(date),records={decisions:[],targets:[]},dayPreviousChain=previousChain;let dayBytes=0;
    for(const ref of chunks){
      checkAbort(signal);const bytes=await readBytes(ref.name,{maxBytes:ref.bytes});checkAbort(signal);
      if(!Buffer.isBuffer(bytes)||bytes.length!==ref.bytes||hash(bytes)!==ref.sha256)fail('chunk_pin');
      dayBytes+=bytes.length;privateBytes+=bytes.length;if(dayBytes>32*1024**2||privateBytes>512*1024**2)fail('source_bytes_bound');
      const decoded=decode(bytes);checkAbort(signal);if(!Array.isArray(decoded)||decoded.length>1000)fail('decoded_chunk');for(const item of decoded)addRecord(records,item);
    }
    if(records.decisions.length!==records.targets.length||new Set(records.decisions.map(r=>r?.raceKey)).size!==records.decisions.length||new Set(records.targets.map(r=>r?.raceKey)).size!==records.targets.length)fail('day_shape');
    const scored=scorePendingPredictionDay({date,records,model,schema,metadata,report,conditionReceipt,previousChain:dayPreviousChain});checkAbort(signal);
    totalRows+=scored.sourceReadyRows;totalA0+=scored.selector.a0Rows;previousChain=scored.decisionChain;
    const receipt={version:'actual_one_day_reference_receipt_v2',date,sourceDigest:metadata.datasetDigest,modelArtifactSHA:metadata.modelArtifactSha256,featureSchemaDigest:schema.schemaDigest,conditionReceiptDigest,decisionChain:scored.decisionChain,previousChain:dayPreviousChain,sourceReadyRows:scored.sourceReadyRows,a0Rows:scored.selector.a0Rows,chunks:chunks.map(({name,bytes,sha256})=>({name,bytes,sha256}))};
    const receiptBytes=Buffer.from(JSON.stringify(receipt));if(receiptBytes.length>64*1024)fail('day_receipt_bytes');
    const ref={date,receiptName:`day-${date}-receipt.json`,receiptSHA:hash(receiptBytes),receiptBytes:receiptBytes.length,modelArtifactSHA:receipt.modelArtifactSHA,featureSchemaDigest:receipt.featureSchemaDigest,conditionReceiptDigest:receipt.conditionReceiptDigest,decisionChain:receipt.decisionChain,previousChain:receipt.previousChain,sourceReadyRows:receipt.sourceReadyRows,a0Rows:receipt.a0Rows,chunks:receipt.chunks};
    days.push(ref);dayReceipts.set(ref.receiptName,receiptBytes);
  }
  if(previousChain!==sourceReport.prefit.decisionDigest||totalRows!==sourceReport.prefit.inputRows||totalRows!==sourceReport.prefit.sourceReady||totalA0!==sourceReport.prefit.a0True)fail('source_report_total');
  checkAbort(signal);await verifyStable();checkAbort(signal);
  const manifest={version:'actual_one_day_prefit_manifest_v2',datasetDigest:metadata.datasetDigest,inputSourcePins,sourceMode,days},outputManifestBytes=Buffer.from(JSON.stringify(manifest));if(outputManifestBytes.length>1024*1024)fail('output_manifest_bytes');const manifestSHA=hash(outputManifestBytes);
  const publicReport={version:'actual_one_day_public_report_v2',privateManifestSHA:manifestSHA,datasetDigest:metadata.datasetDigest,inputSourcePins,sourceMode,status:'producer_complete'},publicReportBytes=Buffer.from(JSON.stringify(publicReport));if(publicReportBytes.length>256*1024)fail('output_report_bytes');const publicSHA=hash(publicReportBytes);
  const producerReceipt={version:'actual_one_day_producer_receipt_v2',status:'producer_complete',reportSHA:publicSHA,manifestSHA,datasetDigest:metadata.datasetDigest,inputSourcePins,sourceMode,dayCount:days.length,daysDigest:hash(Buffer.from(JSON.stringify(days))),rootExecutionEvidence:'NOT_PROVIDED'},producerReceiptBytes=Buffer.from(JSON.stringify(producerReceipt));if(producerReceiptBytes.length>256*1024)fail('output_producer_receipt_bytes');
  const candidateExternalPins={reportSHA:publicSHA,manifestSHA,producerReceiptSHA:hash(producerReceiptBytes)};
  return Object.freeze({status:'PRODUCED_PENDING_INDEPENDENT_PIN_REVIEW',sourceMode,inputSourcePins,sourceEvidence:'PINNED_INPUT_BYTES_ONLY',privateRootRead:false,rootExecutionEvidence:'NOT_PROVIDED',actualSuccessPathVerified:false,financialActions:0,queueEligible:false,actualPurchase:false,autoAdmitted:false,independentApprovalRequired:true,sourceRows:totalRows,a0Rows:totalA0,days:211,privateBytesVerified:privateBytes,artifacts:Object.freeze({reportBytes:publicReportBytes,manifestBytes:outputManifestBytes,producerReceiptBytes,dayReceipts}),candidateExternalPins});
}

/** Uses the repository's fixed historical PREFIT byte pins; caller supplies bytes, never filesystem paths. */
export function producePinnedActualOneDayArtifacts(input){return produce({...input,sourcePins:ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS,sourceMode:'PINNED_SOURCE_BYTES'});}

/** Explicitly synthetic-only entrypoint used by deterministic contract tests. */
export function produceSyntheticOneDayArtifacts(input){return produce({...input,sourceMode:'SYNTHETIC_FIXTURE'});}
