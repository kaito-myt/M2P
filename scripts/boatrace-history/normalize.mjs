// Pure retrospective structural normalization; callers verify stored raw bytes against the manifest hash.
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const int=(v,min,max)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const triple=v=>typeof v==='string'&&/^[1-6]-[1-6]-[1-6]$/.test(v)&&new Set(v.split('-')).size===3;
const identity=(v,date,venue,race)=>object(v)&&v.date===date&&v.stadium_number===venue&&v.race_number===race;
export const NORMALIZER_VERSION='turnmark_structure_v1';
export const SCHEMA_URL='https://raw.githubusercontent.com/turnmark/api/gh-pages/docs/v1/schema.md';
const raceFields=['closed_at','grade_number','title','subtitle','distance','day_number'];
const entryFields=['rank_number','branch_number','birthplace_number','age','weight','flying_count','late_count','average_start_timing','national_win_rate','national_top_2_percent','national_top_3_percent','local_win_rate','local_top_2_percent','local_top_3_percent','motor_number','motor_top_2_percent','motor_top_3_percent','boat_number','boat_top_2_percent','boat_top_3_percent'];
const previewFields=['wind_speed','wind_direction_number','wave_height','weather_number','air_temperature','water_temperature'];
const previewEntryFields=['course_number','start_timing','weight','weight_adjustment','exhibition_time','tilt_adjustment','propeller'];
function fields(node,names,prefix,time='retrospective_unverified'){
 return Object.fromEntries(names.filter(key=>own(node,key)).map(key=>{const v=node[key];return [key,{value:v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)?v:null,rawPath:prefix+'.'+key,time,publishedAt:null,unit:'unverified',valueState:v===null?'null':typeof v==='number'&&!Number.isFinite(v)||!['number','string','boolean'].includes(typeof v)?'invalid':'recorded'}];}));
}
function six(node,registration=false){return object(node)&&Object.keys(node).length===6&&Object.entries(node).every(([k,r])=>/^[1-6]$/.test(k)&&object(r)&&r.entry_number===Number(k)&&(!registration||int(r.number,1,99999)))&&(!registration||new Set(Object.values(node).map(r=>r.number)).size===6);}
function oddsAudit(node){
 const odds={},issues=[];let unavailable=0,invalid=0;
 if(!object(node)){return {odds,complete:false,issues:['odds_market_missing'],unavailable,invalid};}
 for(const [a,second] of Object.entries(node)){
  if(!/^[1-6]$/.test(a)||!object(second)){invalid++;continue;}
  for(const [b,third] of Object.entries(second)){
   if(!/^[1-6]$/.test(b)||a===b||!object(third)){invalid++;continue;}
   for(const [c,value] of Object.entries(third)){
    const key=a+'-'+b+'-'+c;if(!triple(key)){invalid++;continue;}
    if(value===null){unavailable++;continue;}
    if(typeof value!=='number'||!Number.isFinite(value)||value<1){invalid++;continue;}
    odds[key]=value;
   }
  }
 }
 if(Object.keys(odds).length!==120)issues.push('odds_incomplete');if(unavailable)issues.push('odds_null');if(invalid)issues.push('odds_invalid');
 return {odds,complete:Object.keys(odds).length===120&&!invalid&&!unavailable,issues,unavailable,invalid};
}
function resultAudit(node,program,date,venue,race){
 const base={state:'unresolved',winnerTriple:null,payoutAmountYen:null,payoutPer100Yen:null,payoutBasis:'unverified',refundLanes:null,incident:false,lowerPlaceTie:false,placings:[],payouts:[],time:'result_only',settlementAt:null,issues:[]};
 if(!identity(node,date,venue,race)){base.issues.push(node===null||node===undefined?'result_missing':'result_identity_invalid');return base;}
 const refunds=node.refunds;
 if(!Array.isArray(refunds)||refunds.some(v=>!int(v,1,6))||new Set(refunds).size!==refunds.length)base.issues.push('refunds_invalid_or_missing');else base.refundLanes=[...refunds];
 const racersValid=six(node.racers,true)&&six(program.racers,true)&&Object.entries(node.racers).every(([key,r])=>r.number===program.racers[key].number);
 if(!racersValid)base.issues.push('result_entries_identity_invalid');
 else base.placings=Object.values(node.racers).sort((a,b)=>a.entry_number-b.entry_number).map(r=>({lane:r.entry_number,registration:r.number,placeNumber:r.place_number??null}));
 const recognizedPlaces=racersValid&&base.placings.every(r=>int(r.placeNumber,1,13));
 const topCounts=[1,2,3].map(place=>base.placings.filter(r=>r.placeNumber===place).length);
 const topThreeUnique=racersValid&&topCounts.every(count=>count===1);
 const topThreeTie=racersValid&&topCounts.some(count=>count>1);
 base.incident=base.placings.some(r=>int(r.placeNumber,7,13));
 base.lowerPlaceTie=[4,5,6].some(place=>base.placings.filter(r=>r.placeNumber===place).length>1);
 if(base.incident)base.issues.push('lower_incident_present');
 if(base.lowerPlaceTie)base.issues.push('lower_place_tie_present');
 if(racersValid&&!recognizedPlaces)base.issues.push('unrecognized_or_absent_place');
 if(racersValid&&!topThreeUnique)base.issues.push('top_three_not_unique');
 const payouts=node.payouts?.trifecta;
 const payoutShape=Array.isArray(payouts)&&payouts.every(p=>object(p)&&own(p,'combination')&&own(p,'amount')&&own(p,'label')&&(p.combination===null||triple(p.combination))&&(p.amount===null||int(p.amount,0,Number.MAX_SAFE_INTEGER))&&(p.label===null||typeof p.label==='string'));
 if(!payoutShape)base.issues.push('payout_invalid_or_missing');else base.payouts=payouts.map(p=>({combination:p.combination,amountYen:p.amount,label:p.label}));
 const allMarketsEmpty=object(node.payouts)&&['trifecta','trio','exacta','quinella','quinella_place','win','place'].every(k=>Array.isArray(node.payouts[k])&&node.payouts[k].length===0);
 if(allMarketsEmpty){base.state='cancelled';base.issues.push('all_markets_empty');return base;}
 if(base.refundLanes?.length){base.state='refund';base.issues.push('refund_present');return base;}
 if(topThreeTie||payoutShape&&payouts.length>1){base.state='tie';base.issues.push(topThreeTie?'top_three_tie':'multiple_payouts');return base;}
 if(!payoutShape||payouts.length!==1||!recognizedPlaces||!topThreeUnique||base.refundLanes===null){if(payoutShape&&payouts.length===0)base.issues.push('payout_empty');return base;}
 const p=payouts[0];
 if(p.combination===null||p.label!==null){base.issues.push('special_or_unresolved_payout');return base;}
 if(p.amount===null){base.issues.push('winning_ticket_unsold');return base;}
 if(p.amount<1){base.issues.push('payout_nonpositive');return base;}
 const winner=[1,2,3].map(place=>base.placings.find(r=>r.placeNumber===place)?.lane).join('-');
 if(!triple(winner)||p.combination!==winner){base.issues.push('winner_payout_mismatch');return base;}
 base.state='normal';base.winnerTriple=winner;base.payoutAmountYen=p.amount;return base;
}
export function normalizeTurnmarkDay(raw,manifest){
 const report={schemaVersion:1,adapterVersion:NORMALIZER_VERSION,source:'turnmark_v1',date:manifest?.date??null,status:'invalid',races:[],rejectedNodes:[],counts:{identified:0,normalStructure:0,incomplete:0,refund:0,tie:0,cancelled:0,unresolved:0},issues:[],analysisReady:false,executionEvidencePassed:false,liveEligible:false,rawIntegrity:'caller_must_verify',schemaUrl:SCHEMA_URL,sourceSchemaVersion:'v1',schemaHash:null};
 if(!object(manifest)||manifest.source!=='turnmark_v1'||manifest.status!=='collected'||!validDate(manifest.date)||typeof manifest.sha256!=='string'||!/^([a-f0-9]{64})$/i.test(manifest.sha256)){report.issues.push('manifest_invalid');return report;}
 if(!object(raw?.programs?.stadiums)){report.issues.push('schema_unknown');return report;}
 report.status='normalized';
 for(const [venueKey,stadium] of Object.entries(raw.programs.stadiums)){
  if(!/^(?:[1-9]|1\d|2[0-4])$/.test(venueKey)||!object(stadium?.races)){report.rejectedNodes.push({path:'programs.stadiums.'+venueKey,reason:'venue_identity_invalid'});continue;}
  for(const [raceKey,program] of Object.entries(stadium.races)){
   const venue=Number(venueKey),race=Number(raceKey),date=manifest.date,path='programs.stadiums.'+venueKey+'.races.'+raceKey;
   if(!/^(?:[1-9]|1[0-2])$/.test(raceKey)||!identity(program,date,venue,race)){report.rejectedNodes.push({path,reason:'race_identity_invalid'});continue;}
   const issues=[],entriesValid=six(program.racers,true);if(!entriesValid)issues.push('program_entries_invalid');
   const previewValid=identity(program.preview,date,venue,race);if(!previewValid)issues.push('preview_missing_or_identity_invalid');
   const previewEntriesValid=previewValid&&six(program.preview.racers);if(previewValid&&!previewEntriesValid)issues.push('preview_entries_invalid');
   const quoteIdentity=identity(program.odds,date,venue,race);const audit=oddsAudit(quoteIdentity?program.odds.trifecta:null);if(!quoteIdentity)issues.push('odds_identity_invalid');issues.push(...audit.issues);
   const result=resultAudit(program.result,program,date,venue,race);issues.push(...result.issues);
   const entries=entriesValid?Object.values(program.racers).sort((a,b)=>a.entry_number-b.entry_number).map(row=>({lane:row.entry_number,registration:row.number,fields:fields(row,entryFields,path+'.racers.'+row.entry_number),preview:previewEntriesValid?fields(program.preview.racers[row.entry_number],previewEntryFields,path+'.preview.racers.'+row.entry_number):{}})):[];
   // Normal means a resolved top-three settlement, not an incident-free race.
   const normalStructure=entriesValid&&audit.complete&&result.state==='normal';
   const winnerOdds=result.winnerTriple?audit.odds[result.winnerTriple]??null:null;
   const normalized={raceKey:'turnmark_v1:'+date+':'+venue+':'+race,date,venue,raceNumber:race,deadline:null,deadlineRaw:typeof program.closed_at==='string'?program.closed_at:null,settlementAt:null,entries,context:fields(program,raceFields,path),preview:previewValid?fields(program.preview,previewFields,path+'.preview'):{},odds:audit.odds,oddsPhase:'final_or_unknown',oddsObservedAt:null,oddsAudit:{expected:120,observed:Object.keys(audit.odds).length,unavailable:audit.unavailable,invalid:audit.invalid,complete:audit.complete},result,quality:{normalStructure,issues:[...new Set(issues)],winnerOdds,payoutAmountYen:result.payoutAmountYen,oddsPayoutEquality:'not_assessed_unverified_payout_basis'},provenance:{source:'turnmark_v1',rawSha256:manifest.sha256,adapterVersion:NORMALIZER_VERSION,evidenceTime:'retrospective_unverified',rawIntegrity:'caller_must_verify'}};
   report.races.push(normalized);report.counts.identified++;if(normalStructure)report.counts.normalStructure++;else report.counts.incomplete++;if(result.state!=='normal')report.counts[result.state]++;
  }
 }
 if(!report.races.length)report.issues.push('no_identified_races');return report;
}
