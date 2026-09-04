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
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1500,height:1400}});
const page=await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(9000);
// トップ「ビジネス・経済・投資」をクリック(ドリルダウン)
const before=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>/ビジネス・経済・投資/.test(e.textContent||'')&&e.children.length===0).map(e=>({tag:e.tagName,txt:(e.textContent||'').trim().slice(0,24)})).slice(0,3));
console.log('トップ要素:',JSON.stringify(before));
// クリックしてサブカテゴリ出現を観察
await page.locator('*').filter({hasText:/^ビジネス・経済・投資\s*›?$/}).last().click({force:true,timeout:8000}).catch(e=>console.log('click1 err',e.message.slice(0,40)));
await page.waitForTimeout(2500);
const sub=await page.evaluate(()=>[...document.querySelectorAll('li,a,button,[role=button]')].filter(e=>e.offsetParent!==null&&(e.textContent||'').replace(/\s+/g,'').length<20&&(e.textContent||'').replace(/\s+/g,'').length>2).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).slice(0,30));
console.log('ドリルダウン後の項目:',JSON.stringify([...new Set(sub)].slice(0,20)));
// 「一般」等の葉をクリック
for(const cand of ['ビジネス・経済・就職一般','投資・マネー','経営','ビジネス実用','起業・開業']){
  const leaf=page.locator('li,a,button,[role=button],span').filter({hasText:new RegExp('^'+cand+'$')}).first();
  if(await leaf.count().catch(()=>0)){await leaf.click({force:true}).catch(()=>{});await page.waitForTimeout(1500);
    const slot=await page.evaluate(()=>{const els=[...document.querySelectorAll('*')].filter(e=>/ジャンル\s*1/.test(e.textContent||'')&&(e.textContent||'').length<40);return els.map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).slice(0,3);});
    const red=await page.evaluate(()=>[...document.querySelectorAll('*')].some(e=>/1つ以上選択ください/.test(e.textContent||'')&&e.offsetParent!==null&&getComputedStyle(e).color.includes('rgb')));
    console.log('葉['+cand+']クリック→ ジャンル1枠:',JSON.stringify(slot),' 赤字残:',red);
    break;
  }
}
await page.screenshot({path:path.join(REPO,'scripts/kobo/out/genre-test.png'),fullPage:false,clip:{x:60,y:1900,width:900,height:600}}).catch(()=>{});
await browser.close();process.exit(0);
