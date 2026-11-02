import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {stableRead,DIRECTORY} from '../../artifacts/kelly-doc53-cloud-e2e/e0-kelly-parent-dataset-reaudit.mjs';
import {ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS} from './actual-reader-one-day-producer.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const CONFIG='artifacts/kelly-doc53-cloud-e2e/e0-first-reference-loader-config-candidate-r2.json';
const PUBLIC='artifacts/kelly-doc53-cloud-e2e/e0-parent-actual-prefit-result.json';
const METADATA='artifacts/kelly-doc53-cloud-e2e/e0-parent-actual-admitted-metadata.json';
const PIN=Object.freeze({configSHA:'0ea31006131231a39b7d9a2402b22b334afa9039f6a9f3bc16371c3a39ffaf6d',
  publicSHA:ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS.publicSHA,metadataSHA:ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS.metadataSHA,
  manifestSHA:ACTUAL_ONE_DAY_PRODUCER_SOURCE_PINS.manifestSHA,
  updatedAdmissionSHA:'ab10dfbdee921fae2ef76c6f39ff54d0e2613c5c602d6c2428d01bfaf76b69ab'});
const H=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Error(`v2_producer_cloud_inputs_${code}`);};
const parse=b=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b));
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===[...keys].sort().join('|');
const checkRef=(bytes,ref)=>{if(!Buffer.isBuffer(bytes)||bytes.length!==ref.bytes||H(bytes)!==ref.sha256)fail('reference_pin');return bytes;};
const currentAdmission='scripts/boatrace-history/joint-kelly-prefit-pending-admission.mjs';

async function fixedRead(file,cap,stamps){
  const r=await stableRead(file,cap);stamps.set(file,r.stamp);return r.bytes;
}
export async function readAfterV2ProducerCheck(check,read){
  if(typeof check!=='function'||typeof read!=='function')fail('read_guard_contract');
  await check();const value=await read();await check();return value;
}

/** Reads only the fixed admitted parent/model bundle and returns the producer's documented arguments. */
export async function loadFixedV2ProducerInputs({signal,check=()=>{}}={}){
  if(DIRECTORY!=='/app/apps/kelly-edge/data/keirin-history/boatrace-history')fail('runtime_root');
  const stamps=new Map(),configBytes=await fs.readFile(path.join(repo,CONFIG)),publicBytes=await fs.readFile(path.join(repo,PUBLIC)),metadataBytes=await fs.readFile(path.join(repo,METADATA));
  if(H(configBytes)!==PIN.configSHA||H(publicBytes)!==PIN.publicSHA||H(metadataBytes)!==PIN.metadataSHA)fail('repository_pin');
  const config=parse(configBytes),metadata=parse(metadataBytes);if(config.version!=='first_reference_artifact_loader_v1'||config.actualGo!==false||config.allowFit!==false||
    config.moneyAdmission!==null||metadata.runId!=='c0ff23aa-6d74-4cfa-a95d-b8ef809bd3aa'||metadata.currentRawDatasetReaudited!==false||
    metadata.datasetDigest!=='7bea339b237a6dd7eccd27306f3dc5b4ce0f1f866aecd87c9035bc3dbd7318bd'||
    metadata.modelArtifactSha256!=='5c0b174d5ae4a801fa7ce1f1f475883c191bca4428eee7797e6cae35fe13cfa5')fail('metadata_identity');
  if(!Array.isArray(config.sourcePins)||config.sourcePins.length!==37||new Set(config.sourcePins.map(p=>p.name)).size!==config.sourcePins.length)fail('code_pin_set');
  for(const p of config.sourcePins){
    if(!exact(p,['name','bytes','sha256'])||!/^([a-z0-9./-]+\.mjs|docs\/data\/[a-z0-9.-]+\.json)$/.test(p.name))fail('code_pin_shape');
    const bytes=await readAfterV2ProducerCheck(check,()=>fixedRead(path.join(repo,p.name),2*1024**2,stamps)),expected=p.name===currentAdmission?PIN.updatedAdmissionSHA:p.sha256;
    if(bytes.length!==p.bytes&&p.name!==currentAdmission||H(bytes)!==expected)fail('code_pin');
  }
  const manifestBytes=await readAfterV2ProducerCheck(check,()=>fixedRead(path.join(DIRECTORY,'research/parent-prefit-v1/8dd59e8d-136f-4f04-97a5-227ff988c744/manifest.json'),2*1024**2,stamps));
  if(H(manifestBytes)!==PIN.manifestSHA)fail('manifest_pin');
  const pending=await import(pathToUrl(path.join(repo,'scripts/boatrace-history/joint-kelly-prefit-pending-admission.mjs')));
  const {manifest,report}=pending.authenticatePrefitManifest({publicBytes,manifestBytes,expected:{publicSHA:PIN.publicSHA,manifestSHA:PIN.manifestSHA}});
  const refs=new Map(manifest.outputs.map(r=>[r.name,r]));
  const readBytes=async(name,{maxBytes}={})=>{
    if(typeof name!=='string'||!/^day-2026-(?:02|04|05|06|07|08|09)-\d{2}-\d{3}\.json$/.test(name)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2*1024**2)fail('private_name');
    const ref=refs.get(name);if(!ref||ref.bytes>maxBytes)fail('private_reference');
    return checkRef(await readAfterV2ProducerCheck(check,()=>fixedRead(path.join(DIRECTORY,'research/parent-prefit-v1/8dd59e8d-136f-4f04-97a5-227ff988c744',name),maxBytes,stamps)),ref);
  };
  const readRef=async name=>{const ref=refs.get(name);if(!ref)fail('private_reference');return checkRef(await readAfterV2ProducerCheck(check,()=>fixedRead(path.join(DIRECTORY,'research/parent-prefit-v1/8dd59e8d-136f-4f04-97a5-227ff988c744',name),2*1024**2,stamps)),ref);};
  for(const name of ['source-admission.json','units-contract.json','sample-plan.json','money-audit.json'])await readRef(name);
  const source=parse(await readRef('source-admission.json'));
  if(!source.readerAdmission||!source.modelReceipt||!source.conditionReceipt||source.readerAdmission.datasetDigest!==metadata.datasetDigest||
    source.modelReceipt.modelArtifactSHA!==metadata.modelArtifactSha256)fail('source_admission');
  const patternAPI=await import(pathToUrl(path.join(repo,'scripts/boatrace-history/joint-patterns-runtime.mjs')));
  const artifact=await patternAPI.acceptJointArtifact({directory:DIRECTORY,runId:metadata.runId,
    expected:{inputDigest:metadata.inputDigest,modelArtifactSha256:metadata.modelArtifactSha256}}),model=artifact.models.full;
  if(artifact.report.selectedVariant!==null||model.modelDigest!==source.modelReceipt.modelDigest)fail('model_artifact');
  for(const ref of metadata.files){const file=path.join(DIRECTORY,'research/joint',metadata.runId,ref.name),bytes=await readAfterV2ProducerCheck(check,()=>fixedRead(file,131072,stamps));checkRef(bytes,ref);}
  async function verifyStable(){
    for(const [file,stamp]of stamps){const r=await stableRead(file,2*1024**2);if(r.stamp!==stamp)fail('source_changed');}
    if(H(await fs.readFile(path.join(repo,CONFIG)))!==PIN.configSHA||H(await fs.readFile(path.join(repo,PUBLIC)))!==PIN.publicSHA||H(await fs.readFile(path.join(repo,METADATA)))!==PIN.metadataSHA)fail('repo_source_changed');
  }
  await verifyStable();
  return {publicBytes,manifestBytes,metadataBytes,readBytes,verifyStable,model,schema:source.readerAdmission.policyFeatureSchema,
    metadata,report,conditionReceipt:source.conditionReceipt,signal};
}

function pathToUrl(file){return new URL('file://'+file.replaceAll('\\','/').replace(/^([A-Za-z]:)/,'/$1'));}
