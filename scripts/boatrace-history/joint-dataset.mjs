import {createHash} from 'node:crypto';

export const JOINT_DATASET_VERSION='boat_joint_dataset_v1';
export const JOINT_FEATURE_COUNT=318;
export const JOINT_SPLITS=Object.freeze({trainFrom:'2026-01-01',calibrationFrom:'2026-05-26',selectionFrom:'2026-06-26',holdoutFrom:'2026-07-26',holdoutTo:'2026-10-26',train:Object.freeze({from:'2026-01-01',to:'2026-05-26'}),calibration:Object.freeze({from:'2026-05-26',to:'2026-06-26'}),selection:Object.freeze({from:'2026-06-26',to:'2026-07-26'}),holdout:Object.freeze({from:'2026-07-26',to:'2026-10-26'})});
export const JOINT_NUMERIC_FIELDS=Object.freeze([
 ['program','national_win_rate'],['program','local_win_rate'],['program','national_top_2_percent'],['program','national_top_3_percent'],['program','local_top_2_percent'],['program','local_top_3_percent'],
 ['program','motor_top_2_percent'],['program','motor_top_3_percent'],['program','boat_top_2_percent'],['program','boat_top_3_percent'],['program','average_start_timing'],['program','flying_count'],['program','late_count'],['program','age'],['program','weight'],
 ['preview','exhibition_time'],['preview','weight_adjustment'],['preview','tilt_adjustment'],
].map(([source,key])=>Object.freeze({source,key})));
export const JOINT_CONTEXT_FIELDS=Object.freeze([['preview','wind_speed'],['preview','wave_height'],['preview','air_temperature'],['preview','water_temperature'],['program','day_number']].map(([source,key])=>Object.freeze({source,key})));
const MAX_RACES=75000,MAX_BYTES=48*1024*1024;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const validTriple=v=>typeof v==='string'&&/^[1-6]-[1-6]-[1-6]$/.test(v)&&new Set(v.split('-')).size===3;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function normalizeJointSplits(input=JOINT_SPLITS){
 const bounds=['trainFrom','calibrationFrom','selectionFrom','holdoutFrom','holdoutTo'],phases=['train','calibration','selection','holdout'];
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.keys(input).some(key=>!bounds.includes(key)&&!phases.includes(key))||bounds.some(key=>!validDate(input[key]))||bounds.slice(1).some((key,i)=>input[bounds[i]]>=input[key]))throw Error('joint_split_policy_invalid');
 const normalized=Object.fromEntries(bounds.map(key=>[key,input[key]]));
 for(let i=0;i<phases.length;i++){const phase=phases[i],value={from:input[bounds[i]],to:input[bounds[i+1]]};if(input[phase]!==undefined&&(!input[phase]||typeof input[phase]!=='object'||Array.isArray(input[phase])||Object.keys(input[phase]).length!==2||input[phase].from!==value.from||input[phase].to!==value.to))throw Error('joint_split_policy_invalid');normalized[phase]=Object.freeze(value);}
 return JSON.stringify(normalized)===JSON.stringify(JOINT_SPLITS)?JOINT_SPLITS:Object.freeze(normalized);
}
export function resolveJointDatasetSplits(dataset,splits=dataset?.splits??JOINT_SPLITS){const effective=normalizeJointSplits(splits);if(dataset?.splits&&JSON.stringify(normalizeJointSplits(dataset.splits))!==JSON.stringify(effective))throw Error('joint_split_policy_mismatch');return effective;}
const trustedSpecs=new WeakSet();
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object'){if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('joint_feature_spec_invalid');return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));}if(value===null||typeof value==='string'||typeof value==='boolean'||finite(value))return value;throw Error('joint_feature_spec_invalid');}
function freezeDeep(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freezeDeep(child);Object.freeze(value);}return value;}
export function digestJointFeatureSpec(spec){if(!spec||typeof spec!=='object'||Array.isArray(spec))throw Error('joint_feature_spec_invalid');const payload=Object.fromEntries(Object.entries(spec).filter(([key])=>key!=='digest')),normalized=canonical(payload);if(Buffer.byteLength(JSON.stringify(normalized))>128*1024)throw Error('joint_feature_spec_invalid');return hash(normalized);}
export function acceptJointFeatureSpec(spec,{splits}={}){
 if(splits===undefined&&spec&&typeof spec==='object'&&trustedSpecs.has(spec))return spec;
 let effective;try{effective=normalizeJointSplits(spec?.splits??JOINT_SPLITS);if(splits!==undefined&&JSON.stringify(normalizeJointSplits(splits))!==JSON.stringify(effective))throw Error('mismatch');}catch{throw Error('joint_feature_spec_invalid');}
 if(spec&&typeof spec==='object'&&trustedSpecs.has(spec))return spec;
 const expectedColumns=columns();
 const floats=(v,length,positive=false)=>Array.isArray(v)&&v.length===length&&v.every(value=>finite(value)&&(!positive||value>0)),counts=(v,length,max)=>Array.isArray(v)&&v.length===length&&v.every(value=>integer(value,0,max)),flags=(v,length)=>Array.isArray(v)&&v.length===length&&v.every(value=>typeof value==='boolean');
 if(!spec||spec.version!==JOINT_DATASET_VERSION||spec.featureCount!==318||!Array.isArray(spec.columns)||spec.columns.length!==318||spec.columns.some((name,index)=>name!==expectedColumns[index])||!floats(spec.means,18)||!floats(spec.stds,18,true)||!floats(spec.contextMeans,5)||!floats(spec.contextStds,5,true)||!integer(spec.trainRows,1,MAX_RACES)||!counts(spec.counts,18,MAX_RACES*6)||!counts(spec.missing,18,MAX_RACES*6)||!flags(spec.unlearned,18)||!counts(spec.contextCounts,5,MAX_RACES)||!counts(spec.contextMissing,5,MAX_RACES)||!flags(spec.contextUnlearned,5)||!counts(spec.trainClipped,18,MAX_RACES*6)||!counts(spec.contextTrainClipped,5,MAX_RACES)||!Array.isArray(spec.gradeVocabulary)||spec.gradeVocabulary.length>5||new Set(spec.gradeVocabulary).size!==spec.gradeVocabulary.length||spec.gradeVocabulary.some(v=>!integer(v,0,32767))||spec.fitRange?.from!==effective.trainFrom||spec.fitRange?.to!==effective.calibrationFrom||spec.rawUnitsVerified!==false||spec.timingVerified!==false||!['trainIndicesDigest','trainInputDigest','digest'].every(key=>typeof spec[key]==='string'&&/^[a-f0-9]{64}$/.test(spec[key])))throw Error('joint_feature_spec_invalid');
 for(let i=0;i<18;i++)if(spec.counts[i]+spec.missing[i]!==spec.trainRows*6||spec.unlearned[i]!==!spec.counts[i]||spec.trainClipped[i]>spec.counts[i]||spec.unlearned[i]&&(spec.means[i]!==0||spec.stds[i]!==1))throw Error('joint_feature_spec_invalid');
 for(let i=0;i<5;i++)if(spec.contextCounts[i]+spec.contextMissing[i]!==spec.trainRows||spec.contextUnlearned[i]!==!spec.contextCounts[i]||spec.contextTrainClipped[i]>spec.contextCounts[i]||spec.contextUnlearned[i]&&(spec.contextMeans[i]!==0||spec.contextStds[i]!==1))throw Error('joint_feature_spec_invalid');
 if(spec.digest!==digestJointFeatureSpec(spec))throw Error('joint_feature_spec_digest_mismatch');const clone=freezeDeep({...canonical(Object.fromEntries(Object.entries(spec).filter(([key])=>key!=='digest'))),digest:spec.digest});trustedSpecs.add(clone);return clone;
}
function recorded(fields,key){const field=fields?.[key];if(field?.time==='result_only'||field?.valueState!=='recorded'||!finite(field.value))return NaN;const value=Math.fround(field.value);return Number.isFinite(value)?value:NaN;}
function marketReference(race){
 const entries=race?.oddsAudit?.complete===true&&race.odds&&typeof race.odds==='object'&&!Array.isArray(race.odds)?Object.entries(race.odds):[];
 if(entries.length!==120||entries.some(([key,value])=>!validTriple(key)||!finite(value)||value<1))return {triple:null,ties:0};
 entries.sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0]));return {triple:entries[0][0],ties:entries.filter(([,value])=>value===entries[0][1]).length};
}

export function encodeJointRace(race){
 const source=race?.provenance?.source??'turnmark_v1',validSource=source==='turnmark_v1'||source==='boatrace_legacy_v3'&&race.date>='2025-10-01'&&race.date<'2026-01-01'&&race.quality?.normalStructurePolicy==='legacy_three_archive_label_only_v1'&&race.provenance.adapterVersion==='legacy_three_archive_structure_v1'&&['programs','results','previews'].every(kind=>/^[a-f0-9]{64}$/.test(race.provenance.partSha256?.[kind]??''))&&/^[a-f0-9]{64}$/.test(race.provenance.rawSha256??'');
 if(!race||!validSource||!validDate(race.date)||!integer(race.venue,1,24)||!integer(race.raceNumber,1,12)||race.raceKey!==`${source}:${race.date}:${race.venue}:${race.raceNumber}`||race.quality?.normalStructure!==true||race.result?.state!=='normal'||!validTriple(race.result.winnerTriple))return null;
 if(!Array.isArray(race.entries)||race.entries.length!==6||race.entries.some(row=>!integer(row?.lane,1,6)||!integer(row?.registration,1,99999))||new Set(race.entries.map(row=>row.lane)).size!==6||new Set(race.entries.map(row=>row.registration)).size!==6)return null;
 const entries=[...race.entries].sort((a,b)=>a.lane-b.lane),values=new Float32Array(108),context=new Float32Array(5);
 for(let lane=0;lane<6;lane++)for(let column=0;column<18;column++){const field=JOINT_NUMERIC_FIELDS[column];values[lane*18+column]=recorded(field.source==='preview'?entries[lane].preview:entries[lane].fields,field.key);}
 for(let column=0;column<5;column++){const field=JOINT_CONTEXT_FIELDS[column];context[column]=recorded(field.source==='preview'?race.preview:race.context,field.key);}
 const gradeField=race.context?.grade_number,grade=gradeField?.time!=='result_only'&&gradeField?.valueState==='recorded'&&integer(gradeField.value,0,32767)?gradeField.value:-1,market=marketReference(race);
 return {key:race.raceKey,date:race.date,venue:race.venue,grade,values,context,target:Uint8Array.from(race.result.winnerTriple.split('-').map(Number)),marketReferenceTriple:market.triple,marketTieCount:market.ties};
}

function validDataset(dataset){
 return dataset&&integer(dataset.size,0,MAX_RACES)&&dataset.values instanceof Float32Array&&dataset.values.length>=dataset.size*108&&dataset.context instanceof Float32Array&&dataset.context.length>=dataset.size*5&&dataset.venue instanceof Uint8Array&&dataset.venue.length>=dataset.size&&dataset.grade instanceof Int16Array&&dataset.grade.length>=dataset.size&&dataset.targets instanceof Uint8Array&&dataset.targets.length>=dataset.size*3&&Array.isArray(dataset.keys)&&dataset.keys.length===dataset.size&&Array.isArray(dataset.dates)&&dataset.dates.length===dataset.size;
}
export function digestJointDataset(dataset){
 if(!validDataset(dataset))throw Error('joint_dataset_invalid');
 const digest=createHash('sha256');digest.update(JOINT_DATASET_VERSION+'\n');
 for(const [name,array,length] of [['values',dataset.values,dataset.size*108],['context',dataset.context,dataset.size*5],['venue',dataset.venue,dataset.size],['grade',dataset.grade,dataset.size],['targets',dataset.targets,dataset.size*3]]){digest.update(name+':'+length+'\n');digest.update(Buffer.from(array.buffer,array.byteOffset,length*array.BYTES_PER_ELEMENT));}
 digest.update(JSON.stringify({keys:dataset.keys,dates:dataset.dates,marketReferenceTriples:dataset.marketReferenceTriples??null,marketTieCounts:dataset.marketTieCounts?Array.from(dataset.marketTieCounts.subarray(0,dataset.size)):null,exclusions:dataset.exclusions??{},...(dataset.splits?{splits:normalizeJointSplits(dataset.splits)}:{})}));return digest.digest('hex');
}
export function createJointDatasetBuilder({maxRaces=MAX_RACES,maxBytes=MAX_BYTES,splits=JOINT_SPLITS}={}){
 const effective=normalizeJointSplits(splits);
 if(!integer(maxRaces,1,MAX_RACES)||!integer(maxBytes,1,MAX_BYTES))throw Error('joint_dataset_budget_invalid');
 const required=maxRaces*459;if(required>maxBytes)throw Error('joint_dataset_byte_limit');
 const values=new Float32Array(maxRaces*108),context=new Float32Array(maxRaces*5),venue=new Uint8Array(maxRaces),grade=new Int16Array(maxRaces),targets=new Uint8Array(maxRaces*3),marketTieCounts=new Uint8Array(maxRaces);
 const buffers=[values,context,venue,grade,targets,marketTieCounts],allocatedBufferBytes=buffers.reduce((sum,array)=>sum+array.buffer.byteLength,0),keys=[],dates=[],marketReferenceTriples=[],seen=new Set(),exclusions={};let size=0,metadataBytes=0,closed=false;
 return {
  append(race){
   if(closed)throw Error('joint_dataset_closed');const encoded=encodeJointRace(race);
   if(!encoded){const reason=typeof race?.result?.state==='string'&&['refund','cancelled','tie','unresolved'].includes(race.result.state)?race.result.state:'invalid_structure';exclusions[reason]=(exclusions[reason]??0)+1;return false;}
   if(seen.has(encoded.key))throw Error('joint_dataset_duplicate_key');if(size>=maxRaces)throw Error('joint_dataset_row_limit');
   const added=Buffer.byteLength(JSON.stringify({key:encoded.key,date:encoded.date,marketReferenceTriple:encoded.marketReferenceTriple}))+64;
   if(allocatedBufferBytes+metadataBytes+added>maxBytes)throw Error('joint_dataset_byte_limit');
   values.set(encoded.values,size*108);context.set(encoded.context,size*5);venue[size]=encoded.venue;grade[size]=encoded.grade;targets.set(encoded.target,size*3);marketTieCounts[size]=encoded.marketTieCount;
   keys.push(encoded.key);dates.push(encoded.date);marketReferenceTriples.push(encoded.marketReferenceTriple);seen.add(encoded.key);metadataBytes+=added;size++;return true;
  },
  finish(){
   if(closed)throw Error('joint_dataset_closed');closed=true;seen.clear();
   const dataset={version:JOINT_DATASET_VERSION,size,capacity:maxRaces,values:values.subarray(0,size*108),context:context.subarray(0,size*5),venue:venue.subarray(0,size),grade:grade.subarray(0,size),targets:targets.subarray(0,size*3),marketTieCounts:marketTieCounts.subarray(0,size),keys:Object.freeze(keys),dates:Object.freeze(dates),marketReferenceTriples:Object.freeze(marketReferenceTriples),exclusions:Object.freeze(exclusions),allocatedBufferBytes,metadataBytesEstimate:metadataBytes,memoryBytesEstimate:allocatedBufferBytes+metadataBytes,maxBytes,rawIntegrity:'caller_must_verify',evidenceTime:'retrospective_unverified',analysisReady:false,liveEligible:false};
   if(effective!==JOINT_SPLITS)dataset.splits=effective;dataset.digest=digestJointDataset(dataset);return dataset;
  },
 };
}
export function splitJointDataset(dataset,splits=dataset?.splits??JOINT_SPLITS){
 const effective=resolveJointDatasetSplits(dataset,splits);
 if(!validDataset(dataset))throw Error('joint_dataset_invalid');const groups={train:[],calibration:[],selection:[],holdout:[]};
 for(let index=0;index<dataset.size;index++){const day=dataset.dates[index];if(!validDate(day))throw Error('joint_dataset_date_invalid');if(day<effective.trainFrom||day>=effective.holdoutTo)continue;const key=day<effective.calibrationFrom?'train':day<effective.selectionFrom?'calibration':day<effective.holdoutFrom?'selection':'holdout';groups[key].push(index);}
 return Object.fromEntries(Object.entries(groups).map(([key,indices])=>[key,Uint32Array.from(indices)]));
}
export function jointInputAt(dataset,index){
 if(!validDataset(dataset)||!integer(index,0,dataset.size-1))throw Error('joint_dataset_index_invalid');
 return {values:dataset.values.subarray(index*108,(index+1)*108),context:dataset.context.subarray(index*5,(index+1)*5),venue:dataset.venue[index],grade:dataset.grade[index]};
}
function stats(count){return Array.from({length:count},()=>({n:0,mean:0,m2:0,missing:0}));}
function observe(stat,value){if(!finite(value)){stat.missing++;return;}stat.n++;const difference=value-stat.mean;stat.mean+=difference/stat.n;stat.m2+=difference*(value-stat.mean);}
function columns(){
 const names=Array.from({length:318});for(let lane=1;lane<=6;lane++)names[lane-1]=`lane:${lane}`;
 for(let column=0;column<18;column++){names[6+column]=`numeric:${JOINT_NUMERIC_FIELDS[column].source}.${JOINT_NUMERIC_FIELDS[column].key}`;names[24+column]=`missing:${JOINT_NUMERIC_FIELDS[column].source}.${JOINT_NUMERIC_FIELDS[column].key}`;}
 for(let column=0;column<5;column++)for(let lane=1;lane<=6;lane++){names[42+column*6+lane-1]=`context:${JOINT_CONTEXT_FIELDS[column].key}:lane:${lane}`;names[72+column*6+lane-1]=`context_missing:${JOINT_CONTEXT_FIELDS[column].key}:lane:${lane}`;}
 for(let venue=1;venue<=24;venue++)for(let lane=1;lane<=6;lane++)names[102+(venue-1)*6+lane-1]=`venue:${venue}:lane:${lane}`;
 for(let slot=0;slot<6;slot++)for(let lane=1;lane<=6;lane++)names[246+slot*6+lane-1]=`grade_slot:${slot}:lane:${lane}`;
 for(let previous=1;previous<=6;previous++)for(let lane=1;lane<=6;lane++)names[282+(previous-1)*6+lane-1]=`prefix_last:${previous}:lane:${lane}`;return names;
}
export function digestJointTrainIndices(dataset,trainIndices,{splits=dataset?.splits??JOINT_SPLITS}={}){
 const effective=resolveJointDatasetSplits(dataset,splits);
 if(!validDataset(dataset)||!(trainIndices instanceof Uint32Array||Array.isArray(trainIndices))||!trainIndices.length)throw Error('joint_train_indices_invalid');const seen=new Set(),digest=createHash('sha256');
 for(const index of trainIndices){if(!integer(index,0,dataset.size-1)||seen.has(index)||!validDate(dataset.dates[index])||dataset.dates[index]<effective.trainFrom||dataset.dates[index]>=effective.calibrationFrom)throw Error('joint_train_indices_invalid');seen.add(index);digest.update(JSON.stringify([index,dataset.keys[index],dataset.dates[index]])+'\n');}return digest.digest('hex');
}
function updateTrainInputDigest(digest,input){digest.update(Buffer.from(input.values.buffer,input.values.byteOffset,input.values.byteLength));digest.update(Buffer.from(input.context.buffer,input.context.byteOffset,input.context.byteLength));digest.update(JSON.stringify([input.venue,input.grade])+'\n');}
export function digestJointTrainInputs(dataset,trainIndices,options={}){
 digestJointTrainIndices(dataset,trainIndices,options);const digest=createHash('sha256');for(const index of trainIndices)updateTrainInputDigest(digest,jointInputAt(dataset,index));return digest.digest('hex');
}
export function fitJointFeatureSpec(dataset,trainIndices,{splits=dataset?.splits??JOINT_SPLITS}={}){
 const effective=resolveJointDatasetSplits(dataset,splits);
 if(!validDataset(dataset)||!(trainIndices instanceof Uint32Array||Array.isArray(trainIndices))||!trainIndices.length)throw Error('joint_train_indices_invalid');
 const seen=new Set(),numeric=stats(18),environment=stats(5),grades=new Map(),inputDigest=createHash('sha256'),indexDigest=createHash('sha256');
 for(const index of trainIndices){
  if(!integer(index,0,dataset.size-1)||seen.has(index)||!validDate(dataset.dates[index])||dataset.dates[index]<effective.trainFrom||dataset.dates[index]>=effective.calibrationFrom)throw Error('joint_train_indices_invalid');seen.add(index);
  indexDigest.update(JSON.stringify([index,dataset.keys[index],dataset.dates[index]])+'\n');const input=jointInputAt(dataset,index);
  updateTrainInputDigest(inputDigest,input);
  for(let lane=0;lane<6;lane++)for(let column=0;column<18;column++)observe(numeric[column],input.values[lane*18+column]);for(let column=0;column<5;column++)observe(environment[column],input.context[column]);
  if(integer(input.grade,0,32767))grades.set(input.grade,(grades.get(input.grade)??0)+1);
 }
 const means=numeric.map(s=>s.n?s.mean:0),stds=numeric.map(s=>s.n&&Math.sqrt(Math.max(0,s.m2/s.n))>=1e-6?Math.sqrt(Math.max(0,s.m2/s.n)):1);
 const contextMeans=environment.map(s=>s.n?s.mean:0),contextStds=environment.map(s=>s.n&&Math.sqrt(Math.max(0,s.m2/s.n))>=1e-6?Math.sqrt(Math.max(0,s.m2/s.n)):1);
 const spec={version:JOINT_DATASET_VERSION,featureCount:318,columns:columns(),means,stds,contextMeans,contextStds,counts:numeric.map(s=>s.n),missing:numeric.map(s=>s.missing),unlearned:numeric.map(s=>s.n===0),contextCounts:environment.map(s=>s.n),contextMissing:environment.map(s=>s.missing),contextUnlearned:environment.map(s=>s.n===0),gradeVocabulary:[...grades].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,5).map(([code])=>code),trainRows:trainIndices.length,trainIndicesDigest:indexDigest.digest('hex'),trainInputDigest:inputDigest.digest('hex'),fitRange:{from:effective.trainFrom,to:effective.calibrationFrom},rawUnitsVerified:false,timingVerified:false};
 const numericClipped=Array(18).fill(0),contextClipped=Array(5).fill(0);
 for(const index of trainIndices){const input=jointInputAt(dataset,index);for(let lane=0;lane<6;lane++)for(let column=0;column<18;column++){const v=input.values[lane*18+column];if(finite(v)&&Math.abs((v-means[column])/stds[column])>5)numericClipped[column]++;}for(let column=0;column<5;column++){const v=input.context[column];if(finite(v)&&Math.abs((v-contextMeans[column])/contextStds[column])>5)contextClipped[column]++;}}
 if(effective!==JOINT_SPLITS)spec.splits=effective;spec.trainClipped=numericClipped;spec.contextTrainClipped=contextClipped;spec.digest=digestJointFeatureSpec(spec);return acceptJointFeatureSpec(spec,{splits:effective});
}
export function buildJointFeatures(input,lane,prefix,spec,{laneOnly=false,buffer}={}){
 spec=acceptJointFeatureSpec(spec);
 if(!input||!(input.values instanceof Float32Array)||input.values.length!==108||!(input.context instanceof Float32Array)||input.context.length!==5||!integer(input.venue,1,24)||!integer(input.grade,-1,32767)||!integer(lane,1,6)||!Array.isArray(prefix)||prefix.length>2||prefix.some(v=>!integer(v,1,6))||new Set(prefix).size!==prefix.length||prefix.includes(lane)||!spec||spec.featureCount!==318||spec.means?.length!==18||spec.stds?.length!==18||spec.contextMeans?.length!==5||spec.contextStds?.length!==5||!Array.isArray(spec.gradeVocabulary)||spec.gradeVocabulary.length>5)throw Error('joint_feature_input_invalid');
 const indices=buffer?.indices??new Uint16Array(27),values=buffer?.values??new Float64Array(27);if(!(indices instanceof Uint16Array)||indices.length<27||!(values instanceof Float64Array)||values.length<27)throw Error('joint_feature_buffer_invalid');let length=0;
 const add=(index,value)=>{if(value!==0){if(!finite(value))throw Error('joint_feature_value_invalid');indices[length]=index;values[length]=value;length++;}},scaled=(value,mean,std)=>{if(!finite(mean)||!finite(std)||std<=0)throw Error('joint_feature_spec_invalid');return Math.max(-5,Math.min(5,(value-mean)/std));};const laneIndex=lane-1;add(laneIndex,1);
 if(!laneOnly){
  for(let column=0;column<18;column++){const v=input.values[laneIndex*18+column];if(!finite(v)||spec.unlearned?.[column])add(24+column,1);else add(6+column,scaled(v,spec.means[column],spec.stds[column]));}
  for(let column=0;column<5;column++){const v=input.context[column];if(!finite(v)||spec.contextUnlearned?.[column])add(72+column*6+laneIndex,1);else add(42+column*6+laneIndex,scaled(v,spec.contextMeans[column],spec.contextStds[column]));}
  add(102+(input.venue-1)*6+laneIndex,1);const gradeSlot=spec.gradeVocabulary.indexOf(input.grade);add(246+(gradeSlot<0?5:gradeSlot)*6+laneIndex,1);
  if(prefix.length)add(282+(prefix.at(-1)-1)*6+laneIndex,1);
 }
 return {indices,values,length};
}
