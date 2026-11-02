export const FORMATION_CALIBRATION_POLICY=Object.freeze({version:'boat_formation_calibration_v1',iterations:160,learningRate:.1,l2:.01,clip:1e-6,features:['intercept','logit_raw_probability','logit_market_mass'],prior:[0,1,0]});
const clamp=p=>Math.min(1-1e-6,Math.max(1e-6,p)),logit=p=>Math.log(clamp(p)/(1-clamp(p))),sigmoid=x=>x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
const features=row=>[1,logit(row.p),logit(row.q)];
function validate(row){if(!row||!/^\d{4}-\d{2}-\d{2}$/.test(row.date??'')||![row.p,row.q].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1)||![0,1].includes(row.hit))throw Error('formation_calibration_row_invalid');}
export function fitFormationCalibration(rows,{from,to}){
 if(!Array.isArray(rows)||!rows.length||typeof from!=='string'||typeof to!=='string'||from>=to)throw Error('formation_calibration_empty_or_range_invalid');
 for(const row of rows){validate(row);if(row.date<from||row.date>=to)throw Error('formation_calibration_phase_leakage');}
 let weights=[0,1,0];const policy=FORMATION_CALIBRATION_POLICY,loss=w=>{let sum=0;for(const row of rows){const z=features(row).reduce((n,v,i)=>n+v*w[i],0);sum+=Math.max(0,z)+Math.log1p(Math.exp(-Math.abs(z)))-row.hit*z;}return sum/rows.length+policy.l2/2*w.reduce((n,v,i)=>n+(v-policy.prior[i])**2,0);};
 let currentLoss=loss(weights),initialLoss=currentLoss,iterationsCompleted=0,backtrackingSteps=0,status='fitted_fixed_iterations';
 for(let iteration=0;iteration<policy.iterations;iteration++){const gradient=[0,0,0];for(const row of rows){const x=features(row),error=sigmoid(x.reduce((n,v,i)=>n+v*weights[i],0))-row.hit;for(let i=0;i<3;i++)gradient[i]+=error*x[i];}let rate=policy.learningRate,accepted=false;for(let back=0;back<=20;back++){const next=weights.map((w,i)=>w-rate*(gradient[i]/rows.length+policy.l2*(w-policy.prior[i]))),nextLoss=loss(next);if(Number.isFinite(nextLoss)&&nextLoss<=currentLoss+1e-12){weights=next;currentLoss=nextLoss;accepted=true;iterationsCompleted++;break;}rate/=2;backtrackingSteps++;}if(!accepted){status='stopped_no_finite_descent';break;}}
 if(weights.some(x=>!Number.isFinite(x))||!Number.isFinite(currentLoss))throw Error('formation_calibration_nonfinite');return {version:policy.version,status,weights,from,to,samples:rows.length,policy,initialLoss,finalLoss:currentLoss,iterationsCompleted,backtrackingSteps};
}
export function calibratedFormationProbability(model,row){validate({...row,hit:row.hit??0});if(model?.version!==FORMATION_CALIBRATION_POLICY.version||!Array.isArray(model.weights)||model.weights.length!==3||model.weights.some(x=>!Number.isFinite(x)))throw Error('formation_calibration_model_invalid');return sigmoid(features(row).reduce((n,v,i)=>n+v*model.weights[i],0));}
export function formationMetrics(rows){
 if(!Array.isArray(rows))throw Error('formation_metrics_invalid');let hits=0,sumP=0,brier=0;const bins=Array.from({length:10},()=>({n:0,p:0,h:0}));for(const row of rows){validate(row);hits+=row.hit;sumP+=row.p;brier+=(row.p-row.hit)**2;const b=bins[Math.min(9,Math.floor(row.p*10))];b.n++;b.p+=row.p;b.h+=row.hit;}
 const n=rows.length,p=n?hits/n:null,z=1.959963984540054,d=n?1+z*z/n:1,mid=n?(p+z*z/(2*n))/d:null,half=n?z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d:null;return {samples:n,hits,accuracy:p,meanProbability:n?sumP/n:null,binaryBrier:n?brier/n:null,ece:n?bins.reduce((s,b)=>s+Math.abs(b.p-b.h),0)/n:null,interval95:{lower:n?Math.max(0,mid-half):null,upper:n?Math.min(1,mid+half):null}};
}
export function formationMarketMass(selected,odds){
 const entries=Object.entries(odds??{});if(entries.length!==120||entries.some(([t,o])=>!/^([1-6])-([1-6])-([1-6])$/.test(t)||new Set(t.split('-')).size!==3||typeof o!=='number'||!Number.isFinite(o)||o<1)||new Set(selected).size!==selected.length||selected.some(t=>!Object.hasOwn(odds,t)))return null;
 const all=entries.reduce((n,[,o])=>n+1/o,0),part=selected.reduce((n,t)=>n+1/odds[t],0);return {q:part/all,syntheticOdds:1/part};
}
