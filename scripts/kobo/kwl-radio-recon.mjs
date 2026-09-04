import { createRequire } from 'module';
import path from 'path'; import crypto from 'crypto';
const SP=new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const REPO=path.resolve(path.dirname(SP),'../..');
const req=createRequire(path.join(REPO,'apps/worker/package.json'));
const reqRoot=createRequire(path.join(REPO,'package.json'));
const {chromium}=req('playwright');
const {Client}=reqRoot(path.join(REPO,'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
function dec(b64){const raw=Buffer.from(b64,'base64');const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(process.env.KDP_CRED_KEY,'hex'),raw.subarray(0,12));d.setAuthTag(raw.subarray(12,28));return Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString('utf8');}
const c=new Client({connectionString:process.env.DBURL,ssl:{rejectUnauthorized:false}});await c.connect();
const r=await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'");await c.end();
const state=JSON.parse(dec(r.rows[0].kobo_session_state_enc));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']});
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1500,height:1400}});
const page=await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(9000);
// 各radioグループの直前の見出し/質問文を取得
const groups=await page.evaluate(()=>{
  const out=[];
  const seen=new Set();
  for(const inp of document.querySelectorAll('input[type=radio]')){
    const name=inp.name||'(noname)';
    if(seen.has(name))continue;seen.add(name);
    // 直近の見出し/ラベル文を上方向に探す
    let q='';let el=inp.closest('fieldset,section,div');
    for(let i=0;i<5&&el;i++){const lg=el.querySelector('legend,label,h2,h3,p,span');if(lg&&(lg.textContent||'').trim().length>4){q=(lg.textContent||'').replace(/\s+/g,' ').trim().slice(0,80);break;}el=el.parentElement;}
    out.push({name,q});
  }
  return out;
});
console.log('RADIOグループ:');groups.forEach(g=>console.log(' name='+g.name+' Q='+g.q));
// select群
const selects=await page.evaluate(()=>[...document.querySelectorAll('select')].map(s=>({name:s.name||'',opts:[...s.options].slice(0,4).map(o=>o.textContent.trim()).join('|')})));
console.log('SELECT:',JSON.stringify(selects,null,1));
await browser.close();process.exit(0);
