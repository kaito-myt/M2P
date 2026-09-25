/**
 * ペーパーバック完全出版フロー: content(プレビューアー承認)→pricing(価格)→出版。
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-complete.mjs <bookId> <titleId> [--go]
 * 前提: 下書きは原稿/表紙アップロード済み(pb-pilotで作成)。
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { paperbackPrice, priceSummary } from './pb-price.mjs';
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
const price = paperbackPrice(pages);
console.log(priceSummary(pages));

const AMZ_PW = process.env.AMAZON_PASSWORD, TOTP = (process.env.AMAZON_TOTP_SECRET || '').replace(/[\s-]/g, '');
const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1760, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'] });
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const shot = (n) => page.screenshot({ path: path.join(OUT, `pbc-${n}.png`), fullPage: true }).catch(() => {});
/**
 * 再認証ウォール(max_auth_age=0)を通す。
 *
 * 2026-09-25: ここで `page.$()` がナビゲーション中に実行されて
 * 「Execution context was destroyed」で **プロセスごと落ちていた**（9 冊とも同じ場所で失敗）。
 * サインイン送信はページ遷移を伴うので、遷移待ちを明示し、DOM 参照は全て catch する。
 */
async function passReauth(label) {
  if (!/\/ap\/signin/.test(page.url())) return true;
  console.log(`再認証(${label})`);
  try {
    const pf = await page.waitForSelector('#ap_password', { timeout: 20000 }).catch(() => null);
    if (!pf || !AMZ_PW) return false;
    await pf.click({ force: true }).catch(() => {});
    await pf.fill('').catch(() => {});
    await pf.type(AMZ_PW, { delay: 35 });
    await page.check('#auth-remember-me').catch(() => {});
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => null),
      page.click('#signInSubmit').catch(() => {}),
    ]);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(5000);

    const otp = await page.$('#auth-mfa-otpcode').catch(() => null);
    if (otp && TOTP) {
      const { authenticator } = req('otplib');
      await otp.type(authenticator.generate(TOTP), { delay: 35 }).catch(() => {});
      await page.check('#auth-mfa-remember-device').catch(() => {});
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => null),
        page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter').catch(() => {})),
      ]);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(5000);
    }
    const ok = !/\/ap\/signin/.test(page.url());
    console.log(`  再認証後: ${ok ? 'OK' : 'NG'} ${page.url().slice(0, 80)}`);
    return ok;
  } catch (e) {
    console.log('再認証で例外:', String(e.message || e).slice(0, 120));
    return !/\/ap\/signin/.test(page.url());
  }
}
async function gotoWithReauth(url, tag) {
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(7000);
  await passReauth(tag);
  if (!page.url().includes(url.split('/').pop())) {
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(7000);
    // 2 回目も再認証を求められることがある(セッション反映待ち)。
    await passReauth(`${tag}-retry`);
  }
}

// ---- STEP 0: 詳細(STEP1)を保存し直して前段を確定させる ----
// content から pricing へ進む際の「本の設定の以前のページに問題が見つかりました」(=blocked_prior_page)
// の主因は、詳細ページを一度も保存せずに content へ直行していたこと(2026-09-10 実測 / pb-diag-details.mjs)。
// 詳細ページ自体に検証エラーは無く、「保存して続行」を押すだけで前段が確定し content へ正常遷移する。
// 下書きに対する再保存なので破壊的ではない。
await gotoWithReauth(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/details`, 'details');
const detailsSaved = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,input[type=submit],.a-button-text')]
    .find((x) => /保存して続行/.test(x.textContent || x.value || '') && (x.offsetWidth || x.offsetHeight));
  if (b) { b.click(); return true; }
  return false;
});
console.log('詳細ページ保存して続行:', detailsSaved);
await page.waitForTimeout(12000);
await passReauth('details-save');
console.log('詳細保存後URL:', page.url());

// ---- STEP A: content ページでプレビューアー承認 ----
await gotoWithReauth(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, 'content');
console.log('content URL:', page.url());
// プレビューアーを起動 (trusted click — React状態記録のため)
const launchBtn = page.locator('button, a').filter({ hasText: 'プレビューアーを起動' }).first();
const prevOpened = await launchBtn.click({ force: true, timeout: 15000 }).then(() => true).catch((e) => { console.log('起動click失敗:', e.message.slice(0, 50)); return false; });
console.log('プレビューアー起動(trusted):', prevOpened);
if (!prevOpened) { console.log('起動ボタン無し — content状態を確認'); await shot('nopreview'); }
// 【2026-09-10 更新 — KDP のコンテンツページ刷新に追随】
//  旧実装の前提2つが現行UIでは両方とも誤りになっていた(実DOM採取 = pb-diag-preview.mjs):
//   (1) 総頁数は `#cur_page_range` の親テキストではなく **`#max_page_label`**(「/ 126」)に出る。
//       旧セレクタは永久に null を返し、15分空振りしてから未承認のまま終了していた。
//   (2) 「印刷プレビューアーに承認ボタンは無い(2026-09-03実測)」は**現在は誤り**。
//       黄色の「承認」ボタンが存在し、これを押さないと content 保存が
//       `blocked_prior_page` でブロックされ続ける。
//  → 総頁数は #max_page_label で判定し、承認ボタンがあれば必ず押してから終了する。
if (prevOpened) {
  // 変換完了待ち: 総頁数表示が出るまで最大15分。完了前に閉じるとプレビュー実施と見なされず
  // content 保存がクライアント側で永久ブロックされる(2026-09-03実測)。
  // body全体のgrepは「01」等を誤検知するので、必ず総頁数ラベル要素に限定して読む。
  let total = null;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(10000);
    total = await page.evaluate(() => {
      const pick = (t) => { const m = (t || '').replace(/\s+/g, ' ').match(/\/?\s*(\d{2,4})\s*$/); return m ? m[1] : null; };
      // 現行UI: <label id="max_page_label">/ 126</label>
      const lbl = document.querySelector('#max_page_label');
      const fromLbl = lbl ? pick(lbl.textContent) : null;
      if (fromLbl) return fromLbl;
      // 旧UI フォールバック: #cur_page_range の隣接テキスト
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
  } else {
    console.log('previewer変換完了 total=' + total);
  }
  page.on('dialog', async (d) => { console.log('dialog:', d.message().slice(0, 100)); await d.accept().catch(() => {}); });
  // 「承認」= Amazon の a-button 構造 (<span class="a-button"><input type=submit><span class="a-button-text">承認</span></span>)。
  // input 側は textContent/value とも空なので、テキストを持つ .a-button-text を実クリックする
  // (synthetic click では React の承認記録ハンドラが発火しない — BW と同じ isTrusted 罠)。
  // 注意: 同じテキストを持つ**不可視の**要素が先に並ぶことがあり、`.first()` を掴むと
  // `force:true` でも "Element is not visible" で落ちる(2026-09-10 実測。一部の本だけ承認が
  // 空振りして blocked_prior_page になっていた)。→ 候補を走査して**可視の最初の1件**を押す。
  // プレビューアーのフッターは総頁数取得よりわずかに遅れて描画されるので最大60秒リトライする。
  let approved = false;
  for (let attempt = 0; attempt < 12 && !approved; attempt++) {
    const cands = page
      .locator('.a-button-text, button, a, [role=button], input[type=submit]')
      .filter({ hasText: /^\s*承認\s*$/ });
    const n = await cands.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const c = cands.nth(i);
      if (!(await c.isVisible().catch(() => false))) continue;
      approved = await c.click({ force: true, timeout: 15000 }).then(() => true).catch(() => false);
      if (approved) break;
    }
    if (!approved) {
      if (attempt === 0) console.log(`  承認ボタン待機(候補${n}件・可視なし)...`);
      await page.waitForTimeout(5000);
    }
  }
  console.log('プレビュー承認クリック(trusted):', approved);
  if (!approved) console.log('★ 承認ボタンを押せず — pricing で blocked_prior_page になる見込み');
  if (approved) await page.waitForTimeout(8000);
  // 承認後も残っていれば終了を押す(承認が遷移を伴う場合は空振りで良い)
  const exitBtn = page.locator('button, a, [role=button]').filter({ hasText: '印刷プレビューアーを終了' }).first();
  const exited = await exitBtn.click({ force: true, timeout: 15000 }).then(() => true).catch(() => false);
  console.log('プレビューアー終了クリック(trusted):', exited);
  await page.waitForTimeout(8000);
  // 終了確認モーダル(あれば)も信頼済みクリックで承諾
  const confirmBtn = page.locator('[role=dialog] button, .a-popover button').filter({ hasText: /終了|はい|OK|確認|承認/ }).first();
  if (await confirmBtn.count().catch(() => 0)) { console.log('終了確認モーダル→承諾(trusted)'); await confirmBtn.click({ force: true, timeout: 8000 }).catch(() => {}); }
  await page.waitForTimeout(8000);
  console.log('previewer後URL:', page.url());
  await shot('after-exit');
}
// ---- STEP A2: 承認が本当に記録されたかを検証し、されていなければ再試行 ----
// 承認クリックが true でも記録されないことがある(2026-09-10 実測)。判定は content ページに
// 「続行する前に、これらの変更をプレビューして確認してください」が残っているかどうかで行う。
// 残っていると保存が黙ってブロックされ、pricing で blocked_prior_page になる。
const PREVIEW_WARN = '続行する前に、これらの変更をプレビューして確認してください';
const needsPreview = async () => {
  if (!/\/content/.test(page.url())) {
    await gotoWithReauth(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, 'content-verify');
  }
  await page.waitForTimeout(4000);
  return page.evaluate((w) => (document.body.innerText || '').includes(w), PREVIEW_WARN).catch(() => false);
};
const clickVisible = async (re) => {
  const cands = page.locator('.a-button-text, button, a, [role=button], input[type=submit]').filter({ hasText: re });
  const n = await cands.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const c = cands.nth(i);
    if (!(await c.isVisible().catch(() => false))) continue;
    if (await c.click({ force: true, timeout: 15000 }).then(() => true).catch(() => false)) return true;
  }
  return false;
};
for (let retry = 1; retry <= 3; retry++) {
  if (!(await needsPreview())) { console.log('プレビュー承認 記録済み ✓'); break; }
  console.log(`★ プレビュー未承認のまま — 再試行 ${retry}/3`);
  const opened = await clickVisible(/プレビューアーを起動/);
  if (!opened) { console.log('  起動ボタンが無い — 中断'); break; }
  // 前回失敗の主因と思われる「描画完了前の承認」を避けるため、総頁数検出後もしっかり待つ。
  let t = null;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(5000);
    t = await page.evaluate(() => {
      const l = document.querySelector('#max_page_label');
      const m = (l?.textContent || '').match(/(\d{2,4})/);
      return m ? m[1] : null;
    }).catch(() => null);
    if (t) break;
  }
  console.log(`  再試行: total=${t || '?'} — 描画待ち30秒`);
  await page.waitForTimeout(30000);
  console.log('  承認クリック:', await clickVisible(/^\s*承認\s*$/));
  await page.waitForTimeout(10000);
  if (/print-preview/.test(page.url()) || (await page.locator('a,button').filter({ hasText: '印刷プレビューアーを終了' }).count().catch(() => 0))) {
    console.log('  終了クリック:', await clickVisible(/印刷プレビューアーを終了/));
    await page.waitForTimeout(8000);
  }
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
