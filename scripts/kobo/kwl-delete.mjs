/** 指定IDの作品を削除(取消)。DELETEエンドポイントを検証。 */
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
const ctx=await browser.newContext({storageState:state,locale:'ja-JP'});
const page=await ctx.newPage();
const id=process.argv[2];
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/'+id,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(6000);
const res=await page.evaluate(async(id)=>{
  const out=[];
  for(const [m,u] of [['DELETE','/product/'+id+'?productType=BOOK'],['DELETE','/product/'+id],['POST','/product/'+id+'/delete?productType=BOOK'],['POST','/product/'+id+'/cancel?productType=BOOK']]){
    try{const r=await fetch(u,{method:m});out.push(m+' '+u+' -> '+r.status);if(r.ok)break;}catch(e){out.push(m+' '+u+' -> ERR');}
  }
  return out;
},id);
console.log(res.join('\n'));
// 削除後の状態確認
await page.waitForTimeout(2000);
const st=await page.evaluate(async(id)=>{try{const r=await fetch('/product/'+id+'?productType=BOOK',{headers:{accept:'application/json'}});return r.status===404?'DELETED(404)':(await r.json()).status;}catch(e){return 'ERR';}},id);
console.log('削除後ステータス:',st);
await browser.close();process.exit(0);
