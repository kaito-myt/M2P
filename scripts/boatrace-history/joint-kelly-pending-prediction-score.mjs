import {admitPendingDay} from './joint-kelly-prefit-pending-admission.mjs';
import {kellyPredictionDigest as Q} from './joint-kelly-prediction-port.mjs';
import {JOINT_COMBINATIONS} from './joint-model.mjs';

const bad=code=>{throw Error(`pending_prediction_score_${code}`);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const clipped=p=>Math.max(1e-12,Math.min(1-1e-12,p));

/** Scores already-admitted source-ready records. It does not authenticate source bytes or admit prices. */
export function scorePendingPredictionDay(args){
  if(typeof args?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(args.date)||new Date(`${args.date}T00:00:00.000Z`).toISOString().slice(0,10)!==args.date)bad('date');
  const admitted=admitPendingDay(args),{date,records}=args;
  const targets=new Map(records.targets.map(target=>[target.raceKey,target]));
  let scored=0,unknownTargets=0,top1Hits=0,top1Brier=0,top1Nll=0,uniformBrier=0,uniformNll=0;
  let selectedBrier=0,selectedNll=0,marketBrier=0,marketNll=0,marketCompared=0,marketMissing=0,marketMatchedModelBrier=0,marketMatchedModelNll=0,selectedHits=0,selectedProbability=0;
  const bins=Array.from({length:10},()=>({n:0,p:0,hits:0}));
  for(const row of records.decisions){
    const target=targets.get(row.raceKey);
    if(target.status!=='normal'){unknownTargets++;continue;}
    const p=row.rawProbabilities,w=target.winnerIndex;
    if(!Array.isArray(p)||p.length!==120||p.some(v=>!finite(v)||v<0||v>1)||!Number.isSafeInteger(w)||w<0||w>=120)bad('score_input');
    let brier=0;for(let i=0;i<120;i++)brier+=(p[i]-(i===w?1:0))**2;
    top1Brier+=brier;top1Nll-=Math.log(clipped(p[w]));uniformBrier+=119/120;uniformNll+=Math.log(120);
    const top=Math.max(...p);if(p.indexOf(top)===w)top1Hits++;
    const hit=row.tickets.includes(w)?1:0,pt=row.rawMass;
    if(!finite(pt)||pt<0||pt>1||target.hit!==hit)bad('selected_event');
    selectedHits+=hit;selectedProbability+=pt;selectedBrier+=(pt-hit)**2;
    selectedNll-=hit*Math.log(clipped(pt))+(1-hit)*Math.log(clipped(1-pt));
    if(row.marketMass===null)marketMissing++;
    else {const q=row.marketMass;if(!finite(q)||q<0||q>1)bad('market_proxy');marketCompared++;marketBrier+=(q-hit)**2;marketNll-=hit*Math.log(clipped(q))+(1-hit)*Math.log(clipped(1-q));marketMatchedModelBrier+=(pt-hit)**2;marketMatchedModelNll-=hit*Math.log(clipped(pt))+(1-hit)*Math.log(clipped(1-pt));}
    const bin=bins[Math.min(9,Math.floor(pt*10))];bin.n++;bin.p+=pt;bin.hits+=hit;scored++;
  }
  const mean=(n,total)=>n?total/n:null;
  return {
    version:'pending_prediction_diagnostic_v1',status:'REFERENCE_DIAGNOSTIC_ONLY',date,
    sourceReadyRows:admitted.count,predictionScoredRows:scored,unknownTargetRows:unknownTargets,
    selector:{a0Rows:admitted.a0,positiveReferenceRows:admitted.normalPotential},
    full120: {brier:mean(scored,top1Brier),nll:mean(scored,top1Nll),uniformBrier:mean(scored,uniformBrier),uniformNll:mean(scored,uniformNll),top1Accuracy:mean(scored,top1Hits)},
    selectedEvent:{n:scored,hitRate:mean(scored,selectedHits),meanProbability:mean(scored,selectedProbability),brier:mean(scored,selectedBrier),nll:mean(scored,selectedNll),bins:bins.map(b=>({n:b.n,meanProbability:mean(b.n,b.p),hitRate:mean(b.n,b.hits)}))},
    normalizedMarketProxy:{n:marketCompared,brier:mean(marketCompared,marketBrier),nll:mean(marketCompared,marketNll),isTruth:false,matchedModel:{n:marketCompared,brier:mean(marketCompared,marketMatchedModelBrier),nll:mean(marketCompared,marketMatchedModelNll)},priceMissing:{n:marketMissing,rate:mean(scored,marketMissing),denominator:'normal_target_rows'}},
    interpretation:{cohort:'source_ready_decision_target_pairs_only',plannedRaceCoverage:'not_established',featureTimingVerified:false,featureUnitsVerified:false,moneyUnitsVerified:false,priceAsOfVerified:false,calibrated:false,profitEvaluated:false,operationalQualified:false,financialActions:0,queueEligible:false,actualPurchase:false},
    decisionChain:admitted.chain,digest:Q({date,decisionChain:admitted.chain,sourceReadyRows:admitted.count,scored,unknownTargets,top1Hits,top1Brier,top1Nll,selectedHits,selectedProbability,selectedBrier,selectedNll,marketCompared,marketMissing,marketBrier,marketNll,marketMatchedModelBrier,marketMatchedModelNll,bins})
  };
}
