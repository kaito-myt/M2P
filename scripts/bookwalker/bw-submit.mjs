/**
 * BookWalker著者センター 入稿 (1冊)。既定は dry-run(基本情報+ファイル入力まで、販売申請は押さない)。
 *   bash scripts/paperback/pb-env.sh node scripts/bookwalker/bw-submit.mjs <bookId> [--submit]
 * 前提: scripts/bookwalker/out/<bookId>.epub と <bookId>-cover.jpg が生成済み(build-epub / bw-cover-jpg)。
 * セッションは scripts/.bw-userdata を再利用(要事前ログイン)。
 * --submit を付けた時のみ「利用規約に同意して、販売を申請する」をクリック。
 */
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
const USERDATA = path.join(REPO, 'scripts/.bw-userdata2');
const OUT = path.join(REPO, 'scripts/bookwalker/out');

const bookId = process.argv[2];
const SUBMIT = process.argv.includes('--submit');
if (!bookId) { console.log('usage: bw-submit.mjs <bookId> [--submit]'); process.exit(1); }
const epub = path.join(OUT, `${bookId}.epub`);
const epubTrial = path.join(OUT, `${bookId}-trial.epub`);
const cover = path.join(OUT, `${bookId}-cover.jpg`);
for (const f of [epub, cover, epubTrial]) if (!fs.existsSync(f)) { console.log('SKIP(必要ファイル無し):', path.basename(f)); process.exit(3); }

// Kindleジャンル → BWトップ×サブ カテゴリ対応(実用書=実用(評論・情報)、小説=文芸・小説、ラノベ=ライトノベル)
function bwCategory(genre, title) {
  const g = genre || '';
  if (/light_novel|ラノベ/.test(g)) return { top: 'ライトノベル', sub: 'ファンタジー' };
  if (/novel|fiction|romance|fantasy|mystery|horror|literature/.test(g)) return { top: '文芸・小説', sub: /官能|オナニ/.test(title) ? '官能小説' : 'エッセイ' };
  return { top: '実用（評論・情報）', sub: null }; // 実用書
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const bq = await c.query(
  `SELECT b.title, b.subtitle, tc.genre,
     (SELECT km.description FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) description,
     (SELECT km.keywords FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) keywords,
     (SELECT km.price_jpy FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) price_jpy,
     (SELECT km.title_kana FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) title_kana
   FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id WHERE b.id=$1`, [bookId]);
await c.end();
if (!bq.rows.length) { console.log('book not found'); process.exit(1); }
const { title, subtitle, genre, description, keywords, price_jpy, title_kana } = bq.rows[0];
const cat = bwCategory(genre, title);
const kwArr = Array.isArray(keywords) ? keywords : (typeof keywords === 'string' ? (() => { try { return JSON.parse(keywords); } catch { return []; } })() : []);
// BW税抜き価格: Kindle価格(税込想定¥ )から概算。無ければ¥500
const priceNoTax = price_jpy ? Math.round(price_jpy / 1.1 / 10) * 10 : 500;
const descText = String(description || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim();

// 起動前: .bw-userdata を掴む残留Chromeを掃除+SingletonLock除去(ゾンビ蓄積→プロファイルロック/OOM防止)
try {
  const { execSync } = await import('child_process');
  execSync(`powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*bw-userdata*' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>&1 | Out-Null }"`, { stdio: 'ignore', timeout: 20000 });
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) { try { fs.unlinkSync(path.join(USERDATA, f)); } catch {} }
} catch {}

// カタカナ化(簡易): タイトルはそのまま + ヨミは手動補完余地(BWは任意欄が多い)
const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1400, height: 1100 }, args: ['--disable-blink-features=AutomationControlled'] });
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const shot = (n) => page.screenshot({ path: path.join(OUT, `bwsub-${n}.png`), fullPage: true }).catch(() => {});
// 異常終了時は自分のcontextだけ閉じる(全bw chromeのkillはしない=並行テストの巻き添え防止)
const closeGuard = async () => { try { await ctx.close(); } catch {} };
process.on('uncaughtException', async (e) => { console.log('uncaught:', e.message.slice(0, 80)); await closeGuard(); process.exit(1); });

await page.goto('https://author.bookwalker.jp/books/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
// Cookie同意
await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find((x) => /すべてのCookieを許可|必須のCookieのみ許可/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight)); if (b) b.click(); }).catch(() => {});
await page.waitForTimeout(1500);
if (!/books\/new/.test(page.url()) || (await page.$('input[type=password]'))) { console.log('NOT_LOGGED_IN — 先に bw-login で手動ログインを'); await ctx.close(); process.exit(2); }

const setV = async (sel, v) => { if (v == null || v === '') return; const e = await page.$(sel); if (e) { await e.click().catch(() => {}); await e.fill(String(v)).catch(() => {}); } };
await setV('#book_main_title', title);
await setV('#book_main_title_kana', title_kana || '');
await setV('#authors_0_name', '宮田海斗');
await setV('#authors_0_name_kana', 'ミヤタカイト');
await setV('#book_copyright', '© 宮田海斗');
await setV('#book_catchphrase', (subtitle || descText.split('\n')[0] || '').slice(0, 40));
// 内容紹介: フィールド maxlength 内で必ず文末で切る(却下理由② 対策)。
{
  const maxLen = await page.$eval('#book_description', (el) => Number(el.maxLength) || 0).catch(() => 0);
  const t = descText.trim();
  const limit = maxLen > 0 ? maxLen : t.length;
  let fit = t;
  if (t.length > limit || !/[。！？」』）)\n]$/.test(t)) {
    const head = t.slice(0, limit);
    const lp = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'));
    fit = lp > 0 ? head.slice(0, lp + 1) : head;
  }
  await setV('#book_description', fit);
}
// BW検索キーワードは100文字以下必須(2026-09-02実測)。収まるだけ詰める。
let kwStr = '';
for (const k of kwArr) { const nx = kwStr ? kwStr + ' ' + k : k; if (nx.length > 100) break; kwStr = nx; }
await setV('#book_keywords', kwStr);
console.log('keywords:', kwStr.length + '字');
await setV('#book_price_notax', String(priceNoTax));
console.log(`基本情報入力: 価格(税抜)=${priceNoTax} cat=${cat.top}/${cat.sub || '-'}`);

// ファイル
await page.setInputFiles('#book_files_cover', cover).catch((e) => console.log('cover input失敗:', e.message.slice(0, 60)));
await page.setInputFiles('#book_files_epub', epub).catch((e) => console.log('epub input失敗:', e.message.slice(0, 60)));
await page.setInputFiles('#book_files_epub_trial', epubTrial).catch((e) => console.log('trial epub input失敗:', e.message.slice(0, 60)));
console.log('表紙+EPUB(販売用+試し読み) 入力完了');
await page.waitForTimeout(4000);

// カテゴリ: トップ→サブ をラベルクリック(ラジオ/チェックの可能性)
const catPicked = await page.evaluate((cat) => {
  const out = [];
  const clickByText = (t) => { const el = [...document.querySelectorAll('label,button,[role=radio],[role=button],a,span')].find((x) => (x.textContent || '').replace(/\s+/g, '').trim() === t.replace(/\s+/g, '') && (x.offsetWidth || x.offsetHeight)); if (el) { el.click(); return true; } return false; };
  if (clickByText(cat.top)) out.push('top:' + cat.top);
  if (cat.sub && clickByText(cat.sub)) out.push('sub:' + cat.sub);
  return out;
}, cat);
// AI生成 サブカテゴリを必須チェック(却下理由① — book_sub_category value=7497)。
await page.waitForTimeout(1500);
const aiTag = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('input.book_sub_category[value="7497"]')];
  let done = false;
  for (const b of boxes) {
    if (!b.checked) { (b.closest('label'))?.click(); if (!b.checked) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); } }
    if (b.checked) done = true;
  }
  return { found: boxes.length, checked: done };
});
console.log('カテゴリ選択:', JSON.stringify(catPicked), 'AI生成:', JSON.stringify(aiTag));
await page.waitForTimeout(2000);
await shot('filled');

// EPUBアップロードのサーバ処理待ち(固定40秒。ページ本文grepは注意書きで誤検知するため使わない)
await page.waitForTimeout(40000);
await shot('after-verify');

// インラインバリデーション(申請クリックで出る「100文字以下」等)を拾う関数
async function inlineErrors() {
  return await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input,textarea,select')) {
      const sib = el.parentElement?.querySelector('.error, .invalid-feedback, [class*=error], [class*=Error]');
      if (sib && (sib.offsetWidth || sib.offsetHeight)) out.push((el.id || el.name) + ': ' + sib.textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
    }
    return [...new Set(out)];
  });
}

if (SUBMIT) {
  console.log('販売申請クリック...');
  page.on('dialog', async (d) => { console.log('dialog:', d.message().slice(0, 100)); await d.accept().catch(() => {}); });
  // AJAX申請POST(解析ビーコン以外の非GET)を捕捉
  let createResp = null;
  page.on('response', async (r) => {
    const u = r.url(); const m = r.request().method();
    if (m !== 'GET' && /author\.bookwalker\.jp/.test(u) && !/invite_code|percent_scrolled|\.(js|css|png|jpg|gif|woff)/.test(u)) {
      let bodySnip = '';
      try { const t = await r.text(); bodySnip = (t.match(/(審査|申請を受け付|success|error|エラー)[^"<>{}]{0,40}/i) || [''])[0]; } catch {}
      createResp = { status: r.status(), url: u.replace(/https:\/\/author\.bookwalker\.jp/, ''), body: bodySnip };
      console.log('←申請POST', r.status(), createResp.url.slice(0, 40), bodySnip.slice(0, 40));
    }
  });
  // オーバーレイ(Cookieバナー/変換中スピナー)を除去してからクリック — でないと15sタイムアウト
  async function clearOverlays() {
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button,a')) { if (/すべてのCookieを許可|必須のCookieのみ許可|閉じる/.test(b.textContent || '') && (b.offsetWidth || b.offsetHeight)) b.click(); }
    }).catch(() => {});
  }
  await clearOverlays();
  await page.$('#register-book').then((b) => b?.scrollIntoViewIfNeeded()).catch(() => {});
  await page.waitForTimeout(1200);
  // 信頼済みクリック(JSハンドラ発火)。noWaitAfterでナビ待ちハング回避。最大3回リトライ(直前にオーバーレイ再除去)。
  let clicked = false;
  for (let a = 0; a < 3 && !clicked; a++) {
    await clearOverlays();
    // force:true = 遮蔽判定をスキップしつつCDP経由の信頼済みクリック(isTrusted=true→JSハンドラ発火)
    try { await page.click('#register-book', { noWaitAfter: true, force: true, timeout: 8000 }); clicked = true; }
    catch (e) { console.log(`click試行${a + 1}失敗:`, e.message.slice(0, 50)); await page.waitForTimeout(1500); }
  }
  console.log('clicked:', clicked);
  // 確認モーダルの出現をポーリング(コールドスタートで遅い場合あり。最大18秒)。出たら2段目を信頼クリック。
  const modalBtn = page.locator('[role=dialog] button, .modal button, [class*=modal] button, [class*=Modal] button, .pure-button').filter({ hasText: /^(申請する|はい|OK|同意して|確定|申請)/ });
  let modalClicked = false;
  for (let m = 0; m < 9 && !modalClicked; m++) {
    await page.waitForTimeout(2000);
    if (createResp) break; // 既にPOST発火済みなら不要
    const cnt = await modalBtn.count().catch(() => 0);
    if (cnt) {
      console.log(`確認モーダル検知(${m * 2}s)→2段目クリック`);
      await modalBtn.first().click({ noWaitAfter: true, force: true, timeout: 8000 }).catch((e) => console.log('modal click:', e.message.slice(0, 50)));
      modalClicked = true;
      await page.waitForTimeout(3000);
    }
  }
  // モーダル未検知でPOSTも無い = EPUBサーバ検証が未完了で申請ボタンがモーダルを開かない事が多い。
  // 追加待機してから最大2回 再クリック(各回でモーダルをポーリング)。
  for (let r = 0; r < 2 && !createResp && !modalClicked; r++) {
    console.log(`モーダル未検知→検証追加待機20s後 register再クリック(${r + 1})`);
    await page.waitForTimeout(20000);
    await clearOverlays();
    await page.click('#register-book', { noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
    for (let m = 0; m < 6 && !modalClicked; m++) {
      await page.waitForTimeout(2000);
      if (createResp) break;
      const cnt2 = await modalBtn.count().catch(() => 0);
      if (cnt2) { console.log('再クリックでモーダル検知→2段目'); await modalBtn.first().click({ noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {}); modalClicked = true; await page.waitForTimeout(3000); }
    }
  }
  await page.waitForTimeout(5000);
  const errs = await inlineErrors();
  const url = page.url();
  const ok = createResp && createResp.status >= 200 && createResp.status < 400 && !errs.length && !/404|500/.test(String(createResp.status));
  if (errs.length) console.log('★ バリデーションエラー:', JSON.stringify(errs));
  console.log('申請後URL:', url, 'POST:', JSON.stringify(createResp), '判定:', ok ? 'SUBMITTED?' : (errs.length ? 'FAILED(validation)' : 'UNCERTAIN'));
  await shot('submitted');
} else {
  // dry-run: 下書き保存だけ試す(申請はしない)
  console.log('DRY-RUN: 販売申請せず。下書き保存を試行...');
  await page.click('#save-book').catch((e) => console.log('保存クリック失敗:', e.message.slice(0, 60)));
  await page.waitForTimeout(6000);
  await shot('saved-draft');
  console.log('保存後URL:', page.url());
}
console.log('BW SUBMIT DONE (submit=' + SUBMIT + ')');
await ctx.close();
process.exit(0);
