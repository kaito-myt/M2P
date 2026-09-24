/**
 * A2P コスト凍結 (2026-09-24 運営者指示「A2P は赤字を垂れ流しているので、出版、販促作業は中止して。
 * 作成済みの本の出版のみにしばらくしましょう。コストを抑えましょう」)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/ops/a2p-cost-freeze.cjs            # 現状表示のみ
 *   bash scripts/paperback/pb-env.sh node scripts/ops/a2p-cost-freeze.cjs --apply    # 凍結
 *   bash scripts/paperback/pb-env.sh node scripts/ops/a2p-cost-freeze.cjs --revert   # 解凍 (元に戻す)
 *
 * 方針:
 *   止める = 新刊の生成 (テーマ日次自動生成が入口)、販促 (SNS 投稿/エンゲージ/動画)、
 *            組織エージェントの自律ループ、低品質本の間引き。いずれも LLM を継続的に消費する。
 *   残す   = **作成済みの本の出版** (KDP アシスト投入 / BOOK☆WALKER 申請 / ペーパーバック)、
 *            売上取得、コスト分析、ANP (note) 一式。これらは LLM をほぼ使わない。
 *
 * 直近 30 日のコスト実績 (2026-09-24 時点): editor ¥97.5k / writer ¥49.0k = 新刊生成が大半。
 * content_creator ¥13.3k / growth_scout ¥5.7k / promo_strategist ¥3.2k = 販促。
 */
const path = require('path');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

/** 凍結時に false にするフラグ (解凍時は true に戻す)。 */
const FREEZE_FLAGS = [
  ['autopass_theme_enabled', '新刊の日次テーマ自動生成 (= 新しい本の制作の入口)'],
  ['promo_auto_post_enabled', 'SNS 自動投稿'],
  ['promo_auto_on_publish_enabled', '出版時の自動販促'],
  ['promo_daily_review_enabled', '日次の投稿見直し (LLM)'],
  ['promo_growth_loop_enabled', '販促強化の継続ループ (LLM)'],
  ['sns_engage_enabled', 'IG/TikTok 自動フォロー'],
  ['x_engage_enabled', 'X 自動エンゲージ'],
  ['video_use_veo_enabled', '動画生成 (Veo) — 単価が高い'],
  ['book_cull_enabled', '低品質本の間引き (LLM + ブラウザ)'],
  ['org_auto_plan_enabled', '組織エージェント: 計画ループ'],
  ['org_auto_execute_enabled', '組織エージェント: 実行ループ'],
  ['org_ops_watch_enabled', '組織エージェント: 運用監視ループ'],
  ['org_finance_tick_enabled', '組織エージェント: 財務ループ'],
  ['org_kdp_auto_publish_enabled', '組織エージェント: 出版候補スクリーニング (出版自体は別フラグ)'],
  ['org_auto_approve_tasks', '組織 ToDo の自動承認 (承認すると実行ループが回る)'],
];

/** 凍結中も維持するもの (誤って止めないよう明示する)。 */
const KEEP_ON = [
  ['kdp_auto_submit_enabled', '作成済みの本の KDP 出版キュー投入 (LLM 不使用)'],
  ['bw_auto_submit_enabled', 'BOOK☆WALKER 申請 (LLM 不使用)'],
  ['sales_auto_fetch_enabled', '売上取得 (収支把握に必要・LLM 不使用)'],
  ['cost_auto_analyze_enabled', '週次コスト分析 (少額・凍結の効果測定に使う)'],
  ['anp_auto_theme_enabled', 'ANP (note) は対象外'],
  ['anp_auto_publish_enabled', 'ANP (note) は対象外'],
  ['note_engage_enabled', 'ANP (note) は対象外'],
];

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const cols = [...FREEZE_FLAGS.map((f) => f[0]), ...KEEP_ON.map((f) => f[0])];
    const { rows } = await c.query(
      `SELECT ${cols.map((x) => `"${x}"`).join(', ')} FROM app_settings WHERE id='singleton'`,
    );
    const cur = rows[0] ?? {};

    console.log('--- 停止対象 ---');
    for (const [key, why] of FREEZE_FLAGS) {
      console.log(`${cur[key] ? 'ON ' : 'off'}  ${key.padEnd(32)} ${why}`);
    }
    console.log('--- 維持 ---');
    for (const [key, why] of KEEP_ON) {
      console.log(`${cur[key] ? 'ON ' : 'off'}  ${key.padEnd(32)} ${why}`);
    }

    if (!APPLY && !REVERT) {
      console.log('\n--apply で凍結 / --revert で解凍');
      return;
    }

    const target = REVERT;
    const sets = FREEZE_FLAGS.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
    await c.query(
      `UPDATE app_settings SET ${sets} WHERE id='singleton'`,
      FREEZE_FLAGS.map(() => target),
    );
    console.log(`\n${REVERT ? '解凍' : '凍結'}しました (${FREEZE_FLAGS.length} 項目 → ${String(target)})`);
    console.log('※ cron 構成は worker 起動時に反映されるため、即座に効かせるには worker を再起動する');
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
