/**
 * BookWalker ログインセッションを本番 DB へ保存 (F-094)。
 *
 * ローカルの scripts/.bw-userdata2 プロファイル (手動ログイン済み) から Playwright
 * storageState を抽出し、AES-256-GCM (KDP_CRED_KEY) で暗号化して
 * app_settings.bw_session_state_enc に保存する。サーバーの bw.submit がこれを再利用する。
 *
 *   bash scripts/bookwalker/bw-session-push.sh
 * (KDP_CRED_KEY / DBURL は Railway から実行時取得。ファイルには書かない)
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const USERDATA = path.join(REPO, 'scripts/.bw-userdata2');

const KEY_HEX = process.env.KDP_CRED_KEY || '';
const DBURL = process.env.DBURL || '';
if (KEY_HEX.length !== 64 || !DBURL) {
  console.log('KDP_CRED_KEY(64hex)/DBURL 未設定 — bw-session-push.sh 経由で実行してください');
  process.exit(1);
}

// packages/crypto/kdp-credentials.ts と同一フォーマット: base64(iv12 || authTag16 || ciphertext)
function encrypt(plaintext) {
  const key = Buffer.from(KEY_HEX, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

// プロファイルを掴む残留 Chrome を掃除
try {
  const { execSync } = await import('child_process');
  execSync(
    `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*bw-userdata*' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>&1 | Out-Null }"`,
    { stdio: 'ignore', timeout: 20000 },
  );
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(USERDATA, f)); } catch {}
  }
} catch {}

const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless: true,
  channel: 'chrome',
  locale: 'ja-JP',
});
ctx.setDefaultTimeout(45000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://author.bookwalker.jp/books', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const loggedIn = /author\.bookwalker\.jp\/books/.test(page.url()) && !(await page.$('input[type=password]'));
if (!loggedIn) {
  console.log(`NOT_LOGGED_IN (url=${page.url().slice(0, 80)}) — 手動ログインし直してから再実行してください`);
  await ctx.close();
  process.exit(2);
}
const state = await ctx.storageState();
await ctx.close();
const json = JSON.stringify(state);
console.log(`storageState 取得: cookies=${state.cookies.length} origins=${state.origins.length} (${Math.round(json.length / 1024)}KB)`);

const c = new Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(
  `UPDATE app_settings SET bw_session_state_enc=$1, updated_at=NOW() WHERE id='singleton'`,
  [encrypt(json)],
);
await c.end();
console.log(`✔ app_settings.bw_session_state_enc 保存 (rows=${r.rowCount})`);
process.exit(0);
