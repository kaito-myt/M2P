import {createHash} from 'node:crypto';

const H=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(`v2_producer_source_pin_archive_${code}`);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const decode=bytes=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('utf8');}};
const normalize=(name,bytes)=>name.endsWith('.mjs')?Buffer.from(decode(bytes).replace(/\r\n/g,'\n'),'utf8'):Buffer.from(bytes);

/** Bind fixed raw source pins to the byte-exact LF runtime files without conflating either identity. */
export async function verifyV2ProducerSourcePinArchive({manifestBytes,manifest,expectedManifestSHA,configBytes,config,expectedConfigSHA,
  updatedAdmissionSHA,readRaw,readRuntime}={}){
  if(!Buffer.isBuffer(manifestBytes)||H(manifestBytes)!==expectedManifestSHA||!Buffer.isBuffer(configBytes)||H(configBytes)!==expectedConfigSHA||
    typeof readRaw!=='function'||typeof readRuntime!=='function'||!/^[a-f0-9]{64}$/.test(updatedAdmissionSHA??''))fail('binding');
  if(!exact(manifest,['version','configSHA','rows'])||manifest.version!=='v2_producer_source_pin_archive_v1'||manifest.configSHA!==expectedConfigSHA||
    !Array.isArray(manifest.rows)||!Array.isArray(config?.sourcePins)||manifest.rows.length!==config.sourcePins.length)fail('schema');
  const completed=[];
  for(let i=0;i<config.sourcePins.length;i++){
    const pin=config.sourcePins[i],row=manifest.rows[i];
    if(!exact(pin,['name','bytes','sha256'])||typeof pin.name!=='string'||
      !/^(?:scripts\/boatrace-history\/[a-z0-9.-]+\.mjs|docs\/data\/[a-z0-9.-]+\.json)$/.test(pin.name)||
      !exact(row,['name','configBytes','configSHA','rawBytes','rawSHA','runtimeBytes','runtimeSHA','normalization','override'])||row.name!==pin.name||
      row.configBytes!==pin.bytes||row.configSHA!==pin.sha256||!Number.isSafeInteger(row.rawBytes)||row.rawBytes<1||
      !Number.isSafeInteger(row.runtimeBytes)||row.runtimeBytes<1||!/^[a-f0-9]{64}$/.test(row.rawSHA)||!/^[a-f0-9]{64}$/.test(row.runtimeSHA))fail('row_schema');
    const isAdmission=pin.name==='scripts/boatrace-history/joint-kelly-prefit-pending-admission.mjs';
    const expectedNormalization=pin.name.endsWith('.mjs')?'CRLF_TO_LF_UTF8':'EXACT_BYTES';
    if(row.normalization!==expectedNormalization)fail('normalization');
    if(isAdmission){if(!exact(row.override,['kind','effectiveSHA'])||row.override.kind!=='updated_admission'||row.override.effectiveSHA!==updatedAdmissionSHA)fail('admission_override');}
    else if(row.override!==null)fail('unexpected_override');
    const raw=await readRaw(pin.name),runtime=await readRuntime(pin.name);
    if(!Buffer.isBuffer(raw)||raw.length!==row.rawBytes||H(raw)!==row.rawSHA||
      row.rawSHA!==(isAdmission?updatedAdmissionSHA:pin.sha256)||(!isAdmission&&raw.length!==pin.bytes))fail('raw_pin');
    const normalized=normalize(pin.name,raw);
    if(!Buffer.isBuffer(runtime)||runtime.length!==row.runtimeBytes||H(runtime)!==row.runtimeSHA||
      !normalized.equals(runtime))fail('runtime_relation');
    completed.push({name:pin.name,rawBytes:raw.length,rawSHA:row.rawSHA,runtimeBytes:runtime.length,runtimeSHA:row.runtimeSHA,normalization:row.normalization});
  }
  return {status:'SOURCE_PIN_ARCHIVE_VERIFIED',count:completed.length,manifestSHA:expectedManifestSHA,configSHA:expectedConfigSHA,files:completed};
}
