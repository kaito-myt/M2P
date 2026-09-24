/**
 * F-097: ペーパーバック出版状態 (`books.pb_*`) の読み書き CLI。
 * ローカルのアシスト実行 (`pb-auto.sh`) から呼ばれ、DB を唯一の正本にする。
 *
 *   node scripts/paperback/pb-state.cjs queue [--limit=N]     キュー (下書き作成待ち) を "<bookId> <asin>" で出力
 *   node scripts/paperback/pb-state.cjs pending [--hours=3]   出版待ちの下書きを "<bookId> <titleId>" で出力
 *   node scripts/paperback/pb-state.cjs drafted <bookId> <titleId>
 *   node scripts/paperback/pb-state.cjs published <bookId>
 *   node scripts/paperback/pb-state.cjs failed <bookId> <reason> [--cooldown-hours=20]
 *   node scripts/paperback/pb-state.cjs stats
 *
 * DBURL は scripts/paperback/pb-env.sh が供給する。
 */
const path = require('path');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const [, , cmd, ...rest] = process.argv;
const argOf = (name, fallback) => {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const positional = rest.filter((a) => !a.startsWith('--'));

async function main() {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    if (cmd === 'queue') {
      const limit = Number(argOf('limit', '5'));
      const { rows } = await c.query(
        `SELECT id, asin FROM books
          WHERE publish_status='published' AND asin IS NOT NULL
            AND pb_publish_status IN ('unlisted','failed')
            AND (pb_submit_cooldown_until IS NULL OR pb_submit_cooldown_until <= now())
          ORDER BY (pb_publish_queued) DESC, created_at
          LIMIT $1`,
        [Number.isFinite(limit) ? limit : 5],
      );
      for (const r of rows) console.log(`${r.id} ${r.asin}`);
      return;
    }

    if (cmd === 'pending') {
      // 原稿は Amazon 側で変換されるまで出版できない (新規直後は必ず失敗する) ので、
      // 下書き作成から一定時間あけたものだけを出版対象にする。
      const hours = Number(argOf('hours', '3'));
      const { rows } = await c.query(
        `SELECT id, pb_title_id FROM books
          WHERE pb_publish_status='drafted' AND pb_title_id IS NOT NULL
            AND pb_drafted_at <= now() - ($1 || ' hours')::interval
          ORDER BY pb_drafted_at`,
        [String(Number.isFinite(hours) ? hours : 3)],
      );
      for (const r of rows) console.log(`${r.id} ${r.pb_title_id}`);
      return;
    }

    if (cmd === 'drafted') {
      const [bookId, titleId] = positional;
      if (!bookId || !titleId) throw new Error('usage: drafted <bookId> <titleId>');
      await c.query(
        `UPDATE books SET pb_publish_status='drafted', pb_title_id=$2, pb_drafted_at=now(),
           pb_publish_queued=false, pb_last_error=NULL, pb_submit_cooldown_until=NULL
         WHERE id=$1`,
        [bookId, titleId],
      );
      console.log(`drafted ${bookId} ${titleId}`);
      return;
    }

    if (cmd === 'published') {
      const [bookId] = positional;
      if (!bookId) throw new Error('usage: published <bookId>');
      await c.query(
        `UPDATE books SET pb_publish_status='published', pb_submitted_at=now(),
           pb_publish_queued=false, pb_last_error=NULL
         WHERE id=$1`,
        [bookId],
      );
      console.log(`published ${bookId}`);
      return;
    }

    if (cmd === 'failed') {
      const [bookId, ...reasonParts] = positional;
      if (!bookId) throw new Error('usage: failed <bookId> <reason>');
      const cooldown = Number(argOf('cooldown-hours', '20'));
      const reason = reasonParts.join(' ').slice(0, 500) || 'unknown';
      // 既に下書きがある本は drafted のまま (出版フェーズで再試行する)。
      await c.query(
        `UPDATE books SET
           pb_publish_status = CASE WHEN pb_publish_status='drafted' THEN 'drafted' ELSE 'failed' END,
           pb_last_error=$2,
           pb_submit_cooldown_until = now() + ($3 || ' hours')::interval,
           pb_publish_queued=false
         WHERE id=$1`,
        [bookId, reason, String(Number.isFinite(cooldown) ? cooldown : 20)],
      );
      console.log(`failed ${bookId}: ${reason}`);
      return;
    }

    if (cmd === 'stats') {
      const { rows } = await c.query(
        `SELECT pb_publish_status, count(*) FROM books WHERE publish_status='published' GROUP BY 1 ORDER BY 2 DESC`,
      );
      const { rows: tot } = await c.query(
        `SELECT count(*) FILTER (WHERE publish_status='published') AS kindle,
                count(*) FILTER (WHERE pb_publish_status='published') AS pb,
                count(*) FILTER (WHERE pb_publish_queued) AS queued
           FROM books`,
      );
      console.log('KDP出版済み:', tot[0].kindle, '/ PB出版済み:', tot[0].pb, '/ キュー:', tot[0].queued);
      console.log('内訳:', JSON.stringify(rows));
      return;
    }

    throw new Error(`unknown command: ${String(cmd)}`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error('pb-state fatal:', e.message);
  process.exit(1);
});
