/** 商品を出版API直接呼び出しで PUBLISH_REQUESTED にする。GET→status書換→PUT。 */
import { createRequire } from 'module';
import path from 'path'; import crypto from 'crypto';
const SP=new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const REPO=path.resolve(path.dirname(SP),'../..');
const req=createRequire(path.join(REPO,'apps/worker/package.json'));
const reqRoot=createRequire(path.join(REPO,'package.json'));
const {chromium}=req('playwright');
const {Client}=reqRoot(path.join(REPO,'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
function dec(b64){const raw=Buffer.from(b64,'base64');const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(process.env.KDP_CRED_KEY,'hex'),raw.subarray(0,12));d.setAuthTag(raw.subarray(12,28));return Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString('utf8');}
const id=process.argv[2];
const c=new Client({connectionString:process.env.DBURL,ssl:{rejectUnauthorized:false}});await c.connect();
const r=await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'");await c.end();
const state=JSON.parse(dec(r.rows[0].kobo_session_state_enc));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']});
const ctx=await browser.newContext({storageState:state,locale:'ja-JP'});
const page=await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/'+id,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(7000);
const out=await page.evaluate(async(id)=>{
  const g=await fetch('/product/'+id+'?productType=BOOK',{headers:{accept:'application/json'}});
  if(!g.ok)return{err:'GET '+g.status};
  const prod=await g.json();
  const before=prod.status;
  prod.status='PUBLISH_REQUESTED';
  // PUT で書き戻し(productType クエリ付き)
  const p=await fetch('/product/'+id+'?productType=BOOK',{method:'PUT',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(prod)});
  let body='';try{body=JSON.stringify(await p.json()).slice(0,120);}catch(e){body=await p.text().catch(()=>'');body=body.slice(0,120);}
  return{before,putStatus:p.status,body};
},id);
console.log('結果:',JSON.stringify(out));
await page.waitForTimeout(2000);
const now=await page.evaluate(async(id)=>{try{const r=await fetch('/product/'+id+'?productType=BOOK',{headers:{accept:'application/json'}});return (await r.json()).status;}catch(e){return 'ERR'}},id);
console.log('PUT後ステータス:',now);
await browser.close();process.exit(0);
