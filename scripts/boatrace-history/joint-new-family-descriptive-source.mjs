import {createHash} from 'node:crypto';
import {NORMALIZER_VERSION} from './normalize.mjs';

export const NEW_FAMILY_ACTUAL_SOURCE = Object.freeze({
  manifestSHA:'948f3c7483e790582a1eb64eeb08547a158fdfa3ab2c871a6689a01fbafc3f63',
  receiptSHA:'98c2bed45905bb0ebb256bd80643e4ca56cb3520f443ae4f2ad752ee6563e459',
  metadataSHA:'7f42900cdd6ff802ad57e1be6d4b3e3e60c1b9672cd1d0f038eccb1880470512',
  datasetDigest:'7bea339b237a6dd7eccd27306f3dc5b4ce0f1f866aecd87c9035bc3dbd7318bd',
  sourceSnapshotDigest:'2dc19a9f3609eb11599b67503ce0e69c7201a1e8b997d9cd91e2838e9ebfd814',
  modelArtifactSHA:'5c0b174d5ae4a801fa7ce1f1f475883c191bca4428eee7797e6cae35fe13cfa5',
  modelDigest:'b39772a0a52d766dc6f289cdafd460ba7f52d6d8df2d6a57f0bf69ba01968825',
  parentRunId:'c0ff23aa-6d74-4cfa-a95d-b8ef809bd3aa',
  originalPrefitManifestSHA:'139698240678c3d8646c132c07dc57fa803c99abd7f331956ed09377249593c5',
  originalPrefitSourceDigest:'c36e2c946881e0f73a29985799887ea7dd460f7cf9189164b38450f4ba9db770'
});
const H=b=>createHash('sha256').update(b).digest('hex'),sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),fail=s=>{throw Error('new_family_source_'+s);};
const parse=b=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b));
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function newFamilyActualDates(){return Array.from({length:242},(_,i)=>new Date(Date.UTC(2026,1,1+i)).toISOString().slice(0,10)).filter(d=>!d.startsWith('2026-03'));}

/** Header acceptance only. The caller must still verify physical bytes/model bodies and source stability. */
export function acceptNewFamilySourceHeaders({manifestBytes,receiptBytes,metadataBytes,scope,expected}){
  if(!['ACTUAL_ARCHIVE','SYNTHETIC_FIXTURE'].includes(scope)||!expected||Object.keys(expected).sort().join('|')!==Object.keys(NEW_FAMILY_ACTUAL_SOURCE).sort().join('|')||Object.entries(expected).some(([k,v])=>k==='parentRunId'?!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v):!sha(v)))fail('expected');
  if(scope==='ACTUAL_ARCHIVE'&&JSON.stringify(Object.fromEntries(Object.keys(expected).sort().map(k=>[k,expected[k]])))!==JSON.stringify(Object.fromEntries(Object.keys(NEW_FAMILY_ACTUAL_SOURCE).sort().map(k=>[k,NEW_FAMILY_ACTUAL_SOURCE[k]]))))fail('actual_pins');
  for(const[b,pin,cap]of [[manifestBytes,expected.manifestSHA,131072],[receiptBytes,expected.receiptSHA,131072],[metadataBytes,expected.metadataSHA,131072]])if(!Buffer.isBuffer(b)||b.length<1||b.length>cap||H(b)!==pin)fail('header_pin');
  const manifest=parse(manifestBytes),receipt=parse(receiptBytes),metadata=parse(metadataBytes);
  if(manifest.version!=='inbox_raw_source_packets_v1'||manifest.scope!==scope||manifest.datasetDigest!==expected.datasetDigest||manifest.sourceSnapshotDigest!==expected.sourceSnapshotDigest||manifest.originalPrefitManifestSHA!==expected.originalPrefitManifestSHA||manifest.originalPrefitSourceDigest!==expected.originalPrefitSourceDigest||manifest.normalizerVersion!==NORMALIZER_VERSION||manifest.sourceOnly!==true||manifest.moneyUnitsVerified!==false||!Array.isArray(manifest.days)||manifest.days.length<1||manifest.days.length>211)fail('manifest');
  const days=manifest.days,dates=days.map(d=>d.date);
  if(days.some((d,i)=>!dateOK(d.date)||i>0&&d.date<=days[i-1].date||!sha(d.rawSHA)||!sha(d.manifestSHA)||!Number.isSafeInteger(d.rawBytes)||d.rawBytes<1||d.rawBytes>33554432||d.rawName!=='day-'+d.date+'-raw.json'||d.manifestName!=='day-'+d.date+'-manifest.json'))fail('day_inventory');
  if(scope==='ACTUAL_ARCHIVE'&&JSON.stringify(dates)!==JSON.stringify(newFamilyActualDates()))fail('actual_dates');
  if(receipt.version!=='inbox_raw_packet_source_receipt_v1'||receipt.scope!==scope||receipt.status!=='source_packet_prepared'||receipt.manifestSHA!==expected.manifestSHA||receipt.datasetDigest!==expected.datasetDigest||receipt.sourceSnapshotDigest!==expected.sourceSnapshotDigest||receipt.originalPrefitManifestSHA!==expected.originalPrefitManifestSHA||receipt.originalPrefitSourceDigest!==expected.originalPrefitSourceDigest||receipt.normalizerVersion!==NORMALIZER_VERSION||receipt.dayCount!==days.length||receipt.moneyUnitsVerified!==false||receipt.sourceApprovalForFit!==false||receipt.actualFit!==0||receipt.financialActions!==0||receipt.operationalQualified!==false||!Number.isSafeInteger(receipt.rawRows)||!Number.isSafeInteger(receipt.authenticatedDecisions)||!Number.isSafeInteger(receipt.unknownClocks)||receipt.rawRows<0||receipt.authenticatedDecisions<0||receipt.unknownClocks<0||receipt.authenticatedDecisions+receipt.unknownClocks!==receipt.rawRows)fail('receipt');
  if(scope==='ACTUAL_ARCHIVE'&&(receipt.rawRows!==32748||receipt.authenticatedDecisions!==32688||receipt.unknownClocks!==60))fail('actual_counts');
  if(metadata.runId!==expected.parentRunId||metadata.datasetDigest!==expected.datasetDigest||metadata.sourceSnapshotSha256!==expected.sourceSnapshotDigest||metadata.modelArtifactSha256!==expected.modelArtifactSHA||!sha(metadata.inputDigest)||!Array.isArray(metadata.files)||metadata.files.length!==3||metadata.files.map(f=>f.name).sort().join('|')!=='input.json|model.json|report.json'||metadata.files.some(f=>!sha(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>131072)||metadata.files.find(f=>f.name==='model.json').sha256!==expected.modelArtifactSHA)fail('model_metadata');
  return{scope,manifest,receipt,metadata,dates,dayPins:days.map(d=>({date:d.date,sourceSHA:d.rawSHA})),modelDigest:expected.modelDigest,
    headerPins:{manifestSHA:expected.manifestSHA,receiptSHA:expected.receiptSHA,metadataSHA:expected.metadataSHA},
    physicalSourceStabilityVerified:false,actualModelBodyVerified:false,actualFit:0,financialActions:0,operationalQualified:false};
}
