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
await page.getByText('ファイルの追加・管理',{exact:false}).first().click({force:true}).catch(()=>{});
await page.waitForTimeout(4000);
// モーダル/新領域の詳細
const m=await page.evaluate(()=>{
  const vis=e=>e.offsetParent!==null;
  const modal=[...document.querySelectorAll('[role=dialog],[class*=modal],[class*=Modal],[class*=Drawer],[class*=drawer]')].filter(vis);
  const out=modal.map(md=>({text:(md.textContent||'').replace(/\s+/g,' ').trim().slice(0,120),btns:[...md.querySelectorAll('button,label,a')].filter(vis).map(b=>(b.textContent||'').replace(/\s+/g,' ').trim().slice(0,20)).filter(Boolean).slice(0,8),files:md.querySelectorAll('input[type=file]').length}));
  const allFiles=[...document.querySelectorAll('input[type=file]')].map(f=>({accept:(f.accept||'').slice(0,40),hidden:f.offsetParent===null}));
  return {modalCount:modal.length,modals:out.filter(x=>x.text||x.btns.length),allFiles};
});
console.log('モーダル詳細:',JSON.stringify(m,null,1));
// filechooserも待ちつつ「ファイルを選択/アップロード」的ボタンをクリック
let fcSeen=false; page.on('filechooser',()=>{fcSeen=true;});
await page.getByText(/ファイルを選択|アップロード|ファイルを追加|参照/,{exact:false}).first().click({force:true,timeout:5000}).catch(e=>console.log('upload btn click:',e.message.slice(0,40)));
await page.waitForTimeout(2500);
const after=await page.evaluate(()=>[...document.querySelectorAll('input[type=file]')].map(f=>({accept:(f.accept||'').slice(0,40),hidden:f.offsetParent===null})));
console.log('アップロードボタン後 file input:',JSON.stringify(after),'filechooser:',fcSeen);
await browser.close();process.exit(0);
