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
// 内容紹介エディタ
const desc=await page.evaluate(()=>{
  const ce=[...document.querySelectorAll('[contenteditable=true],[role=textbox],.ql-editor,[class*=editor]')].filter(e=>e.offsetParent!==null).map(e=>({tag:e.tagName,cls:e.className.slice(0,40),role:e.getAttribute('role'),ce:e.getAttribute('contenteditable')}));
  return ce.slice(0,5);
});
console.log('内容紹介エディタ候補:',JSON.stringify(desc,null,1));
// ジャンルツリー: トップカテゴリのリンクをクリックして挙動を見る
const cats=await page.evaluate(()=>[...document.querySelectorAll('a,button,[role=button],li')].filter(e=>/ビジネス・経済|表現・暮らし|ノンフィクション/.test(e.textContent||'')&&(e.textContent||'').length<30&&e.offsetParent!==null).map(e=>({tag:e.tagName,txt:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,24)})).slice(0,8));
console.log('ジャンル候補:',JSON.stringify(cats));
// ビジネス系をクリックしてサブが出るか
const biz=page.locator('a,button,[role=button],li,span').filter({hasText:/^ビジネス・経済・投資/}).first();
if(await biz.count().catch(()=>0)){
  await biz.click({force:true}).catch(e=>console.log('biz err',e.message.slice(0,40)));
  await page.waitForTimeout(2500);
  const after=await page.evaluate(()=>{
    const sub=[...document.querySelectorAll('a,button,li,[role=button]')].filter(e=>e.offsetParent!==null&&(e.textContent||'').length<24&&(e.textContent||'').length>1).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).filter(t=>/投資|経営|マネー|起業|ビジネス|経済|自己啓発|副業/.test(t)).slice(0,12);
    const chosen=[...document.querySelectorAll('*')].filter(e=>/ご選択中のジャンル/.test(e.textContent||'')).slice(0,1).map(e=>(e.parentElement?.textContent||'').replace(/\s+/g,' ').trim().slice(0,80));
    return {sub:[...new Set(sub)],chosen};
  });
  console.log('ビジネスクリック後サブ:',JSON.stringify(after.sub));
  console.log('選択中ジャンル:',JSON.stringify(after.chosen));
}
await browser.close();process.exit(0);
