import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const V2_PRODUCER_CLOUD_CLOSURE_MANIFEST_SHA='639af7ad53217ad323e61caf39145cd721d81450660249160df52ca261d343fd';
const fail=()=>{throw Error('v2_producer_cloud_runtime_closure');};
const H=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestURL=new URL('./v2-producer-cloud-runtime-closure.json',import.meta.url);

/** Exact transitive runtime module inventory; caller supplies only the fixed repository root. */
export async function verifyV2ProducerCloudRuntimeClosure(repositoryRoot=fileURLToPath(new URL('../../',import.meta.url))){
  if(repositoryRoot!==fileURLToPath(new URL('../../',import.meta.url)))fail();
  const manifestBytes=await readFile(manifestURL);if(H(manifestBytes)!==V2_PRODUCER_CLOUD_CLOSURE_MANIFEST_SHA)fail();
  let manifest;try{manifest=JSON.parse(manifestBytes);}catch{fail();}
  if(manifest.version!=='v2_producer_cloud_runtime_closure_v1'||!Array.isArray(manifest.files)||manifest.files.length<30||manifest.files.length>128)fail();
  let previous='';for(const ref of manifest.files){
    if(!ref||typeof ref.name!=='string'||ref.name<=previous||!/^((scripts\/boatrace-history|artifacts\/kelly-doc53-cloud-e2e)\/[a-z0-9.-]+\.(mjs|cjs))$/.test(ref.name)||
      !Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>2*1024**2||!/^[a-f0-9]{64}$/.test(ref.sha256))fail();previous=ref.name;
    const bytes=await readFile(path.join(repositoryRoot,...ref.name.split('/')));if(bytes.length!==ref.bytes||H(bytes)!==ref.sha256)fail();
  }
  return {status:'RUNTIME_CLOSURE_VERIFIED',moduleCount:manifest.files.length,manifestSHA:V2_PRODUCER_CLOUD_CLOSURE_MANIFEST_SHA};
}
