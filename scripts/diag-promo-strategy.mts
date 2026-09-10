/**
 * 販促チャネルの strategy_json が AccountStrategyProfileSchema を通るか実データで検証する。
 *   bash scripts/paperback/pb-env.sh corepack pnpm exec tsx scripts/diag-promo-strategy.mts
 *
 * UI 側 (`channel-board.tsx`) は `strategy.profile` が null だとプレビュー枠ごと描画しない。
 * profile は `parseStrategyProfile` = このスキーマの safeParse なので、必須キーが揃っていても
 * 文字数/配列長/入れ子スキーマの制約で落ちれば null になり、プレビューが出ない。
 */
import { createRequire } from 'module';
import path from 'path';
import { AccountStrategyProfileSchema } from '../packages/contracts/src/agents/sns-strategist.ts';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const req = createRequire(path.join(REPO, 'package.json'));
const { Client } = req(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(
  'select channel, strategy_json, avatar_key, banner_key from promotion_channel_settings order by channel',
);
await c.end();

for (const row of r.rows) {
  const res = AccountStrategyProfileSchema.safeParse(row.strategy_json);
  const imgs = `avatar=${row.avatar_key ? '有' : '無'} banner=${row.banner_key ? '有' : '無'}`;
  if (res.success) {
    console.log(`✅ ${String(row.channel).padEnd(11)} プレビュー描画OK  ${imgs}`);
  } else {
    console.log(`❌ ${String(row.channel).padEnd(11)} プレビュー描画されない  ${imgs}`);
    for (const issue of res.error.issues.slice(0, 6)) {
      console.log(`     - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    if (res.error.issues.length > 6) console.log(`     - ...他 ${res.error.issues.length - 6} 件`);
  }
}
