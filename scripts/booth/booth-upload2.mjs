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
// 商品画像エリア/作品ファイルの近くの構造(button, dropzone)
const areas=await page.evaluate(()=>{
  const out={};
  for(const key of ['商品画像','作品ファイル']){
    const lbl=[...document.querySelectorAll('label,h2,h3,legend,div,span')].find(e=>(e.textContent||'').trim().startsWith(key)&&(e.textContent||'').length<30);
    if(lbl){const sec=lbl.closest('div,section,fieldset')?.parentElement||lbl.parentElement;
      out[key]={btns:[...sec.querySelectorAll('button,a,[role=button],label')].filter(e=>e.offsetParent!==null).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,24)).filter(Boolean).slice(0,6),
        hasDropzone:!!sec.querySelector('[class*=drop],[class*=Drop],[class*=upload],[class*=Upload]')};}
  }
  return out;
});
console.log('アップロード領域:',JSON.stringify(areas,null,1));
// 「ファイルの追加・管理」クリック→filechooserが出るか
let fc=null;
page.on('filechooser',f=>{fc='FILECHOOSER出た';});
await page.getByText('ファイルの追加・管理',{exact:false}).first().click({force:true}).catch(e=>console.log('click err',e.message.slice(0,40)));
await page.waitForTimeout(3000);
const afterFile=await page.evaluate(()=>({files:[...document.querySelectorAll('input[type=file]')].map(f=>({accept:(f.accept||'').slice(0,40),hidden:f.offsetParent===null})),modal:[...document.querySelectorAll('[role=dialog],[class*=modal],[class*=Modal]')].filter(e=>e.offsetParent!==null).map(m=>(m.textContent||'').replace(/\s+/g,' ').trim().slice(0,60))}));
console.log('ファイル管理クリック後:',JSON.stringify(afterFile),'filechooser:',fc);
await browser.close();process.exit(0);
