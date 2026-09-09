import { createRequire } from 'module';
import path from 'path';
const SP=new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const REPO=path.resolve(path.dirname(SP),'../..');
const req=createRequire(path.join(REPO,'apps/worker/package.json'));
const {chromium}=req('playwright');
const ctx=await chromium.launchPersistentContext(path.join(REPO,'scripts/.bw-userdata2'),{headless:true,channel:'chrome',locale:'ja-JP',viewport:{width:1500,height:1400},args:['--disable-blink-features=AutomationControlled']});
const page=ctx.pages()[0]??await ctx.newPage();
// 申請一覧のAPIレスポンスを捕捉
const apis=[];
page.on('response',async r=>{const u=r.url();if(/\/api\/.*(book|application|shinsei|status)/i.test(u)&&r.request().method()==='GET'){try{const t=await r.text();apis.push({u:u.replace(/https?:\/\/[^/]+/,''),len:t.length,head:t.slice(0,200)});}catch{}}});
await page.goto('https://author.bookwalker.jp/books',{waitUntil:'domcontentloaded'});
// 本のリストが出るまで最大25秒
let items=[];
for(let i=0;i<12;i++){
  await page.waitForTimeout(2500);
  items=await page.evaluate(()=>{
    const out=[];
    for(const a of document.querySelectorAll('a[href*="/books/"]')){const h=a.getAttribute('href');if(h&&h!=='/books'&&!/\/new$/.test(h))out.push({t:(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,36),href:h});}
    return out;
  });
  if(items.length)break;
}
const status=await page.evaluate(()=>[...new Set((document.body.innerText||'').match(/申請中|審査中|返却|差し戻し|下書き|販売中|却下|要修正|非公開/g)||[])]);
console.log('本リンク数:',items.length);
console.log(JSON.stringify(items.slice(0,12),null,1));
console.log('ステータス語:',JSON.stringify(status));
console.log('API:',JSON.stringify(apis.slice(0,5),null,1));
await ctx.close();process.exit(0);
