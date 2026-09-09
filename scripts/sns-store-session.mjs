/**
 * SNS(IG/TikTok)セッション取り込み — ローカルで取得した storageState を
 * worker の API_CRED_KEY で暗号化し、DB(promotion_channel_settings.browser_session_enc)へ保存する。
 *
 * 取り込みフロー:
 *   1) 運営者: node scripts/sns-capture-session.mjs <channel>  でログイン→ .sns-session-<channel>.json を生成
 *   2) 担当(Claude): WORKER_API_CRED_KEY と DATABASE_PUBLIC_URL を env で渡してこのスクリプトを実行
 *
 * 使い方:
 *   WORKER_API_CRED_KEY=<64hex> DATABASE_URL=<public url> node scripts/sns-store-session.mjs instagram
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createCipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';

const ROOT = process.cwd();
const channel = (process.argv[2] || '').toLowerCase();
if (!['instagram', 'tiktok'].includes(channel)) {
  console.error('usage: node scripts/sns-store-session.mjs instagram|tiktok');
  process.exit(1);
}

const keyHex = process.env.WORKER_API_CRED_KEY;
if (!keyHex || keyHex.length !== 64) {
  console.error('WORKER_API_CRED_KEY (64 hex chars) が必要です');
  process.exit(1);
}
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL が必要です');
  process.exit(1);
}

// packages/crypto と同一形式: base64(iv(12) || authTag(16) || ciphertext), AES-256-GCM。
function encryptApiKey(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

const sessionPath = path.join(ROOT, 'scripts', `.sns-session-${channel}.json`);
let raw;
try {
  raw = readFileSync(sessionPath, 'utf-8');
} catch {
  console.error(`セッションファイルが見つかりません: ${sessionPath}`);
  console.error(`先に  node scripts/sns-capture-session.mjs ${channel}  を実行してください。`);
  process.exit(1);
}

// バリデーション: storageState として妥当か。
let state;
try {
  state = JSON.parse(raw);
} catch {
  console.error('セッションファイルが JSON として不正です');
  process.exit(1);
}
const cookies = Array.isArray(state.cookies) ? state.cookies : [];
const domainRe = channel === 'instagram' ? /instagram\.com/i : /tiktok\.com/i;
const channelCookies = cookies.filter((c) => domainRe.test(c.domain || ''));
const sessionNames = channel === 'tiktok' ? ['sessionid', 'sid_tt', 'sessionid_ss'] : ['sessionid'];
const hasSession = channelCookies.some((c) => sessionNames.includes(c.name) && c.value);
console.log(`cookies: total=${cookies.length} ${channel}=${channelCookies.length} sessionid=${hasSession ? 'yes' : 'NO'}`);
if (!hasSession) {
  console.error(`⚠ ${channel} の sessionid Cookie が見つかりません。ログインが未完了の可能性があります。`);
  console.error('  取り込みを中止しました。再度キャプチャしてください。');
  process.exit(1);
}

const enc = encryptApiKey(JSON.stringify(state), keyHex);

const require = createRequire('C:/DEV/A2P/node_modules/.pnpm/pg@8.21.0/node_modules/pg/');
const { Client } = require('pg');
const c = new Client({ connectionString: dbUrl });
await c.connect();
const now = new Date();
// upsert: 既存行があれば更新、なければ作成。id は cuid 風の一意値を生成。
const existing = await c.query(`SELECT id FROM promotion_channel_settings WHERE channel=$1`, [channel]);
if (existing.rows.length > 0) {
  await c.query(
    `UPDATE promotion_channel_settings SET browser_session_enc=$1, browser_session_updated_at=$2, updated_at=$2 WHERE channel=$3`,
    [enc, now, channel],
  );
  console.log(`✅ 更新: promotion_channel_settings[channel=${channel}] browser_session_enc (${enc.length} chars)`);
} else {
  const id = 'pcs_' + randomBytes(12).toString('hex');
  await c.query(
    `INSERT INTO promotion_channel_settings (id, channel, auto_enabled, browser_session_enc, browser_session_updated_at, created_at, updated_at)
     VALUES ($1,$2,false,$3,$4,$4,$4)`,
    [id, channel, enc, now],
  );
  console.log(`✅ 新規作成: promotion_channel_settings[channel=${channel}] browser_session_enc (${enc.length} chars)`);
}
await c.end();
console.log('取り込み完了。');
