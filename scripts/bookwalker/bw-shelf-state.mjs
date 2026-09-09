/** 著者センター本棚の現状(冊数・各本のステータス・編集導線)をDBセッションで取得。 */
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
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1400,height:1400}});
await ctx.addInitScript({content:'globalThis.__name=globalThis.__name||function(f){return f;};'});
const page=await ctx.newPage();
const apis=[];
page.on('response',async(rp)=>{const u=rp.url();const m=rp.request().method();if(m==='GET'&&/author\.bookwalker\.jp\/api\//.test(u)&&/(book|application|shelf|list)/i.test(u)){try{const t=await rp.text();apis.push({u:u.replace(/https?:\/\/[^/]+/,''),len:t.length,head:t.slice(0,400)});}catch{}}});
await page.goto('https://author.bookwalker.jp/books',{waitUntil:'networkidle',timeout:45000}).catch(()=>{});
await page.waitForTimeout(4000);
if(!/author\.bookwalker/.test(page.url())||await page.$('input[type=password]')){ console.log('NOT_LOGGED_IN', page.url().slice(0,80)); await browser.close(); process.exit(2); }
// DOM側: 各本カードのタイトル+ステータス+リンク
const dom=await page.evaluate(()=>{
  const cards=[...document.querySelectorAll('a[href*="/books/"]')].map(a=>({href:a.getAttribute('href'),t:(a.closest('[class*=item],[class*=card],li,tr')?.textContent||a.textContent||'').replace(/\s+/g,' ').trim().slice(0,80)})).filter(x=>x.href&&x.href!=='/books'&&!/\/new$/.test(x.href));
  const uniq={}; for(const x of cards) uniq[x.href]=x;
  const statusWords=(document.body.innerText||'').match(/申請中|審査中|返却|差し戻し|下書き|販売中|却下|要修正|非公開|公開中|取り下げ|販売準備中/g)||[];
  const counts={}; for(const w of statusWords) counts[w]=(counts[w]||0)+1;
  return {books:Object.values(uniq).slice(0,60), statusCounts:counts, total:Object.keys(uniq).length};
});
console.log('本棚URL:',page.url());
console.log('本リンク総数:',dom.total);
console.log('ステータス内訳:',JSON.stringify(dom.statusCounts));
console.log('本サンプル:'); for(const b of dom.books.slice(0,30)) console.log('  ',b.href,'|',b.t.slice(0,50));
console.log('\nAPI(books/application系):'); for(const a of apis.slice(0,10)) console.log('  ',a.u,`(${a.len}b)`,a.head.slice(0,120).replace(/\s+/g,' '));
await page.screenshot({path:path.join(REPO,'scripts/bookwalker/out/shelf-state.png'),fullPage:true}).catch(()=>{});
await browser.close(); process.exit(0);
