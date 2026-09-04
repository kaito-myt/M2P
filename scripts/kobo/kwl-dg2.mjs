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
// 内容紹介: 「内容紹介」ラベル直後のcontenteditable(role=textboxでspinbutton以外)
const descSel=await page.evaluate(()=>{
  const lbl=[...document.querySelectorAll('label,h2,h3,p,legend')].find(e=>/内容紹介/.test(e.textContent||'')&&(e.textContent||'').length<12);
  if(!lbl)return null;
  const sec=lbl.closest('div,section,fieldset')?.parentElement||lbl.parentElement;
  const ed=[...sec.querySelectorAll('[contenteditable=true]')].find(e=>e.getAttribute('role')!=='spinbutton');
  if(!ed)return null;
  ed.setAttribute('data-kwl-desc','1');
  return {cls:ed.className.slice(0,50),role:ed.getAttribute('role')};
});
console.log('内容紹介エディタ:',JSON.stringify(descSel));
if(descSel){
  const ed=page.locator('[data-kwl-desc="1"]');
  await ed.click().catch(()=>{});
  await page.keyboard.type('テスト内容紹介の本文です。',{delay:5}).catch(()=>{});
  await page.waitForTimeout(800);
  const val=await page.evaluate(()=>document.querySelector('[data-kwl-desc="1"]')?.textContent?.slice(0,30));
  console.log('入力後の内容紹介:',JSON.stringify(val));
}
// ジャンル: トップ「ビジネス・経済・投資」を含むツリー項目をクリック→葉→選択反映
const top=page.locator('li,a,button,[role=button],span').filter({hasText:/^ビジネス・経済・投資\s*›?$|^ビジネス・経済・投資/}).first();
console.log('トップ候補数:',await top.count().catch(()=>0));
await top.click({force:true}).catch(e=>console.log('top err',e.message.slice(0,40)));
await page.waitForTimeout(2000);
const leaves=await page.evaluate(()=>[...document.querySelectorAll('li,a,button,[role=button]')].filter(e=>e.offsetParent!==null&&/一般|投資|経営|マネー|起業|自己啓発|副業|ビジネス実用/.test(e.textContent||'')&&(e.textContent||'').replace(/\s+/g,'').length<16).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).slice(0,10));
console.log('葉候補:',JSON.stringify([...new Set(leaves)]));
// 葉を1つクリック
const leaf=page.locator('li,a,button,[role=button]').filter({hasText:/ビジネス・経済・就職一般|投資・マネー|経営|起業/}).first();
if(await leaf.count().catch(()=>0)){await leaf.click({force:true}).catch(()=>{});await page.waitForTimeout(1500);
  const chosen=await page.evaluate(()=>{const h=[...document.querySelectorAll('*')].find(e=>/ご選択中のジャンル/.test(e.textContent||'')&&(e.textContent||'').length<200);return h?(h.textContent||'').replace(/\s+/g,' ').trim().slice(0,100):'(不明)';});
  console.log('葉クリック後の選択中:',JSON.stringify(chosen));
}
await browser.close();process.exit(0);
