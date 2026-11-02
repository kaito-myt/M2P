import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const V2_PRODUCER_CLOUD_CLOSURE_MANIFEST_SHA='ed30b1d7365bdcfe70d9c8e55e1e2943302299059bd643678773f3adaee9f53d';
const fail=reason=>{throw Error(`v2_producer_cloud_runtime_closure:${reason}`);};
const H=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestURL=new URL('./v2-producer-cloud-runtime-closure.json',import.meta.url);

/** Exact transitive runtime module inventory; caller supplies only the fixed repository root. */
export async function verifyV2ProducerCloudRuntimeClosure(repositoryRoot=fileURLToPath(new URL('../../',import.meta.url))){
  if(repositoryRoot!==fileURLToPath(new URL('../../',import.meta.url)))fail('repository_root');
  const manifestBytes=await readFile(manifestURL);if(H(manifestBytes)!==V2_PRODUCER_CLOUD_CLOSURE_MANIFEST_SHA)fail('manifest_sha');
  let manifest;try{manifest=JSON.parse(manifestBytes);}catch{fail('manifest_json');}
  if(manifest.version!=='v2_producer_cloud_runtime_closure_v1'||!Array.isArray(manifest.files)||manifest.files.length<30||manifest.files.length>128)fail('manifest_schema');
  let previous='';for(const ref of manifest.files){
    if(!ref||typeof ref.name!=='string'||ref.name<=previous||!/^((scripts\/boatrace-history|artifacts\/kelly-doc53-cloud-e2e)\/[a-z0-9.-]+\.(mjs|cjs))$/.test(ref.name)||
      !Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>2*1024**2||!/^[a-f0-9]{64}$/.test(ref.sha256))fail(`manifest_entry:${ref?.name??'invalid'}`);previous=ref.name;
    let bytes;try{bytes=await readFile(path.join(repositoryRoot,...ref.name.split('/')));}catch{fail(`missing_file:${ref.name}`);}
    if(bytes.length!==ref.bytes)fail(`byte_length:${ref.name}`);if(H(bytes)!==ref.sha256)fail(`file_sha:${ref.name}`);
  }
  return {status:'RUNTIME_CLOSURE_VERIFIED',moduleCount:manifest.files.length,manifestSHA:V2_PRODUCER_CLOUD_CLOSURE_MANIFEST_SHA};
}
