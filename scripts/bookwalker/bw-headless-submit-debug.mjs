/** サーバー(headless+storageState)条件で申請フローを可視化。register段の状態を詳細ログ。
 *  bash scripts/paperback/pb-env.sh node scripts/bookwalker/bw-headless-submit-debug.mjs <bookId> [--submit]
 *  --submit なしは register 直前まで(申請しない)。out/hsd-*.png にスクショ。
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/bookwalker/out');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const bookId = process.argv[2];
const SUBMIT = process.argv.includes('--submit');
const epub = path.join(OUT, `${bookId}.epub`), trial = path.join(OUT, `${bookId}-trial.epub`), cover = path.join(OUT, `${bookId}-cover.jpg`);

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const bq = await c.query(`SELECT b.title, b.subtitle, tc.genre,
   (SELECT km.description FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY created_at DESC LIMIT 1) description,
   (SELECT km.keywords FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY created_at DESC LIMIT 1) keywords,
   (SELECT km.price_jpy FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY created_at DESC LIMIT 1) price_jpy,
   (SELECT km.title_kana FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY created_at DESC LIMIT 1) title_kana
 FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id WHERE b.id=$1`, [bookId]);
await c.end();
const { title, subtitle, genre, description, keywords, price_jpy, title_kana } = bq.rows[0];
const kwArr = Array.isArray(keywords) ? keywords : JSON.parse(keywords || '[]');
const descText = String(description || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim();
const priceNoTax = price_jpy ? Math.round(price_jpy / 1.1 / 10) * 10 : 500;

// storageState を .bw-userdata2 から抽出(サーバーと同一Cookie)
const persist = await chromium.launchPersistentContext(path.join(REPO, 'scripts/.bw-userdata2'), { headless: true, channel: 'chrome' });
const state = await persist.storageState(); await persist.close();

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ storageState: state, userAgent: UA, locale: 'ja-JP', viewport: { width: 1400, height: 1100 } });
await ctx.addInitScript({ content: 'globalThis.__name = globalThis.__name || function (f) { return f; };' });
ctx.setDefaultTimeout(60000);
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `hsd-${n}.png`), fullPage: true }).catch(() => {});
const responses = [];
page.on('response', (r) => { const m = r.request().method(); const u = r.url(); if (m !== 'GET' && !/\.(js|css|png|jpg|gif|woff)/.test(u)) responses.push(`${m} ${r.status()} ${u.replace(/https?:\/\/[^/]+/, '').slice(0, 60)}`); });

await page.goto('https://author.bookwalker.jp/books/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.evaluate(() => { for (const b of document.querySelectorAll('button,a')) if (/すべてのCookieを許可|必須のCookieのみ許可/.test(b.textContent || '')) b.click(); }).catch(() => {});
console.log('URL:', page.url(), 'loggedIn:', !/password/.test(await page.content()));
const setV = async (sel, v) => { if (!v) return; const e = await page.$(sel); if (e) { await e.click().catch(() => {}); await e.fill(String(v)).catch(() => {}); } };
await setV('#book_main_title', title); await setV('#book_main_title_kana', title_kana || '');
await setV('#authors_0_name', '宮田海斗'); await setV('#authors_0_name_kana', 'ミヤタカイト');
await setV('#book_copyright', '© 宮田海斗'); await setV('#book_catchphrase', (subtitle || descText.split('\n')[0] || '').slice(0, 40));
await setV('#book_description', descText.slice(0, 800));
let kw = ''; for (const k of kwArr) { const n = kw ? kw + ' ' + k : k; if (n.length > 100) break; kw = n; }
await setV('#book_keywords', kw); await setV('#book_price_notax', String(priceNoTax));
await page.setInputFiles('#book_files_cover', cover).catch((e) => console.log('cover err', e.message.slice(0, 40)));
await page.setInputFiles('#book_files_epub', epub).catch((e) => console.log('epub err', e.message.slice(0, 40)));
await page.setInputFiles('#book_files_epub_trial', trial).catch((e) => console.log('trial err', e.message.slice(0, 40)));
console.log('入力完了 price=', priceNoTax, 'kw=', kw.length);
await page.evaluate((cat) => { const click = (t) => { const el = [...document.querySelectorAll('label,button,[role=radio],span')].find((x) => (x.textContent || '').replace(/\s+/g, '') === t.replace(/\s+/g, '') && (x.offsetWidth || x.offsetHeight)); if (el) el.click(); }; click(cat); }, /light_novel/.test(genre || '') ? 'ライトノベル' : /novel|fiction/.test(genre || '') ? '文芸・小説' : '実用（評論・情報）').catch(() => {});

// EPUB検証待ちの間、10秒ごとにファイル状態＋register-book活性＋インラインエラーを観測
for (let i = 0; i < 9; i++) {
  await page.waitForTimeout(10000);
  const st = await page.evaluate(() => {
    const rb = document.querySelector('#register-book');
    const err = [...document.querySelectorAll('[class*=error],[class*=Error],.invalid-feedback')].filter((x) => x.offsetParent).map((x) => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 50)).filter(Boolean);
    const fileState = [...document.querySelectorAll('[class*=file],[class*=upload],[class*=File],[class*=Upload]')].filter((x) => x.offsetParent).map((x) => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)).filter((t) => t && t.length > 2).slice(0, 6);
    return { rb: rb ? { disabled: rb.disabled, cls: rb.className.slice(0, 40), txt: (rb.textContent || '').trim().slice(0, 20) } : null, err: [...new Set(err)].slice(0, 5), fileState: [...new Set(fileState)] };
  });
  console.log(`t=${(i + 1) * 10}s register=${JSON.stringify(st.rb)} err=${JSON.stringify(st.err)}`);
  if (i === 4) console.log('  fileState:', JSON.stringify(st.fileState));
}
await shot('before-submit');
console.log('POSTs so far:', JSON.stringify(responses));

if (SUBMIT) {
  console.log('--- register-book クリック ---');
  page.on('dialog', async (d) => { console.log('dialog:', d.message().slice(0, 60)); await d.accept().catch(() => {}); });
  await page.click('#register-book', { noWaitAfter: true, force: true, timeout: 8000 }).then(() => console.log('click ok')).catch((e) => console.log('click err', e.message.slice(0, 50)));
  for (let m = 0; m < 12; m++) {
    await page.waitForTimeout(2000);
    const modal = await page.evaluate(() => { const btns = [...document.querySelectorAll('[role=dialog] button,.modal button,[class*=modal] button,[class*=Modal] button,.pure-button')].filter((b) => b.offsetParent).map((b) => (b.textContent || '').trim().slice(0, 20)); return btns; });
    if (modal.length) { console.log(`modal(${m * 2}s):`, JSON.stringify(modal));
      await page.locator('[role=dialog] button,.modal button,[class*=modal] button,[class*=Modal] button,.pure-button').filter({ hasText: /^(申請する|はい|OK|同意して|確定|申請)/ }).first().click({ force: true, noWaitAfter: true, timeout: 6000 }).then(() => console.log('modal 2段目 click')).catch((e) => console.log('modal click err', e.message.slice(0, 40))); break; }
  }
  await page.waitForTimeout(6000);
  await shot('after-submit');
  console.log('全POST:', JSON.stringify(responses));
}
await browser.close();
process.exit(0);
