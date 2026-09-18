/**
 * note ログインセッションのローカル手動キャプチャ [docs/11-anp-design.md §7 Phase2 / F-ANP-20]。
 *
 *   bash scripts/anp/note-session-capture.sh <note_account_id>
 *
 * headful Chrome (専用プロファイル scripts/.note-userdata-<note_account_id>) で note のログイン画面
 * を開き、運営者が手動ログイン(reCAPTCHA が出るためデータセンターIPでは不可 — ローカル実行専用)する
 * のを最大 30 分待つ。ログイン検知後、storageState を KDP_CRED_KEY(AES-256-GCM) で暗号化して
 * `note_accounts.session_state_enc` に保存する(既存の共有セッションは変更しない)。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

const noteAccountId = process.argv[2];
if (!noteAccountId) {
  console.log('usage: note-session-capture.sh <note_account_id>');
  process.exit(1);
}

const KEY_HEX = process.env.KDP_CRED_KEY || '';
const DBURL = process.env.DBURL || '';
if (KEY_HEX.length !== 64 || !DBURL) {
  console.log('KDP_CRED_KEY(64hex)/DBURL 未設定 — note-session-capture.sh 経由で実行してください');
  process.exit(1);
}

function encrypt(plaintext) {
  const key = Buffer.from(KEY_HEX, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

const c = new Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const acc = await c.query('SELECT id, display_name FROM note_accounts WHERE id=$1', [noteAccountId]);
if (acc.rowCount === 0) {
  console.log(`NoteAccount not found: ${noteAccountId}`);
  await c.end();
  process.exit(2);
}

const USERDATA = path.join(REPO, `scripts/.note-userdata-${noteAccountId}`);
fs.mkdirSync(USERDATA, { recursive: true });
const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless: false,
  channel: 'chrome',
  locale: 'ja-JP',
  viewport: { width: 1300, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(60000);
await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded' });
console.log(`ブラウザを開きました。アカウント「${acc.rows[0].display_name}」用に note へログインしてください。最大30分待ちます…`);
let loggedIn = false;
for (let i = 0; i < 360; i++) {
  await page.waitForTimeout(5000);
  const url = page.url();
  loggedIn = await page
    .evaluate(() => !!document.querySelector('[href*="/notes/new"], a[href="/notes/new"]'))
    .catch(() => false);
  if (i % 12 === 0) console.log(`  待機${Math.round(i / 12)}分 url=${url.slice(0, 70)}`);
  if (loggedIn) {
    console.log('✅ ログイン検知: ' + url);
    break;
  }
}
if (!loggedIn) {
  console.log('ログインを検知できませんでした。もう一度実行してください。');
  await ctx.close();
  process.exit(2);
}

// note.com / editor.note.com 双方の cookie を採取するため一度エディタへ遷移してから保存する。
await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(4000);

const state = await ctx.storageState();
await ctx.close();
const json = JSON.stringify(state);
console.log(`storageState 取得: cookies=${state.cookies.length} origins=${state.origins.length} (${Math.round(json.length / 1024)}KB)`);

// docs/11-anp-design.md §7 F-ANP-01/03: status='pending_session' (アカウント設計から作成した
// note_accounts 行) の場合、セッション取込完了をもって稼働可能な 'active' に昇格させる。
// 既に 'active'/'paused'/'archived' の場合はそのステータスを尊重し変更しない。
await c.query(
  "UPDATE note_accounts SET session_state_enc=$1, status=(CASE WHEN status='pending_session' THEN 'active' ELSE status END), updated_at=NOW() WHERE id=$2",
  [encrypt(json), noteAccountId],
);
await c.end();
console.log(`✔ note_accounts.session_state_enc 保存 (id=${noteAccountId})`);
process.exit(0);
