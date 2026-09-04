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
// 言語欄の構造を精査: metadata.language select と、その周辺のcombobox/button
const struct=await page.evaluate(()=>{
  const sel=document.querySelector('[name="metadata.language"]');
  const info={selTag:sel?.tagName,selType:sel?.type,selHidden:sel?sel.offsetParent===null:null,selVal:sel?.value};
  // 「言語」ラベルを含むfieldset内のbutton/comboboxを探す
  const langLabel=[...document.querySelectorAll('label,legend,h2,h3,p')].find(e=>/言語/.test(e.textContent||'')&&(e.textContent||'').length<20);
  let container=langLabel?.closest('fieldset,section,div')?.parentElement;
  const combos=[];
  if(container){for(const el of container.querySelectorAll('button,[role=combobox],[role=button],[aria-haspopup]')){if(el.offsetParent!==null)combos.push({tag:el.tagName,role:el.getAttribute('role'),txt:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,30),haspopup:el.getAttribute('aria-haspopup')});}}
  return {info,combos:combos.slice(0,6)};
});
console.log('言語欄構造:',JSON.stringify(struct,null,1));
// 「言語をご選択ください」ボタンをクリック→リストボックス出現→日本語クリック
const btn=page.locator('button,[role=combobox],[role=button]').filter({hasText:/言語をご選択|言語を選択|Select language|言語/}).first();
const bc=await btn.count().catch(()=>0);
console.log('言語ボタン数:',bc);
if(bc){
  await btn.click({force:true}).catch(e=>console.log('btn click err',e.message.slice(0,40)));
  await page.waitForTimeout(2000);
  // オプションリスト(role=option or listbox li)
  const opts=await page.evaluate(()=>[...document.querySelectorAll('[role=option],[role=listbox] li,li[data-key],[class*=option]')].filter(e=>e.offsetParent!==null).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,20)).filter(Boolean).slice(0,20));
  console.log('オプション:',JSON.stringify(opts.slice(0,15)));
  const jp=page.locator('[role=option],[role=listbox] li,li').filter({hasText:/^日本語$/}).first();
  if(await jp.count().catch(()=>0)){await jp.click({force:true}).catch(e=>console.log('jp click err',e.message.slice(0,40)));console.log('日本語クリック');}
  await page.waitForTimeout(1500);
  const after=await page.evaluate(()=>({selVal:document.querySelector('[name="metadata.language"]')?.value, comboTxt:[...document.querySelectorAll('button,[role=combobox]')].map(b=>(b.textContent||'').trim()).find(t=>/日本語|語$/.test(t))}));
  console.log('選択後:',JSON.stringify(after));
}
await browser.close();process.exit(0);
