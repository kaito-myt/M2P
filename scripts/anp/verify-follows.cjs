/**
 * note.engage が記録した follow が、note 側の「フォロー中」に実在するかを突き合わせる (F-091)。
 *
 *   bash scripts/anp/anp-env.sh node scripts/anp/verify-follows.cjs
 *
 * `GET https://note.com/api/v2/creators/<handle>/followings?page=N` は認証不要で
 * フォロー中リスト(`data.follows[].urlname`)を返す。ブラウザ自動化は
 * 「押したボタンと同じ locator を読み直して done にする」設計だが、note の DOM が
 * 変わると「押していないのに done」が再発しうるので、実在確認はこの外部突合で行う。
 *
 * 不一致が 1 件でもあれば exit 1。その場合は playwright-note-engage-port.ts の
 * locator (特に main 外フォールバック) を疑い、fail-closed に倒す (docs/11 §5)。
 *
 * promotion_sns_engagements はチャンネル単位で account_id を持たないので、
 * 突合は「全アカウントのフォロー中リストの和集合に含まれるか」で行う。
 */
const path = require('path');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const DBURL = process.env.DBURL || process.env.DATABASE_URL;
const UA = 'Mozilla/5.0';
const norm = (h) => String(h || '').replace(/^@/, '').trim().toLowerCase();

async function fetchFollowings(handle) {
  const out = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetch(`https://note.com/api/v2/creators/${handle}/followings?page=${page}`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) {
      console.log(`  ! ${handle} page${page}: HTTP ${res.status}`);
      break;
    }
    const body = await res.json();
    const follows = body?.data?.follows ?? [];
    for (const f of follows) out.push({ urlname: f.urlname, name: f.name });
    // isLastPage が false のときだけ次ページへ (欠けていれば 1 ページで打ち切る)
    if (body?.data?.isLastPage !== false || follows.length === 0) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

(async () => {
  if (!DBURL) {
    console.error('DBURL が未設定です。bash scripts/anp/anp-env.sh 経由で実行してください。');
    process.exit(2);
  }
  const c = new Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let accounts;
  let rows;
  try {
    accounts = (
      await c.query(
        "select id, display_name, handle from note_accounts where handle is not null and status <> 'archived' order by created_at",
      )
    ).rows;
    rows = (
      await c.query(
        "select target_handle, status, created_at from promotion_sns_engagements where channel='note' and action_type='follow' order by created_at",
      )
    ).rows;
  } finally {
    await c.end();
  }

  if (accounts.length === 0) {
    console.error('handle を持つ note アカウントがありません。');
    process.exit(2);
  }

  const noteSide = new Map();
  for (const a of accounts) {
    const list = await fetchFollowings(a.handle);
    noteSide.set(a.handle, list);
    console.log(`note 側 ${a.handle} (${a.display_name}): ${list.length} 件フォロー中`);
  }
  const union = new Set();
  for (const list of noteSide.values()) for (const f of list) union.add(norm(f.urlname));

  console.log(`\nDB 側 follow 記録: ${rows.length} 件`);
  const missing = [];
  for (const r of rows) {
    const hit = union.has(norm(r.target_handle));
    if (!hit) missing.push(r.target_handle);
    console.log(`  ${hit ? 'OK  ' : 'MISS'} ${r.created_at.toISOString()} ${r.status} ${r.target_handle}`);
  }
  console.log(`\n突合: 一致 ${rows.length - missing.length} / ${rows.length}、不一致 ${missing.length}`);

  const dbSet = new Set(rows.map((r) => norm(r.target_handle)));
  for (const [handle, list] of noteSide) {
    const extra = list.filter((f) => !dbSet.has(norm(f.urlname)));
    if (extra.length === 0) continue;
    console.log(`\n${handle}: DB に記録のないフォロー ${extra.length} 件 (手動 / note 公式の自動フォロー等)`);
    for (const f of extra.slice(0, 50)) console.log(`   ${f.urlname}  ${String(f.name).slice(0, 40)}`);
  }

  if (missing.length > 0) {
    console.error(`\nNG: ${missing.length} 件が note 側に実在しません → ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('\nOK: 記録した follow はすべて note 側に実在します。');
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
