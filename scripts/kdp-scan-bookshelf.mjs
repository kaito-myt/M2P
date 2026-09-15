/**
 * KDP 本棚 READ-ONLY スキャナ。重複出版(同一タイトルが複数listing)の洗い出し用。
 * 破壊操作は一切しない(閲覧のみ)。既存の永続 Chrome セッション(.kdp-userdata)を再利用する。
 *   bash scripts/kdp-scan.sh   （env 不要。Chrome ログイン済みセッションを使う）
 * 出力: 全listing(title/status/asin/editId) と、タイトル正規化で重複しているグループ。
 */
import { createRequire } from 'module';
import path from 'path';

const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const reqWorker = createRequire(path.join(REPO_ROOT, 'apps/worker/package.json'));
const pw = reqWorker('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;

const USERDATA = path.join(REPO_ROOT, 'scripts/.kdp-userdata');
const BOOKSHELF = 'https://kdp.amazon.co.jp/ja_JP/bookshelf';

function norm(s) {
  return (s || '').replace(/\s+/g, '').replace(/[　　]/g, '').trim();
}

async function main() {
  const ctx = await chromium.launchPersistentContext(USERDATA, {
    headless: false,
    channel: 'chrome',
    locale: 'ja-JP',
    viewport: { width: 1500, height: 1200 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(60000);
  await page.goto(BOOKSHELF, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (/signin/i.test(page.url())) {
    console.log('NOT_LOGGED_IN: 本棚に入れませんでした（要ログイン）。');
    await ctx.close();
    return;
  }
  // 本棚は既定 10 件/頁のページネーション。表示件数セレクトを最大値にして 1 頁で全件出す
  // (2026-09-15: 既定のままだと 1 頁目の 10 件しか見えず、DB 同期が 48 冊分ずれていた)。
  const perPage = await page.evaluate(() => {
    const sel = document.querySelector('#podbookshelftable-records-per-page-dropdown-option, select[id*="records-per-page"]');
    if (!sel) return null;
    const max = [...sel.options].map((o) => Number(o.value)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (!max) return null;
    sel.value = String(max);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return max;
  }).catch(() => null);
  console.log('表示件数/頁:', perPage ?? '(セレクト無し・既定)');
  await page.waitForTimeout(8000);
  // 遅延読み込み対策: 数回スクロールして全行を出す。
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(1200);
  }
  // 各 listing 行を editkindledetails リンク基点で収集。
  const rows = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const links = [...document.querySelectorAll('a[href*="editkindledetails"], a[href*="title-setup"]')];
    for (const a of links) {
      const m = (a.getAttribute('href') || '').match(/\/kindle\/([A-Z0-9]{8,})/);
      const editId = m ? m[1] : null;
      if (!editId) continue;
      // 行コンテナ: title(著者/ASIN/価格を含む大きめの塊)まで祖先を上る。
      let row = a;
      for (let i = 0; i < 12 && row && row.parentElement; i++) {
        row = row.parentElement;
        const t = row.textContent || '';
        // 価格 or ASIN or ステータスを含み、かつ長すぎない塊 = 1冊分の行
        if (/(¥|レビュー中|販売中|ライブ|出版準備中)/.test(t) && /B0[A-Z0-9]{8}|下書き|レビュー中|販売中|ライブ|出版準備中/.test(t) && t.length < 900) break;
      }
      const key = editId;
      if (seen.has(key)) continue;
      seen.add(key);
      const rt = (row.textContent || '').replace(/\s+/g, ' ').trim();
      const status = (rt.match(/レビュー中|販売中|ライブ|出版準備中|下書き|ブロック[^ ]*/) || [''])[0];
      const asin = (rt.match(/\bB0[A-Z0-9]{8}\b/) || [null])[0];
      // 表紙サムネの alt にタイトルが入ることが多い(一覧はタイトル文字を出さないため)。
      const imgAlt = (() => {
        for (const img of row.querySelectorAll('img')) {
          const a = (img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
          if (a && !/^(表紙|cover|kindle|amazon)/i.test(a) && a.length > 3) return a;
        }
        return '';
      })();
      // title: リンクの title 属性 or aria-label or リンクテキスト、無ければ行テキスト先頭。
      let title =
        (a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim();
      // リンクテキストが generic(電子書籍を出版します等)や価格なら、行テキストから著者/価格/ステータス前までを推定。
      if (!title || /電子書籍|出版します|^¥|Kindle および/.test(title)) {
        title = rt
          .replace(/(レビュー中|販売中|ライブ|出版準備中|下書き).*/, '')
          .replace(/著者:.*/, '')
          .replace(/\bB0[A-Z0-9]{8}\b.*/, '')
          .replace(/¥.*/, '')
          .trim()
          .slice(0, 80);
      }
      out.push({ editId, status, asin, title, imgAlt, rowText: rt.slice(0, 160) });
    }
    return out;
  });
  console.log(`=== 本棚 listing 総数: ${rows.length}（各詳細ページから実タイトル取得中…） ===`);
  // 一覧はタイトルを出さないので、各詳細ページ #data-title から実タイトルを読む(READ-ONLY)。
  const EDIT_BASE = 'https://kdp.amazon.co.jp/ja_JP/title-setup/kindle/';
  for (const r of rows) {
    try {
      await page.goto(EDIT_BASE + r.editId + '/details', { waitUntil: 'domcontentloaded' });
      // タイトル入力が値を持つまで最大10秒待つ(出版準備中は遅延描画のことがある)。
      let t = '';
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        if (/signin|ap\/mfa|ap\/cvf/i.test(page.url())) { t = '(要再認証で取得不可)'; break; }
        t = await page.evaluate(() => {
          const sels = ['#data-title', 'input[name="data[title]"]', 'input[id*="title" i]'];
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el && (el.value || el.getAttribute('value'))) return (el.value || el.getAttribute('value'));
          }
          return '';
        });
        if (t) break;
      }
      // 詳細ページが本棚へリダイレクト等でタイトル取れない場合は一覧の表紙alt を採用。
      if (!t || /電子出版なら|Kindle ダイレクト/.test(t)) t = r.imgAlt || t;
      r.title = (t || '').replace(/\s+/g, ' ').trim() || (r.imgAlt || '(タイトル取得不可)');
    } catch (e) {
      r.title = r.imgAlt || '(取得失敗: ' + e.message.slice(0, 40) + ')';
    }
    console.log(`[${r.status || '?'}] asin=${r.asin || '-'} id=${r.editId}  title="${r.title}"  alt="${r.imgAlt || '-'}"`);
  }

  // タイトル正規化で重複検出
  const byTitle = new Map();
  for (const r of rows) {
    const k = norm(r.title);
    if (!k) continue;
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(r);
  }
  const dups = [...byTitle.entries()].filter(([, v]) => v.length > 1);
  console.log(`\n=== 重複タイトル(複数listing): ${dups.length} グループ ===`);
  for (const [k, v] of dups) {
    console.log(`\n[${v.length}件] ${v[0].title}`);
    for (const r of v) console.log(`   - ${r.status || '?'}\t${r.asin || '-'}\t${r.editId || '-'}`);
  }
  await page.waitForTimeout(1500);
  await ctx.close();
}
main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
