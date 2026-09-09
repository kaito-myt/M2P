import { createRequire } from 'module';
import path from 'path'; import crypto from 'crypto';
const SP=new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const REPO=path.resolve(path.dirname(SP),'../..');
const req=createRequire(path.join(REPO,'apps/worker/package.json'));
const reqRoot=createRequire(path.join(REPO,'package.json'));
const {chromium}=req('playwright');
const {Client}=reqRoot(path.join(REPO,'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT=path.join(REPO,'scripts/bookwalker/out');
function dec(b64){const raw=Buffer.from(b64,'base64');const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(process.env.KDP_CRED_KEY,'hex'),raw.subarray(0,12));d.setAuthTag(raw.subarray(12,28));return Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString('utf8');}
const bookId=process.argv[2];
const c=new Client({connectionString:process.env.DBURL,ssl:{rejectUnauthorized:false}});await c.connect();
const bq=await c.query("SELECT b.title,b.subtitle,tc.genre,(SELECT description FROM kdp_metadata WHERE book_id=b.id ORDER BY created_at DESC LIMIT 1) description,(SELECT price_jpy FROM kdp_metadata WHERE book_id=b.id ORDER BY created_at DESC LIMIT 1) price FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id WHERE b.id=$1",[bookId]);
const s=await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'");await c.end();
const {title,subtitle,description,price}=bq.rows[0];
const descText=String(description||'').replace(/<[^>]+>/g,'').trim();
const state=JSON.parse(dec(s.rows[0].kobo_session_state_enc));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']});
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1500,height:1400}});
await ctx.addInitScript({content:'globalThis.__name=globalThis.__name||function(f){return f;};'});
const page=await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(9000);
const fill=async(n,v)=>{const e=await page.$(`[name="${n}"]`);if(e&&v){await e.click().catch(()=>{});await e.fill(String(v)).catch(()=>{});}};
await fill('metadata.title',title);await fill('metadata.contributors[0].name','宮田海斗');await fill('metadata.publisher','宮田海斗');
const ed=page.locator('.ql-editor').first();if(await ed.count().catch(()=>0)){await ed.click().catch(()=>{});await page.keyboard.type(descText.slice(0,500),{delay:2});}
const lb=page.locator('button,[role=combobox]').filter({hasText:/言語をご選択/}).first();if(await lb.count().catch(()=>0)){await lb.click({force:true}).catch(()=>{});await page.waitForTimeout(1200);await page.locator('[role=option],li').filter({hasText:/^日本語$/}).first().click({force:true}).catch(()=>{});}
const fis=await page.$$('input[type=file]');for(const fi of fis){const a=(await fi.getAttribute('accept'))||'';if(/image|jpe?g|png/.test(a))await fi.setInputFiles(path.join(OUT,bookId+'-cover.jpg')).catch(()=>{});else if(/epub/.test(a))await fi.setInputFiles(path.join(OUT,bookId+'.epub')).catch(()=>{});}
await page.waitForTimeout(25000);
await page.locator('li,a,button').filter({hasText:/^ビジネス・経済・就職一般$/}).first().click({force:true}).catch(()=>{});
await page.waitForTimeout(1000);
// 出版クリック
await page.locator('button').filter({hasText:/^出版する$/}).first().click({force:true,noWaitAfter:true}).catch(()=>{});
await page.waitForTimeout(4000);
// 各「必須項目です」の直近input/labelを精密特定
const pin=await page.evaluate(()=>{
  const vis=e=>e.offsetParent!==null;
  const out=[];
  for(const err of [...document.querySelectorAll('*')].filter(e=>vis(e)&&e.children.length===0&&/必須項目です/.test((e.textContent||'').trim()))){
    // 同じ親コンテナ内のinput/select/contenteditable/labelを探す
    let cont=err.parentElement;let field=null,label=null;
    for(let i=0;i<4&&cont&&!field;i++){field=cont.querySelector('input,select,textarea,[contenteditable=true],[role=combobox],[role=button][aria-haspopup]');label=cont.querySelector('label,legend');if(!field)cont=cont.parentElement;}
    out.push({field:field?(field.getAttribute('name')||field.getAttribute('aria-label')||field.getAttribute('role')||field.tagName):'?',fval:field?(field.value||field.textContent||'').slice(0,15):'',label:label?(label.textContent||'').replace(/\s+/g,' ').trim().slice(0,24):''});
  }
  return out;
});
console.log('必須未入力の精密特定:',JSON.stringify(pin,null,1));
await browser.close();process.exit(0);
