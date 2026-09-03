/**
 * ペーパーバック完全出版フロー: content(プレビューアー承認)→pricing(価格)→出版。
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-complete.mjs <bookId> <titleId> [--go]
 * 前提: 下書きは原稿/表紙アップロード済み(pb-pilotで作成)。
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.kdp-userdata');
const OUT = path.join(REPO, 'scripts/paperback/out');

const bookId = process.argv[2];
const titleId = process.argv[3];
const GO = process.argv.includes('--go');
if (!bookId || !titleId) { console.log('usage: pb-complete.mjs <bookId> <titleId> [--go]'); process.exit(1); }
const plan = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/paperback/plan.json'), 'utf8'));
const pages = plan.find((x) => x.book_id === bookId)?.pages || 200;
const price = Math.max(1480, Math.ceil(((206 + pages * 2.06) / 0.6 + 60) / 10) * 10);
console.log(`pages=${pages} price=¥${price}`);

const AMZ_PW = process.env.AMAZON_PASSWORD, TOTP = (process.env.AMAZON_TOTP_SECRET || '').replace(/[\s-]/g, '');
const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1760, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'] });
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const shot = (n) => page.screenshot({ path: path.join(OUT, `pbc-${n}.png`), fullPage: true }).catch(() => {});
async function passReauth(label) {
  if (!/\/ap\/signin/.test(page.url())) return true;
  console.log(`再認証(${label})`);
  const pf = await page.waitForSelector('#ap_password', { timeout: 20000 }).catch(() => null);
  if (!pf || !AMZ_PW) return false;
  await pf.click({ force: true }).catch(() => {}); await pf.fill('').catch(() => {}); await pf.type(AMZ_PW, { delay: 35 });
  await page.check('#auth-remember-me').catch(() => {});
  await page.click('#signInSubmit'); await page.waitForTimeout(9000);
  const otp = await page.$('#auth-mfa-otpcode');
  if (otp && TOTP) { const { authenticator } = req('otplib'); await otp.type(authenticator.generate(TOTP), { delay: 35 }); await page.check('#auth-mfa-remember-device').catch(() => {}); await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter')); await page.waitForTimeout(9000); }
  return !/\/ap\/signin/.test(page.url());
}
async function gotoWithReauth(url, tag) {
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000);
  await passReauth(tag);
  if (!page.url().includes(url.split('/').pop())) { await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000); }
}

// ---- STEP A: content ページでプレビューアー承認 ----
await gotoWithReauth(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, 'content');
console.log('content URL:', page.url());
// プレビューアーを起動 (trusted click — React状態記録のため)
const launchBtn = page.locator('button, a').filter({ hasText: 'プレビューアーを起動' }).first();
const prevOpened = await launchBtn.click({ force: true, timeout: 15000 }).then(() => true).catch((e) => { console.log('起動click失敗:', e.message.slice(0, 50)); return false; });
console.log('プレビューアー起動(trusted):', prevOpened);
if (!prevOpened) { console.log('起動ボタン無し — content状態を確認'); await shot('nopreview'); }
// 印刷プレビューアーに「承認」ボタンは無い(2026-09-03実測)。正しい完了= ロード後に
// 「印刷プレビューアーを終了」をクリックして content に戻る(離脱ナビでは確認済み状態が記録されない)。
if (prevOpened) {
  // 変換完了待ち: 総頁数表示(「/ 156」等)が出るまで最大8分。完了前に終了するとプレビュー実施と
  // 見なされず content 保存がクライアント側で永久ブロックされる(2026-09-03実測)。
  // 完了判定は #cur_page_range(ページ範囲入力)の隣の「/ 総頁数」表示で行う。
  // body全体のgrepは「01」等を誤検知して変換未完了のまま閉じてしまう(2026-09-04実測 —
  // 未完了で閉じるとプレビュー承認が記録されず pricing が blocked になる)。
  // 新規アップロード直後の変換は5〜15分かかるため最大15分待つ。
  let total = null;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(10000);
    total = await page.evaluate(() => {
      const inp = document.querySelector('#cur_page_range');
      const near = inp ? (inp.parentElement?.textContent || '') : '';
      const m = near.replace(/\s+/g, ' ').match(/\/\s*(\d{2,4})/);
      return m ? m[1] : null;
    }).catch(() => null);
    if (i % 3 === 0) console.log(`  変換待ち ${i * 10}s total=${total || '?'}`);
    if (total && Number(total) >= 20) break;
  }
  if (!total || Number(total) < 20) {
    console.log('★ 変換未完了(15分待っても総頁数表示なし) — 承認記録は期待できないが続行');
  }
  console.log('previewer変換完了 total=' + total);
  page.on('dialog', async (d) => { console.log('dialog:', d.message().slice(0, 100)); await d.accept().catch(() => {}); });
  // 信頼済みクリックで終了(synthetic clickではReactの承認記録ハンドラが発火しない — BWと同じisTrusted罠)
  const exitBtn = page.locator('button, a, [role=button]').filter({ hasText: '印刷プレビューアーを終了' }).first();
  const exited = await exitBtn.click({ force: true, timeout: 15000 }).then(() => true).catch((e) => { console.log('終了click失敗:', e.message.slice(0, 50)); return false; });
  console.log('プレビューアー終了クリック(trusted):', exited);
  await page.waitForTimeout(8000);
  // 終了確認モーダル(あれば)も信頼済みクリックで承諾
  const confirmBtn = page.locator('[role=dialog] button, .a-popover button').filter({ hasText: /終了|はい|OK|確認|承認/ }).first();
  if (await confirmBtn.count().catch(() => 0)) { console.log('終了確認モーダル→承諾(trusted)'); await confirmBtn.click({ force: true, timeout: 8000 }).catch(() => {}); }
  await page.waitForTimeout(8000);
  console.log('previewer後URL:', page.url());
  await shot('after-exit');
}
// content に戻っているはず → 保存して続行
if (!/\/content/.test(page.url())) { await gotoWithReauth(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, 'content2'); }
await page.waitForTimeout(3000);
const cont = await page.evaluate(() => { const b = document.querySelector('#save-and-continue-announce') || [...document.querySelectorAll('button')].find((x) => /保存して続行/.test(x.textContent || '')); if (b) { b.click(); return true; } return false; });
console.log('保存して続行:', cont);
await page.waitForTimeout(12000);
await passReauth('content続行後');
console.log('URL:', page.url());

// ---- STEP B: pricing ----
if (!/pricing/.test(page.url())) { await gotoWithReauth(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/pricing`, 'pricing'); }
const jp = await page.waitForSelector('#price-input-jpy', { timeout: 30000 });
await jp.click({ force: true, timeout: 8000 }).catch(() => {});
await jp.fill('').catch(() => {});
await jp.type(String(price), { delay: 40 });
await page.keyboard.press('Tab');
await page.waitForTimeout(4000);
console.log('価格入力: ¥' + price);
await shot('priced');

// 「以前のページに問題」モーダルが出たら戻るを押さず失敗として報告
const blocked = await page.evaluate(() => { const d = [...document.querySelectorAll('[role=dialog], .a-popover')].find((x) => (x.offsetWidth || x.offsetHeight) && /以前のページに問題/.test(x.textContent || '')); return d ? d.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null; });
if (blocked) { console.log('★ 前ページ問題モーダル:', blocked); await shot('blocked'); console.log('PB RESULT: blocked_prior_page'); await ctx.close(); process.exit(5); }

if (!GO) { console.log('DRY-RUN終了'); await ctx.close(); process.exit(0); }
console.log('出版クリック...');
const pubBtn = page.locator('button').filter({ hasText: 'ペーパーバック本を出版' }).first();
await pubBtn.scrollIntoViewIfNeeded().catch(() => {});
await pubBtn.click({ force: true, timeout: 15000 }).catch((e) => console.log('出版クリック失敗:', e.message.slice(0, 60)));
await page.waitForTimeout(12000);
await passReauth('出版後');
await page.waitForTimeout(5000);
const state = await page.evaluate(() => {
  const t = document.body.textContent || '';
  const dlg = [...document.querySelectorAll('[role=dialog], .a-popover')].find((x) => (x.offsetWidth || x.offsetHeight));
  return { url: location.href, review: /レビュー中|審査|出版準備中|提出されました/.test(t), dialog: dlg ? dlg.textContent.replace(/\s+/g, ' ').trim().slice(0, 150) : null };
});
console.log('出版後:', JSON.stringify(state));
await shot('final');
console.log(state.review || /bookshelf/.test(state.url) ? '✅ PB SUBMITTED' : 'PB RESULT: uncertain');
await ctx.close();
process.exit(0);
