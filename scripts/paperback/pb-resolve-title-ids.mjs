/**
 * F-097c: KDP 本棚に残っている**ペーパーバックの下書き**の titleId を拾い、`books.pb_title_id` に紐付ける。
 *
 * 経緯 (2026-09-25 調査): 旧テキスト台帳から移行した 7 冊は `pb_publish_status='drafted'` なのに
 * `pb_title_id` が不明で、出版フェーズ (`pb-auto.sh publish`) が拾えず止まっていた。
 * 本棚の下書きフィルタには実際に 7 件のペーパーバック下書き (2025-10〜2026-09 作成) が残っており、
 * **下書きの再開は KDP の作成数枠を消費しない**ので、これを完成させれば即出版できる。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-resolve-title-ids.mjs [--apply]
 *
 * READ-ONLY で詳細画面のタイトル欄を読み、`books.title` と突き合わせる。--apply で DB に書く。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';

const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

const APPLY = process.argv.includes('--apply');

function dec(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/** 比較用にタイトルを正規化する (全角/半角・記号・空白の揺れを吸収)。 */
function norm(s) {
  return (s || '')
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[『』「」【】（）()［］\[\]、。,.・:：;；!！?？\-—―ー~〜"'"']/g, '')
    .toLowerCase();
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: accRows } = await c.query(
  "select kdp_session_state_enc from accounts where status='active' and kdp_session_state_enc is not null order by created_at limit 1",
);
if (!accRows[0]) {
  console.log('KDP セッション無し');
  process.exit(1);
}
const state = JSON.parse(dec(accRows[0].kdp_session_state_enc, process.env.KDP_CRED_KEY));
const { rows: books } = await c.query(
  `select id, title, pb_publish_status, pb_title_id from books
    where pb_publish_status in ('drafted','unlisted','failed') or pb_publish_queued = true`,
);
console.log(`突き合わせ候補の書籍: ${books.length} 冊`);

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1200 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);

/**
 * KDP の title-setup 系ページは有効セッションでも `max_auth_age=0` で再認証を強制される
 * (2026-09-25 実測: /ap/signin?openid.pape.max_auth_age=0 へリダイレクト)。
 * pb-pilot.mjs と同じくパスワード実タイプ + TOTP で通す。
 */
async function passReauthIfNeeded(page, label) {
  if (!/\/ap\/signin/.test(page.url())) return true;
  console.log(`  再認証ウォール(${label}) — 通過を試みます`);
  const pwd = process.env.AMAZON_PASSWORD;
  if (!pwd) {
    console.log('  AMAZON_PASSWORD 未設定 — 再認証不可');
    return false;
  }
  try {
    const pf = await page.waitForSelector('#ap_password', { timeout: 20000 });
    await pf.click();
    await pf.fill('');
    await pf.type(pwd, { delay: 35 });
    await page.check('#auth-remember-me').catch(() => {});
    await page.click('#signInSubmit');
    await page.waitForTimeout(9000);
    const otp = await page.$('#auth-mfa-otpcode');
    if (otp) {
      const sec = (process.env.AMAZON_TOTP_SECRET || '').replace(/[\s-]/g, '');
      if (!sec) {
        console.log('  OTP 要求だが AMAZON_TOTP_SECRET 未設定');
        return false;
      }
      const { authenticator } = req('otplib');
      await otp.type(authenticator.generate(sec), { delay: 35 });
      await page.check('#auth-mfa-remember-device').catch(() => {});
      await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter'));
      await page.waitForTimeout(9000);
    }
    return !/\/ap\/signin/.test(page.url());
  } catch (e) {
    console.log('  再認証失敗:', e.message.slice(0, 80));
    return false;
  }
}

await page.goto('https://kdp.amazon.co.jp/ja_JP/bookshelf', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(7000);
if (/\/ap\/signin|\/signin/i.test(page.url())) {
  console.log('セッション失効 — 先にセッションを更新してください');
  await browser.close();
  process.exit(2);
}
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('option')].find((o) => (o.textContent || '').trim() === '下書き');
  const sel = opt?.closest('select');
  if (opt && sel) {
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await page.waitForTimeout(7000);

const titleIds = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll('a')) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/title-setup\/paperback\/([A-Z0-9]{8,})\//);
    if (m) out.push(m[1]);
  }
  return [...new Set(out)];
});
console.log(`下書きの titleId: ${titleIds.length} 件`);

// 各下書きの詳細ページを開いてタイトルを読む (title-setup は再認証ウォールがあるので通す)。
const matched = [];
for (const titleId of titleIds) {
  await page
    .goto(`https://kdp.amazon.co.jp/ja_JP/title-setup/paperback/${titleId}/details`, { waitUntil: 'domcontentloaded' })
    .catch(() => {});
  await page.waitForTimeout(6000);
  if (!(await passReauthIfNeeded(page, titleId))) {
    console.log(`- ${titleId} 再認証できず — スキップ`);
    continue;
  }
  await page.waitForTimeout(4000);
  const title = await page
    .evaluate(() => {
      const cands = [...document.querySelectorAll('input[type=text]')]
        .map((e) => (e.value || '').trim())
        .filter((v) => v.length >= 4 && v.length <= 120);
      return cands[0] ?? '';
    })
    .catch(() => '');
  const hit =
    books.find((b) => norm(b.title) === norm(title)) ??
    books.find((b) => norm(title).length > 8 && norm(b.title).startsWith(norm(title).slice(0, 10))) ??
    null;
  console.log(`- ${titleId} "${title.slice(0, 34)}" → ${hit ? `${hit.id} (${hit.pb_publish_status})` : '一致なし'}`);
  if (hit) matched.push({ titleId, book: hit });
}

await browser.close();

console.log(`\n一致: ${matched.length} 件`);
if (!APPLY) {
  console.log('--apply で books.pb_title_id に書き込みます');
} else {
  for (const m of matched) {
    await c.query(
      `update books set pb_title_id=$2, pb_publish_status='drafted',
         pb_drafted_at=coalesce(pb_drafted_at, now() - interval '1 day'), pb_last_error=null
       where id=$1`,
      [m.book.id, m.titleId],
    );
    console.log(`  ✅ ${m.book.id} ← ${m.titleId}`);
  }
}
await c.end();
