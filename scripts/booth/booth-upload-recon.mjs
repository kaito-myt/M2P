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
// 全input[type=file](hidden含む)を列挙
const files=await page.evaluate(()=>[...document.querySelectorAll('input[type=file]')].map(f=>({name:f.name,accept:(f.accept||'').slice(0,50),id:f.id,hidden:f.offsetParent===null})));
console.log('全fileInput(hidden含む):',JSON.stringify(files,null,1));
// カテゴリ選択のオプション
await page.getByText('カテゴリを選択してください',{exact:false}).first().click({force:true}).catch(()=>{});
await page.waitForTimeout(2000);
const cats=await page.evaluate(()=>[...document.querySelectorAll('[role=option],li,option,a,button')].filter(e=>e.offsetParent!==null&&/小説|書籍|マンガ|漫画|アート|同人|テキスト|電子書籍|その他|イラスト/.test(e.textContent||'')&&(e.textContent||'').length<24).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).slice(0,20));
console.log('カテゴリ候補:',JSON.stringify([...new Set(cats)]));
await browser.close();process.exit(0);
