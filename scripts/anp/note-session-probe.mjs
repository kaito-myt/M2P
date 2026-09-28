/**
 * note のセッションが Playwright で実際に使えるかを確かめる (F-ANP-50 の調査用)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/note-session-probe.mjs <note_account_id> [noteId]
 *
 * 保存/更新は一切しない。エディタを開いて最終 URL を見るだけ。
 * cookie の `expires` をそのまま使った場合と、期限を延長した場合の両方を試す
 * (note の `note_gql_auth_token` は取得直後に期限が切れる設定で降ってくることがあり、
 *  サーバー側ではまだ有効なのに **ブラウザが送らない** ために未ログイン扱いになる)。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';

const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

function dec(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const ACCOUNT_ID = process.argv[2];
const NOTE_ID = process.argv[3] ?? null;
if (!ACCOUNT_ID) {
  console.error('usage: node scripts/anp/note-session-probe.mjs <note_account_id> [noteId]');
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

async function probe(state, label) {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', userAgent: UA });
    const page = await ctx.newPage();
    const url = NOTE_ID ? `https://editor.note.com/notes/${NOTE_ID}/edit/` : 'https://note.com/notes/new';
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(6000);
    const finalUrl = page.url();
    const cookies = await ctx.cookies();
    const sent = cookies.filter((c) => (c.domain || '').includes('note.com')).map((c) => c.name);
    const loggedIn = !/\/login\b|\/signin\b/i.test(finalUrl);
    console.log(`[${label}] loggedIn=${loggedIn} url=${finalUrl.slice(0, 110)}`);
    console.log(`[${label}] context cookies(note.com)=${sent.length} [${sent.join(',')}]`);
    await ctx.close();
    return loggedIn;
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query('select display_name, session_state_enc from note_accounts where id=$1', [ACCOUNT_ID]);
  await c.end();
  if (rows.length === 0 || !rows[0].session_state_enc) {
    console.error('セッションがありません');
    process.exit(1);
  }
  console.log('account:', rows[0].display_name);
  const state = JSON.parse(dec(rows[0].session_state_enc, process.env.KDP_CRED_KEY));

  await probe(state, 'as-is');

  const extended = {
    ...state,
    cookies: (state.cookies || []).map((ck) =>
      typeof ck.expires === 'number' && ck.expires > 0 && ck.expires < Date.now() / 1000
        ? { ...ck, expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }
        : ck,
    ),
  };
  await probe(extended, 'expiry-extended');
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
