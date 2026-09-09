/** 自分のKobo商品を全列挙(searchv2 API)。UUID+タイトル+ステータス。 */
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
// searchv2のリクエスト/レスポンスを捕捉
let searchBody=null,searchResp=null;
page.on('request',rq=>{if(/searchv2/.test(rq.url())&&rq.method()==='POST'){try{searchBody=rq.postData();}catch(e){}}});
page.on('response',async rp=>{if(/searchv2/.test(rp.url())&&rp.request().method()==='POST'){try{searchResp=await rp.json();}catch(e){}}});
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(9000);
console.log('searchv2 body:',(searchBody||'').slice(0,200));
if(searchResp){
  const arr=searchResp.results||searchResp.hits||searchResp.items||searchResp.products||(Array.isArray(searchResp)?searchResp:[]);
  console.log('検索結果件数:',arr.length);
  console.log('レスポンスkeys:',Object.keys(searchResp).slice(0,10));
  for(const p of arr.slice(0,30)){const id=p.id||p.productId||p.workId||p.objectID;const t=(p.title||p.metadata?.title||p.name||'').slice(0,18);const st=p.status||p.state;console.log(`  ${(id||'?').slice(0,10)} [${st}] ${t}`);}
}else console.log('searchv2レスポンス取得できず');
await browser.close();process.exit(0);
