import {calibratedFormationProbability} from './joint-formation-calibration.mjs';
import {contextBin,CONTEXT_FEATURE_VERSION} from './joint-context-features.mjs';
export const CONTEXT_CALIBRATION_POLICY=Object.freeze({version:'boat_context_calibration_v3',minimumLeaf:200,priorStrength:200,maxDepth:2,probabilityClip:1e-6});
const clip=p=>Math.min(1-1e-6,Math.max(1e-6,p)),logit=p=>Math.log(clip(p)/(1-clip(p))),sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const key=(boundaries,row,fields)=>{const bins=fields.map(field=>contextBin(boundaries,row.features,field));return bins.some(bin=>bin===null)?null:bins.join('|');};
function fittedGroups(rows,boundaries,fields,predict,priorStrength){const groups=new Map();for(const row of rows){const bin=key(boundaries,row,fields);if(bin===null)continue;const p=predict(row);let group=groups.get(bin);if(!group){group={samples:0,hits:0,predictedHits:0};groups.set(bin,group);}group.samples++;group.hits+=row.hit;group.predictedHits+=p;}return Object.fromEntries([...groups].sort(([a],[b])=>a.localeCompare(b)).map(([bin,g])=>{const mean=g.predictedHits/g.samples,supported=g.samples>=200,posterior=(g.hits+priorStrength*mean)/(g.samples+priorStrength);return [bin,{...g,supported,priorMean:mean,posteriorMean:posterior,offset:supported?logit(posterior)-logit(mean):0,fallbackReason:supported?null:'calibration_leaf_below_200'}];}));}
/** Labels from calibration only; money and payouts are not read. */
export function fitContextCalibration(rows,{from,to,boundaries,globalModel,fields,priorStrength=200}){
 if(![50,200,800].includes(priorStrength))throw Error("context_prior_strength_invalid");
 if(!validDate(from)||!validDate(to)||from>=to||!validDate(boundaries?.from)||!validDate(boundaries?.to)||boundaries.from>=boundaries.to||boundaries.to>from||globalModel?.from!==from||globalModel?.to!==to)throw Error('context_calibration_range_or_global_phase_invalid');
 if(!Array.isArray(rows)||rows.length<200||!Array.isArray(fields)||fields.length<1||fields.length>2||new Set(fields).size!==fields.length||fields.some(f=>!boundaries?.fields?.[f])||boundaries.version!==CONTEXT_FEATURE_VERSION)throw Error('context_calibration_input_invalid');
 for(const row of rows)if(!validDate(row.date)||row.date<from||row.date>=to||row.features?.version!==CONTEXT_FEATURE_VERSION||![0,1].includes(row.hit))throw Error('context_calibration_phase_leakage');
 const global=row=>calibratedFormationProbability(globalModel,{date:row.date,p:row.p,q:row.q}),first=fittedGroups(rows,boundaries,fields.slice(0,1),global,priorStrength),parent=row=>{const bin=key(boundaries,row,fields.slice(0,1)),group=first[bin];return sigmoid(logit(global(row))+(group?.offset??0));},second=fields.length===2?fittedGroups(rows,boundaries,fields,parent,priorStrength):null;
 return {version:CONTEXT_CALIBRATION_POLICY.version,policy:{...CONTEXT_CALIBRATION_POLICY,priorStrength},from,to,samples:rows.length,boundaryDigest:boundaries.digest,fields:[...fields],globalModel,first,second,approximation:'event_mass_only_with_original_within_package_ratios'};
}
export function predictContextProbability(model,row,boundaries){
 if(model?.version!==CONTEXT_CALIBRATION_POLICY.version||model.boundaryDigest!==boundaries?.digest||!Array.isArray(model.fields)||model.fields.length<1||model.fields.length>2)throw Error('context_model_version_or_boundary_mismatch');
 const globalProbability=calibratedFormationProbability(model.globalModel,{date:row.date,p:row.p,q:row.q}),firstKey=key(boundaries,row,model.fields.slice(0,1)),first=firstKey===null?null:model.first[firstKey],firstP=sigmoid(logit(globalProbability)+(first?.offset??0)),secondKey=model.fields.length===2?key(boundaries,row,model.fields):null,second=secondKey===null?null:model.second?.[secondKey],probability=sigmoid(logit(firstP)+(second?.offset??0));
 return {version:CONTEXT_CALIBRATION_POLICY.version,probability,globalProbability,firstKey,conditionKey:model.fields.length===2?secondKey:firstKey,firstSupported:first?.supported===true,leafSupported:(model.fields.length===2?second:first)?.supported===true,calibrationLeafSamples:(model.fields.length===2?second:first)?.samples??0,fallbackReason:(model.fields.length===2?second:first)?.fallbackReason??((model.fields.length===2?secondKey:firstKey)===null?'context_missing_or_unseen':'context_leaf_not_observed')};
}


