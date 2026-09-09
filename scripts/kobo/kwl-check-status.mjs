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
const ctx=await browser.newContext({storageState:state,locale:'ja-JP'});
const page=await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(6000);
const ids=['a8c1390a-6971-4fca-9807-63d41feba540','e707e1f2-98e4-4d7e-b79b-d879aade3739','34d93ad6-5adb-45fd-b7aa-76f3fa30440e','96d80132-08a6-42c2-a00a-7e74f20904aa','b681bd64-38ee-4483-9515-59be48c34da6'];
for(const id of ids){
  const st=await page.evaluate(async(id)=>{try{const res=await fetch('/product/'+id+'?productType=BOOK',{headers:{accept:'application/json'}});if(res.ok){const j=await res.json();return{status:j.status,ready:j.characteristics?.PUBLISH_READY,title:(j.metadata?.title||'').slice(0,16)};}}catch(e){}return null;},id);
  console.log(id.slice(0,8)+':',JSON.stringify(st));
}
await browser.close();process.exit(0);
