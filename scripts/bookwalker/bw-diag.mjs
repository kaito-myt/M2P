/** 実申請が通らない原因の診断: フォーム再入力→申請クリック→全バリデーション/エラー要素を吸い出す(READ-ONLY診断) */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const USERDATA = path.join(REPO, 'scripts/.bw-userdata');
const OUT = path.join(REPO, 'scripts/bookwalker/out');
const bookId = 'cmtd0rry3004ynt0vpxgdxzjx';
const epub = path.join(OUT, `${bookId}.epub`), epubTrial = path.join(OUT, `${bookId}-trial.epub`), cover = path.join(OUT, `${bookId}-cover.jpg`);

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const bq = await c.query(`SELECT b.title,
  (SELECT km.description FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) description,
  (SELECT km.keywords FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) keywords,
  (SELECT km.title_kana FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) title_kana
  FROM books b WHERE b.id=$1`, [bookId]);
await c.end();
const { title, description, keywords, title_kana } = bq.rows[0];
const kwArr = Array.isArray(keywords) ? keywords : (() => { try { return JSON.parse(keywords); } catch { return []; } })();
console.log('keywords個数:', kwArr.length, '結合長:', kwArr.join(' ').length, '各長:', kwArr.map(k => k.length).join(','));

const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1400, height: 1100 }, args: ['--disable-blink-features=AutomationControlled'] });
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://author.bookwalker.jp/books/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find((x) => /すべてのCookieを許可|必須のCookieのみ許可/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight)); if (b) b.click(); }).catch(() => {});
await page.waitForTimeout(1500);

const setV = async (sel, v) => { if (v == null || v === '') return; const e = await page.$(sel); if (e) { await e.click().catch(() => {}); await e.fill(String(v)).catch(() => {}); } };
await setV('#book_main_title', title);
await setV('#book_main_title_kana', title_kana);
await setV('#authors_0_name', '宮田海斗');
await setV('#authors_0_name_kana', 'ミヤタカイト');
await setV('#book_copyright', '© 宮田海斗');
await setV('#book_catchphrase', 'デジタル時代に再発見された記憶・思考・仕事術の科学');
await setV('#book_description', String(description || '').replace(/<[^>]+>/g, '').slice(0, 800));
await setV('#book_keywords', kwArr.slice(0, 10).join(' '));
await setV('#book_price_notax', '620');
await page.setInputFiles('#book_files_cover', cover).catch(() => {});
await page.setInputFiles('#book_files_epub', epub).catch(() => {});
await page.setInputFiles('#book_files_epub_trial', epubTrial).catch(() => {});
await page.evaluate(() => { const el = [...document.querySelectorAll('label,button,[role=radio],span')].find((x) => x.textContent.replace(/\s+/g, '').trim() === '実用（評論・情報）' && (x.offsetWidth || x.offsetHeight)); if (el) el.click(); });
console.log('入力完了 — EPUB検証を60秒待機');
await page.waitForTimeout(60000);

// 申請クリック前の状態
const before = await page.evaluate(() => {
  const reds = [...document.querySelectorAll('*')].filter((el) => (el.offsetWidth || el.offsetHeight) && el.children.length === 0).map((el) => { const cs = getComputedStyle(el); return { red: /rgb\(2[0-9][0-9]|rgb\(1[5-9][0-9]/.test(cs.color) && /^rgb\(2/.test(cs.color), t: el.textContent.replace(/\s+/g, ' ').trim() }; }).filter((x) => x.t && x.red).map((x) => x.t).slice(0, 30);
  return { reds };
});
console.log('申請前の赤字テキスト:', JSON.stringify(before.reds));

await page.click('#register-book').catch((e) => console.log('申請クリック失敗:', e.message.slice(0, 60)));
await page.waitForTimeout(6000);
console.log('申請後URL:', page.url());

const after = await page.evaluate(() => {
  const errs = [...document.querySelectorAll('.error, .invalid, [class*=error], [class*=invalid], .help-block, .form-error, .alert')].filter((el) => el.offsetWidth || el.offsetHeight).map((el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean);
  const reds = [...document.querySelectorAll('*')].filter((el) => (el.offsetWidth || el.offsetHeight) && el.children.length === 0).map((el) => { const cs = getComputedStyle(el); const m = cs.color.match(/rgb\((\d+), (\d+), (\d+)/); const isRed = m && +m[1] > 180 && +m[2] < 100 && +m[3] < 100; return { isRed, t: el.textContent.replace(/\s+/g, ' ').trim() }; }).filter((x) => x.t && x.isRed).map((x) => x.t);
  const dialog = [...document.querySelectorAll('[role=dialog],.modal,.a-popover')].filter((d) => d.offsetWidth || d.offsetHeight).map((d) => d.textContent.replace(/\s+/g, ' ').trim().slice(0, 300));
  return { errs: [...new Set(errs)], reds: [...new Set(reds)], dialog };
});
console.log('=== 申請後エラー要素 ===', JSON.stringify(after.errs, null, 1));
console.log('=== 申請後 赤字 ===', JSON.stringify(after.reds, null, 1));
if (after.dialog.length) console.log('=== ダイアログ ===', JSON.stringify(after.dialog, null, 1));
await page.screenshot({ path: path.join(OUT, 'bw-diag.png'), fullPage: true }).catch(() => {});
console.log('DIAG DONE');
await ctx.close();
process.exit(0);
