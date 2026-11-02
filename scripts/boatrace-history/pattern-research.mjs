import {createHash} from 'node:crypto';

export const PATTERN_RESEARCH_VERSION='boat_retrospective_accuracy_v1';
export const FORECAST_MODELS=['national','local','motor','exhibition','rank_consensus'];
export const DEFAULT_RESEARCH_POLICY=Object.freeze({maxRows:100000,maxCandidates:2048,maxAtoms:96,beamWidth:32,maxDepth:4,minDepth:2,minGroups:3,minTrain:200,minSelection:50,minHoldout:30,minGain:.01,maxCalibrationError:.05,alpha:.05,trainFrom:'2026-01-01',selectionFrom:'2026-05-26',holdoutFrom:'2026-07-26',holdoutTo:'2026-10-26'});
export const RESEARCH_FEATURES=Object.freeze([
 ['venue','venue','category'],['raceNumber','program','category'],['gradeCode','program','category'],['dayNumber','program','number'],['distance','program','category'],
 ['month','calendar','category'],['weekday','calendar','category'],['closingHourRaw','schedule','category'],
 ['windSpeed','weather','number'],['waveHeight','water','number'],['weatherCode','weather','category'],['windDirectionCode','weather','category'],['airTemperature','weather','number'],['waterTemperature','water','number'],
 ['nationalLeadGap','ability','number'],['nationalSpread','ability','number'],['localLeadGap','local_record','number'],['motorLeadGap','equipment','number'],['motorSpread','equipment','number'],
 ['exhibitionLeadGap','exhibition','number'],['minimumAverageST','start_record','number'],['averageSTSpread','start_record','number'],['flyingTotal','start_record','number'],
].map(([id,group,kind])=>Object.freeze({id,group,kind,unit:'unverified',time:'retrospective_unverified'})));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const triple=v=>typeof v==='string'&&/^[1-6]-[1-6]-[1-6]$/.test(v)&&new Set(v.split('-')).size===3;
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const value=(fields,key)=>{const field=fields?.[key];return field?.time!=='result_only'&&field?.valueState==='recorded'&&finite(field.value)?field.value:null;};
const spread=xs=>{if(!xs)return null;const mean=xs.reduce((s,v)=>s+v,0)/xs.length;return Math.sqrt(xs.reduce((s,v)=>s+(v-mean)**2,0)/xs.length);};
function values(entries,key,preview=false){const xs=entries.map(row=>value(preview?row.preview:row.fields,key));return xs.every(finite)?xs:null;}
function rank(entries,xs,ascending=false){if(!xs)return null;return entries.map((row,i)=>({lane:row.lane,value:xs[i]})).sort((a,b)=>(ascending?a.value-b.value:b.value-a.value)||a.lane-b.lane).map(row=>row.lane);}
const gap=(xs,ascending=false)=>xs?(()=>{const sorted=[...xs].sort((a,b)=>ascending?a-b:b-a);return Math.abs(sorted[0]-sorted[1]);})():null;

/** Discards all quote surfaces, original rows and names before server aggregation. */
export function compactResearchRace(race){
 const identity=typeof race?.raceKey==='string'&&race.raceKey.length<=120&&date(race.date)&&Number.isInteger(race.venue)&&race.venue>=1&&race.venue<=24&&Number.isInteger(race.raceNumber)&&race.raceNumber>=1&&race.raceNumber<=12;
 const entries=Array.isArray(race?.entries)&&race.entries.length===6&&new Set(race.entries.map(row=>row.lane)).size===6&&race.entries.every(row=>Number.isInteger(row.lane)&&row.lane>=1&&row.lane<=6)?[...race.entries].sort((a,b)=>a.lane-b.lane):[];
 const national=entries.length?values(entries,'national_win_rate'):null,local=entries.length?values(entries,'local_win_rate'):null,motor=entries.length?values(entries,'motor_top_2_percent'):null,exhibition=entries.length?values(entries,'exhibition_time',true):null,st=entries.length?values(entries,'average_start_timing'):null,flying=entries.length?values(entries,'flying_count'):null;
 const ranks={national:rank(entries,national),local:rank(entries,local),motor:rank(entries,motor),exhibition:rank(entries,exhibition,true)};
 const allRanks=Object.values(ranks),consensus=allRanks.every(Boolean)?entries.map(row=>({lane:row.lane,total:allRanks.reduce((sum,lanes)=>sum+lanes.indexOf(row.lane),0)})).sort((a,b)=>a.total-b.total||a.lane-b.lane).map(row=>row.lane):null;
 const forecasts=Object.fromEntries([...Object.entries(ranks),['rank_consensus',consensus]].map(([model,lanes])=>[model,lanes?lanes.slice(0,3).join('-'):null]));
 const rawHour=identity&&typeof race.deadlineRaw==='string'?race.deadlineRaw.match(new RegExp('^'+race.date+'[ T]([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d$')):null;
 const context={venue:identity?race.venue:null,raceNumber:identity?race.raceNumber:null,gradeCode:value(race?.context,'grade_number'),dayNumber:value(race?.context,'day_number'),distance:value(race?.context,'distance'),month:identity?Number(race.date.slice(5,7)):null,weekday:identity?new Date(race.date+'T00:00:00Z').getUTCDay():null,closingHourRaw:rawHour?Number(rawHour[1]):null,windSpeed:value(race?.preview,'wind_speed'),waveHeight:value(race?.preview,'wave_height'),weatherCode:value(race?.preview,'weather_number'),windDirectionCode:value(race?.preview,'wind_direction_number'),airTemperature:value(race?.preview,'air_temperature'),waterTemperature:value(race?.preview,'water_temperature'),nationalLeadGap:gap(national),nationalSpread:spread(national),localLeadGap:gap(local),motorLeadGap:gap(motor),motorSpread:spread(motor),exhibitionLeadGap:gap(exhibition,true),minimumAverageST:st?Math.min(...st):null,averageSTSpread:spread(st),flyingTotal:flying?flying.reduce((s,v)=>s+v,0):null};
 const actualTriple=race?.result?.state==='normal'&&triple(race.result.winnerTriple)?race.result.winnerTriple:null;
 const eligible=Boolean(identity&&entries.length===6&&race.quality?.normalStructure===true&&actualTriple);
 return {key:identity?race.raceKey:null,date:identity?race.date:null,context,forecasts,actualTriple:eligible?actualTriple:null,eligible,actualResultState:typeof race?.result?.state==='string'?race.result.state:'unknown',labelReason:!identity?'invalid_identity':entries.length!==6?'invalid_entries':!actualTriple?'normal_label_unavailable':race.quality?.normalStructure!==true?'normal_structure_unavailable':null};
}

function policyOf(overrides){
 if(overrides===null||typeof overrides!=='object'||Array.isArray(overrides)||Object.keys(overrides).some(key=>!Object.hasOwn(DEFAULT_RESEARCH_POLICY,key)))throw Error('invalid_research_policy');
 const policy={...DEFAULT_RESEARCH_POLICY,...overrides};
 for(const [key,max] of [['maxRows',100000],['maxCandidates',2048],['maxAtoms',512],['beamWidth',32],['maxDepth',4],['minDepth',4],['minGroups',4],['minTrain',100000],['minSelection',100000],['minHoldout',100000]])if(!Number.isSafeInteger(policy[key])||policy[key]<1||policy[key]>max)throw Error('invalid_research_policy');
 if(policy.maxCandidates<FORECAST_MODELS.length*policy.maxDepth||policy.minDepth>policy.maxDepth||policy.minGroups>policy.maxDepth)throw Error('invalid_research_policy');
 for(const key of ['minGain','maxCalibrationError','alpha'])if(!finite(policy[key])||policy[key]<0||policy[key]>=1||key==='alpha'&&policy[key]===0)throw Error('invalid_research_policy');
 if(![policy.trainFrom,policy.selectionFrom,policy.holdoutFrom,policy.holdoutTo].every(date)||!(policy.trainFrom<policy.selectionFrom&&policy.selectionFrom<policy.holdoutFrom&&policy.holdoutFrom<policy.holdoutTo))throw Error('invalid_research_split');
 return policy;
}
function wilson(hits,n){if(!n)return {lower:null,upper:null};const z=1.959963984540054,p=hits/n,d=1+z*z/n,mid=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return {lower:Math.max(0,mid-half),upper:Math.min(1,mid+half)};}
function metrics(hits,n,p=null){
 const accuracy=n?hits/n:null,interval95=wilson(hits,n),q=p===null?null:Math.max(1e-9,Math.min(1-1e-9,p));
 return {samples:n,hits,accuracy,interval95,predictedProbability:p,absoluteCalibrationError:n&&p!==null?Math.abs(accuracy-p):null,brier:n&&p!==null?(hits*(1-p)**2+(n-hits)*p*p)/n:null,logLoss:n&&q!==null?-(hits*Math.log(q)+(n-hits)*Math.log1p(-q))/n:null,calibrationIntervalContainsPrediction:n&&p!==null?p>=interval95.lower&&p<=interval95.upper:null};
}
function observed(row,model){return row.eligible===true&&triple(row.actualTriple)&&triple(row.forecasts?.[model]);}
function matches(row,atoms){return atoms.every(atom=>{const v=row.context?.[atom.feature];return finite(v)&&(atom.op==='eq'?v===atom.value:atom.op==='lte'?v<=atom.value:v>atom.value);});}
function count(rows,model,atoms=[]){let samples=0,hits=0;for(const row of rows)if(observed(row,model)&&matches(row,atoms)){samples++;if(row.forecasts[model]===row.actualTriple)hits++;}return {samples,hits};}
export function checkTrainIrreducibility(rows,model,atoms){
 const samples=count(rows,model,atoms).samples;let checks=0;
 if(!samples)return {irreducible:false,checks,samples};
 for(let i=0;i<atoms.length;i++){
  const remaining=atoms.filter((_,index)=>index!==i);let removedSamples=0;checks++;
  // Keep the same complete-case population: missingness alone is not a condition group.
  for(const row of rows)if(observed(row,model)&&atoms.every(atom=>finite(row.context?.[atom.feature]))&&matches(row,remaining))removedSamples++;
  if(removedSamples===samples)return {irreducible:false,checks,samples};
 }
 return {irreducible:true,checks,samples};
}
function scoreCandidate(rows,model,atoms,policy){const {samples,hits}=count(rows,model,atoms);return {id:model+'|'+atoms.map(a=>a.id).join('&'),model,atoms,groups:[...new Set(atoms.map(a=>a.group))].sort(),train:metrics(hits,samples),rankLower:samples?Math.max(0,hits/samples-Math.sqrt(Math.log(2*policy.maxCandidates/policy.alpha)/(2*samples))):0};}
const order=(a,b)=>b.rankLower-a.rankLower||b.train.samples-a.train.samples||a.id.localeCompare(b.id);
function makeAtoms(train,policy){
 const grouped=new Map(),fieldCoverage=[];
 for(const feature of RESEARCH_FEATURES){const xs=train.filter(row=>row.eligible).map(row=>row.context?.[feature.id]).filter(finite);fieldCoverage.push({id:feature.id,group:feature.group,trainNonNull:xs.length,unit:'unverified',timingVerified:false});if(!xs.length)continue;
  const values=feature.kind==='category'?[...new Set(xs)].sort((a,b)=>a-b):(()=>{xs.sort((a,b)=>a-b);return [...new Set([.25,.5,.75].map(q=>xs[Math.floor((xs.length-1)*q)]))];})();
  const group=grouped.get(feature.group)??[];
  for(const v of values)for(const op of feature.kind==='category'?['eq']:['lte','gt']){
   const test=x=>op==='eq'?x===v:op==='lte'?x<=v:x>v;
   if(xs.some(test)&&xs.some(x=>!test(x)))group.push({id:feature.id+':'+op+':'+v,feature:feature.id,group:feature.group,op,value:v});
  }
  grouped.set(feature.group,group);
 }
 const atoms=[],groups=[...grouped.keys()].sort();let index=0;while(atoms.length<policy.maxAtoms){let added=false;for(const group of groups){const atom=grouped.get(group)[index];if(atom&&atoms.length<policy.maxAtoms){atoms.push(atom);added=true;}}if(!added)break;index++;}
 return {atoms,fieldCoverage,generatedAtoms:[...grouped.values()].reduce((s,a)=>s+a.length,0)};
}
function evaluate(rows,candidate){const result=count(rows,candidate.model,candidate.atoms);return metrics(result.hits,result.samples,candidate.train.accuracy);}

/** Finite retrospective accuracy research. This API has no order or wallet output. */
export function researchRetrospective(input,overrides={}){
 const policy=policyOf(overrides);if(!Array.isArray(input)||input.length>policy.maxRows)throw Error('research_row_limit');
 const keys=new Map();for(const row of input)if(typeof row?.key==='string')keys.set(row.key,(keys.get(row.key)??0)+1);
 const rows=input.filter(row=>row&&date(row.date)&&typeof row.key==='string'&&keys.get(row.key)===1&&row.date>=policy.trainFrom&&row.date<policy.holdoutTo);
 const train=rows.filter(row=>row.date<policy.selectionFrom),selection=rows.filter(row=>row.date>=policy.selectionFrom&&row.date<policy.holdoutFrom),holdout=rows.filter(row=>row.date>=policy.holdoutFrom);
 const {atoms,fieldCoverage,generatedAtoms}=makeAtoms(train,policy),baselines=Object.fromEntries(FORECAST_MODELS.map(model=>{const t=count(train,model),p=t.samples?t.hits/t.samples:null,s=count(selection,model),h=count(holdout,model);return [model,{train:metrics(t.hits,t.samples),selection:metrics(s.hits,s.samples,p),holdout:metrics(h.hits,h.samples,p)}];}));
 const candidates=[],exploration={attempted:0,supportPruned:0,redundantPruned:0,richRedundantPruned:0,conditionRemovalChecks:0,duplicatePruned:0,depthCounts:{},budgetReached:false,perModel:{}};
 const perModel=Math.floor(policy.maxCandidates/FORECAST_MODELS.length),perDepth=Math.floor(perModel/policy.maxDepth);
 for(const model of FORECAST_MODELS){let beam=[{atoms:[],id:model,train:baselines[model].train}],attempted=0;const seen=new Set();
  for(let depth=1;depth<=policy.maxDepth;depth++){
   const next=[];let used=0;
   // Rotate parents so a single high-scoring parent cannot exhaust a depth budget.
   outer:for(let atomIndex=0;atomIndex<atoms.length;atomIndex++)for(const parent of beam){
    const atom=atoms[atomIndex];if(parent.atoms.some(a=>a.feature===atom.feature))continue;
    const combined=[...parent.atoms,atom].sort((a,b)=>a.id.localeCompare(b.id)),id=combined.map(a=>a.id).join('&');
    if(seen.has(id)){exploration.duplicatePruned++;continue;}seen.add(id);
    if(used>=perDepth||attempted>=perModel||exploration.attempted>=policy.maxCandidates){exploration.budgetReached=true;break outer;}
    used++;attempted++;exploration.attempted++;exploration.depthCounts[depth]=(exploration.depthCounts[depth]??0)+1;
    const candidate=scoreCandidate(train,model,combined,policy);if(candidate.train.samples<policy.minTrain){exploration.supportPruned++;continue;}if(candidate.train.samples===parent.train.samples){exploration.redundantPruned++;continue;}
    next.push(candidate);
    if(depth>=policy.minDepth&&candidate.groups.length>=policy.minGroups){const check=checkTrainIrreducibility(train,model,combined);exploration.conditionRemovalChecks+=check.checks;if(check.irreducible)candidates.push(candidate);else exploration.richRedundantPruned++;}
   }
   next.sort(order);beam=next.slice(0,policy.beamWidth);if(!beam.length)break;
  }
  exploration.perModel[model]=attempted;
 }
 candidates.sort(order);let frozen=null,selectedMetrics=null;const selectionReasons={};
 for(const candidate of candidates){
  const stats=evaluate(selection,candidate),base=baselines[candidate.model];let reason=null;
  if(candidate.train.accuracy<(base.train.accuracy??1)+policy.minGain)reason='train_accuracy_gain_insufficient';
  else if(stats.samples<policy.minSelection)reason='selection_support_insufficient';
  else if(stats.absoluteCalibrationError>policy.maxCalibrationError)reason='selection_calibration_error';
  else if(stats.accuracy<(base.selection.accuracy??1)+policy.minGain)reason='selection_accuracy_gain_insufficient';
  if(reason){selectionReasons[reason]=(selectionReasons[reason]??0)+1;continue;}
  if(!frozen||stats.interval95.lower>selectedMetrics.interval95.lower||stats.interval95.lower===selectedMetrics.interval95.lower&&(stats.samples>selectedMetrics.samples||stats.samples===selectedMetrics.samples&&candidate.id<frozen.id)){frozen=candidate;selectedMetrics=stats;}
 }
 const frozenCandidate=frozen?{id:frozen.id,model:frozen.model,conditions:frozen.atoms,groups:frozen.groups,predictedProbability:frozen.train.accuracy,train:frozen.train,selection:selectedMetrics,frozenBeforeHoldout:true}:null;
 const frozenDigest=digest({version:PATTERN_RESEARCH_VERSION,policy,atoms,frozenCandidate});
 const holdoutStats=frozen?evaluate(holdout,frozen):null,monthly={};
 if(frozen)for(const row of holdout)if(observed(row,frozen.model)&&matches(row,frozen.atoms)){const month=row.date.slice(0,7),entry=monthly[month]??={samples:0,hits:0};entry.samples++;if(row.forecasts[frozen.model]===row.actualTriple)entry.hits++;}
 const holdoutReasons=[];if(holdoutStats){if(holdoutStats.samples<policy.minHoldout)holdoutReasons.push('holdout_support_insufficient');if(holdoutStats.absoluteCalibrationError>policy.maxCalibrationError)holdoutReasons.push('holdout_calibration_error');if(holdoutStats.accuracy<(baselines[frozen.model].holdout.accuracy??1)+policy.minGain)holdoutReasons.push('holdout_accuracy_gain_insufficient');}
 const featureUsage=fieldCoverage.map(field=>({...field,atoms:atoms.filter(a=>a.feature===field.id).length,selectionNonNull:selection.filter(row=>row.eligible&&finite(row.context?.[field.id])).length,holdoutNonNull:holdout.filter(row=>row.eligible&&finite(row.context?.[field.id])).length}));
 const labelReasons={},resultStates={};for(const row of rows){if(!row.eligible){const reason=row.labelReason??'unavailable';labelReasons[reason]=(labelReasons[reason]??0)+1;}const state=row.actualResultState??'unknown';resultStates[state]=(resultStates[state]??0)+1;}
 return {schemaVersion:1,version:PATTERN_RESEARCH_VERSION,target:'exact_ordered_top_three_match',status:frozen?'evaluated':'no_candidate',policy,policyDiffersFromDefault:Object.keys(policy).some(k=>policy[k]!==DEFAULT_RESEARCH_POLICY[k]),scope:'retrospective_accuracy_only',population:'resolved_normal_structure_and_available_predictors_not_all_races',coverage:{inputRows:input.length,uniqueInPeriodRows:rows.length,duplicateInputRows:input.filter(row=>typeof row?.key==='string'&&keys.get(row.key)>1).length,excludedInputRows:input.length-rows.length,eligibleRows:rows.filter(row=>row.eligible).length,labelExclusions:labelReasons,resultStates,trainRows:train.length,selectionRows:selection.length,holdoutRows:holdout.length},featureUsage,forecastModels:FORECAST_MODELS,baselines,atoms,atomsDigest:digest(atoms),exploration:{...exploration,generatedAtoms,usedAtoms:atoms.length,richCandidates:candidates.length,selectionReasons,adaptiveSearchCoverage:'bounded_not_exhaustive',intervals:'nominal_wilson_95_not_simultaneous',rankingCorrection:'hoeffding_family_size_proxy_not_adaptive_search_guarantee'},frozenCandidate,frozenDigest,holdout:{status:!frozen?'not_run':holdoutReasons.length?'criteria_not_met':'reference_criteria_met',metrics:holdoutStats,reasons:!frozen?['no_frozen_candidate']:holdoutReasons,monthly:Object.fromEntries(Object.entries(monthly).map(([month,s])=>[month,metrics(s.hits,s.samples,frozen.train.accuracy)])),tier:holdoutStats?.accuracy===null||!holdoutStats?null:[.8,.7,.6,.5].find(t=>holdoutStats.accuracy>=t)??'below_50_percent'},diagnostics:candidates.slice(0,24).map(c=>({id:c.id,groups:c.groups,conditions:c.atoms,train:c.train,rankLower:c.rankLower})),unsupportedFeatureFamilies:['individual_race_joint_probability_model','strictly_prior_rider_history','motor_lifecycle','tipster_archives','tidal_and_relative_wind','all_other_inventory_candidates_not_implemented'],formalWindows:{months3:'reference_only',months6:'not_run',months9:'not_run',months12:'not_run',reason:'history_before_frozen_cutoff_insufficient'},analysisReady:false,executionEvidencePassed:false,liveEligible:false,financialActions:0,limitations:['not_purchase_recommendations','no_profit_or_future_accuracy_guarantee','raw_units_and_meanings_unverified','historical_pre_deadline_timing_unverified','fixed_rank_baselines_not_trained_joint_ml','same_races_shared_across_models_not_independent_trials','adaptive_training_search_can_overfit','holdout_is_reference_and_becomes_observed_after_this_run','all_374_inventory_candidates_not_used','missing_predictors_or_labels_excluded_not_losses','outcome_conditioned_eligibility_not_full_field_accuracy']};
}
