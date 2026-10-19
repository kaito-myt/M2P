/**
 * note.engage が記録した「スキ」が実在するかを note 自身に聞いて監査する (F-091)。
 *
 *   bash scripts/anp/anp-env.sh node scripts/anp/verify-likes.mjs            # 監査のみ
 *   bash scripts/anp/anp-env.sh node scripts/anp/verify-likes.mjs --apply    # 実体の無い行を削除
 *
 * フォローは公開 API (`/api/v2/creators/<handle>/followings`) で無認証に突合できるが
 * (`verify-follows.cjs`)、スキは「自分がスキしたか」なので**ログイン済みセッションが要る**。
 * `GET https://note.com/api/v3/notes/<id>` が認証付きで `data.is_liked` を返すので、それを正とする。
 *
 * **なぜ必要か (2026-10-19)**: スキの locator が「スキした人を見る」件数ボタン
 * (`aria-label="97スキ この記事にスキをつけたユーザーを見る"`) を掴んでいて、
 * `aria-pressed` を持たないため確認が常に false。押下は空振りで、記録 14 件はすべて
 * `is_liked=false` の実体の無い行だった。worker 側は API 確認に直したが、
 * note の DOM / API が変われば同じ事故が起きるので、外から確かめる口を残す。
 *
 * READ-ONLY (--apply を付けたときだけ、実体の無い行を削除する)。note 側は一切操作しない。
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
const DBURL = process.env.DBURL || process.env.DATABASE_URL;
const KEY = process.env.KDP_CRED_KEY;

/** `note_accounts.session_state_enc` は ANP の連携画面が KDP_CRED_KEY で AES-256-GCM 暗号化して書く。 */
function decryptSession(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

if (!DBURL || !KEY) {
  console.error('DBURL と KDP_CRED_KEY が必要です。bash scripts/anp/anp-env.sh 経由で実行し、');
  console.error('KDP_CRED_KEY は A2P-Worker の env から渡してください。');
  process.exit(2);
}

const c = new Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
let session;
let rows;
try {
  const acc = await c.query(
    "select id, handle, session_state_enc from note_accounts where session_state_enc is not null and status <> 'archived' order by created_at limit 1",
  );
  if (!acc.rowCount) {
    console.error('セッションを持つ note アカウントがありません。');
    process.exit(2);
  }
  console.log(`セッション: ${acc.rows[0].handle} (${acc.rows[0].id})`);
  session = JSON.parse(decryptSession(acc.rows[0].session_state_enc, KEY));
  rows = (
    await c.query(
      "select id, target_handle, target_url, status, created_at from promotion_sns_engagements where channel='note' and action_type='like' order by created_at",
    )
  ).rows;
} catch (e) {
  await c.end();
  throw e;
}

const browser = await chromium.launch({
  headless: false,
  channel: 'chrome',
  args: ['--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({ storageState: session, locale: 'ja-JP' });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();

const real = [];
const phantom = [];
const unknown = [];
console.log(`\nDB 側 like 記録: ${rows.length} 件`);
for (const r of rows) {
  const id = /\/n\/([A-Za-z0-9]+)/.exec(r.target_url || '')?.[1];
  if (!id) {
    unknown.push(r);
    console.log(`  判定不能 (URL に記事 ID が無い) ${r.target_handle} ${r.target_url}`);
    continue;
  }
  await page.goto(`https://note.com/api/v3/notes/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  const text = await page.locator('body').innerText().catch(() => '');
  let liked = null;
  try {
    const v = JSON.parse(text)?.data?.is_liked;
    liked = typeof v === 'boolean' ? v : null;
  } catch {
    liked = null;
  }
  if (liked === true) real.push(r);
  else if (liked === false) phantom.push(r);
  else unknown.push(r);
  console.log(`  ${liked === true ? 'OK  ' : liked === false ? 'MISS' : '不明'} ${r.created_at.toISOString()} ${r.target_handle}`);
  await new Promise((s) => setTimeout(s, 900));
}
await browser.close();

console.log(`\n突合: 実体あり ${real.length} / 実体なし ${phantom.length} / 判定不能 ${unknown.length} / 計 ${rows.length}`);

if (phantom.length > 0 && APPLY) {
  const del = await c.query('delete from promotion_sns_engagements where id = any($1::text[]) returning id', [
    phantom.map((p) => p.id),
  ]);
  console.log(`実体の無い行を削除しました: ${del.rowCount} 行 (対象が再度スキできるようになります)`);
}
await c.end();

if (phantom.length > 0 && !APPLY) {
  console.error(`\nNG: ${phantom.length} 件が note 側でスキされていません。--apply で削除できます。`);
  process.exit(1);
}
console.log(phantom.length === 0 ? '\nOK: 記録したスキはすべて実在します。' : '');
