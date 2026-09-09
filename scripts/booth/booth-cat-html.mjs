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
await page.waitForTimeout(3000);
// カテゴリモーダルを特定し、その中の項目HTMLをダンプ
const dump=await page.evaluate(()=>{
  // 「カテゴリを選択」見出しを含むモーダル
  const head=[...document.querySelectorAll('*')].find(e=>e.offsetParent!==null&&/^カテゴリを選択$/.test((e.textContent||'').trim()));
  let modal=head; for(let i=0;i<6&&modal;i++){modal=modal.parentElement;if(modal&&modal.querySelectorAll('*').length>20)break;}
  if(!modal)return{err:'no-modal'};
  // 「小説」を含む項目の要素チェーン
  const item=[...modal.querySelectorAll('*')].find(e=>/小説・その他書籍/.test((e.textContent||'').replace(/\s+/g,''))&&(e.textContent||'').replace(/\s+/g,'').length<16);
  const chain=[];let el=item;for(let i=0;i<4&&el;i++){chain.push({tag:el.tagName,cls:(el.className||'').slice(0,40),role:el.getAttribute&&el.getAttribute('role'),clickable:el.tagName==='A'||el.tagName==='BUTTON'||el.getAttribute&&el.getAttribute('role')==='button'||(el.className||'').includes('cursor')||!!el.onclick});el=el.parentElement;}
  return {itemHtml:item?item.outerHTML.slice(0,200):null,chain};
});
console.log(JSON.stringify(dump,null,1));
await browser.close();process.exit(0);
