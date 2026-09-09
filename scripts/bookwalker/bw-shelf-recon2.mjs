import { createRequire } from 'module';
import path from 'path';
const SP=new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const REPO=path.resolve(path.dirname(SP),'../..');
const req=createRequire(path.join(REPO,'apps/worker/package.json'));
const {chromium}=req('playwright');
const persist=await chromium.launchPersistentContext(path.join(REPO,'scripts/.bw-userdata2'),{headless:true,channel:'chrome'});
const state=await persist.storageState();await persist.close();
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']});
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1500,height:1400}});
const page=await ctx.newPage();
await page.goto('https://author.bookwalker.jp/books',{waitUntil:'networkidle',timeout:40000}).catch(()=>{});
await page.waitForTimeout(6000);
// スクロールして遅延読み込み
for(let i=0;i<4;i++){await page.mouse.wheel(0,1200);await page.waitForTimeout(1500);}
const info=await page.evaluate(()=>{
  const bodyText=(document.body.innerText||'').replace(/\s+/g,' ');
  // 申請状態リンク(本の詳細/編集URL)
  const links=[...document.querySelectorAll('a[href*="/books/"]')].map(a=>({t:(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,40),href:a.getAttribute('href')})).filter(x=>x.href&&x.href!=='/books').slice(0,20);
  const status=[...new Set(bodyText.match(/申請中|審査中|返却|差し戻し|下書き|販売中|却下|要修正|非公開|公開中/g)||[])];
  return {status,links,textHead:bodyText.slice(0,600)};
});
console.log('ステータス語:',JSON.stringify(info.status));
console.log('本リンク:',JSON.stringify(info.links,null,1));
console.log('本文冒頭:',info.textHead);
await browser.close();process.exit(0);
