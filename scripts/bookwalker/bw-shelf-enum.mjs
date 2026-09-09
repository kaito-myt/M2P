/** 本棚を全ページ走査し、各書籍の bwId/タイトル/価格/カテゴリ/ステータス/操作を列挙。 */
import { createRequire } from 'module'; import path from 'path'; import fs from 'fs'; import crypto from 'crypto';
const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
function dec(b64){ const raw=Buffer.from(b64,'base64'); const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(process.env.KDP_CRED_KEY,'hex'),raw.subarray(0,12)); d.setAuthTag(raw.subarray(12,28)); return Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString('utf8'); }
const c=new Client({connectionString:process.env.DBURL,ssl:{rejectUnauthorized:false}}); await c.connect();
const r=await c.query("SELECT bw_session_state_enc FROM app_settings WHERE id='singleton'"); await c.end();
const state=JSON.parse(dec(r.rows[0].bw_session_state_enc));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({storageState:state,locale:'ja-JP',viewport:{width:1400,height:2400}});
await ctx.addInitScript({content:'globalThis.__name=globalThis.__name||function(f){return f;};'});
const page=await ctx.newPage();
const all=[];
for(let p=1;p<=12;p++){
  await page.goto('https://author.bookwalker.jp/library/bookshelf?page='+p,{waitUntil:'networkidle',timeout:45000}).catch(()=>{});
  await page.waitForTimeout(2500);
  if(p===1 && (!/bookshelf/.test(page.url())||await page.$('input[type=password]'))){ console.log('NOT_LOGGED_IN'); break; }
  const rows=await page.evaluate(()=>{
    const out=[];
    for(const el of document.querySelectorAll('a.js-booksample[data-url],a.js-bookviewer[data-url]')){
      const id=(el.getAttribute('data-url').match(/\/books\/(\d+)/)||[])[1]; if(!id) continue;
      let box=el; for(let i=0;i<7&&box.parentElement;i++){ box=box.parentElement; if(/円（税別）/.test(box.textContent||'')) break; }
      const t=(box.textContent||'').replace(/\s+/g,' ').trim();
      const drop=box.querySelector('a.js-bookdrop');
      const title=drop?.getAttribute('data-title')||(t.match(/^(.*?)\s*宮田海斗/)||[])[1]||t.slice(0,40);
      let status='取り下げ/未販売';
      if(drop) status='申請中';
      else if(/申請が却下されました/.test(t)) status='却下';
      else if(/予約受付中|発売日|販売中/.test(t)) status='販売中/予約';
      out.push({id,title:title.slice(0,44),status,btns:''});
    }
    return out;
  });
  if(rows.length===0) break;
  all.push(...rows);
  // 次ページが無ければ終了
  const hasNext=await page.evaluate((cur)=>!![...document.querySelectorAll('a')].find(a=>a.textContent.trim()===String(cur+1)||/次|>>/.test(a.textContent)), p);
  if(!hasNext) break;
}
await browser.close();
const uniq={}; for(const x of all){ if(x.id) uniq[x.id]=x; }
const list=Object.values(uniq);
const byStatus={}; for(const x of list){ byStatus[x.status]=(byStatus[x.status]||0)+1; }
console.log('総数:',list.length,'/ ステータス:',JSON.stringify(byStatus));
fs.writeFileSync(path.join(REPO,'scripts/bookwalker/shelf-enum.json'),JSON.stringify(list,null,1));
console.log('\n--- 申請中 ---');
for(const x of list.filter(x=>x.status==='申請中')) console.log(`  ${x.id}\t${x.title}\t[${x.btns}]`);
console.log('\n--- 却下 ---');
for(const x of list.filter(x=>x.status==='却下')) console.log(`  ${x.id}\t${x.title}`);
console.log('\n保存: scripts/bookwalker/shelf-enum.json');
process.exit(0);
