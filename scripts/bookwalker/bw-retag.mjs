/**
 * BW 却下/申請中 書籍の再申請: [申請中なら取り下げ]→編集画面→「AI生成」サブカテゴリ付与＋内容紹介を文末で整形
 * ＋クリーンEPUB(販売用/試し読み)＋表紙を再アップ→再申請。[F-094 却下理由①②の恒久対応]
 *   bash scripts/paperback/pb-env.sh node scripts/bookwalker/bw-retag.mjs <bwId> [--withdraw] [--dry]
 * タイトル照合で当方 books.id を特定し、素材が無ければ build-epub / bw-cover-jpg で生成。
 */
import { createRequire } from 'module'; import path from 'path'; import fs from 'fs'; import crypto from 'crypto';
import { execFileSync } from 'child_process';
const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/bookwalker/out');
function dec(b64){ const raw=Buffer.from(b64,'base64'); const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(process.env.KDP_CRED_KEY,'hex'),raw.subarray(0,12)); d.setAuthTag(raw.subarray(12,28)); return Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString('utf8'); }
function fitToSentence(text, maxLen){ const t=(text||'').trim(); if(!t) return ''; const limit=maxLen&&maxLen>0?maxLen:t.length; if(t.length<=limit&&/[。！？」』】）)]$/.test(t)) return t; const head=t.slice(0,limit); let idx=-1; for(const ch of ['。','！','？','」','』','】']) idx=Math.max(idx,head.lastIndexOf(ch)); return idx>0?head.slice(0,idx+1).trim():head.trim(); }

const bwId = process.argv[2];
const WITHDRAW = process.argv.includes('--withdraw');
const DRY = process.argv.includes('--dry');
if (!bwId) { console.log('usage: bw-retag.mjs <bwId> [--withdraw] [--dry]'); process.exit(1); }

const enum_ = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/bookwalker/shelf-enum.json'), 'utf8'));
const shelf = enum_.find((x) => String(x.id) === String(bwId));
if (!shelf) { console.log('shelf-enum に', bwId, 'が無い'); process.exit(1); }

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
// タイトル照合(前方一致44字。shelf.titleは44字truncの可能性)
const bq = await c.query(
  `SELECT b.id, b.title, tc.genre,
     (SELECT description FROM kdp_metadata WHERE book_id=b.id ORDER BY created_at DESC LIMIT 1) description
   FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id
   WHERE b.title = $1 OR b.title LIKE $2 ORDER BY length(b.title) LIMIT 1`,
  [shelf.title, shelf.title.slice(0, 40) + '%'],
);
const sess = await c.query("SELECT bw_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
if (bq.rows.length === 0) { console.log('DBに該当書籍なし:', shelf.title); process.exit(1); }
const book = bq.rows[0];
const ourId = book.id;
console.log(`bwId=${bwId} status=${shelf.status} → book=${ourId} 「${book.title.slice(0,30)}」`);

// 素材(EPUB/trial/cover)を確保(クリーン本文で再生成)
const epub = path.join(OUT, `${ourId}.epub`);
const trial = path.join(OUT, `${ourId}-trial.epub`);
const cover = path.join(OUT, `${ourId}-cover.jpg`);
const buildIf = (file, args, label) => {
  console.log(`  ${label}: 生成中...`);
  execFileSync('node', args, { cwd: REPO, stdio: 'inherit', env: process.env });
  if (!fs.existsSync(file)) throw new Error(label + ' 生成失敗: ' + file);
};
// 本文が変わっているので EPUB は必ず作り直す(表紙は既存流用)。
buildIf(epub, ['scripts/bookwalker/build-epub.mjs', ourId], 'EPUB(販売用)');
buildIf(trial, ['scripts/bookwalker/build-epub.mjs', ourId, '--trial'], 'EPUB(試し読み)');
if (!fs.existsSync(cover)) buildIf(cover, ['scripts/bookwalker/bw-cover-jpg.mjs', ourId], '表紙JPG');

const descText = String(book.description || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim();
const state = JSON.parse(dec(sess.rows[0].bw_session_state_enc));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1400, height: 1200 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `retag-${bwId}-${n}.png`), fullPage: true }).catch(() => {});
page.on('dialog', (d) => d.accept().catch(() => {}));

try {
  // 1) 申請中なら取り下げ — POST /api/books/drop を直接叩く(CSRFトークン不要・セッションcookie依存)。
  if (WITHDRAW && shelf.status === '申請中') {
    await page.goto('https://author.bookwalker.jp/library/bookshelf', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3000);
    if (await page.$('input[type=password]')) { console.log('NOT_LOGGED_IN'); await browser.close(); process.exit(2); }
    const dropStatus = await page.evaluate(async (id) => {
      const r = await fetch('/api/books/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body: 'book_id=' + id, credentials: 'include',
      }).catch(() => null);
      return r ? r.status : 0;
    }, bwId).catch(() => 0);
    // フォールバック: 直POSTが不調ならUIクリック(該当ページを探索)
    let ok = dropStatus >= 200 && dropStatus < 400;
    if (!ok) {
      for (let p = 1; p <= 12 && !ok; p++) {
        await page.goto('https://author.bookwalker.jp/library/bookshelf?page=' + p, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(1500);
        if (await page.$(`a.js-bookdrop[data-id="${bwId}"]`)) {
          await page.click(`a.js-bookdrop[data-id="${bwId}"]`, { force: true }).catch(() => {});
          await page.waitForTimeout(2000);
          await page.evaluate(() => { const y = [...document.querySelectorAll('button,a,.pure-button')].find((b) => (b.offsetWidth || b.offsetHeight) && (b.textContent || '').replace(/\s+/g, '') === 'はい'); if (y) y.click(); });
          await page.waitForTimeout(4000); ok = true;
        }
      }
    }
    console.log('取り下げ:', ok ? `OK(POST=${dropStatus})` : '失敗');
    await page.waitForTimeout(1500);
  }

  // 2) 編集画面へ
  await page.goto(`https://author.bookwalker.jp/books/${bwId}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (!/\/edit/.test(page.url()) || await page.$('input[type=password]')) { console.log('編集画面に入れず:', page.url().slice(0,80)); await shot('no-edit'); await browser.close(); process.exit(3); }

  // 3) 内容紹介を文末整形で再セット
  const maxLen = await page.$eval('#book_description', (el) => Number(el.maxLength) || 0).catch(() => 0);
  const descFit = fitToSentence(descText, maxLen);
  if (descFit) { const d = await page.$('#book_description'); if (d) { await d.click().catch(()=>{}); await d.fill(descFit).catch(()=>{}); } }

  // 4) ファイル再アップ(クリーンEPUB)
  await page.setInputFiles('#book_files_cover', cover).catch((e) => console.log('cover再UP失敗', e.message.slice(0,40)));
  await page.setInputFiles('#book_files_epub', epub).catch((e) => console.log('epub再UP失敗', e.message.slice(0,40)));
  await page.setInputFiles('#book_files_epub_trial', trial).catch((e) => console.log('trial再UP失敗', e.message.slice(0,40)));
  await page.waitForTimeout(4000);

  // 5) AI生成 サブカテゴリを必須チェック — value=7497 は複数(カテゴリ毎)DOMに在り、
  //    保存に効くのは**選択中メインカテゴリ配下の可視チェックボックス1つ**のみ。
  //    編集画面ではサブカテゴリ枠がメインカテゴリの再選択で初めて展開するため、まずトップを実クリック。
  const g = (book.genre || '');
  const topCat = /light_novel|ラノベ/.test(g) ? 'ライトノベル'
    : /novel|fiction|romance|fantasy|mystery|horror|literature/.test(g) ? '文芸・小説'
    : '実用（評論・情報）';
  const topLabel = page.locator('label', { hasText: topCat }).first();
  await topLabel.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1800);
  const labels = page.locator('label.pure-checkbox', { has: page.locator('input.book_sub_category[value="7497"]') });
  const ln = await labels.count().catch(() => 0);
  let aiClicked = false;
  for (let i = 0; i < ln; i++) {
    const el = labels.nth(i);
    if (await el.isVisible().catch(() => false)) {
      const box = el.locator('input.book_sub_category[value="7497"]');
      if (!(await box.isChecked().catch(() => false))) await el.click({ force: true }).catch(() => {});
      aiClicked = await box.isChecked().catch(() => false);
      break;
    }
  }
  console.log('AI生成チェック(可視):', aiClicked, `(候補${ln})`, '内容紹介:', descFit.length + '字(末尾)「' + descFit.slice(-16) + '」');
  await page.waitForTimeout(40000); // EPUBサーバ検証待ち
  await shot('filled');

  if (DRY) {
    await page.click('#save-book', { noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(5000); await shot('saved-dry');
    console.log('DRY: 保存のみ(再申請せず)'); await browser.close(); process.exit(0);
  }

  // 6) 再申請(信頼済み2段クリック)
  let createResp = null;
  page.on('response', (r) => { const u=r.url(),m=r.request().method(); if (m!=='GET'&&/author\.bookwalker\.jp/.test(u)&&!/invite_code|percent_scrolled|\.(js|css|png|jpg|gif|woff)/.test(u)) { createResp={status:r.status(),url:u.replace('https://author.bookwalker.jp','')}; } });
  let clicked=false;
  for (let a=0;a<3&&!clicked;a++){ try{ await page.click('#register-book',{noWaitAfter:true,force:true,timeout:8000}); clicked=true; }catch{ await page.waitForTimeout(1500); } }
  const modalBtn = page.locator('[role=dialog] button, .modal button, [class*=modal] button, [class*=Modal] button, .pure-button').filter({ hasText: /^(申請する|はい|OK|同意して|確定|申請)/ });
  for (let m=0;m<9;m++){ await page.waitForTimeout(2000); if(createResp) break; if(await modalBtn.count().catch(()=>0)){ await modalBtn.first().click({noWaitAfter:true,force:true,timeout:8000}).catch(()=>{}); await page.waitForTimeout(3000); break; } }
  await page.waitForTimeout(5000); await shot('reapplied');
  console.log(createResp && createResp.status<400 ? `再申請OK (${createResp.status} ${createResp.url.slice(0,40)})` : `再申請 要確認 (resp=${createResp?createResp.status:'none'})`);
  await browser.close(); process.exit(0);
} catch (e) {
  console.log('ERROR:', e.message.slice(0, 200)); await shot('error'); await browser.close(); process.exit(1);
}
