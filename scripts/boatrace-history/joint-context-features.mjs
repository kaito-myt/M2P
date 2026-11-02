import {createHash} from 'node:crypto';
export const CONTEXT_FEATURE_VERSION='boat_context_features_v3';
export const CONTEXT_FEATURES=Object.freeze([
 {id:'venue',kind:'category'},{id:'grade',kind:'category'},
 ...['wind','wave','airTemperature','waterTemperature','dayNumber','nationalWinGap','localWinGap','motorLeadGap','boatLeadGap','startTimingGap','exhibitionGap','maxFlying','maxLate','headEntropy','headMargin','headProbability'].map(id=>({id,kind:'numeric'})),
].map(Object.freeze));
export const FIRST_STAGE_CONTEXTS=Object.freeze(['venue','grade','wind','wave','nationalWinGap','motorLeadGap','headEntropy','headMargin']);
export const CONTEXT_INTERACTIONS=Object.freeze([['nationalWinGap','headEntropy'],['motorLeadGap','headEntropy'],['venue','wind'],['grade','headMargin'],['wind','wave'],['nationalWinGap','motorLeadGap']].map(Object.freeze));
const finite=v=>typeof v==='number'&&Number.isFinite(v),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export function contextFeatures(input,prediction){
 if(input?.values?.length!==108||input?.context?.length!==5||prediction?.combinations?.length!==120||prediction?.probabilities?.length!==120)throw Error('context_input_invalid');
 const values={},missing={},record=(key,value,reason='not_recorded_finite')=>{values[key]=finite(value)?value:null;if(values[key]===null)missing[key]=reason;};
 record('venue',Number.isInteger(input.venue)&&input.venue>=1&&input.venue<=24?input.venue:null,'venue_identity_invalid');record('grade',Number.isInteger(input.grade)&&input.grade>=0?input.grade:null,'grade_code_missing');
 ['wind','wave','airTemperature','waterTemperature','dayNumber'].forEach((name,i)=>record(name,input.context[i]));
 const column=i=>Array.from({length:6},(_,lane)=>input.values[lane*18+i]),gap=i=>{const v=column(i);return v.every(finite)?v.sort((a,b)=>b-a)[0]-v[1]:null;},maximum=i=>{const v=column(i);return v.every(finite)?Math.max(...v):null;};
 for(const [name,index]of [['nationalWinGap',0],['localWinGap',1],['motorLeadGap',6],['boatLeadGap',8],['startTimingGap',10],['exhibitionGap',15]])record(name,gap(index),'incomplete_six_boat_values');record('maxFlying',maximum(11),'incomplete_six_boat_values');record('maxLate',maximum(12),'incomplete_six_boat_values');
 const head=Array(6).fill(0);let sum=0;const seen=new Set();for(let i=0;i<120;i++){const triple=prediction.combinations[i],p=prediction.probabilities[i];if(typeof triple!=='string'||!/^([1-6])-([1-6])-([1-6])$/.test(triple)||new Set(triple.split('-')).size!==3||seen.has(triple)||!finite(p)||p<0||p>1)throw Error('context_distribution_invalid');seen.add(triple);head[Number(triple[0])-1]+=p;sum+=p;}if(Math.abs(sum-1)>1e-8)throw Error('context_distribution_invalid');head.sort((a,b)=>b-a);record('headEntropy',-head.reduce((n,p)=>n+(p>0?p*Math.log(p):0),0)/Math.log(6));record('headMargin',head[0]-head[1]);record('headProbability',head[0]);
 return {version:CONTEXT_FEATURE_VERSION,values,missing,evidence:{numericUnits:'source_native_unconverted_research_only',gradeMeaning:'source_code_uninterpreted',historicalTiming:'unverified',resultFieldsRead:false}};
}
export function fitContextBoundaries(rows,{from,to,resolution='quartiles'}){
 if(!['median','quartiles'].includes(resolution))throw Error('context_boundary_resolution_invalid');const quantiles=resolution==='median'?[.5]:[.25,.5,.75];
 if(!Array.isArray(rows)||!rows.length||!validDate(from)||!validDate(to)||from>=to)throw Error('context_training_range_invalid');
 for(const row of rows)if(!validDate(row.date)||row.date<from||row.date>=to||row.features?.version!==CONTEXT_FEATURE_VERSION)throw Error('context_training_phase_leakage');
 const fields={};for(const feature of CONTEXT_FEATURES){const values=rows.map(row=>row.features.values[feature.id]).filter(finite).sort((a,b)=>a-b),unique=[...new Set(values)];fields[feature.id]={kind:feature.kind,observed:values.length,missing:rows.length-values.length,...(feature.kind==='category'?{categories:unique.length<=32?unique:[],unavailable:unique.length>32?'categorical_cardinality_limit':null}:{thresholds:values.length?[...new Set(quantiles.map(q=>values[Math.floor((values.length-1)*q)]))]:[]})};}
 const body={version:CONTEXT_FEATURE_VERSION,from,to,resolution,rows:rows.length,fields};return {...body,digest:hash(body)};
}
export function contextBin(boundaries,features,field){const definition=boundaries?.fields?.[field],value=features?.values?.[field];if(boundaries?.version!==CONTEXT_FEATURE_VERSION||features?.version!==CONTEXT_FEATURE_VERSION||!definition)throw Error('context_boundary_invalid');if(!finite(value))return null;if(definition.kind==='category')return definition.categories.includes(value)?'c'+value:null;if(!definition.observed)return null;return 'q'+definition.thresholds.filter(threshold=>value>threshold).length;}
