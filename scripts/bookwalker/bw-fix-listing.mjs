/**
 * BW 掲載情報の修正（却下対応）。編集画面で以下を直し、保存する。
 *   bash scripts/paperback/pb-env.sh node scripts/bookwalker/bw-fix-listing.mjs <bwId> [options]
 *
 * options:
 *   --strip-ai-prefix          タイトル先頭の「AI生成 」を除去する
 *   --series=<名>              シリーズ名(最大60字)
 *   --series-kana=<カナ>       シリーズ名カナ(必須・全角カタカナ)
 *   --volume=<数>              巻数(必須・数値)
 *   --register                 保存後に販売申請まで行う(既定は保存のみ)
 *   --dry                      変更内容を表示するだけで保存しない
 *
 * 背景(2026-09-11 実測):
 *  - BW の却下理由に「シリーズ作品なのにシリーズ情報が未設定」がある。編集画面下部の
 *    `#book_series` / `#book_series_kana` / `#book_series_volume` を埋める必要がある。
 *    既存シリーズは `#sereis_selector`(BW側のtypo) から選べる。
 *  - 一部書籍のタイトル先頭に「AI生成 」が入っていた。BW が求めるのは入稿フォームの
 *    **AI生成サブカテゴリ**(`input.book_sub_category[value="7497"]`)であってタイトル表記ではない。
 *    店頭で書名として出てしまい販売上不利なので除去する(運営者指示)。
 *  - 申請は ~3件/日 で以降 403。403 でも編集内容は保存済みなので翌日 register のみで復帰できる。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/bookwalker/out');

function dec(b64) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.KDP_CRED_KEY, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || null;

const bwId = process.argv[2];
const STRIP = process.argv.includes('--strip-ai-prefix');
const SERIES = arg('series');
const SERIES_KANA = arg('series-kana');
const VOLUME = arg('volume');
const WITHDRAW = process.argv.includes('--withdraw');
const REGISTER = process.argv.includes('--register');
const DRY = process.argv.includes('--dry');
if (!bwId) { console.log('usage: bw-fix-listing.mjs <bwId> [--strip-ai-prefix] [--series=..] [--series-kana=..] [--volume=..] [--register] [--dry]'); process.exit(1); }

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT bw_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(dec(r.rows[0].bw_session_state_enc));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1400, height: 2400 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `fix-${bwId}-${n}.png`), fullPage: true }).catch(() => {});

// 本棚を経由してから編集画面へ（直行はリダイレクトされることがある）
await page.goto('https://author.bookwalker.jp/library/bookshelf', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
if (await page.$('input[type=password]')) { console.log('NOT_LOGGED_IN'); await browser.close(); process.exit(2); }

// 「申請中」の書籍は編集画面に入れず本棚へリダイレクトされる(2026-09-11 実測)。
// --withdraw 指定時は先に取り下げる。POST /api/books/drop は CSRF 不要・上限なし。
if (WITHDRAW) {
  const st = await page.evaluate(async (id) => {
    const r = await fetch('/api/books/drop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: 'book_id=' + id, credentials: 'include',
    }).catch(() => null);
    return r ? r.status : 0;
  }, bwId).catch(() => 0);
  console.log('取り下げ POST:', st, st >= 200 && st < 400 ? 'OK' : '失敗');
  await page.waitForTimeout(4000);
}
await page.goto(`https://author.bookwalker.jp/books/${bwId}/edit`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
if (!(await page.$('#book_main_title'))) {
  console.log('編集画面に入れず:', page.url().slice(0, 90));
  await shot('no-edit'); await browser.close(); process.exit(3);
}

const before = await page.evaluate(() => ({
  title: document.querySelector('#book_main_title')?.value || '',
  series: document.querySelector('#book_series')?.value || '',
  kana: document.querySelector('#book_series_kana')?.value || '',
  volume: document.querySelector('#book_series_volume')?.value || '',
}));
console.log('変更前:', JSON.stringify(before));

const plan = {};
if (STRIP && /^AI生成[\s　]*/.test(before.title)) plan.title = before.title.replace(/^AI生成[\s　]*/, '');
if (SERIES) plan.series = SERIES;
if (SERIES_KANA) plan.kana = SERIES_KANA;
if (VOLUME) plan.volume = String(VOLUME);
console.log('変更内容:', JSON.stringify(plan));
// --register のみ(編集済みの申請やり直し)は変更ゼロでも続行する
if (!Object.keys(plan).length && !REGISTER) { console.log('変更なし — 終了'); await browser.close(); process.exit(0); }
if (DRY) { console.log('DRY — 保存しない'); await browser.close(); process.exit(0); }

// シリーズ欄はアコーディオン内で非表示のことがあるので、見出しを開いてから入力する
await page.evaluate(() => {
  for (const el of document.querySelectorAll('a,button,summary,h2,h3,legend,div[role=button]')) {
    if (/シリーズ/.test(el.textContent || '') && (el.offsetWidth || el.offsetHeight)) el.click();
  }
});
await page.waitForTimeout(1500);

const applied = await page.evaluate((p) => {
  const set = (sel, v) => {
    const el = document.querySelector(sel);
    if (!el || v == null) return false;
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc?.set?.call(el, v); // React/jQuery 双方に効くよう native setter で入れる
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const out = {};
  // シリーズは `#sereis_selector`(BW側のtypo) が主導。既存シリーズがある場合、
  // 先に selector を選ぶと #book_series / #book_series_kana が自動補完される。
  // 直接 #book_series に入れると selector の change ハンドラで消される
  // (2026-09-11 実測: volume だけ入れたら series/kana が空になった)。
  if (p.kana != null) {
    const sel = document.querySelector('#sereis_selector');
    const opt = sel && [...sel.options].find((o) => o.value === p.kana);
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      out.selector = opt.value;
    }
  }
  if (p.title != null) out.title = set('#book_main_title', p.title);
  // selector で埋まらなかった場合のみ直接入力する
  if (p.series != null && !document.querySelector('#book_series')?.value) out.series = set('#book_series', p.series);
  if (p.kana != null && !document.querySelector('#book_series_kana')?.value) out.kana = set('#book_series_kana', p.kana);
  if (p.volume != null) out.volume = set('#book_series_volume', p.volume);
  return out;
}, plan);
console.log('入力結果:', JSON.stringify(applied));

const after = await page.evaluate(() => ({
  title: document.querySelector('#book_main_title')?.value || '',
  series: document.querySelector('#book_series')?.value || '',
  kana: document.querySelector('#book_series_kana')?.value || '',
  volume: document.querySelector('#book_series_volume')?.value || '',
}));
console.log('変更後:', JSON.stringify(after));

// 保存（更新ボタン）。isTrusted 罠があるため実クリックする。
const saved = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,input[type=submit],a.pure-button')]
    .find((x) => /更新|保存/.test(x.textContent || x.value || '') && (x.offsetWidth || x.offsetHeight));
  if (!b) return null;
  return { cls: (b.className || '').toString().slice(0, 40), text: (b.textContent || b.value || '').trim().slice(0, 20) };
});
console.log('保存ボタン:', JSON.stringify(saved));
if (saved) {
  await page.locator('button,input[type=submit],a.pure-button').filter({ hasText: /更新|保存/ }).first()
    .click({ force: true, timeout: 15000 }).catch((e) => console.log('保存click失敗:', e.message.slice(0, 50)));
  await page.waitForTimeout(8000);
  console.log('保存後URL:', page.url().slice(0, 80));
}
await shot('after-save');

if (REGISTER) {
  // 申請手順は apps/worker/src/tasks/bw-submit/playwright-submit-port.ts の実績実装に合わせる。
  // POST /api/books/register の HTTP status を拾って成否と 403(当日枠超過) を判定する。
  let createResp = null;
  page.on('response', (res) => {
    if (/\/api\/books\/register/.test(res.url())) createResp = res.status();
  });
  await page.$('#register-book').then((b) => b?.scrollIntoViewIfNeeded()).catch(() => {});
  await page.waitForTimeout(1200);
  let clicked = false;
  for (let a = 0; a < 3 && !clicked; a++) {
    try { await page.click('#register-book', { noWaitAfter: true, force: true, timeout: 8000 }); clicked = true; }
    catch { await page.waitForTimeout(1500); }
  }
  console.log('申請クリック:', clicked);

  // 確認モーダルの2段目も信頼済みクリックでなければ発火しない (BW共通の isTrusted 罠)
  const modalBtn = page
    .locator('[role=dialog] button, .modal button, [class*=modal] button, [class*=Modal] button, .pure-button')
    .filter({ hasText: /^(申請する|はい|OK|同意して|確定|申請)/ });
  let modalClicked = false;
  for (let m = 0; m < 9 && !modalClicked; m++) {
    await page.waitForTimeout(2000);
    if (createResp) break;
    if (await modalBtn.count().catch(() => 0)) {
      await modalBtn.first().click({ noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
      modalClicked = true;
      await page.waitForTimeout(3000);
    }
  }
  // モーダル未検知 & POST 無し = EPUB のサーバ検証が未完了のことが多い → 待って再クリック
  for (let r = 0; r < 2 && !createResp && !modalClicked; r++) {
    console.log('  モーダル未検知 — EPUB検証待ちとみて20秒後に再クリック');
    await page.waitForTimeout(20_000);
    await page.click('#register-book', { noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
    for (let m = 0; m < 6 && !modalClicked; m++) {
      await page.waitForTimeout(2000);
      if (createResp) break;
      if (await modalBtn.count().catch(() => 0)) {
        await modalBtn.first().click({ noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
        modalClicked = true;
        await page.waitForTimeout(3000);
      }
    }
  }
  await page.waitForTimeout(6000);
  console.log('確認モーダルクリック:', modalClicked, '/ register POST status:', createResp ?? '無し');
  if (createResp === 403) console.log('★ 当日の申請枠(~3件)超過。編集内容は保存済みなので翌日 --register のみで復帰可。');
  await shot('after-register');
  console.log('※ 申請は ~3件/日 で 403。403 でも上記の編集内容は保存済み。');
}
await browser.close();
