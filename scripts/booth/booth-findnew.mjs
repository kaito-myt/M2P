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
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1500,height:1200}});
const page=await ctx.newPage();
await page.goto('https://manage.booth.pm/items',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(6000);
// 商品登録リンクのhref
const links=await page.evaluate(()=>[...document.querySelectorAll('a')].filter(a=>/商品登録|新規|追加|register|new/i.test(a.textContent||'')).map(a=>({t:(a.textContent||'').trim().slice(0,16),href:a.getAttribute('href')})));
console.log('登録リンク:',JSON.stringify(links));
// 商品登録をクリックして遷移先を確認
await page.getByText('商品登録',{exact:false}).first().click({force:true}).catch(e=>console.log('click err',e.message.slice(0,40)));
await page.waitForTimeout(6000);
console.log('遷移先URL:',page.url());
const info=await page.evaluate(()=>{
  const vis=e=>e.offsetParent!==null;
  const fields=[...document.querySelectorAll('input,textarea,select')].filter(vis).map(e=>`${e.tagName.toLowerCase()}[name=${e.name||''}][type=${e.type||''}]${e.placeholder?' ph='+e.placeholder.slice(0,16):''}`).slice(0,35);
  const files=[...document.querySelectorAll('input[type=file]')].map(f=>({name:f.name,accept:(f.accept||'').slice(0,40)}));
  const labels=[...document.querySelectorAll('label,h2,h3,legend')].filter(vis).map(l=>(l.textContent||'').replace(/\s+/g,' ').trim().slice(0,26)).filter(Boolean).slice(0,30);
  const btns=[...document.querySelectorAll('button,input[type=submit]')].filter(vis).map(b=>(b.textContent||b.value||'').replace(/\s+/g,' ').trim().slice(0,20)).filter(Boolean).slice(0,15);
  return {fields,files,labels,btns};
});
console.log('FIELDS:',JSON.stringify(info.fields,null,1));
console.log('FILES:',JSON.stringify(info.files));
console.log('LABELS:',JSON.stringify(info.labels));
console.log('BUTTONS:',JSON.stringify(info.btns));
await browser.close();process.exit(0);
