/**
 * ペーパーバック詳細(STEP1)ページの検証エラー診断。
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-diag-details.mjs <titleId> [--save]
 *
 * `blocked_prior_page`（content で「以前のページに問題が見つかりました」）の原因を特定する。
 * 既定は読み取りのみ。--save を付けると「保存して続行」を押して検証を発火させ、
 * 出たエラーメッセージを採取する（下書きに対する操作なので破壊的ではない）。
 */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.kdp-userdata');
const OUT = path.join(REPO, 'scripts/paperback/out');

const titleId = process.argv[2];
const SAVE = process.argv.includes('--save');
if (!titleId) { console.log('usage: pb-diag-details.mjs <titleId> [--save]'); process.exit(1); }

const AMZ_PW = process.env.AMAZON_PASSWORD;
const TOTP = (process.env.AMAZON_TOTP_SECRET || '').replace(/[\s-]/g, '');

const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless: false, channel: 'chrome', locale: 'ja-JP',
  viewport: { width: 1760, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'],
});
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());

async function passReauth() {
  if (!/\/ap\/signin/.test(page.url())) return;
  const pf = await page.waitForSelector('#ap_password', { timeout: 20000 }).catch(() => null);
  if (!pf || !AMZ_PW) return;
  await pf.click({ force: true }).catch(() => {});
  await pf.type(AMZ_PW, { delay: 35 });
  await page.click('#signInSubmit').catch(() => {});
  await page.waitForTimeout(9000);
  const otp = await page.$('#auth-mfa-otpcode');
  if (otp && TOTP) {
    const { authenticator } = req('otplib');
    await otp.type(authenticator.generate(TOTP), { delay: 35 });
    await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter'));
    await page.waitForTimeout(9000);
  }
}

await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/details`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await passReauth();
console.log('details URL:', page.url());

const snap = async (tag) => {
  const r = await page.evaluate(() => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight);
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return {
      // Amazon の検証エラー表示 (a-alert / エラーバナー / フィールド直下メッセージ)
      alerts: [...document.querySelectorAll('.a-alert-error, .a-alert-warning, [class*="error"], [role=alert]')]
        .filter(vis)
        .map((e) => clean(e.textContent).slice(0, 200))
        .filter((t) => t.length > 4)
        .slice(0, 15),
      // 未入力の必須フィールド
      emptyRequired: [...document.querySelectorAll('input,select,textarea')]
        .filter((f) => vis(f) && (f.required || f.getAttribute('aria-required') === 'true') && !f.value)
        .map((f) => ({ id: f.id, name: f.name })),
      // カテゴリー欄の現状 (紙は独自分類で必須)
      categoryText: clean(
        [...document.querySelectorAll('div,section')]
          .filter((d) => /カテゴリー/.test(d.textContent || '') && d.querySelectorAll('*').length < 120)
          .map((d) => d.textContent)[0] || ''
      ).slice(0, 400),
    };
  }).catch((e) => ({ err: e.message }));
  console.log(`\n===== ${tag} =====`);
  console.log(JSON.stringify(r, null, 2));
};

await snap('BEFORE');

if (SAVE) {
  const saved = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button,a,input[type=submit],.a-button-text')]
      .find((x) => /保存して続行/.test(x.textContent || x.value || '') && (x.offsetWidth || x.offsetHeight));
    if (b) { b.click(); return true; }
    return false;
  });
  console.log('\n保存して続行クリック:', saved);
  await page.waitForTimeout(12000);
  console.log('保存後URL:', page.url());
  await snap('AFTER SAVE');
}

await page.screenshot({ path: path.join(OUT, `diag-details-${titleId}.png`), fullPage: true }).catch(() => {});
console.log(`\nscreenshot: scripts/paperback/out/diag-details-${titleId}.png`);
await ctx.close();
