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
const info=await page.evaluate(()=>{
  const t=document.querySelector('[name="metadata.contributors[0].type"]');
  let out={found:!!t};
  if(t){out.tag=t.tagName;out.type=t.type;out.role=t.getAttribute('role');if(t.tagName==='SELECT')out.opts=[...t.options].map(o=>o.textContent.trim());}
  // 名前欄の近くのcombobox/button(著者役割ドロップダウン)
  const nameEl=document.querySelector('[name="metadata.contributors[0].name"]');
  if(nameEl){const sec=nameEl.closest('div,fieldset')?.parentElement;const combos=[...(sec?.querySelectorAll('button,[role=combobox],[role=button],select')||[])].filter(e=>e.offsetParent!==null).map(e=>({tag:e.tagName,txt:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,26),role:e.getAttribute('role')}));out.nearName=combos.slice(0,6);}
  return out;
});
console.log('著者type欄:',JSON.stringify(info,null,1));
// 著者役割のcomboを開いてオプションを見る
const combo=page.locator('button,[role=combobox],[role=button]').filter({hasText:/著者|役割|貢献|選択|Author|Contributor/}).first();
if(await combo.count().catch(()=>0)){
  await combo.click({force:true}).catch(()=>{});await page.waitForTimeout(1500);
  const opts=await page.evaluate(()=>[...document.querySelectorAll('[role=option],li')].filter(e=>e.offsetParent!==null).map(e=>(e.textContent||'').trim().slice(0,16)).filter(Boolean).slice(0,15));
  console.log('役割オプション:',JSON.stringify(opts));
}
await browser.close();process.exit(0);
