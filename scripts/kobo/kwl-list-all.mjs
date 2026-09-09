/** 全作品(下書き含む)をAPIで列挙し、状態を一覧。削除/取消のエンドポイントも探る。 */
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
// 作品一覧のAPIを傍受
const apis=[];
page.on('request',rq=>{const u=rq.url();if(/product|ebook|list|search/i.test(u)&&!/\.(js|css|png|jpg|woff|svg)|rum/.test(u))apis.push(rq.method()+' '+u.replace(/https?:\/\/[^/]+/,'@'));});
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(9000);
console.log('一覧API:');[...new Set(apis)].slice(0,10).forEach(x=>console.log('  '+x.slice(0,120)));
// 一覧を取得(検出したエンドポイント候補)
const list=await page.evaluate(async()=>{
  for(const u of ['/product?productType=BOOK','/products?productType=BOOK','/v2/products','/product/list']){
    try{const res=await fetch(u,{headers:{accept:'application/json'}});if(res.ok){const j=await res.json();return{u,j};}}catch(e){}
  }
  return null;
});
if(list){console.log('一覧エンドポイント:',list.u);const arr=Array.isArray(list.j)?list.j:(list.j.products||list.j.items||list.j.data||[]);
  console.log('作品数:',arr.length);
  const byTitle={};
  for(const p of arr){const t=(p.metadata?.title||p.title||'').slice(0,20);const st=p.status;const id=p.id||p.productId;byTitle[t]=byTitle[t]||[];byTitle[t].push({id:(id||'').slice(0,8),st});}
  for(const t in byTitle)console.log(`  「${t}」×${byTitle[t].length}:`,JSON.stringify(byTitle[t]));
}else console.log('一覧取得失敗');
await browser.close();process.exit(0);
