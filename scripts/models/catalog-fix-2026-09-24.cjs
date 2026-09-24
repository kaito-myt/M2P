// 2026-09-24 model_catalog の単価修正 + GPT-6 系の追加。
// usage: bash scripts/paperback/pb-env.sh node scripts/models/catalog-fix-2026-09-24.cjs [--apply]
//
// 1) Anthropic の行が **全モデル $10/$50** になっていた (pricing ページのスクレイプ失敗)。
//    実単価 (platform.claude.com/docs/en/about-claude/pricing, 2026-09-24 確認) に直す。
//    これを直さないと Claude のコストが実際の 2〜5 倍で表示され、モデル選定の判断を誤る。
// 2) GPT-6 (sol/luna/astra) は catalog に無いと token_usage の cost_jpy が 0 のままになるため追加。
const path = require('path');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

/** [provider, model, input_usd_per_mtok, output_usd_per_mtok, 出典] */
const PRICES = [
  ['anthropic', 'claude-opus-5', 5, 25, 'anthropic pricing page 2026-09-24'],
  ['anthropic', 'claude-opus-4-8', 5, 25, 'anthropic pricing page 2026-09-24'],
  ['anthropic', 'claude-sonnet-5', 2, 10, 'anthropic pricing page 2026-09-24 (introductory→standard)'],
  ['anthropic', 'claude-sonnet-4-6', 3, 15, 'anthropic pricing page 2026-09-24'],
  ['anthropic', 'claude-haiku-4-5-20251001', 1, 5, 'anthropic pricing page 2026-09-24'],
  ['openai', 'gpt-6-luna', 0.1, 0.5, 'developers.openai.com 2026-09-22 launch'],
  ['openai', 'gpt-6-sol', 2, 10, 'developers.openai.com 2026-09-22 launch'],
  ['openai', 'gpt-6-astra', 10, 50, 'developers.openai.com 2026-09-22 launch'],
];

(async () => {
  const apply = process.argv.includes('--apply');
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows: fxRows } = await c.query(
    `SELECT fx_rate_usd_jpy FROM model_catalog WHERE is_current=true ORDER BY fetched_at DESC LIMIT 1`,
  );
  const fx = fxRows[0]?.fx_rate_usd_jpy;
  if (!fx) throw new Error('fx_rate_usd_jpy を持つ current 行がありません');
  console.log('fx =', fx);

  for (const [provider, model, inUsd, outUsd, src] of PRICES) {
    const { rows } = await c.query(
      `SELECT input_price_per_mtok_usd AS i, output_price_per_mtok_usd AS o FROM model_catalog WHERE provider=$1 AND model=$2 AND is_current=true`,
      [provider, model],
    );
    const cur = rows[0];
    const same = cur && Number(cur.i) === inUsd && Number(cur.o) === outUsd;
    console.log(
      `${same ? '=' : cur ? '~' : '+'} ${provider}/${model}: ${cur ? `$${cur.i}/$${cur.o}` : '(none)'} -> $${inUsd}/$${outUsd}   # ${src}`,
    );
    if (same || !apply) continue;
    await c.query(`UPDATE model_catalog SET is_current=false WHERE provider=$1 AND model=$2 AND is_current=true`, [
      provider,
      model,
    ]);
    await c.query(
      `INSERT INTO model_catalog (id, provider, model, input_price_per_mtok_usd, output_price_per_mtok_usd, image_price_per_image_usd, fx_rate_usd_jpy, fetched_at, source, available, availability_checked_at, raw_json, is_current)
       VALUES ('mc_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22), $1, $2, $3, $4, NULL, $5, now(), 'manual_edit', true, now(), $6::jsonb, true)`,
      [provider, model, inUsd, outUsd, fx, JSON.stringify({ source: src, fixed_at: new Date().toISOString() })],
    );
  }

  if (!apply) console.log('\ndry-run: --apply で反映');
  await c.end();
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
