/** Retrospective coverage comparison. Never creates or submits an order. */
export const COVERAGE_POLICY=Object.freeze({version:'boat_ticket_coverage_v1',topCounts:Object.freeze([1,2,3,5,10,20]),formations:Object.freeze([1,2]),selection:'probability_only_before_outcome',financialActions:0});
const validTriple=s=>typeof s==='string'&&/^[1-6]-[1-6]-[1-6]$/.test(s)&&new Set(s.split('-')).size===3;
const finite=Number.isFinite;
export function coverageSets(combinations,probabilities){
 if(!Array.isArray(combinations)||combinations.length!==120||new Set(combinations).size!==120||combinations.some(s=>!validTriple(s))||probabilities?.length!==120)throw Error('invalid_coverage_distribution');
 let sum=0;const ranked=combinations.map((triple,i)=>{const p=probabilities[i];if(typeof p!=='number'||!finite(p)||p<0||p>1)throw Error('invalid_coverage_distribution');sum+=p;return {triple,p};});
 if(Math.abs(sum-1)>1e-8)throw Error('invalid_coverage_distribution');
 ranked.sort((a,b)=>b.p-a.p||a.triple.localeCompare(b.triple));
 const sets=COVERAGE_POLICY.topCounts.map(k=>({id:'top_'+k,triples:ranked.slice(0,k).map(x=>x.triple)}));
 const first=Array.from({length:6},(_,i)=>({lane:String(i+1),p:ranked.filter(x=>x.triple[0]===String(i+1)).reduce((n,x)=>n+x.p,0)})).sort((a,b)=>b.p-a.p||a.lane.localeCompare(b.lane));
 for(const heads of COVERAGE_POLICY.formations){
  const triples=[];
  for(const {lane} of first.slice(0,heads)){
   const seconds=first.filter(x=>x.lane!==lane).map(x=>({lane:x.lane,p:ranked.filter(t=>t.triple[0]===lane&&t.triple[2]===x.lane).reduce((n,t)=>n+t.p,0)})).sort((a,b)=>b.p-a.p||a.lane.localeCompare(b.lane));
   for(const second of seconds.slice(0,2))for(const third of first.filter(x=>x.lane!==lane&&x.lane!==second.lane))triples.push(lane+'-'+second.lane+'-'+third.lane);
  }
  sets.push({id:'formation_'+heads+'x2x4',triples:triples.sort()});
 }
 const lookup=new Map(ranked.map(x=>[x.triple,x.p]));
 return sets.map(x=>({...x,points:x.triples.length,probability:Math.min(1,x.triples.reduce((n,t)=>n+lookup.get(t),0))}));
}
const aggregate=()=>({samples:0,hits:0,sumP:0,brier:0,points:0,bins:Array.from({length:10},()=>({n:0,h:0,p:0}))});
function add(a,set,actual){const hit=Number(set.triples.includes(actual)),p=set.probability;a.samples++;a.hits+=hit;a.sumP+=p;a.brier+=(p-hit)**2;a.points+=set.points;const b=a.bins[Math.min(9,Math.floor(p*10))];b.n++;b.h+=hit;b.p+=p;}
function finish(a){const n=a.samples,p=n?a.hits/n:null,z=1.959963984540054,d=n?1+z*z/n:1,mid=n?(p+z*z/(2*n))/d:null,half=n?z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d:null;return {samples:n,hits:a.hits,accuracy:p,meanProbability:n?a.sumP/n:null,signedCalibrationError:n?a.sumP/n-p:null,binaryBrier:n?a.brier/n:null,ece:n?a.bins.reduce((s,b)=>s+Math.abs(b.h-b.p),0)/n:null,meanPoints:n?a.points/n:null,interval95:{lower:n?Math.max(0,mid-half):null,upper:n?Math.min(1,mid+half):null}};}
export function createCoverageAccumulator(){
 const states=new Map();let closed=false;
 return {add({combinations,probabilities,actual,date}){
  if(closed)throw Error('coverage_finished');if(!validTriple(actual)||!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date??'')||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('invalid_coverage_observation');
  const sets=coverageSets(combinations,probabilities),month=date.slice(0,7);
  for(const set of sets){let state=states.get(set.id);if(!state){state={all:aggregate(),months:{}};states.set(set.id,state);}add(state.all,set,actual);add(state.months[month]??=aggregate(),set,actual);}
 },finish(){if(closed)throw Error('coverage_finished');closed=true;return {policy:COVERAGE_POLICY,strategies:Array.from(states,([id,s])=>({id,metrics:finish(s.all),monthly:Object.fromEntries(Object.entries(s.months).sort(([a],[b])=>a.localeCompare(b)).map(([month,a])=>[month,finish(a)]))})),financialSimulation:{status:'not_measured',reason:'decision_time_full_odds_and_rounding_not_available'},analysisReady:false,liveEligible:false,financialActions:0};}};
}

/** Equal-payout theoretical weights only; no odds are inferred from payouts. */
export function theoreticalDutching(odds){
 if(!Array.isArray(odds)||!odds.length||odds.some(o=>typeof o!=='number'||!finite(o)||o<=1))throw Error('invalid_dutching_odds');
 const reciprocal=odds.reduce((n,o)=>n+1/o,0);return {syntheticOdds:1/reciprocal,weights:odds.map(o=>(1/o)/reciprocal),beforeRounding:true,financialActions:0};
}
