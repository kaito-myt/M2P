/** 各メインカテゴリ選択後の「サブカテゴリ」要素を洗い出す(特に AI生成)。 */
import { createRequire } from 'module'; import path from 'path'; import crypto from 'crypto';
const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
function dec(b64){ const raw=Buffer.from(b64,'base64'); const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(process.env.KDP_CRED_KEY,'hex'),raw.subarray(0,12)); d.setAuthTag(raw.subarray(12,28)); return Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString('utf8'); }
const c=new Client({connectionString:process.env.DBURL,ssl:{rejectUnauthorized:false}}); await c.connect();
const r=await c.query("SELECT bw_session_state_enc FROM app_settings WHERE id='singleton'"); await c.end();
const state=JSON.parse(dec(r.rows[0].bw_session_state_enc));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']});
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1400,height:1600}});
await ctx.addInitScript({content:'globalThis.__name=globalThis.__name||function(f){return f;};'});
const page=await ctx.newPage();
await page.goto('https://author.bookwalker.jp/books/new',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(6000);
if(!/books\/new/.test(page.url())||await page.$('input[type=password]')){ console.log('NOT_LOGGED_IN', page.url().slice(0,80)); await browser.close(); process.exit(2); }
for(const [name,val] of [['実用','4'],['ライトノベル','3'],['文芸・小説','1']]){
  // メインカテゴリのラジオをラベルクリック
  await page.evaluate((label)=>{ const el=[...document.querySelectorAll('label,span,button')].find(x=>(x.textContent||'').replace(/\s+/g,'').trim()===label.replace(/\s+/g,'')&&(x.offsetWidth||x.offsetHeight)); if(el)el.click(); const radio=document.querySelector('input[name=book_main_category][value="'+({'実用':'4','ライトノベル':'3','文芸・小説':'1'}[label])+'"]'); if(radio){radio.click();radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));} },name);
  await page.waitForTimeout(2500);
  const info=await page.evaluate(()=>{
    // 表示中のサブカテゴリ系チェック/ラジオを収集
    const items=[...document.querySelectorAll('input[type=checkbox],input[type=radio]')].filter(i=>{const l=(i.closest('label')?.textContent||i.parentElement?.textContent||'').replace(/\s+/g,'').trim(); return /AI生成|AI利用/.test(l) || (i.name&&/sub|genre|category/i.test(i.name));});
    const ai=[...document.querySelectorAll('*')].filter(e=>/^(AI生成|AI利用)$/.test((e.textContent||'').replace(/\s+/g,'').trim())&&(e.offsetWidth||e.offsetHeight));
    return {
      subInputs: items.map(i=>({name:i.name,value:i.value,type:i.type,checked:i.checked,label:(i.closest('label')?.textContent||i.parentElement?.textContent||'').replace(/\s+/g,'').trim().slice(0,20)})).slice(0,40),
      aiEls: ai.map(e=>({tag:e.tagName,cls:(e.className||'').slice(0,30),html:e.outerHTML.replace(/\s+/g,' ').slice(0,160)})),
    };
  });
  console.log(`\n===== メイン=${name} =====`);
  console.log('AI生成/AI利用 表示要素:', JSON.stringify(info.aiEls,null,1));
  console.log('sub/genre系input:', JSON.stringify(info.subInputs));
}
await browser.close(); process.exit(0);
