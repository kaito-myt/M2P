import {createHash} from 'node:crypto';
import {RESEARCH_FEATURES} from './pattern-research.mjs';
import {wilsonJoint,PROBABILITY_BIN_EDGES} from './joint-evaluation.mjs';
import {JOINT_COMBINATIONS} from './joint-model.mjs';
import {JOINT_SPLITS,normalizeJointSplits} from './joint-dataset.mjs';

export const JOINT_PATTERN_RESEARCH_VERSION='boat_joint_patterns_v3';
export const JOINT_PATTERN_CONTEXT_FIELDS=Object.freeze(RESEARCH_FEATURES.map(({id,group,kind})=>Object.freeze({id,group,kind})));
export const JOINT_PATTERN_ROLE_FIELDS=Object.freeze([['predictedFirstLane','category'],['predictedSecondLane','category'],['predictedThirdLane','category'],['confidence','number'],['firstHeadProbability','number']].map(([id,kind])=>Object.freeze({id,group:'forecast_role',kind})));
export const JOINT_PATTERN_REGISTRY=Object.freeze([...JOINT_PATTERN_CONTEXT_FIELDS,...JOINT_PATTERN_ROLE_FIELDS]);
export const DEFAULT_JOINT_PATTERN_POLICY=Object.freeze({version:JOINT_PATTERN_RESEARCH_VERSION,maxRows:75000,maxCandidates:32768,maxAtoms:512,beamWidth:128,maxDepth:6,minDepth:2,minGroups:3,minTrain:200,minSelection:50,minHoldout:30,frozenPerTrack:8,diagnosticsPerTrack:16,alpha:.05,minLogLossGain:.01,maxEce:.03,minProbabilityStd:.01,maxBinError:.05,minBinSupport:100,hitRateFloor:.5,tracks:Object.freeze(['nll_gain','hit_rate']),splits:JOINT_SPLITS});
const MAX_ROWS=75000,MIB=1024*1024,WIDTH=JOINT_PATTERN_CONTEXT_FIELDS.length,PERIODS=['train','selection','holdout'],PERIOD_SPLIT={train:0,selection:2,holdout:3};
const COLUMNS=[['context',Float64Array,WIDTH],['split',Uint8Array,1],['predictedTriple',Uint8Array,1],['actualTriple',Uint8Array,1],['probability',Float64Array,1],['confidence',Float64Array,1],['firstHeadProbability',Float64Array,1],['fullJointLogLoss',Float64Array,1],['fullMulticlassBrier',Float64Array,1],['laneJointLogLoss',Float64Array,1],['laneMulticlassBrier',Float64Array,1],['marketTriple',Int16Array,1],['marketTieCount',Uint8Array,1]];
const ROW_BYTES=COLUMNS.reduce((sum,[,Type,width])=>sum+Type.BYTES_PER_ELEMENT*width,0);
const LANES=Uint8Array.from(JOINT_COMBINATIONS.flatMap(t=>t.split('-').map(Number)));
const FEATURE_INDEX=new Map(JOINT_PATTERN_REGISTRY.map((f,i)=>[f.id,i]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const unit=(v,min=0,max=1)=>finite(v)&&v>=min&&v<=max;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const splitOf=(d,s=JOINT_SPLITS)=>d<s.trainFrom||d>=s.holdoutTo?-1:d<s.calibrationFrom?0:d<s.selectionFrom?1:d<s.holdoutFrom?2:3;
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const byText=(a,b)=>a<b?-1:a>b?1:0;
const validKey=v=>typeof v==='string'&&v.length>=1&&v.length<=200;
const contextValue=v=>typeof v==='number'&&(Number.isFinite(v)||Number.isNaN(v));

function validRow(row,splits){
 if(!row||typeof row!=='object'||!validKey(row.key)||!validDate(row.date)||!integer(row.split,0,3)||splitOf(row.date,splits)!==row.split)return false;
 const c=row.context;if(!(Array.isArray(c)||ArrayBuffer.isView(c)&&!(c instanceof DataView))||c.length!==WIDTH)return false;
 for(let f=0;f<WIDTH;f++)if(!contextValue(c[f]))return false;
 return integer(row.predictedTriple,0,119)&&integer(row.actualTriple,0,119)&&unit(row.probability)&&unit(row.confidence)&&unit(row.firstHeadProbability)&&unit(row.fullJointLogLoss,0,Infinity)&&unit(row.laneJointLogLoss,0,Infinity)&&unit(row.fullMulticlassBrier,0,2)&&unit(row.laneMulticlassBrier,0,2)&&integer(row.marketTriple,-1,119)&&integer(row.marketTieCount,0,255);
}
/** Typed row columns only; no race originals, names or 120-way distributions are retained. */
export function createJointPatternRowsBuilder({maxRows=MAX_ROWS,maxBytes=48*MIB,splits=JOINT_SPLITS}={}){
 const effective=normalizeJointSplits(splits);
 if(!integer(maxRows,1,MAX_ROWS)||!integer(maxBytes,1,96*MIB))throw Error('joint_pattern_budget_invalid');
 const allocatedBytes=maxRows*ROW_BYTES;if(allocatedBytes>maxBytes)throw Error('joint_pattern_byte_limit');
 const columns=Object.fromEntries(COLUMNS.map(([name,Type,width])=>[name,new Type(maxRows*width)])),keys=[],dates=[],seen=new Set();let size=0,metadataBytes=0,closed=false;
 return {
  append(row){
   if(closed)throw Error('joint_pattern_rows_closed');if(!validRow(row,effective))throw Error('joint_pattern_row_invalid');
   if(seen.has(row.key))throw Error('joint_pattern_duplicate_key');if(size>=maxRows)throw Error('joint_pattern_row_limit');
   const added=Buffer.byteLength(JSON.stringify([row.key,row.date]))+64;if(allocatedBytes+metadataBytes+added>maxBytes)throw Error('joint_pattern_byte_limit');
   // Canonical NaN keeps rowsDigest independent of the caller's NaN payload bits.
   for(let f=0;f<WIDTH;f++){const v=row.context[f];columns.context[size*WIDTH+f]=Number.isNaN(v)?NaN:v;}
   for(const [name] of COLUMNS.slice(1))columns[name][size]=row[name];
   keys.push(row.key);dates.push(row.date);seen.add(row.key);metadataBytes+=added;size++;
  },
  finish(){
   if(closed)throw Error('joint_pattern_rows_closed');closed=true;seen.clear();
   const rows={version:JOINT_PATTERN_RESEARCH_VERSION,size,keys:Object.freeze(keys),dates:Object.freeze(dates),contextFields:JOINT_PATTERN_CONTEXT_FIELDS,...Object.fromEntries(COLUMNS.map(([name,,width])=>[name,columns[name].subarray(0,size*width)])),joinStats:undefined,sourceSnapshotSha256:null,datasetDigest:null,parent:null,allocatedBytes,metadataBytesEstimate:metadataBytes,memoryBytesEstimate:allocatedBytes+metadataBytes,maxBytes};
   if(effective!==JOINT_SPLITS)rows.splits=effective;rows.rowsDigest=digestJointPatternRows(rows);return rows;
  },
 };
}
function shapeOk(rows){return rows&&typeof rows==='object'&&rows.version===JOINT_PATTERN_RESEARCH_VERSION&&integer(rows.size,0,MAX_ROWS)&&COLUMNS.every(([name,Type,width])=>rows[name] instanceof Type&&rows[name].length===rows.size*width);}
export function digestJointPatternRows(rows){
 if(!shapeOk(rows)||!Array.isArray(rows.keys)||!Array.isArray(rows.dates))throw Error('joint_pattern_dataset_invalid');
 const h=createHash('sha256');h.update(JOINT_PATTERN_RESEARCH_VERSION+'\n');
 for(const [name] of COLUMNS){const a=rows[name];h.update(name+':'+a.length+'\n');h.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));}
 h.update(JSON.stringify({keys:rows.keys,dates:rows.dates,...(rows.splits?{splits:normalizeJointSplits(rows.splits)}:{})}));return h.digest('hex');
}
export function validateJointPatternDataset(rows){
 const bad=()=>{throw Error('joint_pattern_dataset_invalid');};
 let effective;try{effective=normalizeJointSplits(rows?.splits??JOINT_SPLITS);}catch{bad();}
 if(!shapeOk(rows)||!Array.isArray(rows.keys)||!Array.isArray(rows.dates)||rows.keys.length!==rows.size||rows.dates.length!==rows.size)bad();
 if(!Array.isArray(rows.contextFields)||rows.contextFields.length!==WIDTH||rows.contextFields.some((f,i)=>f?.id!==JOINT_PATTERN_CONTEXT_FIELDS[i].id||f.group!==JOINT_PATTERN_CONTEXT_FIELDS[i].group||f.kind!==JOINT_PATTERN_CONTEXT_FIELDS[i].kind))bad();
 if(!integer(rows.memoryBytesEstimate,0,192*MIB)||typeof rows.rowsDigest!=='string'||!/^[a-f0-9]{64}$/.test(rows.rowsDigest))bad();
 if(new Set(rows.keys).size!==rows.size)bad();
 for(let i=0;i<rows.size;i++){
  if(!validKey(rows.keys[i])||!validDate(rows.dates[i])||rows.split[i]>3||splitOf(rows.dates[i],effective)!==rows.split[i]||rows.predictedTriple[i]>119||rows.actualTriple[i]>119||rows.marketTriple[i]<-1||rows.marketTriple[i]>119)bad();
  for(let f=0;f<WIDTH;f++)if(Math.abs(rows.context[i*WIDTH+f])===Infinity)bad();
  if(!unit(rows.probability[i])||!unit(rows.confidence[i])||!unit(rows.firstHeadProbability[i])||!unit(rows.fullJointLogLoss[i],0,Infinity)||!unit(rows.laneJointLogLoss[i],0,Infinity)||!unit(rows.fullMulticlassBrier[i],0,2)||!unit(rows.laneMulticlassBrier[i],0,2))bad();
 }
 if(digestJointPatternRows(rows)!==rows.rowsDigest)bad();
 return rows;
}

function policyOf(overrides,splits=JOINT_SPLITS){
 const fail=()=>{throw Error('invalid_joint_pattern_policy');};
 if(overrides===null||typeof overrides!=='object'||Array.isArray(overrides)||Object.keys(overrides).some(key=>!Object.hasOwn(DEFAULT_JOINT_PATTERN_POLICY,key)))fail();
 const p={...DEFAULT_JOINT_PATTERN_POLICY,...overrides};
 if(p.version!==JOINT_PATTERN_RESEARCH_VERSION||!Array.isArray(p.tracks)||JSON.stringify(p.tracks)!==JSON.stringify(DEFAULT_JOINT_PATTERN_POLICY.tracks))fail();
 try{p.splits=normalizeJointSplits(overrides.splits??splits);}catch{fail();}
 for(const [key,min,max] of [['maxRows',1,MAX_ROWS],['maxCandidates',1,131072],['maxAtoms',1,512],['beamWidth',1,256],['maxDepth',1,8],['minDepth',1,8],['minGroups',1,8],['minTrain',1,MAX_ROWS],['minSelection',1,MAX_ROWS],['minHoldout',1,MAX_ROWS],['frozenPerTrack',1,8],['diagnosticsPerTrack',0,16],['minBinSupport',1,MAX_ROWS]])if(!integer(p[key],min,max))fail();
 if(p.minDepth>p.maxDepth||p.minGroups>p.maxDepth||p.maxCandidates<p.maxDepth)fail();
 for(const key of ['minLogLossGain','maxEce','minProbabilityStd','maxBinError'])if(!finite(p[key])||p[key]<0||p[key]>=1)fail();
 if(!finite(p.alpha)||p.alpha<=0||p.alpha>=1||!finite(p.hitRateFloor)||p.hitRateFloor<=0||p.hitRateFloor>1)fail();
 return Object.freeze({...p,tracks:DEFAULT_JOINT_PATTERN_POLICY.tracks});
}

const pop=x=>{x-=x>>>1&0x55555555;x=(x&0x33333333)+(x>>>2&0x33333333);return Math.imul(x+(x>>>4)&0x0f0f0f0f,0x01010101)>>>24;};
function each(mask,split,fn){for(let w=0;w<mask.length;w++){let x=mask[w]&split[w];while(x){fn(w*32+31-Math.clz32(x&-x));x&=x-1;}}}
function engineOf(rows){
 const n=rows.size,W=Math.max(1,Math.ceil(n/32)),blank=()=>new Uint32Array(W),set=(m,i)=>{m[i>>>5]|=1<<(i&31);};
 const splits=[0,1,2,3].map(blank),all=blank();for(let i=0;i<n;i++){set(splits[rows.split[i]],i);set(all,i);}
 const value=(i,f)=>f<WIDTH?rows.context[i*WIDTH+f]:f<WIDTH+3?LANES[rows.predictedTriple[i]*3+f-WIDTH]:f===WIDTH+3?rows.confidence[i]:rows.firstHeadProbability[i];
 const finiteMasks=new Map(),atomMasks=new Map();
 const finiteMask=f=>{let m=finiteMasks.get(f);if(!m){m=blank();for(let i=0;i<n;i++)if(Number.isFinite(value(i,f)))set(m,i);finiteMasks.set(f,m);}return m;};
 const atomMask=atom=>{let m=atomMasks.get(atom.id);if(!m){m=blank();const f=FEATURE_INDEX.get(atom.feature);for(let i=0;i<n;i++){const v=value(i,f);if(Number.isFinite(v)&&test(atom,v))set(m,i);}atomMasks.set(atom.id,m);}return m;};
 const and=(...ms)=>{const o=Uint32Array.from(ms[0]);for(let k=1;k<ms.length;k++)for(let w=0;w<W;w++)o[w]&=ms[k][w];return o;};
 const count=(m,s)=>{let c=0;for(let w=0;w<W;w++)c+=pop(m[w]&s[w]);return c;};
 return {n,splits,all,value,finiteMask,atomMask,and,count,maskOf:atoms=>atoms.length?and(all,...atoms.map(atomMask)):all};
}
const test=(atom,v)=>atom.op==='eq'?v===atom.value:atom.op==='lte'?v<=atom.value:v>atom.value;
function validAtoms(atoms){if(!Array.isArray(atoms)||atoms.some(a=>!a||!FEATURE_INDEX.has(a.feature)||!['eq','lte','gt'].includes(a.op)||!finite(a.value)||typeof a.id!=='string')||new Set(atoms.map(a=>a.feature)).size!==atoms.length)throw Error('invalid_joint_pattern_atoms');return atoms;}

function makeAtoms(rows,eng,policy){
 const grouped=new Map(),registry=[],train=eng.splits[0];
 JOINT_PATTERN_REGISTRY.forEach((field,f)=>{
  const xs=[];each(train,train,i=>{const v=eng.value(i,f);if(Number.isFinite(v))xs.push(v);});
  const entry={id:field.id,group:field.group,kind:field.kind,trainNonNull:xs.length,selectionNonNull:eng.count(eng.finiteMask(f),eng.splits[2]),holdoutNonNull:eng.count(eng.finiteMask(f),eng.splits[3]),atoms:0,generatedAtoms:0,omittedAtoms:0,allocationStatus:'no_train_values'};registry.push(entry);
  const fields=grouped.get(field.group)??[];grouped.set(field.group,fields);const list=[];fields.push(list);if(!xs.length)return;
  xs.sort((a,b)=>a-b);const values=field.kind==='category'?[...new Set(xs)]:[...new Set([.25,.5,.75].map(q=>xs[Math.floor((xs.length-1)*q)]))];
  for(const value of values)for(const op of field.kind==='category'?['eq']:['lte','gt']){const atom={id:field.id+':'+op+':'+value,feature:field.id,group:field.group,op,value};if(xs.some(x=>test(atom,x))&&xs.some(x=>!test(atom,x)))list.push(atom);}
  entry.generatedAtoms=list.length;entry.allocationStatus=list.length?'budget_exhausted':xs[0]===xs.at(-1)?'constant_train_value':'no_valid_split';
 });
 const atoms=[],groups=[...grouped.keys()].sort(byText);let round=0;
 while(atoms.length<policy.maxAtoms){let added=false;
  for(let fieldIndex=0;groups.some(group=>fieldIndex<grouped.get(group).length);fieldIndex++)for(const group of groups){const atom=grouped.get(group)[fieldIndex]?.[round];if(atom&&atoms.length<policy.maxAtoms){atoms.push(atom);added=true;}}
  if(!added)break;round++;
 }
 for(const entry of registry){entry.atoms=atoms.filter(a=>a.feature===entry.id).length;entry.omittedAtoms=entry.generatedAtoms-entry.atoms;if(entry.generatedAtoms)entry.allocationStatus=entry.atoms===entry.generatedAtoms?'all_allocated':entry.atoms?'partially_allocated':'budget_exhausted';}
 return {atoms,registry,generatedAtoms:registry.reduce((s,r)=>s+r.generatedAtoms,0),atomsDigest:digest({version:JOINT_PATTERN_RESEARCH_VERSION,registry:JOINT_PATTERN_REGISTRY,atoms})};
}
function checkPatternSplits(rows,splits){if(JSON.stringify(normalizeJointSplits(rows.splits??JOINT_SPLITS))!==JSON.stringify(splits))throw Error('joint_split_policy_mismatch');}
export function buildJointPatternAtoms(rows,policy={}){const p=policyOf(policy??{},rows?.splits??JOINT_SPLITS);validateJointPatternDataset(rows);checkPatternSplits(rows,p.splits);return makeAtoms(rows,engineOf(rows),p);}

function irreducibility(eng,atoms,mask=eng.maskOf(atoms)){
 const train=eng.splits[0],samples=eng.count(mask,train);let checks=0;
 if(!samples)return {irreducible:false,checks,samples};
 // Removal keeps the complete-case population: missingness alone is not a condition.
 const complete=eng.and(train,...atoms.map(a=>eng.finiteMask(FEATURE_INDEX.get(a.feature))));
 for(let i=0;i<atoms.length;i++){checks++;const removed=eng.count(eng.and(complete,...atoms.filter((_,k)=>k!==i).map(eng.atomMask)),eng.all);if(removed===samples)return {irreducible:false,checks,samples};}
 return {irreducible:true,checks,samples};
}
export function checkJointPatternIrreducibility(rows,atoms){validateJointPatternDataset(rows);return irreducibility(engineOf(rows),validAtoms(atoms));}

function light(rows,eng,mask,split){let samples=0,hits=0,full=0,lane=0;each(mask,eng.splits[split],i=>{samples++;if(rows.predictedTriple[i]===rows.actualTriple[i])hits++;full+=rows.fullJointLogLoss[i];lane+=rows.laneJointLogLoss[i];});return {samples,hits,accuracy:samples?hits/samples:null,jointLogLossGain:samples?lane/samples-full/samples:null};}
const binRow=(k,samples,hits,meanP,minBinSupport)=>{const rate=samples?hits/samples:null;return {from:PROBABILITY_BIN_EDGES[k],to:PROBABILITY_BIN_EDGES[k+1],samples,hits,meanProbability:meanP,accuracy:rate,absoluteError:samples?Math.abs(meanP-rate):null,interval95:wilsonJoint(hits,samples),support:samples>=minBinSupport?'sufficient':'insufficient'};};
/** Report bins keep only {samples,hits,meanProbability} so 2 tracks x 8 candidates x 3 periods fit 128KiB; this restores the full bin rows exactly. */
export function expandJointPatternBins(bins,minBinSupport=DEFAULT_JOINT_PATTERN_POLICY.minBinSupport){
 if(!Array.isArray(bins)||bins.length!==PROBABILITY_BIN_EDGES.length-1||!integer(minBinSupport,1,MAX_ROWS)||bins.some(b=>!integer(b?.samples,0,MAX_ROWS)||!integer(b.hits,0,b.samples)||(b.samples?!unit(b.meanProbability):b.meanProbability!==null)))throw Error('invalid_joint_pattern_bins');
 return bins.map((b,k)=>binRow(k,b.samples,b.hits,b.meanProbability,minBinSupport));
}
const compactMetrics=m=>({...m,bins:m.bins.map(b=>({samples:b.samples,hits:b.hits,meanProbability:b.meanProbability}))});
function binOf(p){for(let k=1;k<PROBABILITY_BIN_EDGES.length;k++)if(p<PROBABILITY_BIN_EDGES[k])return k-1;return PROBABILITY_BIN_EDGES.length-2;}
function metricsOf(rows,eng,mask,split,policy){
 let n=0,hits=0,sumP=0,binary=0,full=0,lane=0,fullB=0,laneB=0;const ps=[],bins=PROBABILITY_BIN_EDGES.slice(0,-1).map(()=>({samples:0,hits:0,sumP:0})),m={samples:0,bothCorrect:0,selfOnly:0,marketOnly:0,neither:0,marketMissing:0,tiedMarketRows:0};
 each(mask,eng.splits[split],i=>{
  const p=rows.probability[i],hit=rows.predictedTriple[i]===rows.actualTriple[i]?1:0,bin=bins[binOf(p)];
  n++;hits+=hit;sumP+=p;ps.push(p);binary+=(p-hit)**2;full+=rows.fullJointLogLoss[i];lane+=rows.laneJointLogLoss[i];fullB+=rows.fullMulticlassBrier[i];laneB+=rows.laneMulticlassBrier[i];bin.samples++;bin.hits+=hit;bin.sumP+=p;
  const market=rows.marketTriple[i];if(market<0)m.marketMissing++;else{m.samples++;const marketHit=market===rows.actualTriple[i];if(hit&&marketHit)m.bothCorrect++;else if(hit)m.selfOnly++;else if(marketHit)m.marketOnly++;else m.neither++;if(rows.marketTieCount[i]>1)m.tiedMarketRows++;}
 });
 const mean=n?sumP/n:null,sorted=Float64Array.from(ps).sort(),q=x=>n?sorted[Math.floor((n-1)*x)]:null;let variance=0;for(const p of ps)variance+=(p-mean)**2;
 const binRows=bins.map((b,k)=>binRow(k,b.samples,b.hits,b.samples?b.sumP/b.samples:null,policy.minBinSupport));
 const ms=m.samples;
 return {samples:n,hits,accuracy:n?hits/n:null,wilson95:wilsonJoint(hits,n),meanProbability:mean,probabilityStd:n?Math.sqrt(variance/n):null,probabilityQuantiles:{p10:q(.1),p50:q(.5),p90:q(.9)},binaryBrier:n?binary/n:null,ece:n?binRows.reduce((sum,b)=>sum+(b.samples/n)*(b.absoluteError??0),0):null,bins:binRows,fullJointLogLoss:n?full/n:null,laneJointLogLoss:n?lane/n:null,jointLogLossGain:n?lane/n-full/n:null,fullMulticlassBrier:n?fullB/n:null,laneMulticlassBrier:n?laneB/n:null,multiclassBrierGain:n?laneB/n-fullB/n:null,market:{...m,selfAccuracy:ms?(m.bothCorrect+m.selfOnly)/ms:null,marketAccuracy:ms?(m.bothCorrect+m.marketOnly)/ms:null,accuracyDifference:ms?(m.selfOnly-m.marketOnly)/ms:null,marketBrier:null,marketLogLoss:null,phase:'final_or_unknown',evaluationOnly:true}};
}

const TRAIN_ORDER={
 nll_gain:(a,b)=>b.train.jointLogLossGain-a.train.jointLogLossGain||b.train.accuracy-a.train.accuracy||b.train.samples-a.train.samples||byText(a.id,b.id),
 hit_rate:(a,b)=>b.rankLower-a.rankLower||b.train.accuracy-a.train.accuracy||b.train.samples-a.train.samples||byText(a.id,b.id),
};
export function compareJointPatternTrainCandidates(track,a,b){const order=TRAIN_ORDER[track];if(!order)throw Error('invalid_joint_pattern_track');return order(a,b);}
const SELECTION_ORDER={
 nll_gain:(a,b)=>b.selection.jointLogLossGain-a.selection.jointLogLossGain||b.selection.accuracy-a.selection.accuracy||b.selection.samples-a.selection.samples||byText(a.id,b.id),
 hit_rate:(a,b)=>b.selection.wilsonLower-a.selection.wilsonLower||b.selection.accuracy-a.selection.accuracy||b.selection.samples-a.selection.samples||byText(a.id,b.id),
};
function* search(rows,eng,atoms,policy,track){
 const ex={attempted:0,supportPruned:0,redundantPruned:0,richRedundantPruned:0,duplicatePruned:0,conditionRemovalChecks:0,depthCounts:{},budgetReached:false,richCandidates:0,selectionInsufficient:0,selectionEvaluated:0,selectionEligible:0,selectionRejected:0,selectionRejectionReasons:{},maxRetainedNextMasks:0};
 const rich=[],seen=new Set(),perDepth=Math.floor(policy.maxCandidates/policy.maxDepth),penalty=Math.log(2*policy.maxCandidates/policy.alpha);
 let beam=[{atoms:[],id:'',mask:eng.all,train:{samples:eng.count(eng.all,eng.splits[0])}}];
 for(let depth=1;depth<=policy.maxDepth;depth++){
  const next=[];let used=0;
  // Rotate parents so a single high-scoring parent cannot exhaust a depth budget.
  outer:for(let atomIndex=0;atomIndex<atoms.length;atomIndex++)for(const parent of beam){
   const atom=atoms[atomIndex];if(parent.atoms.some(a=>a.feature===atom.feature))continue;
   const combined=[...parent.atoms,atom].sort((a,b)=>byText(a.id,b.id)),id=combined.map(a=>a.id).join('&');
   if(seen.has(id)){ex.duplicatePruned++;continue;}seen.add(id);
   if(used>=perDepth||ex.attempted>=policy.maxCandidates){ex.budgetReached=true;break outer;}
   used++;ex.attempted++;ex.depthCounts[depth]=(ex.depthCounts[depth]??0)+1;
   if(ex.attempted%128===0)yield {track,depth,attempted:ex.attempted};
   const mask=eng.and(parent.mask,eng.atomMask(atom)),train=light(rows,eng,mask,0);
   if(train.samples<policy.minTrain){ex.supportPruned++;continue;}
   if(train.samples===parent.train.samples){ex.redundantPruned++;continue;}
   const candidate={atoms:combined,id,groups:[...new Set(combined.map(a=>a.group))].sort(byText),depth,mask,train,rankLower:Math.max(0,train.accuracy-Math.sqrt(penalty/(2*train.samples)))};
   next.push(candidate);ex.maxRetainedNextMasks=Math.max(ex.maxRetainedNextMasks,next.length);
   if(next.length>=2*policy.beamWidth){next.sort(TRAIN_ORDER[track]);next.length=policy.beamWidth;}
   if(depth>=policy.minDepth&&candidate.groups.length>=policy.minGroups){const check=irreducibility(eng,combined,mask);ex.conditionRemovalChecks+=check.checks;if(check.irreducible)rich.push({...candidate,mask:null});else ex.richRedundantPruned++;}
  }
  next.sort(TRAIN_ORDER[track]);beam=next.slice(0,policy.beamWidth);if(!beam.length)break;
 }
 ex.richCandidates=rich.length;return {ex,rich};
}
function gate(metrics,min,policy){
 if(!metrics||metrics.samples<min)return {support:'insufficient',referenceCriteria:'insufficient',reasons:['support_insufficient']};
 const reasons=[];
 if(!(metrics.jointLogLossGain>=policy.minLogLossGain))reasons.push('joint_log_loss_gain_below_001');
 if(!(metrics.multiclassBrierGain>=0))reasons.push('multiclass_brier_not_better');
 if(!(metrics.ece<=policy.maxEce))reasons.push('calibration_error_above_003');
 if(!(metrics.probabilityStd>=policy.minProbabilityStd))reasons.push('probability_resolution_below_001');
 if(metrics.bins.some(b=>b.samples>=policy.minBinSupport&&b.absoluteError>policy.maxBinError))reasons.push('supported_probability_bin_error_above_005');
 return {support:'sufficient',referenceCriteria:reasons.length?'criteria_not_met':'reference_criteria_met',reasons};
}
function hitRateFloor(holdout,policy){if(!holdout||holdout.samples<policy.minHoldout)return {status:'insufficient',tier:null};return {status:holdout.wilson95.lower>=policy.hitRateFloor?'met':'not_met',tier:[.8,.7,.6,.5].find(t=>holdout.accuracy>=t)??'below_50_percent'};}

/** Exploratory condition research on a frozen joint model's per-row predictions. No order, wallet or network output. */
function* researchSteps(rows,overrides={}){
 const policy=policyOf(overrides,rows?.splits??JOINT_SPLITS);validateJointPatternDataset(rows);checkPatternSplits(rows,policy.splits);if(rows.size>policy.maxRows)throw Error('joint_pattern_row_limit');
 const eng=engineOf(rows),{atoms,registry,generatedAtoms,atomsDigest}=makeAtoms(rows,eng,policy),exploration={},frozen={},diagnostics={};
 for(const track of policy.tracks){
  const {ex,rich}=yield* search(rows,eng,atoms,policy,track),ranked=[];let selectedEvaluated=0;
  for(const candidate of rich){
   if(++selectedEvaluated%128===0)yield {track,phase:'selection',evaluated:selectedEvaluated};
   const mask=eng.maskOf(candidate.atoms),support=eng.count(mask,eng.splits[2]);ex.selectionEvaluated++;
   if(support<policy.minSelection){ex.selectionInsufficient++;continue;}
   const s=metricsOf(rows,eng,mask,2,policy),selectionGate=gate(s,policy.minSelection,policy);
   if(selectionGate.referenceCriteria!=='reference_criteria_met'){ex.selectionRejected++;for(const reason of selectionGate.reasons)ex.selectionRejectionReasons[reason]=(ex.selectionRejectionReasons[reason]??0)+1;continue;}
   ex.selectionEligible++;ranked.push({...candidate,selection:{samples:s.samples,hits:s.hits,accuracy:s.accuracy,jointLogLossGain:s.jointLogLossGain,wilsonLower:s.wilson95.lower}});
  }
  ranked.sort(SELECTION_ORDER[track]);const chosen=ranked.slice(0,policy.frozenPerTrack);
  // Digest is sealed before any holdout row is read.
  frozen[track]={chosen,omittedCandidates:rich.length-chosen.length,frozenDigest:digest({version:JOINT_PATTERN_RESEARCH_VERSION,policy,atomsDigest,track,candidates:chosen.map(c=>({id:c.id,conditions:c.atoms}))})};
  exploration[track]=ex;diagnostics[track]=[...rich].sort(TRAIN_ORDER[track]).slice(0,policy.diagnosticsPerTrack).map(c=>({id:c.id,groups:c.groups,conditions:c.atoms.map(a=>a.id),train:{samples:c.train.samples,hits:c.train.hits,accuracy:c.train.accuracy,jointLogLossGain:c.train.jointLogLossGain}}));
 }
 const ids=policy.tracks.map(track=>new Set(frozen[track].chosen.map(c=>c.id))),evaluated=new Map();
 const evaluate=c=>{let e=evaluated.get(c.id);if(e)return e;const mask=eng.maskOf(c.atoms),m=Object.fromEntries(PERIODS.map(p=>[p,metricsOf(rows,eng,mask,PERIOD_SPLIT[p],policy)])),monthly={};
  each(mask,eng.splits[3],i=>{const month=rows.dates[i].slice(0,7),entry=monthly[month]??={samples:0,hits:0,sumProbability:0,sumBinaryBrier:0},hit=rows.predictedTriple[i]===rows.actualTriple[i]?1:0;entry.samples++;entry.hits+=hit;entry.sumProbability+=rows.probability[i];entry.sumBinaryBrier+=(rows.probability[i]-hit)**2;});
  const holdoutMonthly=Object.fromEntries(Object.keys(monthly).sort(byText).map(k=>{const {samples,hits,sumProbability,sumBinaryBrier}=monthly[k],accuracy=hits/samples,meanProbability=sumProbability/samples;return [k,{samples,hits,accuracy,meanProbability,signedCalibrationError:meanProbability-accuracy,binaryBrier:sumBinaryBrier/samples,wilson95:wilsonJoint(hits,samples),support:samples>=policy.minHoldout?'sufficient':'insufficient'}];}));
  e={...m,holdoutMonthly,gates:{train:gate(m.train,policy.minTrain,policy),selection:gate(m.selection,policy.minSelection,policy),holdout:gate(m.holdout,policy.minHoldout,policy)},hitRateFloor:hitRateFloor(m.holdout,policy)};evaluated.set(c.id,e);return e;};
 const tracks=Object.fromEntries(policy.tracks.map(track=>[track,{frozenDigest:frozen[track].frozenDigest,candidates:frozen[track].chosen.map((c,k)=>{const e=evaluate(c);return {id:c.id,rank:k+1,conditions:c.atoms,groups:c.groups,depth:c.depth,frozenBeforeHoldout:true,train:compactMetrics(e.train),selection:compactMetrics(e.selection),holdout:compactMetrics(e.holdout),holdoutMonthly:e.holdoutMonthly,gates:e.gates,hitRateFloor:e.hitRateFloor,inBothTracks:ids.every(set=>set.has(c.id))};}),omittedCandidates:frozen[track].omittedCandidates}]));
 const splitCounts={train:eng.count(eng.all,eng.splits[0]),calibration:eng.count(eng.all,eng.splits[1]),selection:eng.count(eng.all,eng.splits[2]),holdout:eng.count(eng.all,eng.splits[3])};
 return {schemaVersion:1,version:JOINT_PATTERN_RESEARCH_VERSION,status:'complete',kind:'exploratory_reanalysis',
  dataset:{rows:rows.size,rowsDigest:rows.rowsDigest,splitCounts,memoryBytesEstimate:rows.memoryBytesEstimate},
  policy,policyDigest:digest(policy),registry,atoms,atomsDigest,generatedAtoms,exploration,
  binEdges:PROBABILITY_BIN_EDGES,binFormat:'samples_hits_meanProbability',
  baseline:Object.fromEntries(PERIODS.map(p=>[p,compactMetrics(metricsOf(rows,eng,eng.all,PERIOD_SPLIT[p],policy))])),
  tracks,diagnostics,
  unsupportedFeatureFamilies:['strictly_prior_rider_history','motor_lifecycle','tipster_archives','tidal_and_relative_wind','higher_order_prefix_interactions','all_other_inventory_candidates_not_implemented'],
  analysisReady:false,executionEvidencePassed:false,liveEligible:false,financialActions:0,networkRequests:0,
  limitations:['not_purchase_recommendations','no_profit_or_future_accuracy_guarantee','historical_timing_and_units_unverified','previously_observed_holdout_exploratory_reanalysis','adaptive_training_search_can_overfit','same_races_shared_across_candidates_not_independent_trials','all_374_inventory_candidates_not_used','small_probability_bins_not_verified','market_reference_evaluation_only']};
}

export function researchJointPatterns(rows,overrides={}){const steps=researchSteps(rows,overrides);for(;;){const next=steps.next();if(next.done)return next.value;}}

/** Server runtime yields between bounded work batches so cancellation/deadlines remain observable. */
export async function researchJointPatternsAsync(rows,overrides={}, {signal,deadlineMs=Infinity,now=Date.now,yieldControl=()=>new Promise(resolve=>setImmediate(resolve)),onProgress=()=>{}}={}){
 if(typeof deadlineMs!=='number'||Number.isNaN(deadlineMs)||typeof now!=='function'||typeof yieldControl!=='function'||typeof onProgress!=='function')throw Error('invalid_joint_pattern_control');
 const check=()=>{if(signal?.aborted)throw Error('joint_patterns_cancelled');if(now()>=deadlineMs)throw Error('joint_patterns_timeout');};
 const steps=researchSteps(rows,overrides);check();
 for(;;){const next=steps.next();check();if(next.done)return next.value;onProgress(next.value);await yieldControl();check();}
}
