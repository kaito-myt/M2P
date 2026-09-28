/**
 * 公開済み記事に残った Markdown (表・`**`・バッククォート・`---`・リンク記法) を直す
 * (F-ANP-48、運営者報告 2026-09-28
 * 「表がこんな感じで表示されてるからちゃんと表で出力されるようにして」)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/fix-tables.cjs                     # 対象一覧 (dry)
 *   bash scripts/paperback/pb-env.sh node scripts/anp/fix-tables.cjs --apply             # ドライラン投入
 *   bash scripts/paperback/pb-env.sh node scripts/anp/fix-tables.cjs --apply --real      # 実際に更新
 *
 * note のエディタには表機能が無いため、初期の記事は `| 頭数帯 | レース数 |` がそのまま
 * 公開されている。1 件ずつ `pipeline.note.fix-tables` を投入し、worker が note エディタで
 * パイプ段落を消して表画像に差し替える。
 *
 * オプション:
 *   --real           実際に「更新する」を押す (省略時は差し替えるだけで更新しない。
 *                    note は公開中の本文を「更新する」まで変えないので安全)。
 *   --account=<id>   対象アカウントを絞る。
 *   --limit=<n>      投入件数の上限 (既定 0 = 全件)。
 *   --article=<id>   特定の記事だけ投入する (検証用)。
 */
const path = require('path');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const TASK = 'pipeline.note.fix-tables';
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const REAL = argv.includes('--real');
const arg = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const ACCOUNT = arg('account');
const ARTICLE = arg('article');
const LIMIT = Number(arg('limit') ?? 0) || 0;

/** body_md に GFM の表が何個あるか (worker 側の splitTableSegments と同じ判定)。 */
function countTables(md) {
  const lines = String(md || '').split('\n');
  let n = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    const row = lines[i].trim();
    const sep = lines[i + 1].trim();
    const isRow = /^\|.*\|$/.test(row) && (row.match(/\|/g) || []).length >= 3;
    const isSep = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(sep) && sep.includes('-');
    if (isRow && isSep) n += 1;
  }
  return n;
}

/** 公開記事に出てしまう Markdown 記号の数 (`**` / バッククォート / `[文字](URL)` / 単独行の `---`)。 */
function countJunk(md) {
  const b = String(md || '');
  return (
    (b.match(/\*\*/g) || []).length +
    (b.match(/`/g) || []).length +
    (b.match(/\[[^\]]+\]\([^)]*\)/g) || []).length +
    (b.match(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm) || []).length
  );
}

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const params = [];
    let where = "a.status='published' AND a.note_url IS NOT NULL";
    if (ACCOUNT) {
      params.push(ACCOUNT);
      where += ` AND a.note_account_id = $${params.length}`;
    }
    if (ARTICLE) {
      params.push(ARTICLE);
      where += ` AND a.id = $${params.length}`;
    }
    const { rows } = await c.query(
      `SELECT a.id, left(a.title, 34) AS title, a.paid, a.note_url, a.body_md, acc.display_name
         FROM note_articles a JOIN note_accounts acc ON acc.id = a.note_account_id
        WHERE ${where}
        ORDER BY a.published_at DESC NULLS LAST`,
      params,
    );
    const withTables = rows
      .map((r) => ({ ...r, tables: countTables(r.body_md), junk: countJunk(r.body_md) }))
      .filter((r) => r.tables > 0 || r.junk > 0);

    const global = await c.query("SELECT anp_publish_dry_run FROM app_settings WHERE id='singleton'");
    const globalDry = global.rows[0]?.anp_publish_dry_run ?? true;

    console.log(
      `Markdown が残っている公開記事: ${withTables.length} 件 / 公開記事 ${rows.length} 件 / グローバルdry_run=${globalDry}`,
    );
    for (const r of withTables) {
      console.log(
        `- ${r.display_name} [表${r.tables}個 記号${r.junk}個 / ${r.paid ? '有料' : '無料'}] ${r.title}  ${r.note_url}`,
      );
    }
    const targets = LIMIT > 0 ? withTables.slice(0, LIMIT) : withTables;
    if (!APPLY) {
      console.log(`\n--apply で ${targets.length} 件投入 (--real を付けると実際に更新)`);
      return;
    }
    if (REAL && globalDry) {
      console.log('\nグローバルのドライラン設定が ON のため実更新はできません (ANP /settings で OFF に)。');
    }

    let enqueued = 0;
    for (const r of targets) {
      const payload = { note_article_id: r.id, dry_run: !REAL };
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
