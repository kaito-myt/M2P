/**
 * 既存ペーパーバック下書きの本文/表紙を差し替える。
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-reupload.mjs <bookId> <titleId>
 *
 * 用途: プレビューアーが `GUTTER_ISSUE`(内側マージン不足)を **エラー** として報告すると
 * 「承認」ボタンが無効化され出版できない(2026-09-10 実測)。余白を広げて再生成した
 * `out/<bookId>-pb-interior.pdf` と `out/<bookId>-pb-cover.pdf` を既存下書きへ上げ直すための工程。
 * アップロード後は Amazon 側の変換に数分〜数時間かかるので、その後 pb-complete.mjs で出版する。
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
if (!bookId || !titleId) { console.log('usage: pb-reupload.mjs <bookId> <titleId>'); process.exit(1); }

const interiorPdf = path.join(OUT, `${bookId}-pb-interior.pdf`);
const coverPdf = path.join(OUT, `${bookId}-pb-cover.pdf`);
for (const f of [interiorPdf, coverPdf]) {
  if (!fs.existsSync(f)) { console.log('ファイルが無い:', f); process.exit(1); }
}
console.log('interior:', Math.round(fs.statSync(interiorPdf).size / 1024) + 'KB',
  '/ cover:', Math.round(fs.statSync(coverPdf).size / 1024) + 'KB');

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

await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await passReauth();
console.log('content URL:', page.url());

// pb-pilot.mjs と同じ filechooser 方式(隠し input 直結なら fallback)
async function uploadVia(btnRe, file, fallbackIdx) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
  const btn = await page.evaluateHandle(
    (re) => [...document.querySelectorAll('button,[role=button]')]
      .find((x) => new RegExp(re).test(x.textContent || '') && (x.offsetWidth || x.offsetHeight)),
    btnRe);
  const el = btn.asElement();
  if (!el) { console.log('アップロードボタン無し:', btnRe); return false; }
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null),
    el.click({ timeout: 15000 }).catch((e) => console.log('クリック妨害:', btnRe, e.message.slice(0, 60))),
  ]);
  if (!fc) {
    const ins = await page.$$('input[type=file]');
    if (ins.length > fallbackIdx) { await ins[fallbackIdx].setInputFiles(file); console.log('直接input投入:', btnRe); return true; }
    console.log('filechooserもinputも無し:', btnRe); return false;
  }
  await fc.setFiles(file);
  console.log('アップロード開始:', btnRe, '->', path.basename(file));
  return true;
}

await uploadVia('原稿をアップロード', interiorPdf, 0);
await page.waitForTimeout(4000);
await uploadVia('表紙ファイルをアップロード', coverPdf, 1);

// アップロード完了待ち (最大12分)。両ファイルの「正常にアップロードしました」を数える。
let done = false;
for (let i = 0; i < 72; i++) {
  await page.waitForTimeout(10000);
  const t = await page.evaluate(() => document.body.textContent || '').catch(() => '');
  const ok = (t.match(/正常にアップロードしました|アップロードに成功|正常にアップロードされました/g) || []).length;
  const err = /アップロードで問題|アップロードに失敗|エラーが発生/.test(t);
  if (i % 6 === 0) console.log(`  待機${i * 10}s ok=${ok} err=${err}`);
  if (err) { console.log('★ アップロードエラー'); break; }
  if (ok >= 2) { console.log('両ファイルアップロード完了'); done = true; break; }
}

// 再アップロード時は「新しい原稿または表紙画像をアップロードされたようです…」の確認チェックが出る事がある
const confirms = await page.evaluate(() => {
  let n = 0;
  for (const el of document.querySelectorAll('input[type=checkbox], [role=checkbox]')) {
    const lbl = (el.closest('label')?.textContent || el.parentElement?.textContent || '');
    if (/確認|自分の回答が正しい/.test(lbl)) {
      const checked = el.getAttribute('aria-checked') === 'true' || el.checked;
      if (!checked) { el.click(); n++; }
    }
  }
  return n;
});
if (confirms) console.log('再アップロード確認チェック:', confirms);

await page.evaluate(() => {
  const b = document.querySelector('#save-and-continue-announce')
    || [...document.querySelectorAll('button,.a-button-text')].find((x) => /下書きとして保存/.test(x.textContent || ''));
  if (b) b.click();
});
await page.waitForTimeout(10000);
await page.screenshot({ path: path.join(OUT, `reupload-${bookId}.png`), fullPage: true }).catch(() => {});
console.log(done ? '✔ REUPLOADED' : '★ REUPLOAD INCOMPLETE');
await ctx.close();
process.exit(done ? 0 : 6);
