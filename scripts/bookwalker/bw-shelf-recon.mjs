/** BW著者センターの本棚: 返却された申請の状態(再申請ボタン/編集動線)を偵察 */
import { createRequire } from 'module';
import path from 'path';
const SP=new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const REPO=path.resolve(path.dirname(SP),'../..');
const req=createRequire(path.join(REPO,'apps/worker/package.json'));
const {chromium}=req('playwright');
const persist=await chromium.launchPersistentContext(path.join(REPO,'scripts/.bw-userdata2'),{headless:true,channel:'chrome'});
const state=await persist.storageState();await persist.close();
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']});
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1500,height:1200}});
const page=await ctx.newPage();
await page.goto('https://author.bookwalker.jp/books',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(8000);
console.log('URL:',page.url(),'title:',await page.title().catch(()=>'?'));
const info=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('[class*=book],[class*=item],tr,li')].filter(e=>/申請|審査|返却|下書き|販売中|却下|差し戻/.test(e.textContent||'')).slice(0,10).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,90));
  const statusWords=[...new Set((document.body.innerText||'').match(/申請中|審査中|返却|差し戻し|下書き|販売中|却下|要修正/g)||[])];
  const buttons=[...document.querySelectorAll('a,button')].map(b=>(b.textContent||'').replace(/\s+/g,' ').trim()).filter(t=>/申請|編集|再|修正|削除|取り下げ/.test(t)).slice(0,15);
  return {rows,statusWords,buttons,count:(document.body.innerText||'').length};
});
console.log('ステータス語:',JSON.stringify(info.statusWords));
console.log('行サンプル:',JSON.stringify(info.rows,null,1));
console.log('操作ボタン:',JSON.stringify(info.buttons));
await page.screenshot({path:path.join(REPO,'scripts/bookwalker/out/shelf.png'),fullPage:true}).catch(()=>{});
await browser.close();process.exit(0);
