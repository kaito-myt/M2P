/**
 * 公開済みの無料記事を一括で有料化する (F-ANP-47、運営者指示 2026-09-25「有料化機能作って」)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/monetize-published.cjs            # 対象一覧 (dry)
 *   bash scripts/paperback/pb-env.sh node scripts/anp/monetize-published.cjs --apply    # ドライラン投入
 *   bash scripts/paperback/pb-env.sh node scripts/anp/monetize-published.cjs --apply --real
 *                                                                                      # 実際に有料化
 *
 * judge の格下げバグ (F-ANP-45) で無料公開されてしまった記事の後始末用。1 件ずつ
 * `pipeline.note.monetize` を投入する (worker 側が note エディタを開いて有料ラインを引き直す)。
 *
 * オプション:
 *   --real           実際に「更新する」を押す (省略時は有料設定+価格入力まで進めて更新しない)。
 *                    実更新はアカウント設定 `paid_publish_enabled` が ON かつグローバルの
 *                    ドライランが OFF のときだけ worker 側で実行される。
 *   --all            価格提案が無い記事も対象にする。**既定では judge が価格を提案した記事
 *                    (`price_jpy > 0`) だけ**を対象にする — 企画時から無料のつもりの記事まで
 *                    有料にすると回遊用の無料記事が無くなるため。
 *   --account=<id>   対象アカウントを絞る。
 *   --limit=<n>      投入件数の上限 (既定 0 = 全件)。
 *   --price=<jpy>    価格を明示する (省略時は記事の提案価格 → 価格帯下限 → 500 円)。
 */
const path = require('path');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const TASK = 'pipeline.note.monetize';
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const REAL = argv.includes('--real');
const arg = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const ALL = argv.includes('--all');
const ACCOUNT = arg('account');
const LIMIT = Number(arg('limit') ?? 0) || 0;
const PRICE = arg('price') ? Number(arg('price')) : null;

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const params = [];
    let where = "a.status='published' AND a.paid=false AND a.note_url IS NOT NULL";
    if (!ALL) where += ' AND a.price_jpy > 0';
    if (ACCOUNT) {
      params.push(ACCOUNT);
      where += ` AND a.note_account_id = $${params.length}`;
    }
    const { rows } = await c.query(
      `SELECT a.id, left(a.title, 34) AS title, a.price_jpy, a.note_url,
              acc.display_name, (acc.settings_json->>'paid_publish_enabled') AS paid_enabled,
              length(coalesce(a.body_md, '')) AS chars
         FROM note_articles a JOIN note_accounts acc ON acc.id = a.note_account_id
        WHERE ${where}
        ORDER BY a.published_at DESC NULLS LAST`,
      params,
    );
    const global = await c.query("SELECT anp_publish_dry_run FROM app_settings WHERE id='singleton'");
    const globalDry = global.rows[0]?.anp_publish_dry_run ?? true;

    console.log(
      `有料化候補 (公開済み・無料${ALL ? '・価格提案なしも含む' : '・価格提案ありのみ'}): ${rows.length} 件 / グローバルdry_run=${globalDry}`,
    );
    for (const r of rows) {
      console.log(
        `- ${r.display_name} [提案¥${r.price_jpy ?? '-'} / ${r.chars}字 / paid_publish=${r.paid_enabled ?? 'unset'}] ${r.title}`,
      );
    }
    const targets = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
    if (!APPLY) {
      console.log(`\n--apply で ${targets.length} 件投入 (--real を付けると実際に有料化)`);
      return;
    }
    if (REAL && globalDry) {
      console.log('\nグローバルのドライラン設定が ON のため実更新はできません (ANP /settings で OFF に)。');
    }

    let enqueued = 0;
    for (const r of targets) {
      const payload = { note_article_id: r.id, dry_run: !REAL };
      if (PRICE) payload.price_jpy = PRICE;
      const jobRow = await c.query(
        `INSERT INTO jobs (id, kind, status, payload_json, created_at)
         VALUES (gen_random_uuid()::text, $1, 'queued', $2::jsonb, now()) RETURNING id`,
        [TASK, JSON.stringify(payload)],
      );
      const jobId = jobRow.rows[0].id;
      await c.query(`SELECT graphile_worker.add_job($1, payload := $2::json, max_attempts := 2)`, [
        TASK,
        JSON.stringify({ ...payload, job_id: jobId }),
      ]);
      enqueued += 1;
    }
    console.log(`\n投入: ${enqueued} 件 (dry_run=${!REAL})`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
