/**
 * F-098: `ceo_chat` プロンプトに「会話で完結できる権限」を追記して新バージョンを active にする。
 * (CLAUDE.md 規則 4: プロンプトの正本は DB)
 *
 *   bash scripts/paperback/pb-env.sh node scripts/org/apply-ceo-powers-prompt.cjs [--apply]
 */
const path = require('path');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const APPLY = process.argv.includes('--apply');

const SECTION = `

━━ あなたが会話でそのまま実行できる権限 (F-098) ━━
オーナーは「CEO との会話だけで運営を完結させたい」と考えています。次はタスク起票ではなく、
あなたの応答に含めた時点で **worker が即座に反映** します。使うときは必ず reason に判断根拠を書くこと。
- prompt_edits: 各エージェントのシステムプロンプト改訂 (ceo / ceo_chat / prompt_editor は不可)
- settings_changes: 運用トグルの ON/OFF (許可リスト内のキーのみ。出版・販促・組織ループの停止/再開はここで行う)
- model_changes: 役割ごとの AI モデル割当の変更 (model_catalog にある現行モデルのみ)
- research_queries: 外部情報が必要なときの Web 検索クエリ (最大3)。返すと検索結果を添えて再度あなたに聞きます。
  検索結果が添えられているターンでは research_queries を空にして結論を出すこと。
- code_requests: ソースコードの変更要求。**これだけは自動適用されません** (本番コンテナはリポジトリを書き換えられない)。
  何をどう変えるかを具体的に書いて起票し、実装は開発側が行います。

権限を使う判断基準:
- 「今すぐ止めたい/変えたい」運用上の意思決定は、タスク起票より settings_changes を優先する (確実に効くため)。
- コストが赤字を押し広げていると判断したら、オーナーの明示指示を待たずに停止を提案し、合意が取れていれば実行する。
- ただし ANP (note) 側の設定を A2P の都合で止めない。停止・再開の影響範囲を reply で必ず説明する。`;

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const { rows } = await c.query(
      "select id, version, body from prompts where role='ceo_chat' and status='active' order by version desc limit 1",
    );
    const cur = rows[0];
    if (!cur) throw new Error('ceo_chat の active プロンプトがありません');
    if (cur.body.includes('F-098')) {
      console.log(`ceo_chat v${cur.version} は既に F-098 の追記済み — スキップ`);
      return;
    }
    const next = cur.version + 1;
    const body = `${cur.body.trimEnd()}${SECTION}`;
    console.log(`ceo_chat v${cur.version} (${cur.body.length}字) → v${next} (${body.length}字)`);
    if (!APPLY) {
      console.log('--apply で反映');
      return;
    }
    await c.query('BEGIN');
    await c.query("update prompts set status='archived', archived_at=now() where id=$1", [cur.id]);
    await c.query(
      `insert into prompts (id, role, genre, version, body, placeholders_json, status, created_by, activated_at, created_at)
       values (gen_random_uuid()::text, 'ceo_chat', null, $1, $2, '[]'::jsonb, 'active', 'system', now(), now())`,
      [next, body],
    );
    await c.query('COMMIT');
    console.log(`ceo_chat v${next} を active にしました`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
