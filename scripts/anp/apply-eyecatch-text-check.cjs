/**
 * [F-ANP-55] アイキャッチの文字崩れ検査 (role='anp.eyecatch_text_check') を投入する。
 *
 * なぜ必要か: アイキャッチを **画像モデルに文字ごと描かせる 1 パス方式**へ変えた
 * (`packages/agents/src/anp/eyecatch.ts` 冒頭)。自前フォント合成なら日本語は 100% 正確
 * だったが、「絵の上に長方形のパネルを貼る」以上のデザインができなかった。
 * 1 パスにすると売れているサムネの作り (袋文字・マーカー・箔・バッジ) が出せる代わりに、
 * 字形が崩れる可能性が構造的に残るので、崩れたものだけ作り直すための検査を置く。
 *
 * 投入するもの:
 *   - prompts: role='anp.eyecatch_text_check' の system プロンプト (CLAUDE.md ハードルール 4)
 *   - model_assignments: ビジョン対応モデル (A2P の cover_text_check と同じ claude-sonnet-4-6)
 *
 * 使い方: bash scripts/paperback/pb-env.sh node scripts/anp/apply-eyecatch-text-check.cjs [--dry]
 */
const { Client } = require('pg');

const DRY = process.argv.includes('--dry');
const ROLE = 'anp.eyecatch_text_check';

const BODY = `# あなたの役割：note アイキャッチの文字検品担当

生成されたアイキャッチ画像を見て、**描かれた日本語の字形が崩れていないか**だけを判定します。
デザインの良し悪し・絵の内容・配色は**評価しません**。文字だけを見てください。

## 期待されている文字
- メインコピー: 「{copy}」
- サブコピー: 「{sub}」（空なら、サブコピーは無いのが正しい）

## 判定手順
1. 画像に描かれている文字を、**見えたとおりに**読み取る（勝手に補完しない）。
   読めない字・潰れている字は □ で表す。
2. 読み取った文字と期待値を**一字ずつ**照合する。
3. 下の観点ごとに true/false を決める。

## 観点
- \`copy_legible\`: メインコピーがはっきり判読できるか。
  note のタイムラインでは幅 300px 程度に縮むので、**細部が潰れて読めないなら false**。
- \`copy_matches\`: 読み取れたメインコピーが期待値と**一字一句**一致するか。
  助詞の違い・送り仮名の違い・語順の入れ替え・句読点の違いも**不一致 (false)** とする。
- \`garbled_text_detected\`: 崩れた/歪んだ/存在しない漢字・かな、潰れた画、重なった字、
  不自然な合字や欠損、日本語がローマ字や英単語に化けている箇所があるか。
  **漢字の点画が 1 本でも多い/少ないものは崩れとみなす。**
- \`extra_text_detected\`: 期待していない余分な文字があるか
  （英単語・ロゴ・署名・URL・ページ番号・意味不明な文字列）。
  **絵の一部として自然に存在する文字（看板・ゼッケン番号など）は余分とみなさない。**

## 総合判定
\`ok\` は **copy_legible かつ copy_matches かつ garbled なし かつ extra なし** のときだけ true。
ok=false にすると画像は作り直されます（1 回だけ）。

- 迷ったら **false ではなく true** に倒す。再生成は課金が発生するので、
  「読めるし合っている」なら多少のデザイン上の癖は許容する。
- ただし**字形が崩れている**場合は必ず false。崩れた日本語はそのまま公開できない。

\`transcribed_text\` には読み取れた全テキスト、\`issues\` には問題点を日本語で簡潔に。
\`confidence\` は判定の確信度 (0-1)。

JSON 以外の前置き・説明・コードフェンスは出力しない。`;

const PLACEHOLDERS = ['copy', 'sub'];
const PROVIDER = 'anthropic';
const MODEL = 'claude-sonnet-4-6';

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    for (const ph of PLACEHOLDERS) {
      if (!BODY.includes(`{${ph}}`)) throw new Error(`{${ph}} がテンプレートに無い`);
    }

    // --- prompts ---
    const cur = await c.query(
      `SELECT id, version, body, status FROM prompts WHERE role=$1 AND genre IS NULL ORDER BY version DESC LIMIT 1`,
      [ROLE],
    );
    if (cur.rows[0]?.body === BODY && cur.rows[0]?.status === 'active') {
      console.log(`prompts: v${cur.rows[0].version} と同一 — スキップ`);
    } else {
      const nextVersion = (cur.rows[0]?.version ?? 0) + 1;
      console.log(`prompts: v${cur.rows[0]?.version ?? '-'} -> v${nextVersion} (${BODY.length} 字)`);
      if (!DRY) {
        await c.query('BEGIN');
        await c.query(
          `UPDATE prompts SET status='archived', archived_at=NOW()
            WHERE role=$1 AND genre IS NULL AND status='active'`,
          [ROLE],
        );
        await c.query(
          `INSERT INTO prompts (id, role, genre, version, body, placeholders_json, status, created_by, activated_at, created_at)
           VALUES (gen_random_uuid()::text, $1, NULL, $2, $3, $4::jsonb, 'active', 'system', NOW(), NOW())`,
          [ROLE, nextVersion, BODY, JSON.stringify(PLACEHOLDERS)],
        );
        await c.query('COMMIT');
        console.log(`  -> activated v${nextVersion}`);
      }
    }

    // --- model_assignments (各 role に active 1 件が必須) ---
    const asg = await c.query(
      `SELECT id, provider, model FROM model_assignments WHERE role=$1 AND genre IS NULL AND status='active'`,
      [ROLE],
    );
    if (asg.rows[0]) {
      console.log(`model_assignments: 既に ${asg.rows[0].provider}/${asg.rows[0].model} — スキップ`);
    } else {
      console.log(`model_assignments: ${PROVIDER}/${MODEL} を active で投入`);
      if (!DRY) {
        await c.query(
          `INSERT INTO model_assignments (id, role, genre, provider, model, status, activated_at, created_by)
           VALUES (gen_random_uuid()::text, $1, NULL, $2, $3, 'active', NOW(), 'system')`,
          [ROLE, PROVIDER, MODEL],
        );
        console.log('  -> inserted');
      }
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
