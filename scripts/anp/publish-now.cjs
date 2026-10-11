// usage: bash scripts/paperback/pb-env.sh node scripts/anp/publish-now.cjs [--limit N]
// `status='ready' AND publish_status='draft'` の記事を今すぐ pipeline.note.publish へ投入する。
// note.publish.dispatch (30分毎・1アカウント15本/日) を待たずに流したいときに使う。
// 同時に走らせない: 1 件ずつ graphile に積み、worker の並列度に任せる (job_key で重複防止)。
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.join('C:/DEV/M2P', 'apps/anp/package.json'));
const { makeWorkerUtils } = req('graphile-worker');
const { Client } = createRequire(path.join('C:/DEV/M2P', 'package.json'))(
  path.join('C:/DEV/M2P', 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 1;
/** --paid / --free で絞る (有料公開の経路を単独で確認したいとき用)。 */
const ONLY_PAID = process.argv.includes('--paid');
const ONLY_FREE = process.argv.includes('--free');

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows: settings } = await c.query(
    `SELECT anp_publish_dry_run FROM app_settings WHERE id='singleton'`,
  );
  const dryRun = settings[0]?.anp_publish_dry_run === true;

  const { rows } = await c.query(
    `SELECT a.id, left(a.title, 40) AS title, a.paid, a.price_jpy, a.quality_score, acc.display_name AS account
       FROM note_articles a
       JOIN note_accounts acc ON acc.id = a.note_account_id
      WHERE a.status = 'ready' AND a.publish_status = 'draft' AND acc.status = 'active'
        AND ($2::boolean IS NULL OR a.paid = $2::boolean)
      ORDER BY a.quality_score DESC, a.updated_at ASC
      LIMIT $1`,
    [LIMIT, ONLY_PAID ? true : ONLY_FREE ? false : null],
  );
  if (rows.length === 0) {
    console.log('対象なし');
    await c.end();
    return;
  }
  console.log(`dry_run=${dryRun} / 投入 ${rows.length} 本`);

  const utils = await makeWorkerUtils({
    connectionString:
      process.env.DBURL + (process.env.DBURL.includes('?') ? '&' : '?') + 'sslmode=no-verify',
  });
  for (const r of rows) {
    const { rows: jr } = await c.query(
      `INSERT INTO jobs (id, kind, status, payload_json, created_at)
       VALUES (gen_random_uuid()::text, 'pipeline.note.publish', 'queued', $1::jsonb, now())
       RETURNING id`,
      [JSON.stringify({ note_article_id: r.id, dry_run: dryRun })],
    );
    const jobId = jr[0].id;
    await utils.addJob(
      'pipeline.note.publish',
      { note_article_id: r.id, job_id: jobId, dry_run: dryRun },
      { jobKey: `note-publish-${r.id}`, jobKeyMode: 'preserve_run_at', maxAttempts: 2 },
    );
    console.log(
      `  ${r.quality_score}点 ${r.paid ? `有料¥${r.price_jpy}` : '無料'} [${r.account}] ${r.title}`,
    );
  }
  await utils.release();
  await c.end();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
