// 2026-09-24 運営者指示「A2P のモデル構成下記を参考に」(KDP 書籍パイプライン)。
// usage: bash scripts/paperback/pb-env.sh node scripts/models/model-mix-a2p-2026-09-24.cjs [--apply]
//
// 設計意図:
//   - 書くのは Claude Sonnet 4.6 (章をまたぐ一貫性・長文の指示追従)、**直す/採点するのは GPT-6 Sol**
//     (同じモデルに自分の文章を採点させない)。
//   - Judge は「粗悪な原稿を出版するか止めるかの最後の門番」なのでケチらない (Sol / high)。
//   - Thumbnail Text は 10〜30 字のコピーなのでオーバースペックだった Sonnet 4.6 → Luna へ。
//   - Optimizer は Writer/Editor/Judge の後段なので Opus 4.8 を常用しない (Sol / high)。
//   - 小説 7 ジャンルの writer/editor 上書き (Claude) はそのまま残す — 既定行だけを入れ替える。
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const ACTOR_ID = 'cmqhfp8sq0014j3c4d875cqb2'; // users.miyata1229
const CREATED_BY = 'model-mix-a2p-2026-09-24';

/** role → [provider, model, reasoning_effort, 理由] */
const TARGET = [
  ['writer', 'anthropic', 'claude-sonnet-4-6', null, '本文執筆 — 章をまたぐ一貫性・長文の指示追従 (維持)'],
  ['editor', 'openai', 'gpt-6-sol', 'medium', '校閲 — Claude が書いた原稿を別系統で直す (gpt-5 から更新)'],
  ['marketer', 'google', 'gemini-3.1-pro-preview', null, '市場/テーマ設計 — 検索連携との相性 (維持)'],
  ['judge', 'openai', 'gpt-6-sol', 'high', '品質判定 — 出版可否の最後の門番。gemini-3.8-flash から強化'],
  ['thumbnail_text', 'openai', 'gpt-6-luna', 'low', '表紙コピー 10〜30 字 — sonnet-4-6 はオーバースペック'],
  ['thumbnail_image', 'openai', 'gpt-image-2', null, '表紙画像 (維持)'],
  ['optimizer', 'openai', 'gpt-6-sol', 'high', 'プロンプト/原稿最適化 — opus-4-8 の常用をやめる'],
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
    path.join(ROOT, 'scripts/.stage/ma-backup-model-mix-a2p-2026-09-24.json'),
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
