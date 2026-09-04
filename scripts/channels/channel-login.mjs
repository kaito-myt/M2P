/**
 * 楽天Kobo / BOOTH の手動ログイン捕獲 + セッション DB 保存 (F-095/F-096)。
 *   bash scripts/channels/channel-login.sh kobo
 *   bash scripts/channels/channel-login.sh booth
 *
 * 方式: **本物の Chrome を直接起動**(Playwright launch は使わない=自動化フラグが付かず
 * hCaptcha/reCAPTCHA を通常ブラウザとして通過できる)。ユーザーが手動ログイン後、
 * Playwright は remote-debugging-port に **後から CDP 接続してセッションを読むだけ**。
 * 取得した storageState を AES-256-GCM (KDP_CRED_KEY) で暗号化し
 * app_settings.<ch>_session_state_enc へ保存する。
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
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
    doneRe: /rakutenkwl\.kobo\.com\/v2/,
    notDoneRe: /authorize\.kobo\.com|\/login|signin|rakuten\.co\.jp\/.*login/i,
    column: 'kobo_session_state_enc',
  },
  booth: {
    userdata: 'scripts/.booth-userdata',
    start: 'https://manage.booth.pm/items',
    doneRe: /manage\.booth\.pm\/(items|dashboard)/,
    notDoneRe: /accounts\.pixiv\.net|\/login/i,
    column: 'booth_session_state_enc',
  },
}[CH];
if (!CONF) { console.log('usage: channel-login.mjs <kobo|booth>'); process.exit(1); }
const KEY_HEX = process.env.KDP_CRED_KEY || '';
const DBURL = process.env.DBURL || '';
if (KEY_HEX.length !== 64 || !DBURL) { console.log('KDP_CRED_KEY/DBURL 未設定 — channel-login.sh 経由で実行'); process.exit(1); }

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = CH === 'kobo' ? 9333 : 9334;
const USERDATA = path.join(REPO, CONF.userdata);
fs.mkdirSync(USERDATA, { recursive: true });

function encrypt(plaintext) {
  const key = Buffer.from(KEY_HEX, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

// 既存の同プロファイル Chrome を掃除(プロファイルロック回避)
try {
  const { execSync } = await import('child_process');
  execSync(`powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${CONF.userdata.replace(/\\/g, '/').split('/').pop()}*' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>&1 | Out-Null }"`, { stdio: 'ignore', timeout: 15000 });
} catch {}
for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) { try { fs.unlinkSync(path.join(USERDATA, f)); } catch {} }

// 本物の Chrome を直接起動(remote-debugging-port 付き。--enable-automation は付けない)
console.log(`[${CH}] 本物のChromeを起動します。表示されたページで手動ログインしてください(hCaptchaも手で解けます)。`);
const child = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${USERDATA}`,
  '--no-first-run',
  '--no-default-browser-check',
  CONF.start,
], { detached: true, stdio: 'ignore' });
child.unref();

// CDP が立ち上がるまで待って接続
let browser = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch {}
}
if (!browser) { console.log('CDP接続失敗 — Chromeが起動しませんでした'); process.exit(2); }
const ctx = browser.contexts()[0];
console.log('CDP接続OK — ログイン完了を待機(最大20分)');

// ログイン完了検知: いずれかのページが doneRe に到達し notDoneRe でない
let done = false;
for (let i = 0; i < 240; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const urls = ctx.pages().map((p) => p.url());
  const hit = urls.find((u) => CONF.doneRe.test(u) && !CONF.notDoneRe.test(u));
  if (hit) { await new Promise((r) => setTimeout(r, 4000)); const again = ctx.pages().map((p) => p.url()).find((u) => CONF.doneRe.test(u) && !CONF.notDoneRe.test(u)); if (again) { done = true; break; } }
  if (i % 12 === 0) console.log(`  待機中 ${Math.round((i * 5) / 60)}分 pages=${JSON.stringify(urls.map((u) => u.slice(0, 55)))}`);
}
if (!done) { console.log('ログイン検知できず(20分) — 再実行してください'); await browser.close().catch(() => {}); process.exit(3); }

console.log('ログイン検知 — セッション保存中...');
const state = await ctx.storageState();
await browser.close().catch(() => {});
// Chrome プロセスも閉じる(次回のためにプロファイルを解放)
try { const { execSync } = await import('child_process'); execSync(`powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*remote-debugging-port=${PORT}*' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>&1 | Out-Null }"`, { stdio: 'ignore', timeout: 15000 }); } catch {}

const json = JSON.stringify(state);
const c = new Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(`UPDATE app_settings SET ${CONF.column}=$1, updated_at=NOW() WHERE id='singleton'`, [encrypt(json)]);
await c.end();
console.log(`✔ [${CH}] セッション保存完了 (cookies=${state.cookies.length}, ${Math.round(json.length / 1024)}KB)`);
process.exit(0);
