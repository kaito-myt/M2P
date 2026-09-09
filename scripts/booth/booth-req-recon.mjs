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
await page.goto('https://manage.booth.pm/items/8804766/edit',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(7000);
// カテゴリを開いてオプション
await page.getByText('カテゴリを選択してください',{exact:false}).first().click({force:true}).catch(()=>{});
await page.waitForTimeout(2500);
const cats=await page.evaluate(()=>[...document.querySelectorAll('[role=option],li,option,a,button,div')].filter(e=>e.offsetParent!==null&&/小説|書籍|テキスト|マンガ|漫画|同人誌|電子書籍|イラスト|素材|音楽|その他|アート/.test((e.textContent||'').trim())&&(e.textContent||'').replace(/\s+/g,'').length<20).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).slice(0,25));
console.log('カテゴリ候補:',JSON.stringify([...new Set(cats)]));
// 紹介文エディタ(rich text)
const desc=await page.evaluate(()=>[...document.querySelectorAll('[contenteditable=true],[role=textbox],.ProseMirror,.ql-editor,textarea')].filter(e=>e.offsetParent!==null).map(e=>({tag:e.tagName,cls:e.className.slice(0,30),ce:e.getAttribute('contenteditable')})).slice(0,4));
console.log('紹介文エディタ:',JSON.stringify(desc));
// 代理購入許可select
const proxy=await page.evaluate(()=>{const sels=[...document.querySelectorAll('select')].filter(s=>s.offsetParent!==null);return sels.map(s=>({name:s.name,opts:[...s.options].map(o=>o.textContent.trim()).slice(0,5)}));});
console.log('select群(代理購入等):',JSON.stringify(proxy,null,1));
// 商品名/価格の実セレクタ
const inputs=await page.evaluate(()=>[...document.querySelectorAll('input[type=text],input:not([type])')].filter(e=>e.offsetParent!==null).map(e=>({name:e.name,id:e.id.slice(0,20),ph:(e.placeholder||'').slice(0,16),label:(e.labels&&e.labels[0]?.textContent||'').replace(/\s+/g,' ').trim().slice(0,16)})).slice(0,10));
console.log('テキスト入力:',JSON.stringify(inputs,null,1));
await browser.close();process.exit(0);
