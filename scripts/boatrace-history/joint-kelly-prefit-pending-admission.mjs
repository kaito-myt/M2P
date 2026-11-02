import {createHash} from 'node:crypto';
import {evaluateA0Frame} from './joint-kelly-a0-policy.mjs';
import {predictJoint} from './joint-model.mjs';
import {kellyPredictionDigest as Q} from './joint-kelly-prediction-port.mjs';
const R=b=>createHash('sha256').update(b).digest('hex'),bad=s=>{throw Error('pending_admission_'+s);};
export function authenticatePrefitManifest({publicBytes,manifestBytes,expected}){if(!expected||!/^[a-f0-9]{64}$/.test(expected.publicSHA)||!/^[a-f0-9]{64}$/.test(expected.manifestSHA)||R(publicBytes)!==expected.publicSHA||R(manifestBytes)!==expected.manifestSHA)bad('independent_pin');const report=JSON.parse(publicBytes),manifest=JSON.parse(manifestBytes);if(report.privateManifestSHA!==expected.manifestSHA||manifest.sourceDigest!==report.sourceDigest||!Array.isArray(manifest.outputs)||manifest.outputs.length>1024||new Set(manifest.outputs.map(x=>x.name)).size!==manifest.outputs.length||manifest.outputs.some(x=>!/^(?:source-admission|units-contract|sample-plan|money-audit|day-2026-(?:02|04|05|06|07|08|09)-\d{2}-\d{3})\.json$/.test(x.name)||!/^[a-f0-9]{64}$/.test(x.sha256)||!Number.isSafeInteger(x.bytes)||x.bytes<1||x.bytes>2*1024**2))bad('manifest_scope');return {manifest,report};}
function checkTicketIdentity(expected,actual){const valid=a=>Array.isArray(a)&&a.length<=120&&a.every((n,i)=>Number.isSafeInteger(n)&&n>=0&&n<120&&(i===0||n>a[i-1]));if(!valid(expected)||!valid(actual)||JSON.stringify(expected)!==JSON.stringify(actual))bad('source_T');}
export function admitPendingDay({date,records,model,schema,metadata,report,conditionReceipt,previousChain}){
 if(!Array.isArray(records.decisions)||!Array.isArray(records.targets)||records.decisions.length>288||records.targets.length>288||new Set(records.decisions.map(r=>r.raceKey)).size!==records.decisions.length||new Set(records.targets.map(r=>r.raceKey)).size!==records.targets.length||records.decisions.length!==records.targets.length)bad('day_bound');
 const targets=new Map(records.targets.map(t=>[t.raceKey,t]));let chain=previousChain,count=0,a0=0,normalPotential=0,previous='';const policyAPI={evaluateA0Frame},modelAPI={predictJoint};
 for(const r of records.decisions){
  if(r.date!==date||r.raceKey<=previous||r.modelArtifactSHA!==metadata.modelArtifactSha256||r.modelCodeDigest!==report.sourceDigest||r.sourceDigest!==metadata.datasetDigest||r.featureSpecDigest!==model.featureSpec.digest||r.rawTemperature!==1||r.conditionAdmissionDigest!==Q(conditionReceipt))bad('decision_binding');previous=r.raceKey;
  const selected=policyAPI.evaluateA0Frame({policyFeatures:r.policyFeatureFrame,schema,decisionAt:r.decisionAt});checkTicketIdentity(selected.tickets,r.tickets);const native={values:Float32Array.from(r.modelInput.values),context:Float32Array.from(r.modelInput.context),venue:r.modelInput.venue,grade:r.modelInput.grade},raw=modelAPI.predictJoint(model,native,{temperature:1});
  if(Q(Array.from(raw.probabilities))!==Q(r.rawProbabilities)||r.rawMass!==r.tickets.reduce((n,i)=>n+raw.probabilities[i],0))bad('raw_prediction');
  chain=Q({previous:chain,decision:Q(r)});count++;if(r.tickets.length)a0++;
  const t=targets.get(r.raceKey);if(!t||t.date!==date||t.targetDigest!==Q({raceKey:t.raceKey,status:t.status,winnerIndex:t.winnerIndex,hit:t.hit}))bad('target_digest');
  if(t.status==='normal'){if(!Number.isSafeInteger(t.winnerIndex)||t.winnerIndex<0||t.winnerIndex>=120||![0,1].includes(t.hit)||t.hit!==(r.tickets.includes(t.winnerIndex)?1:0))bad('target_mapping');}
  else if(t.status==='target_unresolved'){if(t.winnerIndex!==null||t.hit!==null)bad('target_unresolved_payload');}
  else bad('target_status');
  if(r.tickets.length>0&&r.tickets.length<120&&r.rawMass>0&&r.rawMass<1&&r.marketMass>0&&r.marketMass<1&&t.status==='normal'&&r.priceEligibilityReason==='money_unverified')normalPotential++;
 }
 return {chain,count,a0,normalPotential};
}
export function pendingNoFit(sourceSummary){return {status:'NO_FIT',reason:'independent_money_admission_adapter_not_implemented',sourceSummary,calibration:null,accounts:null,profit:null,nextAction:'implement_and_independently_review_inbox_money_admission_adapter',actualFit:0,operationalQualified:false,financialActions:0};}
