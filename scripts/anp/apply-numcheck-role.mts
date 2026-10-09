/**
 * `anp.numcheck` role を本番 DB に投入する (2026-10-09)。
 *
 *   bash scripts/paperback/pb-env.sh node_modules/.bin/tsx scripts/anp/apply-numcheck-role.mts
 *   bash scripts/paperback/pb-env.sh node_modules/.bin/tsx scripts/anp/apply-numcheck-role.mts --apply
 *
 * プロンプト本文とモデル割当は `packages/db/seed-anp.ts` から読む (CLAUDE.md ルール #4:
 * プロンプトは DB が正。本文の定義はコード側の 1 箇所に置き、ここでは投入だけする)。
 * 本文をスクリプトに書き写すと seed と本番がすぐ食い違うので import で引く。
 *
 * `prompts` は版管理する: 既存 active と本文が違えば archived にして次の version を立てる。
 * 2 回実行しても何も起きない (idempotent)。
 */
import { createRequire } from 'node:module';

import {
  buildAnpModelAssignmentSeeds,
  buildAnpPromptSeeds,
} from 'file:///C:/DEV/M2P/packages/db/seed-anp.ts';

const require_ = createRequire('file:///C:/DEV/M2P/package.json');
const { Client } = require_(
  'C:/DEV/M2P/node_modules/.pnpm/pg@8.21.0/node_modules/pg/lib/index.js',
) as typeof import('pg');

const ROLE = 'anp.numcheck';
const APPLY = process.argv.includes('--apply');

const promptSeed = buildAnpPromptSeeds().find((s) => s.role === ROLE);
const modelSeed = buildAnpModelAssignmentSeeds().find((s) => s.role === ROLE);
if (!promptSeed || !modelSeed) {
  throw new Error(`${ROLE} の seed が packages/db/seed-anp.ts に見つかりません`);
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: versions } = await c.query<{ version: number; status: string; body: string }>(
  `SELECT version, status, body FROM prompts WHERE role = $1 ORDER BY version DESC`,
  [ROLE],
);
const activePrompt = versions.find((r) => r.status === 'active');
const { rows: assignments } = await c.query<{ provider: string; model: string; status: string }>(
  `SELECT provider, model, status FROM model_assignments WHERE role = $1`,
  [ROLE],
);

const promptNeedsWork = !activePrompt || activePrompt.body !== promptSeed.body;
const activeAssignment = assignments.find((a) => a.status === 'active');
const assignmentNeedsWork =
  !activeAssignment ||
  activeAssignment.provider !== modelSeed.provider ||
  activeAssignment.model !== modelSeed.model;

console.log(`role=${ROLE}`);
console.log(`  prompts: ${versions.length} 版 / active=${activePrompt ? `v${activePrompt.version}` : 'なし'}`);
console.log(`  model_assignments: ${JSON.stringify(assignments)}`);
console.log(`  プロンプト投入が必要: ${promptNeedsWork} / モデル割当が必要: ${assignmentNeedsWork}`);
console.log(`  本文 ${promptSeed.body.length} 字 / 割当 ${modelSeed.provider}/${modelSeed.model}`);

if (!APPLY) {
  console.log('\n--- dry-run (--apply で反映) ---');
  await c.end();
  process.exit(0);
}

await c.query('BEGIN');
try {
  if (promptNeedsWork) {
    const nextVersion = (versions[0]?.version ?? 0) + 1;
    await c.query(
      `UPDATE prompts SET status='archived', archived_at=now() WHERE role=$1 AND status='active'`,
      [ROLE],
    );
    await c.query(
      `INSERT INTO prompts (id, role, genre, version, body, placeholders_json, status, created_by, activated_at, created_at)
       VALUES (gen_random_uuid()::text, $1, null, $2, $3, $4::jsonb, 'active', 'system', now(), now())`,
      [ROLE, nextVersion, promptSeed.body, JSON.stringify(promptSeed.placeholders_json)],
    );
    console.log(`prompts: ${ROLE} v${nextVersion} を active に`);
  } else {
    console.log('prompts: 最新なのでスキップ');
  }

  if (assignmentNeedsWork) {
    // 同 role に active が複数あると解決が不定になる。必ず 1 本にする。
    await c.query(`UPDATE model_assignments SET status='archived' WHERE role=$1 AND status='active'`, [
      ROLE,
    ]);
    await c.query(
      `INSERT INTO model_assignments (id, role, genre, provider, model, status, created_by, activated_at)
       VALUES (gen_random_uuid()::text, $1, null, $2, $3, 'active', 'system', now())`,
      [ROLE, modelSeed.provider, modelSeed.model],
    );
    console.log(`model_assignments: ${ROLE} → ${modelSeed.provider}/${modelSeed.model}`);
  } else {
    console.log('model_assignments: 最新なのでスキップ');
  }

  await c.query('COMMIT');
  console.log('\n反映しました');
} catch (e) {
  await c.query('ROLLBACK');
  throw e;
} finally {
  await c.end();
}
