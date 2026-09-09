/**
 * note セッション再取得ツール (運営者が「住宅IP」で実行する)。
 *
 * なぜ必要か: worker(Railway データセンターIP)から note にログインすると reCAPTCHA を出されて
 * ブロックされる。そこで住宅IP(=運営者のローカル)で一度ログインしてセッション(storageState)を
 * 取得し、`API_CRED_KEY` で暗号化して `promotion_channel_settings.config_json.note_session_enc`
 * に保存する。worker はそのセッションを再利用してログイン自体を回避する。
 *
 * 実行 (住宅IPのローカルで):
 *   railway run --service A2P-Worker node scripts/note-session-refresh.mjs
 * 必要 env (railway run が A2P-Worker から注入):
 *   NOTE_EMAIL / NOTE_PASSWORD / API_CRED_KEY / DATABASE_URL
 *
 * セッションが失効して note 投稿が auth 失敗し始めたら、これを再実行する。
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const EMAIL = process.env.NOTE_EMAIL;
const PW = process.env.NOTE_PASSWORD;
const APIKEY = process.env.API_CRED_KEY;
const DB = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (!EMAIL || !PW || !APIKEY || !DB) {
  console.error('missing env: NOTE_EMAIL/NOTE_PASSWORD/API_CRED_KEY/DATABASE_URL');
  process.exit(1);
}

// @a2p/crypto の encryptApiKey と同形式: base64(iv[12] || authTag[16] || ciphertext), AES-256-GCM。
function encryptApiKey(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(APIKEY, 'hex'), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

const require = createRequire(new URL('../apps/worker/', import.meta.url));
const { chromium } = require('playwright');
const { Client } = createRequire(new URL('../node_modules/', import.meta.url))('pg');

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({
  locale: 'ja-JP',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
});
const page = await ctx.newPage();
await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await (await page.$('input[type=email], #email')).fill(EMAIL);
await (await page.$('input[type=password], #password')).fill(PW);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,[role=button],input[type=submit]')].find((x) =>
    /ログイン/.test(x.textContent || x.value || ''),
  );
  if (b) b.click();
});
await page.waitForTimeout(7000);
await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(6000);
const authed = !!(await page.$('textarea'));
console.log('login authed (editor reachable):', authed, '| url:', page.url().slice(0, 60));
if (!authed) {
  console.error('!! login failed even locally — 住宅IPで実行しているか / 認証情報を確認');
  await browser.close();
  process.exit(2);
}
const state = await ctx.storageState();
const enc = encryptApiKey(JSON.stringify(state));
console.log('storageState cookies:', state.cookies.length, '| enc len:', enc.length);
await browser.close();

const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(
  `update promotion_channel_settings
     set config_json = coalesce(config_json,'{}'::jsonb) || jsonb_build_object('note_session_enc', $1::text)
   where channel='note'`,
  [enc],
);
await c.end();
console.log('SAVED note_session_enc to promotion_channel_settings(note). note 自動投稿はこのセッションを再利用します。');
