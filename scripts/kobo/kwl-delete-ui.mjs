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
// ebook編集ページ内の削除/取消ボタン、及びDELETEのAPI傍受
const dels=[];
page.on('request',rq=>{const u=rq.url();const m=rq.method();if((m==='DELETE'||/delet|cancel|remove|withdraw|unpublish/i.test(u))&&!/\.(js|css)/.test(u))dels.push(m+' '+u.replace(/https?:\/\/[^/]+/,'@'));});
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/e707e1f2-98e4-4d7e-b79b-d879aade3739',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(8000);
const btns=await page.evaluate(()=>[...document.querySelectorAll('button,a,[role=button]')].filter(e=>e.offsetParent!==null&&/削除|取消|取り下げ|破棄|キャンセル|delete|remove|下書きに戻す|非公開/.test(e.textContent||e.getAttribute('aria-label')||'')).map(e=>(e.textContent||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,24)));
console.log('削除系ボタン:',JSON.stringify([...new Set(btns)]));
// メニュー(…)ボタンを探して開く
const menu=await page.evaluate(()=>{const m=[...document.querySelectorAll('button,[role=button],[aria-haspopup]')].filter(e=>e.offsetParent!==null&&(/⋮|…|メニュー|more|options/i.test(e.textContent||e.getAttribute('aria-label')||'')||e.getAttribute('aria-haspopup')));return m.slice(0,5).map(e=>(e.getAttribute('aria-label')||e.textContent||'').slice(0,20));});
console.log('メニューボタン候補:',JSON.stringify(menu));
console.log('削除系API傍受:',JSON.stringify(dels));
await browser.close();process.exit(0);
