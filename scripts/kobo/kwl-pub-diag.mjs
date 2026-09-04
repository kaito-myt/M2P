/** 新規フォームで全入力→出版クリック後の エラー/モーダル/トースト を精密捕捉 */
import { createRequire } from 'module';
import path from 'path'; import fs from 'fs'; import crypto from 'crypto';
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
const bq=await c.query("SELECT b.title,b.subtitle,(SELECT description FROM kdp_metadata WHERE book_id=b.id ORDER BY created_at DESC LIMIT 1) description,(SELECT price_jpy FROM kdp_metadata WHERE book_id=b.id ORDER BY created_at DESC LIMIT 1) price FROM books b WHERE b.id=$1",[bookId]);
const sess=await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'");await c.end();
const {title,subtitle,description,price}=bq.rows[0];
const descText=String(description||'').replace(/<[^>]+>/g,'').trim();
const state=JSON.parse(dec(sess.rows[0].kobo_session_state_enc));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']});
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1500,height:1400}});
await ctx.addInitScript({content:'globalThis.__name=globalThis.__name||function(f){return f;};'});
const page=await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(9000);
const fill=async(n,v)=>{const e=await page.$(`[name="${n}"]`);if(e&&v){await e.click().catch(()=>{});await e.fill(String(v)).catch(()=>{});}};
await fill('metadata.title',title);await fill('metadata.subtitle',subtitle||'');
await fill('metadata.contributors[0].name','宮田海斗');await fill('metadata.publisher','宮田海斗');
const db=await page.$('textarea');if(db){await db.click().catch(()=>{});await db.fill(descText.slice(0,3000)).catch(()=>{});}
const langRes=await page.selectOption('[name="metadata.language"]',{label:'日本語'}).catch(e=>'ERR:'+e.message.slice(0,30));
console.log('language選択:',JSON.stringify(langRes));
await page.evaluate(()=>{for(const nm of ['metadata.publicDomainContent']){const rs=[...document.querySelectorAll(`input[name="${nm}"]`)];for(const r of rs){const l=(r.closest('label')?.textContent||'').trim();if(l.includes('いいえ'))r.click();}}const ow=[...document.querySelectorAll('input[name="ownWorldwideRights"]')];for(const r of ow){const l=(r.closest('label')?.textContent||'').trim();if(l.includes('はい'))r.click();}});
const fis=await page.$$('input[type=file]');for(const fi of fis){const a=(await fi.getAttribute('accept'))||'';if(/image|jpe?g|png/.test(a))await fi.setInputFiles(path.join(OUT,bookId+'-cover.jpg')).catch(()=>{});else if(/epub/.test(a))await fi.setInputFiles(path.join(OUT,bookId+'.epub')).catch(()=>{});}
await page.waitForTimeout(25000);
await fill('prices[0]',String(price||680));
await page.waitForTimeout(1500);
// 出版前の必須未入力チェック
const pre=await page.evaluate(()=>{const vis=e=>e.offsetParent!==null;return{title:document.querySelector('[name="metadata.title"]')?.value,lang:document.querySelector('[name="metadata.language"]')?.value,price:document.querySelector('[name="prices[0]"]')?.value,pubBtn:!!document.querySelector('button')&&[...document.querySelectorAll('button')].some(b=>/出版する/.test(b.textContent||''))};});
console.log('入力状態:',JSON.stringify(pre));
// 出版クリック
await page.locator('button').filter({hasText:/^出版する$/}).first().click({force:true,noWaitAfter:true,timeout:8000}).catch(e=>console.log('click err',e.message.slice(0,40)));
await page.waitForTimeout(5000);
const post=await page.evaluate(()=>{const vis=e=>e.offsetParent!==null;
  const errs=[...document.querySelectorAll('[class*=error],[class*=Error],[role=alert],[aria-invalid=true]')].filter(vis).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,90)).filter(Boolean);
  const modal=[...document.querySelectorAll('[role=dialog],[class*=modal],[class*=Modal]')].filter(vis).map(m=>(m.textContent||'').replace(/\s+/g,' ').trim().slice(0,120));
  const toasts=[...document.querySelectorAll('[class*=toast],[class*=Toast],[class*=notif],[class*=snack]')].filter(vis).map(t=>(t.textContent||'').replace(/\s+/g,' ').trim().slice(0,80));
  const btns=[...document.querySelectorAll('[role=dialog] button,[class*=modal] button')].filter(vis).map(b=>(b.textContent||'').trim().slice(0,20));
  return{errs:[...new Set(errs)].slice(0,8),modal:[...new Set(modal)].slice(0,3),toasts,modalBtns:btns};});
console.log('出版後エラー:',JSON.stringify(post.errs));
console.log('モーダル:',JSON.stringify(post.modal));
console.log('モーダルボタン:',JSON.stringify(post.modalBtns));
console.log('トースト:',JSON.stringify(post.toasts));
console.log('URL:',page.url());
await page.screenshot({path:path.join(REPO,'scripts/kobo/out/pub-diag.png'),fullPage:true}).catch(()=>{});
await browser.close();process.exit(0);
