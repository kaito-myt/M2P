import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyV2ProducerSourcePinArchive} from './v2-producer-cloud-source-pin-archive.mjs';

const H=bytes=>createHash('sha256').update(bytes).digest('hex');
const lf=bytes=>Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/\r\n/g,'\n'));
function fixture(){
  const codeName='scripts/boatrace-history/example.mjs',jsonName='docs/data/reference.json';
  const rawCode=Buffer.from('export const x = 1;\r\nexport const y = 2;\r\n'),runtimeCode=lf(rawCode),json=Buffer.from('{"ok":true}\n');
  const config={sourcePins:[{name:codeName,bytes:rawCode.length,sha256:H(rawCode)},{name:jsonName,bytes:json.length,sha256:H(json)}]},configBytes=Buffer.from(JSON.stringify(config));
  const raw=new Map([[codeName,rawCode],[jsonName,json]]),runtime=new Map([[codeName,runtimeCode],[jsonName,json]]);
  const manifest={version:'v2_producer_source_pin_archive_v1',configSHA:H(configBytes),rows:[
    {name:codeName,configBytes:rawCode.length,configSHA:H(rawCode),rawBytes:rawCode.length,rawSHA:H(rawCode),runtimeBytes:runtimeCode.length,runtimeSHA:H(runtimeCode),normalization:'CRLF_TO_LF_UTF8',override:null},
    {name:jsonName,configBytes:json.length,configSHA:H(json),rawBytes:json.length,rawSHA:H(json),runtimeBytes:json.length,runtimeSHA:H(json),normalization:'EXACT_BYTES',override:null},
  ]};
  const manifestBytes=Buffer.from(JSON.stringify(manifest));
  const args={manifestBytes,manifest,expectedManifestSHA:H(manifestBytes),configBytes,config,expectedConfigSHA:H(configBytes),updatedAdmissionSHA:'a'.repeat(64),
    readRaw:async name=>raw.get(name),readRuntime:async name=>runtime.get(name)};
  return {args,raw,runtime};
}

test('binds CRLF raw pins to LF runtime bytes and preserves exact JSON bytes',async()=>{
  const {args}=fixture();const result=await verifyV2ProducerSourcePinArchive(args);
  assert.equal(result.status,'SOURCE_PIN_ARCHIVE_VERIFIED');assert.equal(result.count,2);
  assert.equal(result.files[0].rawBytes-result.files[0].runtimeBytes,2);
  assert.equal(result.files[0].normalization,'CRLF_TO_LF_UTF8');assert.equal(result.files[1].normalization,'EXACT_BYTES');
});

test('rejects altered raw bytes, altered runtime bytes, and changed relation',async()=>{
  const rawCase=fixture();rawCase.raw.set(rawCase.args.config.sourcePins[0].name,Buffer.from('changed'));
  await assert.rejects(()=>verifyV2ProducerSourcePinArchive(rawCase.args),/raw_pin/);
  const runtimeCase=fixture();runtimeCase.runtime.set(runtimeCase.args.config.sourcePins[0].name,Buffer.from('changed'));
  await assert.rejects(()=>verifyV2ProducerSourcePinArchive(runtimeCase.args),/runtime_relation/);
  const relationCase=fixture();relationCase.args.manifest.rows[0].normalization='EXACT_BYTES';relationCase.args.manifestBytes=Buffer.from(JSON.stringify(relationCase.args.manifest));relationCase.args.expectedManifestSHA=H(relationCase.args.manifestBytes);
  await assert.rejects(()=>verifyV2ProducerSourcePinArchive(relationCase.args),/normalization/);
});

test('records the known pending-admission override explicitly',async()=>{
  const f=fixture(),pin=f.args.config.sourcePins[0],updated=Buffer.from('updated admission code\r\n');
  pin.name='scripts/boatrace-history/joint-kelly-prefit-pending-admission.mjs';pin.bytes=3;pin.sha256=H(Buffer.from('old'));
  f.args.configBytes=Buffer.from(JSON.stringify(f.args.config));f.args.expectedConfigSHA=H(f.args.configBytes);
  f.raw.set(pin.name,updated);f.runtime.set(pin.name,lf(updated));
  const row=f.args.manifest.rows[0];Object.assign(row,{name:pin.name,configBytes:pin.bytes,configSHA:pin.sha256,rawBytes:updated.length,rawSHA:H(updated),runtimeBytes:lf(updated).length,runtimeSHA:H(lf(updated)),normalization:'CRLF_TO_LF_UTF8',override:{kind:'updated_admission',effectiveSHA:H(updated)}});
  f.args.manifest.configSHA=f.args.expectedConfigSHA;f.args.manifestBytes=Buffer.from(JSON.stringify(f.args.manifest));f.args.expectedManifestSHA=H(f.args.manifestBytes);f.args.updatedAdmissionSHA=H(updated);
  assert.equal((await verifyV2ProducerSourcePinArchive(f.args)).status,'SOURCE_PIN_ARCHIVE_VERIFIED');
  f.args.manifest.rows[0].override=null;f.args.manifestBytes=Buffer.from(JSON.stringify(f.args.manifest));f.args.expectedManifestSHA=H(f.args.manifestBytes);
  await assert.rejects(()=>verifyV2ProducerSourcePinArchive(f.args),/admission_override/);
});
