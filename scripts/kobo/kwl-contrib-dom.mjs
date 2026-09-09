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
// 著者名を入れてから(役割UIが名前入力後に出る場合に備え)、著者行の全要素をダンプ
const nm=await page.$('[name="metadata.contributors[0].name"]');if(nm){await nm.click().catch(()=>{});await nm.fill('宮田海斗').catch(()=>{});}
await page.waitForTimeout(1500);
const dump=await page.evaluate(()=>{
  const name=document.querySelector('[name="metadata.contributors[0].name"]');
  // 著者ブロック = 名前とその隠しtypeを両方含む最小の共通祖先
  const type=document.querySelector('[name="metadata.contributors[0].type"]');
  let block=name;
  while(block&&!(block.contains(name)&&block.contains(type)))block=block.parentElement;
  block=block||name.closest('div');
  const vis=e=>e.offsetParent!==null;
  const els=[...block.querySelectorAll('*')].filter(e=>vis(e)&&(e.tagName==='BUTTON'||e.tagName==='SELECT'||e.getAttribute('role')==='combobox'||e.getAttribute('role')==='button'||e.getAttribute('aria-haspopup')||/select|dropdown|combo|picker/i.test(e.className))).map(e=>({tag:e.tagName,role:e.getAttribute('role'),haspopup:e.getAttribute('aria-haspopup'),txt:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,30),cls:e.className.slice(0,40)}));
  return {blockTag:block?.tagName,els:els.slice(0,12)};
});
console.log('著者ブロック内のUI要素:',JSON.stringify(dump,null,1));
await browser.close();process.exit(0);
