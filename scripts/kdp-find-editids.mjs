/**
 * 指定 ASIN 群について、本棚検索で該当 listing の editId(titleId) と状態を取得する(READ-ONLY)。
 *   node scripts/kdp-find-editids.mjs B0HFFLJSSZ B0HFF6JF98 ...
 * 破壊操作なし。既存の永続 Chrome セッションを再利用。
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

const targets = process.argv.slice(2).filter((a) => /^B0[A-Z0-9]{8}$/.test(a));

async function main() {
  if (!targets.length) { console.log('usage: node kdp-find-editids.mjs <ASIN> [ASIN...]'); return; }
  const ctx = await chromium.launchPersistentContext(USERDATA, {
    headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1500, height: 1200 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(60000);
  const results = [];
  for (const asin of targets) {
    try {
      await page.goto(BOOKSHELF, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const sb = await page.$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"], input[name*="search"]').catch(() => null);
      if (sb) { await sb.fill('').catch(() => {}); await sb.fill(asin).catch(() => {}); await page.keyboard.press('Enter').catch(() => {}); await page.waitForTimeout(5000); }
      const info = await page.evaluate((asin) => {
        const body = document.body.textContent || '';
        if (!body.includes(asin)) return { found: false };
        // asin を含む行から editkindledetails リンクの id を拾う
        let editId = null, status = null;
        for (const a of document.querySelectorAll('a[href*="editkindledetails"], a[href*="title-setup"]')) {
          const m = (a.getAttribute('href') || '').match(/\/kindle\/([A-Z0-9]{8,})/);
          if (!m) continue;
          let row = a;
          for (let i = 0; i < 12 && row && row.parentElement; i++) { row = row.parentElement; if ((row.textContent || '').includes(asin)) break; }
          if ((row.textContent || '').includes(asin)) {
            editId = m[1];
            status = ((row.textContent || '').match(/レビュー中|販売中|ライブ|出版準備中|下書き|ブロック[^ ]*/) || [''])[0];
            break;
          }
        }
        return { found: true, editId, status };
      }, asin);
      results.push({ asin, ...info });
      console.log(`${asin}  found=${info.found}  editId=${info.editId || '-'}  status=${info.status || '-'}`);
    } catch (e) {
      results.push({ asin, error: e.message });
      console.log(`${asin}  ERROR ${e.message.slice(0, 60)}`);
    }
  }
  console.log('\nJSON:', JSON.stringify(results));
  await page.waitForTimeout(1000);
  await ctx.close();
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
