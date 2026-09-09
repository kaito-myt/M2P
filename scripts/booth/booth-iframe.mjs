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
console.log('クリック前URL:',page.url());
console.log('iframe数(前):',page.frames().length);
await page.getByText('ファイルの追加・管理',{exact:false}).first().click({force:true}).catch(()=>{});
await page.waitForTimeout(5000);
console.log('クリック後URL:',page.url());
console.log('iframe:',page.frames().map(f=>f.url()).filter(u=>u&&u!=='about:blank').slice(0,5));
// フレーム内のfile input
for(const f of page.frames()){const n=await f.evaluate(()=>document.querySelectorAll('input[type=file]').length).catch(()=>0);if(n)console.log('frame',f.url().slice(0,50),'file input数:',n);}
// ページ全体のfile input(改めて)
const files=await page.evaluate(()=>[...document.querySelectorAll('input[type=file]')].map(f=>({accept:(f.accept||'').slice(0,40),hidden:f.offsetParent===null})));
console.log('全file input:',JSON.stringify(files));
await page.screenshot({path:path.join(REPO,'scripts/booth/out/filemodal.png'),fullPage:true}).catch(()=>{});
await browser.close();process.exit(0);
