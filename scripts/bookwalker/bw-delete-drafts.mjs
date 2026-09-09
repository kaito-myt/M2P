/** 手書きメモ本の重複下書きを削除(下書きのみ・審査中や販売中は触らない) */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.bw-userdata');
const KEEP = process.argv[2] || null; // 残す本のbook番号(あれば)。無ければ全下書き削除
const TITLE = '手書きメモ';

const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1400, height: 1000 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(45000);
page.on('dialog', async (d) => { console.log('確認dialog:', d.message().slice(0, 80)); await d.accept().catch(() => {}); });

let deleted = 0;
for (let pass = 0; pass < 6; pass++) {
  await page.goto('https://author.bookwalker.jp/library/bookshelf', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const target = await page.evaluate(({ TITLE, KEEP }) => {
    const rows = [...document.querySelectorAll('tr, li, [class*=book], article, .book-item')].filter((el) => (el.textContent || '').includes(TITLE) && /下書き/.test(el.textContent || '') && (el.offsetWidth || el.offsetHeight));
    for (const row of rows) {
      const link = [...row.querySelectorAll('a')].find((a) => /\/books\/(\d+)/.test(a.href || ''));
      const num = link ? (link.href.match(/\/books\/(\d+)/) || [])[1] : null;
      if (KEEP && num === KEEP) continue;
      const del = [...row.querySelectorAll('a, button')].find((x) => /削除/.test(x.textContent || ''));
      if (del) { del.click(); return num || 'unknown'; }
    }
    return null;
  }, { TITLE, KEEP });
  if (!target) { console.log('削除対象なし — 完了'); break; }
  console.log('削除実行:', target);
  await page.waitForTimeout(2500);
  // 確認モーダルがあれば OK
  await page.evaluate(() => { const b = [...document.querySelectorAll('[role=dialog] button, .modal button, button')].find((x) => /削除する|はい|OK|確定/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight)); if (b) b.click(); }).catch(() => {});
  await page.waitForTimeout(4000);
  deleted++;
}
console.log('削除数:', deleted);
await ctx.close();
process.exit(0);
