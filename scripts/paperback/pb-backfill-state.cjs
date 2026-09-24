/**
 * F-097: ローカルのテキスト台帳 (pb-published.txt / pb-drafted.txt / pb-drafts-pending.txt) から
 * `books.pb_*` へ状態を移す 1 回限りのバックフィル。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-backfill-state.cjs [--apply]
 *
 * 以後の正本は DB。テキストはローカル実行ログとして残すだけ。
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const APPLY = process.argv.includes('--apply');
const dir = path.join(ROOT, 'scripts/paperback');

function readLines(file) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

(async () => {
  const published = new Set(readLines('pb-published.txt').map((l) => l.split(/\s+/)[0]));
  const drafted = new Set(readLines('pb-drafted.txt').map((l) => l.split(/\s+/)[0]));
  const titleIds = new Map();
  for (const line of readLines('pb-drafts-pending.txt')) {
    const [bid, tid] = line.split(/\s+/);
    if (bid && tid) titleIds.set(bid, tid);
  }

  console.log(`published=${published.size} drafted=${drafted.size} titleIds=${titleIds.size}`);

  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  let pubCount = 0;
  let draftCount = 0;
  for (const id of published) {
    if (APPLY) {
      await c.query(
        `UPDATE books SET pb_publish_status='published', pb_publish_queued=false,
           pb_submitted_at=COALESCE(pb_submitted_at, now()), pb_drafted_at=COALESCE(pb_drafted_at, now()),
           pb_title_id=COALESCE(pb_title_id, $2)
         WHERE id=$1`,
        [id, titleIds.get(id) ?? null],
      );
    }
    pubCount += 1;
  }
  for (const id of drafted) {
    if (published.has(id)) continue;
    if (APPLY) {
      await c.query(
        `UPDATE books SET pb_publish_status='drafted', pb_drafted_at=COALESCE(pb_drafted_at, now()),
           pb_title_id=COALESCE(pb_title_id, $2)
         WHERE id=$1 AND pb_publish_status <> 'published'`,
        [id, titleIds.get(id) ?? null],
      );
    }
    draftCount += 1;
  }

  const { rows } = await c.query(
    `SELECT pb_publish_status, count(*) FROM books WHERE publish_status='published' GROUP BY 1 ORDER BY 2 DESC`,
  );
  console.log(`${APPLY ? '適用後' : '(dry-run) 現在'} の KDP 出版済み本の PB 状態:`, JSON.stringify(rows));
  console.log(`published→${pubCount} 件 / drafted→${draftCount} 件 ${APPLY ? '更新' : 'を更新予定'}`);
  if (!APPLY) console.log('--apply で反映');
  await c.end();
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
