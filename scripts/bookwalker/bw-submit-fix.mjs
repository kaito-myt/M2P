/** 既存下書きの詳細ページで「販売を申請する」の機構を解明(確認モーダルの2段目を探す)。重複を作らない。 */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.bw-userdata');
const OUT = path.join(REPO, 'scripts/bookwalker/out');
const DO_SUBMIT = process.argv.includes('--submit');

const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1400, height: 1100 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(45000);
page.on('dialog', async (d) => { console.log('★native dialog:', d.message().slice(0, 120)); await d.accept().catch(() => {}); });

// 本棚から最新下書きの詳細画面リンクを取得
await page.goto('https://author.bookwalker.jp/library/bookshelf', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
const detailUrl = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a')].filter((a) => /詳細画面|編集/.test(a.textContent || '') || /\/books\/\d|\/book\//.test(a.href || ''));
  // 手書きメモ本の行内の詳細リンク
  for (const a of links) { let row = a; for (let i = 0; i < 8 && row; i++) { row = row.parentElement; if ((row?.textContent || '').includes('手書きメモ')) return a.href; } }
  return links[0]?.href || null;
});
console.log('詳細URL:', detailUrl);
if (!detailUrl) { console.log('詳細リンク無し'); await ctx.close(); process.exit(1); }
await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find((x) => /Cookieを許可/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight)); if (b) b.click(); }).catch(() => {});
console.log('編集ページURL:', page.url());

// 申請ボタン特定
// キーワードを100字以内に是正(保存済み下書きが超過している)
const kwFix = await page.evaluate(() => {
  const kw = document.querySelector('#book_keywords');
  if (!kw) return 'no-field';
  if ((kw.value || '').length <= 100) return 'ok:' + kw.value.length;
  const parts = kw.value.split(/\s+/); let s = '';
  for (const p of parts) { const nx = s ? s + ' ' + p : p; if (nx.length > 100) break; s = nx; }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  setter.set.call(kw, s); kw.dispatchEvent(new Event('input', { bubbles: true })); kw.dispatchEvent(new Event('change', { bubbles: true }));
  return 'trimmed:' + s.length;
});
console.log('キーワード是正:', kwFix);
await page.waitForTimeout(1500);

const applyBtn = await page.$('#register-book');
console.log('register-book 有:', !!applyBtn);
if (DO_SUBMIT && applyBtn) {
  await page.$('#register-book').then((b) => b?.scrollIntoViewIfNeeded()).catch(() => {});
  // noWaitAfterでクリック→即座にモーダル探索
  await page.click('#register-book', { noWaitAfter: true, timeout: 15000 }).catch((e) => console.log('click:', e.message.slice(0, 60)));
  await page.waitForTimeout(3500);
  const modal = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role=dialog], .modal, .a-popover, [class*=modal], [class*=Modal], [class*=dialog]')].find((d) => d.offsetWidth || d.offsetHeight);
    if (!dlg) return { open: false };
    return { open: true, text: dlg.textContent.replace(/\s+/g, ' ').trim().slice(0, 300), buttons: [...dlg.querySelectorAll('button, a, input[type=submit]')].filter((b) => b.offsetWidth || b.offsetHeight).map((b) => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean) };
  });
  console.log('クリック後モーダル:', JSON.stringify(modal));
  if (modal.open && modal.buttons.length) {
    // モーダル内の申請/OK/はい を押す
    const btn = page.locator('[role=dialog] button, .modal button, [class*=modal] button, [class*=Modal] button').filter({ hasText: /申請|する|はい|OK|同意|確定/ }).first();
    await btn.click({ noWaitAfter: true, timeout: 10000 }).catch((e) => console.log('モーダルbtn:', e.message.slice(0, 60)));
    await page.waitForTimeout(6000);
  }
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => {
    const errs = [];
    for (const el of document.querySelectorAll('input,textarea,select')) { const sib = el.parentElement?.querySelector('[class*=error], [class*=Error]'); if (sib && (sib.offsetWidth || sib.offsetHeight)) errs.push((el.id || el.name) + ': ' + sib.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)); }
    const status = (document.body.textContent.match(/申請ステータス[：:]\s*\S+/) || [null])[0];
    return { url: location.href, errs: [...new Set(errs)], status, hasReview: /審査中|申請中|申請を受け付け/.test(document.body.textContent || '') };
  });
  console.log('=== 申請後 ===', JSON.stringify(after, null, 1));
  await page.screenshot({ path: path.join(OUT, 'bw-submitfix.png'), fullPage: true }).catch(() => {});
} else {
  // 偵察のみ: 申請ボタン周辺の構造
  await page.screenshot({ path: path.join(OUT, 'bw-editpage.png'), fullPage: true }).catch(() => {});
}
console.log('SUBMITFIX DONE');
await ctx.close();
process.exit(0);
