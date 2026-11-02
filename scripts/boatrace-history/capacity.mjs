import {oddsCompleteness} from './probe.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=(v,min,max)=>(typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v))&&Number.isInteger(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):null;
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
export function entryNumbers(value){
 if(!object(value))return null;
 const entries=Object.entries(value);if(entries.length!==6)return null;
 const numbers=[];
 for(const [key,row] of entries){if(!/^[1-6]$/.test(key)||!object(row)||id(row.entry_number,1,6)!==Number(key))return null;numbers.push(Number(key));}
 return numbers.sort((a,b)=>a-b);
}
const sameIdentity=(v,date,stadium,race)=>object(v)&&v.date===date&&id(v.stadium_number,1,24)===stadium&&id(v.race_number,1,12)===race;
export function inspectDay(json,date){
 const result={schemaKnown:false,races:0,completeEntryRaces:0,completeTrifectaRaces:0,resultShapeRaces:0,refundShapeRaces:0,trifectaPayoutShapeRaces:0,invalidIdentityNodes:0,fields:[],fieldPathLimit:384,fieldsTruncated:false,omittedFieldObservations:0,timingVerifiedRaces:0,analysisReady:false,crossSourceEqualityVerified:false};
 const stadiums=json?.programs?.stadiums;if(!object(stadiums))return result;
 const fields=new Map();
 const measure=(value,prefix,grain)=>{
  if(!object(value))return;
  for(const [key,v] of Object.entries(value)){
   if(!/^[a-z][a-z0-9_]{0,79}$/.test(key)||['racers','odds','preview','result'].includes(key))continue;
   const path=prefix+'.'+key;
   if(fields.size>=result.fieldPathLimit&&!fields.has(path)){result.fieldsTruncated=true;result.omittedFieldObservations++;continue;}
   const field=fields.get(path)??{path,grain,present:0,nonNull:0,total:0};field.present++;if(v!==null)field.nonNull++;fields.set(path,field);
  }
 };
 let raceDenominator=0;
 for(const [stadiumKey,stadium] of Object.entries(stadiums)){
  if(!/^(?:[1-9]|1\d|2[0-4])$/.test(stadiumKey)||!object(stadium?.races)){result.invalidIdentityNodes++;continue;}
  for(const [raceKey,race] of Object.entries(stadium.races)){
   if(result.races>=288){result.invalidIdentityNodes++;continue;}
   if(!/^(?:[1-9]|1[0-2])$/.test(raceKey)||!sameIdentity(race,date,Number(stadiumKey),Number(raceKey))){result.invalidIdentityNodes++;continue;}
   result.races++;raceDenominator++;measure(race,'program','race');
   if(entryNumbers(race.racers))result.completeEntryRaces++;
   if(object(race.racers))for(const [key,row] of Object.entries(race.racers)){if(!/^[1-6]$/.test(key)||!object(row))continue;measure(row,'program.racers','boat');}
   for(const type of ['preview','result']){
    const node=race[type];
    if(!sameIdentity(node,date,Number(stadiumKey),Number(raceKey)))continue;
    measure(node,type,'race');
    if(object(node.racers))for(const [key,row] of Object.entries(node.racers)){if(!/^[1-6]$/.test(key)||!object(row))continue;measure(row,type+'.racers','boat');}
    if(type==='result'){
     if(entryNumbers(node.racers)&&Object.entries(node.racers).every(([key,row])=>(id(row.place_number,1,16)!==null||row.place_number===99)&&Number.isInteger(row.number)&&row.number===race.racers?.[key]?.number))result.resultShapeRaces++;
     if(Array.isArray(node.refunds)&&new Set(node.refunds).size===node.refunds.length&&node.refunds.every(v=>typeof v==='number'&&id(v,1,6)!==null))result.refundShapeRaces++;
     const payouts=node.payouts?.trifecta;
     if(Array.isArray(payouts)&&payouts.every(p=>object(p)&&own(p,'combination')&&own(p,'amount')&&own(p,'label')&&(p.combination===null||typeof p.combination==='string')&&(p.amount===null||Number.isSafeInteger(p.amount)&&p.amount>=0)&&(p.label===null||typeof p.label==='string')))result.trifectaPayoutShapeRaces++;
    }
   }
   if(sameIdentity(race.odds,date,Number(stadiumKey),Number(raceKey))&&oddsCompleteness(race.odds).markets.find(m=>m.market==='trifecta')?.allValuesAvailable)result.completeTrifectaRaces++;
  }
 }
 result.schemaKnown=result.races>0;
 result.fields=[...fields.values()].map(field=>({...field,total:raceDenominator*(field.grain==='boat'?6:1)})).sort((a,b)=>a.path.localeCompare(b.path));
 return result;
}
