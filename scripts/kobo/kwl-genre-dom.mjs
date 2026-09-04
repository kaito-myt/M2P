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
// 「ビジネス・経済・投資」トップ要素のDOM詳細
const dom=await page.evaluate(()=>{
  const top=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^ビジネス・経済・投資\s*›?$/.test((e.textContent||'').trim()));
  if(!top)return{err:'no-top'};
  // クリック可能な祖先
  let clickable=top;for(let i=0;i<4;i++){const p=clickable.parentElement;if(!p)break;if(p.tagName==='BUTTON'||p.tagName==='A'||p.getAttribute('role')==='button'||p.onclick||p.className.includes('cursor'))clickable=p;else break;}
  return{topTag:top.tagName,topTxt:(top.textContent||'').trim(),clickTag:clickable.tagName,clickRole:clickable.getAttribute('role'),clickCls:clickable.className.slice(0,60)};
});
console.log('トップDOM:',JSON.stringify(dom));
// そのトップをクリック(祖先経由)して子を観察
await page.evaluate(()=>{
  const top=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^ビジネス・経済・投資\s*›?$/.test((e.textContent||'').trim()));
  let cl=top;for(let i=0;i<4;i++){const p=cl.parentElement;if(p&&(p.tagName==='BUTTON'||p.tagName==='A'||p.getAttribute('role')==='button'))cl=p;else break;}
  cl.click();
});
await page.waitForTimeout(2500);
const children=await page.evaluate(()=>[...document.querySelectorAll('li,a,button,[role=button]')].filter(e=>e.offsetParent!==null).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).filter(t=>t.length>1&&t.length<20&&!/ダッシュボード|マイアカウント|ヘルプ|ログアウト|作品一覧|楽天|スキップ/.test(t)).slice(0,30));
console.log('クリック後の可視項目:',JSON.stringify([...new Set(children)]));
await browser.close();process.exit(0);
