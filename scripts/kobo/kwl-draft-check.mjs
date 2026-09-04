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
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/'+process.argv[2],{waitUntil:'domcontentloaded'});
await page.waitForTimeout(9000);
// 出版クリックしてエラーを拾う
await page.locator('button').filter({hasText:/^出版する$/}).first().click({force:true,noWaitAfter:true,timeout:8000}).catch(()=>{});
await page.waitForTimeout(4000);
const diag=await page.evaluate(()=>{
  const vis=e=>e.offsetParent!==null;
  const errors=[...document.querySelectorAll('[class*=error],[class*=Error],[role=alert],[aria-invalid=true],.invalid-feedback')].filter(vis).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,80)).filter(Boolean);
  const emptyReq=[...document.querySelectorAll('input[required],select[required],textarea[required],[aria-required=true]')].filter(vis).filter(e=>!e.value).map(e=>e.name||e.getAttribute('aria-label')||e.id).slice(0,10);
  const drm=[...document.querySelectorAll('input[name="metadata.drm"]')].map(r=>({checked:r.checked,lbl:(r.closest('label')?.textContent||'').replace(/\s+/g,' ').trim().slice(0,20)}));
  const price=document.querySelector('[name="prices[0]"]')?.value;
  return {errors:[...new Set(errors)].slice(0,10),emptyReq,drm,price};
});
console.log('エラー:',JSON.stringify(diag.errors,null,1));
console.log('未入力必須:',JSON.stringify(diag.emptyReq));
console.log('DRM:',JSON.stringify(diag.drm),' 価格:',diag.price);
await page.screenshot({path:path.join(REPO,'scripts/kobo/out/draft-check.png'),fullPage:true}).catch(()=>{});
await browser.close();process.exit(0);
