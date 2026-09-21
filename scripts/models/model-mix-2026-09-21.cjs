// 2026-09-21 運営者指示「使っている AI モデルがすべて Claude なので、適材適所で使う AI モデルを最適化しておいて」
// usage: bash scripts/paperback/pb-env.sh node scripts/models/model-mix-2026-09-21.cjs [--apply]   (DBURL を環境から読む)
//   --apply 無しは dry-run (差分表示のみ)。適用時は元 active 行を scripts/.stage/ma-backup-model-mix-2026-09-21.json (gitignore 対象・ローカル保管) に保存し、
//   同 role/genre の active を archived にして新 active 行 (created_by='model-mix-2026-09-21') を追加、audit_log に記録する。
//   戻すには backup の id を status='active' に戻し、created_by='model-mix-2026-09-21' の行を archived にする。
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

const ACTOR_ID = 'cmqhfp8sq0014j3c4d875cqb2'; // users.miyata1229
const CREATED_BY = 'model-mix-2026-09-21';

/** role (genre=null) → 目標。理由は docs/03 §7.3 / docs/11 §5.4 参照。 */
const TARGET = [
  // --- Anthropic: 非現行 opus-4-7 (cost ¥0 記録バグ) → opus-5 / 記事の執筆・判定は sonnet-5 に統一
  ['anp.theme', 'anthropic', 'claude-opus-5', 'テーマ企画 (創作寄り) — 非現行 opus-4-7 からの更新'],
  ['anp.strategist', 'anthropic', 'claude-opus-5', 'アカウント設計/プロフィール/販促施策 — 非現行 opus-4-7 からの更新'],
  ['anp.consultant', 'anthropic', 'claude-opus-5', 'AI 相談 — 非現行 opus-4-7 からの更新'],
  ['anp.writer', 'anthropic', 'claude-sonnet-5', 'note 本文執筆 — A2P writer と同じ sonnet-5'],
  ['anp.judge', 'anthropic', 'claude-sonnet-5', '品質判定 — A2P judge と同じ sonnet-5 (GPT は採点が甘い実測)'],
  // --- OpenAI gpt-5: 整える工程・SEO・数値分析・構造化推論 (安価: $1.25/$10 vs $10/$50)
  ['editor', 'openai', 'gpt-5', '校閲 (実用書既定) — 2026-09-01 実測 ¥16/call vs ¥68、品質差小。小説 7 ジャンルは sonnet-5 のまま'],
  ['anp.editor', 'openai', 'gpt-5', 'note 記事の校閲 — editor と同方針'],
  ['finance_mgr', 'openai', 'gpt-5', '財務本部長 — 数値分析/構造化'],
  ['cost_accountant', 'openai', 'gpt-5', 'コスト会計 — 数値分析'],
  ['market_analyst', 'openai', 'gpt-5', '市場分析 — 構造化推論'],
  ['promo_analyst', 'openai', 'gpt-5', '販促分析 — 数値分析'],
  ['cost_optimizer', 'openai', 'gpt-5', 'コスト最適化提案 — 数値分析'],
  ['metadata_worker', 'openai', 'gpt-5', 'KDP メタデータ担当 — seo_optimizer と同じ GPT 系'],
  // book_cover は packages/agents/src/book-cover が assignmentOverride (sonnet-5) を固定しており DB 割当を参照しない → 対象外。
  ['ops_mgr', 'openai', 'gpt-5', '運用本部長 — 障害/ログ分析。自己修復 (healModelOutages) は LLM 非依存'],
  // --- OpenAI gpt-5-mini: 軽い校正
  ['tiktok_proofreader', 'openai', 'gpt-5-mini', 'TikTok 台本の校正 — 軽量'],
  // --- Google gemini-3.8-flash: 長文入力の集計/報告 (低リスク役のみ。health probe + auto-heal で保護)
  ['analytics_mgr', 'google', 'gemini-3.8-flash', '分析本部長 — 2 万 tok 超の集計入力、報告のみ'],
  ['sales_analyst', 'google', 'gemini-3.8-flash', '売上分析 — 集計/報告のみ'],
];

(async () => {
  const apply = process.argv.includes('--apply');
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const roles = TARGET.map((t) => t[0]);
  const { rows: current } = await c.query(
    `SELECT id, role, genre, provider, model, created_by FROM model_assignments WHERE status='active' AND genre IS NULL AND role = ANY($1)`,
    [roles],
  );
  const byRole = new Map(current.map((r) => [r.role, r]));
  const { rows: catalog } = await c.query(`SELECT provider, model, available FROM model_catalog WHERE is_current=true`);
  const catalogSet = new Map(catalog.map((r) => [`${r.provider}/${r.model}`, r.available]));

  const plan = [];
  for (const [role, provider, model, reason] of TARGET) {
    const cur = byRole.get(role);
    const key = `${provider}/${model}`;
    if (!catalogSet.has(key)) throw new Error(`not in current catalog: ${key}`);
    if (catalogSet.get(key) === false) throw new Error(`catalog says unavailable: ${key}`);
    if (cur && cur.provider === provider && cur.model === model) {
      console.log(`= ${role}: already ${key}`);
      continue;
    }
    plan.push({ role, provider, model, reason, before: cur ? { id: cur.id, provider: cur.provider, model: cur.model } : null });
    console.log(`${cur ? '~' : '+'} ${role}: ${cur ? `${cur.provider}/${cur.model}` : '(none)'} -> ${key}   # ${reason}`);
  }
  if (!apply) {
    console.log(`\ndry-run: ${plan.length} changes. Re-run with --apply.`);
    await c.end();
    return;
  }

  fs.writeFileSync(path.join(ROOT, 'scripts/.stage/ma-backup-model-mix-2026-09-21.json'), JSON.stringify({ at: new Date().toISOString(), plan }, null, 2));
  await c.query('BEGIN');
  try {
    for (const p of plan) {
      await c.query(`UPDATE model_assignments SET status='archived', archived_at=now() WHERE status='active' AND genre IS NULL AND role=$1`, [p.role]);
      await c.query(
        `INSERT INTO model_assignments (id, role, genre, provider, model, status, activated_at, created_by)
         VALUES ('ma_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22), $1, NULL, $2, $3, 'active', now(), $4)`,
        [p.role, p.provider, p.model, CREATED_BY],
      );
      await c.query(
        `INSERT INTO audit_log (id, actor_id, action, target_kind, target_id, before_json, after_json, created_at)
         VALUES ('al_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22), $1, 'model_assignment.upsert', 'model_assignment', $2, $3, $4, now())`,
        [ACTOR_ID, `${p.role}:default`, p.before ? JSON.stringify({ provider: p.before.provider, model: p.before.model }) : null, JSON.stringify({ provider: p.provider, model: p.model, source: 'model-mix-2026-09-21', reason: p.reason })],
      );
    }
    const { rows: bad } = await c.query(
      `SELECT role, genre, count(*) FROM model_assignments WHERE status='active' GROUP BY role, genre HAVING count(*) <> 1`,
    );
    if (bad.length > 0) throw new Error(`active count != 1: ${JSON.stringify(bad)}`);
    await c.query('COMMIT');
    console.log(`\napplied ${plan.length} changes.`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  const { rows: after } = await c.query(`SELECT role, provider, model FROM model_assignments WHERE status='active' AND genre IS NULL AND role = ANY($1) ORDER BY role`, [roles]);
  console.log(after.map((r) => `${r.role} = ${r.provider}/${r.model}`).join('\n'));
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
