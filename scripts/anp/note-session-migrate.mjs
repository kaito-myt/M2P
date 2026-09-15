/**
 * note ログインセッションを単一アカウント共有(promotion_channel_settings.config_json.note_session_enc,
 * API_CRED_KEY 暗号化)から、指定 NoteAccount 専用(note_accounts.session_state_enc, KDP_CRED_KEY
 * 暗号化)へ移行する [docs/11-anp-design.md §7 Phase2 / F-ANP-20]。
 *
 *   bash scripts/anp/note-session-migrate.sh <note_account_id>
 *
 * KDP_CRED_KEY/API_CRED_KEY/DBURL はファイルに書かず実行時に Railway から取得する
 * (note-session-migrate.sh 経由での実行を前提)。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';

const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

const noteAccountId = process.argv[2];
if (!noteAccountId) {
  console.log('usage: note-session-migrate.sh <note_account_id>');
  process.exit(1);
}

const API_KEY_HEX = process.env.API_CRED_KEY || '';
const KDP_KEY_HEX = process.env.KDP_CRED_KEY || '';
const DBURL = process.env.DBURL || '';
if (API_KEY_HEX.length !== 64 || KDP_KEY_HEX.length !== 64 || !DBURL) {
  console.log('API_CRED_KEY(64hex)/KDP_CRED_KEY(64hex)/DBURL 未設定 — note-session-migrate.sh 経由で実行してください');
  process.exit(1);
}

// packages/crypto/{api,kdp}-credentials.ts と同一フォーマット: base64(iv12 || authTag16 || ciphertext)
function decrypt(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
function encrypt(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
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

const r = await c.query("SELECT config_json->>'note_session_enc' AS enc FROM promotion_channel_settings WHERE channel='note'");
const enc = r.rows[0]?.enc;
if (!enc) {
  console.log('promotion_channel_settings.config_json.note_session_enc が見つかりません');
  await c.end();
  process.exit(2);
}

let plaintext;
try {
  plaintext = decrypt(enc, API_KEY_HEX);
  JSON.parse(plaintext); // storageState として妥当か検証
} catch (err) {
  console.log(`復号(API_CRED_KEY)に失敗: ${err.message}`);
  await c.end();
  process.exit(2);
}

const reEncrypted = encrypt(plaintext, KDP_KEY_HEX);
await c.query('UPDATE note_accounts SET session_state_enc=$1, updated_at=NOW() WHERE id=$2', [
  reEncrypted,
  noteAccountId,
]);
console.log(`✔ note_accounts.session_state_enc 移行完了 (account=${acc.rows[0].display_name}, id=${noteAccountId})`);
await c.end();
process.exit(0);
