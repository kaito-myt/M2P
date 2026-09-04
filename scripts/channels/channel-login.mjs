/**
 * 楽天Kobo / BOOTH の手動ログイン捕獲 + セッション DB 保存 (F-095/F-096)。
 *   bash scripts/channels/channel-login.sh kobo
 *   bash scripts/channels/channel-login.sh booth
 * headful Chrome が開くので手動ログインする(reCAPTCHA可)。ログイン完了を自動検知したら
 * storageState を AES-256-GCM (KDP_CRED_KEY) で暗号化し app_settings.<ch>_session_state_enc へ保存。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

const CH = process.argv[2];
const CONF = {
  kobo: {
    userdata: 'scripts/.kobo-userdata',
    start: 'https://rakutenkwl.kobo.com/v2/ebooks',
    // ログイン完了 = KWL ダッシュボードに到達 (OAuth リダイレクトが済み /v2/ に戻る)
    doneRe: /rakutenkwl\.kobo\.com\/v2/,
    notDoneRe: /authorize\.kobo\.com|signin|login/i,
    column: 'kobo_session_state_enc',
  },
  booth: {
    userdata: 'scripts/.booth-userdata',
    start: 'https://manage.booth.pm/items',
    doneRe: /manage\.booth\.pm\/(items|dashboard)/,
    notDoneRe: /accounts\.pixiv\.net|login/i,
    column: 'booth_session_state_enc',
  },
}[CH];
if (!CONF) { console.log('usage: channel-login.mjs <kobo|booth>'); process.exit(1); }
const KEY_HEX = process.env.KDP_CRED_KEY || '';
const DBURL = process.env.DBURL || '';
if (KEY_HEX.length !== 64 || !DBURL) { console.log('KDP_CRED_KEY/DBURL 未設定 — channel-login.sh 経由で実行'); process.exit(1); }

function encrypt(plaintext) {
  const key = Buffer.from(KEY_HEX, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

console.log(`[${CH}] Chrome を開きます — 表示されたページでログインしてください(最大20分待機)`);
const ctx = await chromium.launchPersistentContext(path.join(REPO, CONF.userdata), {
  headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1280, height: 1000 },
  // hCaptcha/reCAPTCHA が Playwright 制御を自動化として検知しブロックするのを回避。
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});
ctx.setDefaultTimeout(60000);
// navigator.webdriver を隠す(自動化検知回避の定番)。
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(CONF.start, { waitUntil: 'domcontentloaded' }).catch(() => {});

let done = false;
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(5000);
  const url = page.url();
  if (CONF.doneRe.test(url) && !CONF.notDoneRe.test(url)) {
    // 5秒後にもう一度確認(リダイレクト途中の誤検知防止)
    await page.waitForTimeout(5000);
    if (CONF.doneRe.test(page.url())) { done = true; break; }
  }
  if (i % 12 === 0) console.log(`  待機中 ${Math.round((i * 5) / 60)}分 url=${url.slice(0, 70)}`);
}
if (!done) { console.log('ログイン検知できず(20分) — 再実行してください'); await ctx.close(); process.exit(2); }
console.log('ログイン検知 — セッション保存中...');
const state = await ctx.storageState();
await ctx.close();
const json = JSON.stringify(state);
const c = new Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(`UPDATE app_settings SET ${CONF.column}=$1, updated_at=NOW() WHERE id='singleton'`, [encrypt(json)]);
await c.end();
console.log(`✔ [${CH}] セッション保存完了 (cookies=${state.cookies.length}, ${Math.round(json.length / 1024)}KB)`);
process.exit(0);
