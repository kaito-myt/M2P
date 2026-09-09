/** 公開済み本と下書きの product JSON をAPIで取得し、出版を表すフィールド差分を特定 */
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
const PUB='a8c1390a-6971-4fca-9807-63d41feba540'; // 公開済(ユーザーが出版)
const DRAFT='e707e1f2-98e4-4d7e-b79b-d879aade3739'; // 作成中
// GET /product APIをページ内fetchで叩く(セッションCookie付き)
async function getProduct(id){
  await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/'+id,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(6000);
  return await page.evaluate(async(id)=>{
    for(const u of ['/product/'+id+'?productType=BOOK']){
      try{const res=await fetch(u,{headers:{accept:'application/json'}});if(res.ok){return{url:u,status:res.status,body:await res.json()};}}catch(e){}
    }
    return null;
  },id);
}
const pub=await getProduct(PUB);
const draft=await getProduct(DRAFT);
const flat=(o,p='')=>{let out={};for(const k in o){const v=o[k];const key=p?p+'.'+k:k;if(v&&typeof v==='object'&&!Array.isArray(v))Object.assign(out,flat(v,key));else out[key]=Array.isArray(v)?JSON.stringify(v).slice(0,40):v;}return out;};
if(pub&&draft){
  console.log('APIエンドポイント:',pub.url);
  const fp=flat(pub.body),fd=flat(draft.body);
  console.log('=== 差分(公開 vs 下書き) ===');
  for(const k of new Set([...Object.keys(fp),...Object.keys(fd)])){
    if(String(fp[k])!==String(fd[k])&&!/title|description|contributor|isbn|price|updated|created|id$|Id$|slug/i.test(k)){
      console.log(`  ${k}: 公開=${JSON.stringify(fp[k])} 下書き=${JSON.stringify(fd[k])}`);
    }
  }
  console.log('=== statusっぽいキー ===');
  for(const k of Object.keys(fp))if(/status|state|publish|workflow|stage|active|live/i.test(k))console.log(`  ${k}: 公開=${JSON.stringify(fp[k])} 下書き=${JSON.stringify(fd[k])}`);
}else{console.log('取得失敗 pub=',!!pub,'draft=',!!draft); if(pub)console.log('pubキー:',Object.keys(pub.body||{}).slice(0,20));}
await browser.close();process.exit(0);
