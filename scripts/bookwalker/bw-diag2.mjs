/** キーワード欄周辺のバリデーション文言 + 申請ボタンの状態を精密採取 */
import { createRequire } from 'module';
import path from 'path';
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

const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1400, height: 1100 }, args: ['--disable-blink-features=AutomationControlled'] });
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://author.bookwalker.jp/books/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find((x) => /Cookieを許可/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight)); if (b) b.click(); }).catch(() => {});
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
await page.waitForTimeout(30000);

// キーワード欄の親セクションのテキスト全部 + ボタン状態
const info = await page.evaluate(() => {
  const kw = document.querySelector('#book_keywords');
  let section = kw;
  for (let i = 0; i < 6 && section; i++) section = section.parentElement;
  const btn = document.querySelector('#register-book');
  const cover = document.querySelector('#book_files_cover');
  const epub = document.querySelector('#book_files_epub');
  const trial = document.querySelector('#book_files_epub_trial');
  return {
    keywordSection: (section?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    registerBtn: btn ? { disabled: btn.disabled, cls: btn.className, aria: btn.getAttribute('aria-disabled'), visible: !!(btn.offsetWidth || btn.offsetHeight), text: btn.textContent.replace(/\s+/g, ' ').trim() } : 'なし',
    files: { coverVal: cover?.value?.slice(-30), epubVal: epub?.value?.slice(-30), trialVal: trial?.value?.slice(-30) },
    // 販売開始日/その他必須の空チェック
    required: [...document.querySelectorAll('[required]')].map((el) => ({ id: el.id, name: el.name, empty: !el.value })).filter((x) => x.empty),
  };
});
console.log('=== キーワードセクション全文 ===');
console.log(info.keywordSection);
console.log('=== 申請ボタン状態 ===', JSON.stringify(info.registerBtn));
console.log('=== ファイル値 ===', JSON.stringify(info.files));
console.log('=== required空欄 ===', JSON.stringify(info.required));

// 申請クリック→直後にトースト/alert監視
page.on('dialog', async (d) => { console.log('ネイティブdialog:', d.message().slice(0, 120)); await d.accept().catch(() => {}); });
await page.click('#register-book').catch((e) => console.log('click例外:', e.message.slice(0, 80)));
await page.waitForTimeout(4000);
const post = await page.evaluate(() => {
  const toast = [...document.querySelectorAll('.toast, .toastr, [class*=toast], [class*=notice], [class*=message], [role=alert]')].filter((el) => el.offsetWidth || el.offsetHeight).map((el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 150)).filter(Boolean);
  // input直後の兄弟にエラー文が出るタイプ
  const inline = [];
  for (const el of document.querySelectorAll('input,textarea,select')) {
    const sib = el.parentElement?.querySelector('.error, .invalid-feedback, [class*=error], [class*=Error]');
    if (sib && (sib.offsetWidth || sib.offsetHeight)) inline.push((el.id || el.name) + ': ' + sib.textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
  }
  return { url: location.href, toast: [...new Set(toast)], inline: [...new Set(inline)] };
});
console.log('=== 申請後 ===', JSON.stringify(post, null, 1));
await page.screenshot({ path: path.join(OUT, 'bw-diag2.png'), fullPage: true }).catch(() => {});
console.log('DIAG2 DONE');
await ctx.close();
process.exit(0);
