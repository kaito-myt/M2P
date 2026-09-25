/**
 * `needs_human_review` に溜まった note 記事を一括で再キックする (運営者指示 2026-09-25)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/rekick-review.cjs [--apply] [--force-ready]
 *
 * - 既定 (--apply のみ): 校閲からやり直す (`pipeline.note.editor` を retry_count=1 で投入)。
 *   judge の RETRY_LIMIT=2 なので「あと 1 回だけ自動修正して再判定」になる。
 * - `--force-ready`: 判定を無視して `status='ready'` にする (自動公開が ON なら次の
 *   `note.publish.dispatch` で公開される)。再キックしても届かなかった記事の最終手段。
 *
 * UI の「再判定 / 校閲からやり直し / 強制的に公開可」(app/actions/review.ts) と同じ操作を
 * まとめて行うためのスクリプト。
 */
const path = require('path');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const APPLY = process.argv.includes('--apply');
const FORCE_READY = process.argv.includes('--force-ready');
const EDITOR_TASK = 'pipeline.note.editor';
/** 手動リトライは judge の RETRY_LIMIT を 1 回分残した状態から再開する。 */
const MANUAL_RETRY_COUNT = 1;

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const { rows } = await c.query(
      `SELECT a.id, left(a.title, 30) AS title, a.quality_score, acc.display_name
         FROM note_articles a JOIN note_accounts acc ON acc.id = a.note_account_id
        WHERE a.status = 'needs_human_review'
        ORDER BY a.created_at`,
    );
    console.log(`needs_human_review: ${rows.length} 件${FORCE_READY ? ' (強制公開可)' : ' (校閲から再キック)'}`);
    for (const r of rows) {
      console.log(`- [${r.quality_score ?? '-'}] ${r.display_name} / ${r.title}`);
    }
    if (!APPLY) {
      console.log('\n--apply で実行');
      return;
    }

    let done = 0;
    for (const r of rows) {
      if (FORCE_READY) {
        const res = await c.query(
          "UPDATE note_articles SET status='ready' WHERE id=$1 AND status='needs_human_review'",
          [r.id],
        );
        if (res.rowCount > 0) done += 1;
        continue;
      }

      // CAS で二重実行を防ぎつつ editing へ。
      const guard = await c.query(
        "UPDATE note_articles SET status='editing' WHERE id=$1 AND status='needs_human_review'",
        [r.id],
      );
      if (guard.rowCount === 0) continue;

      const feedback = ['運営者による手動差し戻し: 品質基準を満たすよう内容を見直してください。'];
      const jobRow = await c.query(
        `INSERT INTO jobs (id, kind, status, payload_json, created_at)
         VALUES (gen_random_uuid()::text, $1, 'queued', $2::jsonb, now()) RETURNING id`,
        [EDITOR_TASK, JSON.stringify({ note_article_id: r.id, feedback, retry_count: MANUAL_RETRY_COUNT })],
      );
      const jobId = jobRow.rows[0].id;
      await c.query(
        `SELECT graphile_worker.add_job($1, payload := $2::json, max_attempts := 2)`,
        [
          EDITOR_TASK,
          JSON.stringify({ note_article_id: r.id, job_id: jobId, feedback, retry_count: MANUAL_RETRY_COUNT }),
        ],
      );
      done += 1;
    }
    console.log(`\n${FORCE_READY ? 'ready に変更' : '再キック'}: ${done} 件`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
