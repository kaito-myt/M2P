/**
 * `app_settings` の自律運転キルスイッチを切り替える (2026-10-13)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/set-flag.cjs                      # 現在値を表示
 *   bash scripts/paperback/pb-env.sh node scripts/anp/set-flag.cjs note_engage_enabled off
 *   bash scripts/paperback/pb-env.sh node scripts/anp/set-flag.cjs anp_auto_theme_enabled on
 *
 * 背景: これらのフラグは cron タスクが LLM を呼ぶ**前**に見るので、off にした時点で
 * そのタスクの生成コストは ¥0 になる (`note.engage` は `generate()` より前に return、
 * `promotion.sns.engage` も同型)。一方で UI トグルが無いフラグがあり、
 * コストを止めたいときに触る手段が無かった (docs/11「`note.engage` に ¥4,700/月」)。
 *
 * 破壊的操作ではない (値の反転のみ・いつでも戻せる) が、自律運転の挙動を変えるので
 * 許可フラグを allowlist で絞り、変更前後の値を必ず表示する。
 */
const { Client } = require('pg');

/** 触っていいフラグ (いずれも boolean・タスク内キルスイッチ)。 */
const ALLOWED = [
  'note_engage_enabled', // note 自動フォロー/スキ (growth_scout の偵察込み)
  'sns_engage_enabled', // IG/TikTok 自動フォロー
  'x_engage_enabled', // X 能動エンゲージ
  'promo_growth_loop_enabled', // 販促強化継続ループ
  'anp_auto_theme_enabled', // ANP テーマ日次自動生成 (記事の生成再開スイッチ)
  'anp_publish_dry_run', // ANP 公開のドライラン
  'autopass_kdp_enabled',
  'autopass_outline_enabled',
  'autopass_content_enabled',
  'autopass_cover_enabled',
];

const [flag, value] = process.argv.slice(2);

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const cols = ALLOWED.map((f) => `"${f}"`).join(', ');
  const show = async () => {
    const { rows } = await c.query(`SELECT ${cols} FROM app_settings WHERE id='singleton'`);
    for (const f of ALLOWED) console.log(`  ${f.padEnd(28)} ${rows[0][f]}`);
  };

  if (!flag) {
    console.log('現在値:');
    await show();
    console.log('\n変更: node scripts/anp/set-flag.cjs <flag> <on|off>');
    await c.end();
    return;
  }
  if (!ALLOWED.includes(flag)) {
    console.error(`未許可のフラグ: ${flag}\n許可: ${ALLOWED.join(', ')}`);
    process.exit(1);
  }
  if (value !== 'on' && value !== 'off') {
    console.error('値は on か off');
    process.exit(1);
  }

  const want = value === 'on';
  const { rows: before } = await c.query(
    `SELECT "${flag}" AS v FROM app_settings WHERE id='singleton'`,
  );
  const { rows: after } = await c.query(
    `UPDATE app_settings SET "${flag}"=$1, updated_at=now() WHERE id='singleton' RETURNING "${flag}" AS v`,
    [want],
  );
  console.log(`${flag}: ${before[0].v} -> ${after[0].v}`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
