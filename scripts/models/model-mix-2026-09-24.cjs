// 2026-09-24 運営者指示「モデルの構成はこれにして」(GPT-6 Sol/Luna + Claude Sonnet 5 + Nano Banana 2)。
// usage: bash scripts/paperback/pb-env.sh node scripts/models/model-mix-2026-09-24.cjs [--apply]
//   --apply 無しは dry-run。適用時は元 active 行を scripts/.stage/ma-backup-model-mix-2026-09-24.json に保存し、
//   同 role/genre の active を archived にして新 active 行 (created_by='model-mix-2026-09-24') を追加、audit_log に記録する。
//
// 設計意図 (docs/11 §5.4):
//   - 執筆は Claude Sonnet 5、評価/校閲は GPT-6 Sol —— **書いたモデルと直すモデルを分ける**
//     (同じモデルに自分の文章を採点させると、そのモデル特有の癖をそのまま通してしまう)。
//   - 企画/構成/告知文のような高頻度・定型作業は GPT-6 Luna ($0.10/$0.50 = Sol の 1/20)。
//   - judge は品質の門番なので落とさない (Sol / effort=high)。
//   - アイキャッチは Nano Banana 2 (gemini-3.1-flash-image)。文字は焼き込まず実フォント合成 (F-ANP-41)。
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const ACTOR_ID = 'cmqhfp8sq0014j3c4d875cqb2'; // users.miyata1229
const CREATED_BY = 'model-mix-2026-09-24';

/** role → [provider, model, reasoning_effort, 理由] */
const TARGET = [
  ['anp.theme', 'openai', 'gpt-6-luna', 'low', 'テーマ候補の大量生成 — 定型・高頻度。Sol の 1/20 単価'],
  ['anp.outline', 'openai', 'gpt-6-luna', 'medium', '構成 (見出し設計) — 定型。構造化出力で十分'],
  ['anp.strategist', 'openai', 'gpt-6-sol', 'high', 'アカウント設計/プロフィール/販促施策 — 最上流。毎記事は走らない'],
  ['anp.writer', 'anthropic', 'claude-sonnet-5', null, 'note 本文の長文執筆 — 日本語の読み味で選定 ($2/$10)'],
  ['anp.judge', 'openai', 'gpt-6-sol', 'high', '品質判定 — 書いた Claude と別系統で採点 (クロスチェック)'],
  ['anp.editor', 'openai', 'gpt-6-sol', 'medium', '校閲 — 問題箇所の特定と最小修正。judge と系統を揃える'],
  ['anp.seo', 'openai', 'gpt-6-sol', 'medium', 'note 内 SEO/タイトル設計 (F-ANP-42) — 1 記事 1 回'],
  ['anp.promo', 'openai', 'gpt-6-luna', 'low', 'X/IG 等の告知文 — 短文・高頻度'],
  ['anp.eyecatch', 'google', 'gemini-3.1-flash-image', null, 'アイキャッチ画像 (Nano Banana 2) — 文字は実フォント合成'],
];

(async () => {
  const apply = process.argv.includes('--apply');
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const roles = TARGET.map((t) => t[0]);
  const { rows: current } = await c.query(
    `SELECT id, role, genre, provider, model, reasoning_effort, created_by FROM model_assignments WHERE status='active' AND genre IS NULL AND role = ANY($1)`,
    [roles],
  );
  const byRole = new Map(current.map((r) => [r.role, r]));
  const { rows: catalog } = await c.query(`SELECT provider, model, available FROM model_catalog WHERE is_current=true`);
  const catalogSet = new Map(catalog.map((r) => [`${r.provider}/${r.model}`, r.available]));

  const plan = [];
  for (const [role, provider, model, effort, reason] of TARGET) {
    const cur = byRole.get(role);
    const key = `${provider}/${model}`;
    if (!catalogSet.has(key)) throw new Error(`not in current catalog: ${key} (先に catalog 行を入れてください)`);
    if (catalogSet.get(key) === false) throw new Error(`catalog says unavailable: ${key}`);
    if (cur && cur.provider === provider && cur.model === model && (cur.reasoning_effort ?? null) === effort) {
      console.log(`= ${role}: already ${key}${effort ? ` (${effort})` : ''}`);
      continue;
    }
    plan.push({
      role,
      provider,
      model,
      effort,
      reason,
      before: cur ? { id: cur.id, provider: cur.provider, model: cur.model, effort: cur.reasoning_effort ?? null } : null,
    });
    console.log(
      `${cur ? '~' : '+'} ${role}: ${cur ? `${cur.provider}/${cur.model}${cur.reasoning_effort ? ` (${cur.reasoning_effort})` : ''}` : '(none)'} -> ${key}${effort ? ` (${effort})` : ''}   # ${reason}`,
    );
  }
  if (!apply) {
    console.log(`\ndry-run: ${plan.length} changes. Re-run with --apply.`);
    await c.end();
    return;
  }

  fs.mkdirSync(path.join(ROOT, 'scripts/.stage'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'scripts/.stage/ma-backup-model-mix-2026-09-24.json'),
    JSON.stringify({ at: new Date().toISOString(), plan }, null, 2),
  );
  await c.query('BEGIN');
  try {
    for (const p of plan) {
      await c.query(
        `UPDATE model_assignments SET status='archived', archived_at=now() WHERE status='active' AND genre IS NULL AND role=$1`,
        [p.role],
      );
      await c.query(
        `INSERT INTO model_assignments (id, role, genre, provider, model, reasoning_effort, status, activated_at, created_by)
         VALUES ('ma_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22), $1, NULL, $2, $3, $4, 'active', now(), $5)`,
        [p.role, p.provider, p.model, p.effort, CREATED_BY],
      );
      await c.query(
        `INSERT INTO audit_log (id, actor_id, action, target_kind, target_id, before_json, after_json, created_at)
         VALUES ('al_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22), $1, 'model_assignment.upsert', 'model_assignment', $2, $3, $4, now())`,
        [
          ACTOR_ID,
          `${p.role}:default`,
          p.before ? JSON.stringify(p.before) : null,
          JSON.stringify({ provider: p.provider, model: p.model, reasoning_effort: p.effort, source: CREATED_BY, reason: p.reason }),
        ],
      );
    }
    const { rows: bad } = await c.query(
      `SELECT role, genre, count(*) FROM model_assignments WHERE status='active' GROUP BY role, genre HAVING count(*) <> 1`,
    );
    if (bad.length > 0) throw new Error(`active count != 1: ${JSON.stringify(bad)}`);
    await c.query('COMMIT');
    console.log(`applied ${plan.length} changes.`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  await c.end();
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
