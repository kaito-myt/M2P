import {JOINT_NUMERIC_FIELDS, JOINT_CONTEXT_FIELDS} from './joint-dataset.mjs';
import {predictJoint, JOINT_COMBINATIONS, withJointTemperature} from './joint-model.mjs';
import {createRichFeaturePipeline} from './joint-rich-feature-pipeline.mjs';
import {createA0FrameAdapter} from './joint-kelly-a0-policy.mjs';
import {kellyPredictionDigest as H} from './joint-kelly-prediction-port.mjs';
import {formationMarketMass} from './joint-formation-calibration.mjs';
export const A0_COHORT_VERSION = 'boat_a0_prefit_cohort_v1';
const fail = x => {throw Error('a0_cohort_' + x);};
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const plain = x => x !== null && typeof x === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => {if (!plain(x) || Object.keys(x).sort().join('|') !== [...keys].sort().join('|')) fail('shape');};
const freeze = x => {if (x && typeof x === 'object' && !ArrayBuffer.isView(x)) {Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const at = x => {const n = typeof x === 'string' ? Date.parse(x) : NaN;if (!Number.isFinite(n) || new Date(n).toISOString() !== x) fail('clock');return n;};
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x+'T00:00:00.000Z')) && new Date(x+'T00:00:00.000Z').toISOString().slice(0,10) === x;
const phaseOf = date => date >= '2026-02-01' && date < '2026-03-01' ? 'calibration' : date >= '2026-04-01' && date < '2026-10-01' ? 'evaluation' : 'outside';
/** Exact native18x6+5 table extraction; never accesses current result/odds. */
export function extractA0NativeModelInput(race, decisionAt) {
  const decision = at(decisionAt);
  if (!Array.isArray(race.entries) || race.entries.length !== 6 || new Set(race.entries.map(e=>e.lane)).size !== 6 || race.entries.some(e=>!Number.isInteger(e.lane)||e.lane<1||e.lane>6)) fail('native_entries');
  const read = envelope => {
    if (envelope?.time === 'result_only') fail('known_future_native');
    if (envelope?.publishedAt !== null && envelope?.publishedAt !== undefined && at(envelope.publishedAt) > decision) fail('known_future_native');
    if (envelope?.valueState !== 'recorded' || !finite(envelope.value)) return NaN;
    const value = Math.fround(envelope.value);if (!Number.isFinite(value)) fail('native_overflow');return value;
  };
  const values = new Float32Array(108), context = new Float32Array(5);
  for (let lane=1;lane<=6;lane++) {const entry=race.entries.find(e=>e.lane===lane);JOINT_NUMERIC_FIELDS.forEach((f,i)=>{values[(lane-1)*18+i]=read((f.source==='preview'?entry.preview:entry.fields)?.[f.key]);});}
  JOINT_CONTEXT_FIELDS.forEach((f,i)=>{context[i]=read((f.source==='preview'?race.preview:race.context)?.[f.key]);});
  const gradeEnvelope=race.context?.grade_number;read(gradeEnvelope);
  const grade=gradeEnvelope?.valueState==='recorded'&&Number.isSafeInteger(gradeEnvelope.value)&&gradeEnvelope.value>=0&&gradeEnvelope.value<=32767?gradeEnvelope.value:-1;
  return {values,context,venue:race.venue,grade};
}
function inspectPrice(price, admission, decisionAt) {
  if (!plain(price) || price.status !== 'valid' || !['historical_final_or_unknown_not_T60','historical_final_proxy'].includes(price.basis)) return 'price_unavailable';
  if (!Array.isArray(price.odds)||price.odds.length!==120||price.odds.some(o=>!finite(o)||o<1)||!sha(price.snapshotDigest)) return 'price_incomplete';
  if (price.moneyUnitsVerified !== true || !sha(admission.moneyUnitEvidenceDigest) || price.unitEvidenceDigest !== admission.moneyUnitEvidenceDigest) return 'money_unverified';
  if (price.currency!=='JPY'||price.payoutUnitYen!==100||price.settlementRule!=='integer_per_100_yen_v1'||!Array.isArray(price.payoutPer100Yen)||price.payoutPer100Yen.length!==120||price.payoutPer100Yen.some((n,i)=>!Number.isSafeInteger(n)||n<100||Math.abs(n/100-price.odds[i])>1e-9*Math.max(1,price.odds[i]))) return 'money_invalid';
  // Historical final prices may be observed after decision; retain proxy provenance, never claim T60.
  if (price.observedAt !== 'unverified') at(price.observedAt);
  return null;
}
function targetOf(race,tickets) {
  const result=race.result;
  if (result?.state!=='normal'||!JOINT_COMBINATIONS.includes(result.winnerTriple)) return {status:'target_unresolved',winnerIndex:null,hit:null};
  const winnerIndex=JOINT_COMBINATIONS.indexOf(result.winnerTriple);return {status:'normal',winnerIndex,hit:tickets.includes(winnerIndex)?1:0};
}
export function createA0CohortGenerator({model,catalog,registry,schema,sourceBinding,expectedAdmissionDigest,verifyConfiguration,expectedA0AdmissionDigest,verifyConditionRace,verifyDay,snapshot=null}) {
  if (!sha(expectedAdmissionDigest)||typeof verifyConfiguration!=='function'||typeof verifyDay!=='function') fail('admission_required');
  let accepted;try {accepted=verifyConfiguration({model,catalog,registry,schema,sourceBinding,expectedAdmissionDigest});}catch{fail('configuration_verifier');}
  if (!plain(accepted)||accepted.model!==model||H(accepted.receipt)!==expectedAdmissionDigest) fail('independent_admission');
  const admission=structuredClone(accepted.receipt);
  exact(admission,['modelArtifactSHA','modelBodyDigest','modelDigest','featureSpecDigest','sourceDigest','schemaDigest','extractorDigest','policyDigest','selectorDigest','missingPolicyDigest','labelOrderVerified','modelInternalSelectionEnd','modelLabelUseEnd','codeDigest','moneyUnitEvidenceDigest']);
  if (!['modelArtifactSHA','modelBodyDigest','modelDigest','featureSpecDigest','sourceDigest','schemaDigest','extractorDigest','policyDigest','selectorDigest','missingPolicyDigest','codeDigest'].every(k=>sha(admission[k]))||!(admission.moneyUnitEvidenceDigest===null||sha(admission.moneyUnitEvidenceDigest))||admission.modelBodyDigest!==H(model)||admission.modelDigest!==withJointTemperature(model,model.temperature).modelDigest||admission.featureSpecDigest!==model.featureSpec.digest||model.featureSpec.fitRange.from!=='2025-10-01'||model.featureSpec.fitRange.to!=='2026-02-01'||admission.labelOrderVerified!==true||at(admission.modelInternalSelectionEnd)>Date.parse('2026-01-31T15:00:00.000Z')||at(admission.modelLabelUseEnd)>Date.parse('2026-01-31T15:00:00.000Z')||admission.sourceDigest!==sourceBinding.datasetDigest||admission.schemaDigest!==schema.schemaDigest||admission.extractorDigest!==schema.extractorDigest||schema.sourceDigest!==admission.sourceDigest) fail('configuration_binding');
  const owned=structuredClone(model),pipeline=createRichFeaturePipeline({catalog,registry,sourceBinding,snapshot}),adapter=createA0FrameAdapter({schema,expectedAdmissionDigest:expectedA0AdmissionDigest,verifyConditionRace});
  const counters={days:0,inputRows:0,sourceReady:0,a0True:0,quoteComplete:0,moneyVerified:0,targetNormal:0,eligible:0,reasons:{}},chain={eligible:H({version:A0_COHORT_VERSION,keys:[]}),decisions:H({version:A0_COHORT_VERSION,decisions:[]})};
  let previousDate=pipeline.state().lastCommittedDate,processing=false;
  const reason=x=>{counters.reasons[x]=(counters.reasons[x]??0)+1;};
  return Object.freeze({processDay({date,rows,dayReceipt,expectedDayAdmissionDigest}) {
    if (processing) fail('reentry');if (!day(date)||previousDate!==null&&date<=previousDate||!Array.isArray(rows)||rows.length>1000||!sha(expectedDayAdmissionDigest)) fail('day_order_or_budget');
    let verified;try{verified=verifyDay({date,rows,dayReceipt,expectedDayAdmissionDigest});}catch{fail('day_verifier');}
    if (!plain(verified)||verified.rows!==rows||verified.receipt!==dayReceipt||H(dayReceipt)!==expectedDayAdmissionDigest||dayReceipt.sourceDigest!==admission.sourceDigest||dayReceipt.date!==date||dayReceipt.inputRowsDigest!==H(rows.map(r=>({raceKey:r.normalizedRace?.raceKey,rawSha256:r.rawSha256,decisionAt:r.decisionAt,asOfByField:r.asOfByField,priceDigest:r.priceFrame?.snapshotDigest??null})))) fail('day_admission');
    const beforeCounters=structuredClone(counters),beforeChain={...chain};
    const keys=rows.map(r=>r.normalizedRace?.raceKey);if(keys.some((key,i)=>typeof key!=='string'||i>0&&key<=keys[i-1]))fail('source_key_order');
    processing=true;let prepared;
    try {
      prepared=pipeline.prepareDay({date,rows:rows.map(r=>({rawRace:r.rawRace,normalizedRace:r.normalizedRace,rawSha256:r.rawSha256}))});
      const decisions=[],pending=[],calibrationRows=[],targetRecords=[],excluded=[],eligibleKeys=[];
      const phase=phaseOf(date);
      for(const record of prepared.records) {
        const row=rows[record.inputIndex];if(record.status!=='ready'){excluded.push({raceKey:record.raceKey??null,reason:'source_not_ready'});continue;}
        const race=row.normalizedRace;const base={raceKey:record.raceKey,date,phase};
        let packet,raw,input,priceReason;
        try {
          if (new Date(at(row.decisionAt)+9*3600000).toISOString().slice(0,10)!==date) fail('decision_day');
          packet=adapter.adapt({conditionRace:record.conditionRace,decisionAt:row.decisionAt,asOfByField:row.asOfByField});
          input=extractA0NativeModelInput(race,row.decisionAt);raw=predictJoint(owned,input,{temperature:1});
          if(raw.temperature!==1||raw.combinations.some((v,i)=>v!==JOINT_COMBINATIONS[i])||raw.probabilities.length!==120||Array.from(raw.probabilities).some(p=>!finite(p)||p<0||p>1)||Math.abs(raw.sum-1)>1e-8) fail('raw_distribution');
          priceReason=inspectPrice(row.priceFrame,admission,row.decisionAt);
        } catch(error) {const code=/^(a0_|a0_cohort_)[a-z_]+$/.test(error.message)?error.message:'feature_or_model_invalid';excluded.push({...base,reason:code});continue;}
        const tickets=packet.selection.tickets,r=tickets.reduce((s,i)=>s+raw.probabilities[i],0);
        const quotesValid=Array.isArray(row.priceFrame?.odds)&&row.priceFrame.odds.length===120&&row.priceFrame.odds.every(o=>finite(o)&&o>=1);
        const resolvedOdds=priceReason===null?row.priceFrame.payoutPer100Yen.map(n=>n/100):row.priceFrame?.odds;
        const market=quotesValid?formationMarketMass(tickets.map(i=>JOINT_COMBINATIONS[i]),Object.fromEntries(JOINT_COMBINATIONS.map((t,i)=>[t,resolvedOdds[i]]))):null;
        const q=market?.q??null;
        const item=freeze({...base,decisionAt:row.decisionAt,modelInput:{values:Array.from(input.values),context:Array.from(input.context),venue:input.venue,grade:input.grade},policyFeatureFrame:packet.policyFeatures,tickets,unknownIndices:packet.selection.unknownIndices,unknownReasons:packet.diagnostics.originalReasons,rawTemperature:1,featureSpecDigest:admission.featureSpecDigest,modelCodeDigest:admission.codeDigest,featureTimingVerified:false,featureUnitsVerified:false,conditionAdmissionDigest:packet.diagnostics.expectedAdmissionDigest,rawProbabilities:Array.from(raw.probabilities),rawMass:r,marketMass:q,priceBasis:row.priceFrame?.basis??null,priceDigest:row.priceFrame?.snapshotDigest??null,resolvedPriceDigest:H({basis:row.priceFrame?.basis??null,odds:resolvedOdds??null,payoutPer100Yen:row.priceFrame?.payoutPer100Yen??null}),priceEligibilityReason:priceReason,modelArtifactSHA:admission.modelArtifactSHA,sourceDigest:admission.sourceDigest,policyDigest:admission.policyDigest,selectorDigest:admission.selectorDigest,featureDigest:record.conditionRace.featureDigest,operationalQualified:false,realAllocation:0});
        decisions.push(item);pending.push({row,item,packet,priceReason,quotesValid});
      }
      // Every current-day forecast is frozen before any target or history result is read.
      for(const {row,item,priceReason,quotesValid} of pending) {
        const target=targetOf(row.normalizedRace,item.tickets);targetRecords.push(freeze({raceKey:item.raceKey,date,...target,targetDigest:H({raceKey:item.raceKey,...target})}));
        let ineligible=phase==='outside'?'outside_fixed_windows':item.tickets.length===0?'empty_T':item.tickets.length===120?'full_T':item.rawMass<=0||item.rawMass>=1?'raw_mass_not_interior':priceReason??(item.marketMass===null||item.marketMass<=0||item.marketMass>=1?'market_mass_not_interior':target.status!=='normal'?'target_unresolved':null);
        if(quotesValid)counters.quoteComplete++;if(priceReason===null)counters.moneyVerified++;if(target.status==='normal')counters.targetNormal++;if(item.tickets.length)counters.a0True++;
        if(ineligible){excluded.push({raceKey:item.raceKey,date,phase,reason:ineligible});continue;}
        counters.eligible++;eligibleKeys.push(item.raceKey);chain.eligible=H({previous:chain.eligible,raceKey:item.raceKey,phase});
        if(phase==='calibration')calibrationRows.push(freeze({raceKey:item.raceKey,date,tickets:[...item.tickets],p:item.rawMass,q:item.marketMass,hit:target.hit,policyDigest:admission.policyDigest,modelArtifactSHA:admission.modelArtifactSHA,sourceDigest:admission.sourceDigest,priceDigest:item.priceDigest,targetDigest:targetRecords[targetRecords.length-1].targetDigest,moneyUnitEvidenceDigest:admission.moneyUnitEvidenceDigest}));
      }
      const acceptedRows=prepared.records.filter(r=>r.status==='ready').map(r=>rows[r.inputIndex].normalizedRace);
      const history=pipeline.commitDay({date,dayPacketDigest:prepared.digest,resultRaces:acceptedRows});
      decisions.sort((a,b)=>a.raceKey<b.raceKey?-1:a.raceKey>b.raceKey?1:0);calibrationRows.sort((a,b)=>a.raceKey<b.raceKey?-1:a.raceKey>b.raceKey?1:0);
      for(const item of decisions)chain.decisions=H({previous:chain.decisions,decision:H(item)});
      excluded.forEach(x=>reason(x.reason));counters.days++;counters.inputRows+=rows.length;counters.sourceReady+=acceptedRows.length;previousDate=date;
      return freeze({version:A0_COHORT_VERSION,date,phase,decisions,calibrationRows,targetRecords,excluded,eligibleKeys,eligibleKeysDigest:H(eligibleKeys),historyReceipt:history,summary:structuredClone(counters),orderedEligibleDigest:chain.eligible,decisionDigest:chain.decisions,operationalQualified:false,realAllocation:0});
    } catch(error) {if(prepared)pipeline.abortDay();Object.assign(counters,beforeCounters);Object.assign(chain,beforeChain);throw error;} finally {processing=false;}
  },prefitSummary(){return freeze({version:A0_COHORT_VERSION,...structuredClone(counters),orderedEligibleDigest:chain.eligible,decisionDigest:chain.decisions,lastDate:previousDate,fitAttempted:false,operationalQualified:false,realAllocation:0});},historySnapshot(){return pipeline.snapshot();}});
}
