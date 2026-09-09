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
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1500,height:1200}});
const page=await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(9000);
const list=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('tr,li,[class*=row],[class*=item],[class*=card]')].filter(e=>e.offsetParent!==null&&/新NISA|下書き|審査|公開|販売|未公開|作成中|レビュー/.test(e.textContent||'')&&(e.textContent||'').length<160).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim());
  const statusWords=[...new Set((document.body.innerText||'').match(/下書き|審査中|公開中|販売中|未公開|作成中|レビュー中|準備完了|エラー/g)||[])];
  return {rows:[...new Set(rows)].slice(0,10),statusWords,total:(document.body.innerText.match(/(\d+)\s*件/)||[])[0]};
});
console.log('作品一覧の状態語:',JSON.stringify(list.statusWords));
console.log('行:',JSON.stringify(list.rows.slice(0,8),null,1));
await browser.close();process.exit(0);
