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
const r=await c.query("SELECT booth_session_state_enc FROM app_settings WHERE id='singleton'");await c.end();
const state=JSON.parse(dec(r.rows[0].booth_session_state_enc));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']});
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1500,height:1400}});
const page=await ctx.newPage();
await page.goto('https://manage.booth.pm/items/8807249/edit',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(7000);
await page.getByText('カテゴリを選択してください',{exact:false}).first().click({force:true}).catch(()=>{});
await page.waitForTimeout(2500);
// 「小説・その他書籍」要素の詳細
const before=await page.evaluate(()=>{
  const el=[...document.querySelectorAll('*')].find(e=>e.offsetParent!==null&&e.children.length<=2&&/小説・その他書籍/.test((e.textContent||'').replace(/\s+/g,''))&&(e.textContent||'').replace(/\s+/g,'').length<16);
  if(!el)return null;
  el.setAttribute('data-cat','1');
  return {tag:el.tagName,cls:el.className.slice(0,30),role:el.getAttribute('role')};
});
console.log('小説要素:',JSON.stringify(before));
// クリックして展開/選択挙動
await page.locator('[data-cat="1"]').click({force:true}).catch(()=>{});
await page.waitForTimeout(2500);
const after=await page.evaluate(()=>{
  const modal=document.querySelector('.booth-modal,[class*=modal]');
  const modalOpen=modal&&modal.offsetParent!==null;
  // 展開後に現れたラジオ/サブ項目
  const radios=[...document.querySelectorAll('input[type=radio]')].filter(e=>e.offsetParent!==null).map(r=>({checked:r.checked,lbl:(r.closest('label')?.textContent||r.parentElement?.textContent||'').replace(/\s+/g,' ').trim().slice(0,20)}));
  const subItems=[...document.querySelectorAll('li,label,button')].filter(e=>e.offsetParent!==null&&/小説|評論|情報|テキスト|ノベル|書籍|その他|ゲーム|音声|一般/.test((e.textContent||'').replace(/\s+/g,''))&&(e.textContent||'').replace(/\s+/g,'').length<16).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim());
  const catBtnText=[...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim()).find(t=>/カテゴリ/.test(t)&&t.length<30);
  return {modalOpen,radios:radios.slice(0,12),subItems:[...new Set(subItems)].slice(0,12),catBtnText};
});
console.log('クリック後:',JSON.stringify(after,null,1));
await browser.close();process.exit(0);
