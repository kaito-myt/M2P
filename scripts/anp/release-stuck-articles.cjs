/**
 * 滞留している `needs_human_review` 記事を公開ラインに戻す (2026-10-11)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/release-stuck-articles.cjs
 *   bash scripts/paperback/pb-env.sh node scripts/anp/release-stuck-articles.cjs --apply --limit 1
 *   bash scripts/paperback/pb-env.sh node scripts/anp/release-stuck-articles.cjs --apply
 *
 * 背景: judge の合格ライン 85 が実測で到達不能だったため、差し戻しを使い切った記事が
 * 全部 `needs_human_review` に落ち、`note.publish.dispatch` は `status='ready'` しか
 * 拾わないので 9 日間 1 本も公開されなかった (docs/11「9日間1本も公開されていなかった」)。
 * コード側は `NOTE_JUDGE_PUBLISH_FLOOR` で解消したが、既に落ちた記事は status を戻す必要がある。
 *
 * 更新は `apps/anp/app/actions/review.ts` の `forceReady` と同じ CAS
 * (`WHERE status='needs_human_review'`) にする。進行中の記事を踏まない。
 * 実公開そのものは `note.publish.dispatch` (30分毎・1アカウント15本/日) に任せる。
 */
const { Client } = require('pg');

/** 公開下限。`NOTE_JUDGE_PUBLISH_FLOOR` (packages/contracts/src/agents/anp.ts) と同じ値。 */
const PUBLISH_FLOOR = 70;

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : null;

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows: candidates } = await c.query(
    `SELECT a.id, a.title, a.paid, a.price_jpy, a.quality_score, a.paywall_line_pos,
            acc.display_name AS account
       FROM note_articles a
       JOIN note_accounts acc ON acc.id = a.note_account_id
      WHERE a.status = 'needs_human_review'
        AND a.publish_status = 'draft'
        AND a.quality_score >= $1
        AND a.body_md IS NOT NULL
        -- 有料記事は有料ラインが無いと本文が丸ごと有料側に入る。そういう記事は出さない。
        AND (a.paid = false OR a.paywall_line_pos IS NOT NULL)
      ORDER BY a.quality_score DESC, a.updated_at ASC`,
    [PUBLISH_FLOOR],
  );

  const { rows: held } = await c.query(
    `SELECT count(*) FILTER (WHERE quality_score < $1) AS below_floor,
            count(*) FILTER (WHERE paid = true AND paywall_line_pos IS NULL) AS paid_no_line,
            count(*) AS total
       FROM note_articles
      WHERE status = 'needs_human_review' AND publish_status = 'draft'`,
    [PUBLISH_FLOOR],
  );

  const target = LIMIT === null ? candidates : candidates.slice(0, LIMIT);

  console.log(`滞留 ${held[0].total} 本 / 公開ライン (>= ${PUBLISH_FLOOR}) に戻せる ${candidates.length} 本`);
  console.log(`  据え置き: 下限未満 ${held[0].below_floor} 本 / 有料だが有料ライン無し ${held[0].paid_no_line} 本`);
  const byAccount = {};
  for (const r of target) {
    byAccount[r.account] = (byAccount[r.account] ?? 0) + 1;
  }
  console.log(`  今回戻す ${target.length} 本: ${JSON.stringify(byAccount)}`);
  const paidCount = target.filter((r) => r.paid).length;
  console.log(`  うち有料 ${paidCount} 本 / 無料 ${target.length - paidCount} 本`);
  for (const r of target.slice(0, 5)) {
    console.log(`    ${r.quality_score}点 ${r.paid ? `有料¥${r.price_jpy}` : '無料'} ${r.title.slice(0, 40)}`);
  }

  if (!APPLY) {
    console.log('\n--- dry-run (--apply で反映) ---');
    await c.end();
    return;
  }

  let moved = 0;
  for (const r of target) {
    const res = await c.query(
      `UPDATE note_articles SET status = 'ready', updated_at = now()
        WHERE id = $1 AND status = 'needs_human_review'`,
      [r.id],
    );
    moved += res.rowCount;
  }
  console.log(`\nready に戻した: ${moved} 本 (note.publish.dispatch が 30 分毎に拾う)`);
  await c.end();
})();
