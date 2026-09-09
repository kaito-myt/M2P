/** 申請クリック時のネットワークPOSTを捕捉。既存下書き25940の編集ページで実行。 */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.bw-userdata');
const OUT = path.join(REPO, 'scripts/bookwalker/out');

const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1400, height: 1100 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(45000);
let dialogSeen = null;
page.on('dialog', async (d) => { dialogSeen = d.message(); console.log('★dialog出現:', d.message().slice(0, 150)); await d.accept().catch(() => {}); });
page.on('request', (r) => { if (r.method() === 'POST' && /bookwalker/.test(r.url())) console.log('→POST', r.url().slice(-60)); });
page.on('response', async (r) => { if (r.request().method() === 'POST' && /bookwalker/.test(r.url())) { console.log('←RESP', r.status(), r.url().slice(-60)); try { const t = await r.text(); const m = t.match(/(エラー|error|審査|申請を受け付|success|下書き)[^"<>]{0,50}/i); if (m) console.log('   body抜粋:', m[0].slice(0, 80)); } catch {} } });

await page.goto('https://author.bookwalker.jp/books/25940/edit', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find((x) => /Cookieを許可/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight)); if (b) b.click(); }).catch(() => {});
await page.waitForTimeout(1000);
// キーワード是正
await page.evaluate(() => {
  const kw = document.querySelector('#book_keywords'); if (!kw || (kw.value || '').length <= 100) return;
  const parts = kw.value.split(/\s+/); let s = ''; for (const p of parts) { const nx = s ? s + ' ' + p : p; if (nx.length > 100) break; s = nx; }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value'); setter.set.call(kw, s); kw.dispatchEvent(new Event('input', { bubbles: true }));
});
// フォームと送信ハンドラの調査
const formInfo = await page.evaluate(() => {
  const btn = document.querySelector('#register-book');
  const form = btn?.closest('form');
  return { btnType: btn?.type, btnForm: !!form, formAction: form?.action, formMethod: form?.method, onclick: btn?.getAttribute('onclick'), formId: form?.id };
});
console.log('フォーム情報:', JSON.stringify(formInfo));

console.log('--- 申請クリック(requestSubmit試行) ---');
await page.evaluate(() => {
  const btn = document.querySelector('#register-book');
  btn?.scrollIntoView({ block: 'center' });
  btn?.click();
});
await page.waitForTimeout(8000);
console.log('dialogSeen:', dialogSeen);
console.log('URL:', page.url());
await page.screenshot({ path: path.join(OUT, 'bw-net.png'), fullPage: true }).catch(() => {});
console.log('NET DONE');
await ctx.close();
process.exit(0);
