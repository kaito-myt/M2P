import {createHash} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';

const REPO=fileURLToPath(new URL('../../',import.meta.url));
export const V2_PRODUCER_CLOUD_BOOTSTRAP_PINS=Object.freeze({
  controllerSHA:'e7cb6dcd967364de54c1611e2522c41a6ddd9bb27f5f51c2213451b28a8b2dd7',closureModuleSHA:'9d90598fa2a1a6fe70fd03525360117a0167b03efedbf45968528b2a49983caf',closureManifestSHA:'cab66ee387ea915e43020476e274d5dc34f372e4cb9084dfe28c3f3fc700e361'
});
const H=b=>createHash('sha256').update(b).digest('hex');
async function verifyBootstrap(){
  const controller=await readFile(new URL('./v2-producer-cloud-controller.mjs',import.meta.url)),closure=await readFile(new URL('./v2-producer-cloud-closure.mjs',import.meta.url)),manifest=await readFile(new URL('./v2-producer-cloud-runtime-closure.json',import.meta.url));
  if(H(controller)!==V2_PRODUCER_CLOUD_BOOTSTRAP_PINS.controllerSHA||H(closure)!==V2_PRODUCER_CLOUD_BOOTSTRAP_PINS.closureModuleSHA||H(manifest)!==V2_PRODUCER_CLOUD_BOOTSTRAP_PINS.closureManifestSHA)throw Error('v2_producer_cloud_bootstrap_pin');
}

/** Explicit, single-run entry. Importing this module never starts cloud work. */
export async function main(argv=process.argv.slice(2),ports){
  if(argv.length!==1||argv[0]!=='--execute-one-fixed-candidate')return {status:'NOT_STARTED_NEEDS_EXPLICIT_APPROVAL',sourceReadStarted:false,financialActions:0};
  await verifyBootstrap();const {runV2ProducerCloudController}=await import('./v2-producer-cloud-controller.mjs');return runV2ProducerCloudController({approved:true,runId:ports?.runId??randomUUID()},ports);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{
    process.stderr.write(JSON.stringify({status:'CONTROLLER_FAILED',reason:/^[a-z0-9_]{1,100}$/.test(error.message)?error.message:'controller_failure',sourceReadStarted:false,financialActions:0})+'\n');process.exitCode=1;
  });
}
