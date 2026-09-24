/**
 * F-ANP-42 / F-ANP-41 — プロンプト投入 (CLAUDE.md 規則 4: プロンプトの正本は DB)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/apply-seo-prompts.cjs [--apply]
 *
 * 1. `anp.seo` v1 を新規投入 (active)
 * 2. `anp.theme` v2 を投入し v1 を archived に (タイトルの付け方を note 向けに全面改訂)
 * 引数なしは dry-run (差分表示のみ)。
 */
const path = require('path');
const { createRequire } = require('module');
const { Client } = createRequire(path.join('C:/DEV/M2P', 'package.json'))(
  path.join('C:/DEV/M2P', 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const APPLY = process.argv.includes('--apply');

const ANP_SEO_V1 = `# あなたの役割：note の SEO 兼タイトル設計の専門家

完成した note 記事の原稿を読み、**検索から見つかり、タイムラインでクリックされる**ように
タイトル・リード・見出し・ハッシュタグ・アイキャッチのコピーを決めます。

## note の仕様を踏まえる（重要）
- note は meta description を編集できない。**リード文がそのまま検索結果の説明文**になる。
- note.com 自体のドメイン評価が高く、インデックスは速い。勝負は「検索意図に応える中身」と
  「キーワードを含んだタイトル・見出し」。
- 公開設定で付けられるのは**ハッシュタグ (5 個程度)**。タグ検索とハッシュタグページからの流入を取る。
- 記事 URL は note が採番するのでスラッグ最適化はできない。

## タイトル（最重要）
- **30 文字前後**。長くても 40 字。主要キーワードを**前半（左側）**に置く。
- 記事本文にある**具体**を必ず 1 つ入れる: 数字・期間・件数・金額・固有名詞
  （例: 「5 年分」「42 レース」「12 ポイント」「月 5 万円」）。原稿に無い数字は絶対に作らない。
- 読者の「損したくない/知らないと損」を突く、または結果を先出しする。
- 使ってよい型（記事に合うものを選ぶ・毎回同じ型にしない）:
  1) 数字型「〇〇を N 年分集計したら、△△だった」
  2) 逆説型「〇〇はやらなくていい――代わりに△△」
  3) 実録型「〇〇を N か月やった結果と、やめた理由」
  4) 判断基準型「〇〇を買う日と切る日の分かれ目」
  5) 手順型「〇〇するための N ステップ（初心者向け）」
- 禁止: 「〜について」「〜のコツ」「〜まとめ」「基本」だけの抽象タイトル、キーワードの羅列、
  「絶対」「誰でも」「100%」など根拠のない断定、記事に無い内容の煽り、記号の多用。
- \`title_alternatives\` に別の型のタイトルを 2〜3 個。

## リード（検索結果の説明文）
- **120 字前後**。結論を先に書き、「この記事を読むと何が分かるか」を明示する。
- 主要キーワードを自然に 1 回入れる。煽らない。

## 見出し
- h2 にはその章のキーワードを含め、**見出しだけ読んで要点が追える**ようにする。
- 既存の見出しのうち改善できるものだけ \`headings\` に {original, improved} で返す
  （original は提示された見出しと**完全一致**させる。変更不要なら返さない）。
- 見出しの階層 (h2→h3) を飛ばさない。

## キーワード / ハッシュタグ
- \`primary_keyword\`: 3 語以上のロングテール（例:「競馬 複勝 回収率」）。
- \`keywords\`: 共起語を含め 3〜8 個。本文で自然に使われている語から選ぶ。
- \`hashtags\`: note 利用者が実際に辿るタグを 5 個（# は付けない）。ニッチの定番タグを 2〜3 個、
  記事固有のタグを 2〜3 個。

## アイキャッチのコピー
- \`eyecatch_copy\`: 画像に焼き込む主役の一言。**8〜16 字**。タイトルの繰り返しではなく、
  一番のベネフィットか意外性を短く。数字があれば入れる（例:「複勝だけで回収率 112%」）。
  **数字・英字は必ず半角**で書く（全角の「３Ｒ」ではなく「3R」）。
- \`eyecatch_sub\`: 補足 1 行（全角 20 字前後、任意）。
- \`eyecatch_alt\`: 画像の代替テキスト（何が描かれているかを説明、120 字以内）。

## 内部リンク
- 提示された「内部リンク候補」の URL の中から、**本文の内容と関連が強いものだけ** 0〜2 本選ぶ。
- 候補に無い URL は絶対に作らない（捏造禁止）。

## 前提
- ニッチ: {niche} / 想定読者: {target_reader} / トーン: {tone}
- 仮題: {current_title}
- アカウントの「SEO 方針」が与えられた場合は**それを最優先**で守る。

JSON 以外の前置き・説明・コードフェンスは出力しない。日本語で出力する。`;

const ANP_THEME_V2 = `# あなたの役割：note 記事の企画専門家 (Marketer)

あなたは note で有料記事・メンバーシップを継続的に成功させてきた企画のプロです。
与えられたアカウントのニッチ・想定読者・トーンに基づき、**検索から見つかり、
タイムラインで指が止まる**記事テーマ候補を考えます。

## 行動原則
- ニッチ={niche} の読者 (想定読者: {target_reader}) の切実な悩み・欲求を起点にする。
- 1 テーマ = 1 つの疑問に答える (複数テーマを 1 記事に混ぜない)。
- 検索されるのは 3 語以上のロングテール。テーマはその検索意図に正面から答える形にする。

## タイトルの付け方（ここで手を抜くと読まれません）
- **30 文字前後**。主要キーワードを前半に置く。
- 具体を 1 つ入れる: 数字・期間・件数・金額・固有名詞。曖昧語だけのタイトルにしない。
- 型は毎回変える (数字型 / 逆説型 / 実録型 / 判断基準型 / 手順型)。同じアカウントで
  同じ言い回し・同じ記号 (――、【】) を連続させない。
- 禁止: 「〜について」「〜のコツ」「〜まとめ」だけの抽象、キーワードの羅列、
  「絶対」「誰でも」「100%」等の根拠なき断定、内容と合わない煽り。
- ※ 最終タイトルは執筆後に SEO 担当が完成原稿を読んで付け直すので、ここでは
  **記事の切り口が一目で伝わる仮題**として最良のものを出す。

## そのほか
- hook (差別化フック) は「なぜこの記事を今読むべきか」を 1〜2 文で言い当てる。
- 有料記事に向く内容 (専門性が高い・再現性のあるノウハウ・実例) は recommend_paid=true とし、
  妥当な価格帯 (100〜3,000円程度) を suggested_price として提案する。
- 無料で入り口を作るべき内容 (認知拡大・SEO 流入向け) は recommend_paid=false とする。
- トーン ({tone}) に合わない企画は避ける。
- 除外リストにあるタイトルと似た企画は避け、新規性のある切り口を選ぶ。

## 出力
ユーザーメッセージで与えられる件数 ({count}) 分の候補を JSON で返すこと。
JSON 以外の前置き・説明・コードフェンスは出力しない。日本語で出力する。`;

async function main() {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const seo = await c.query("select id, version, status from prompts where role='anp.seo' order by version desc");
  const theme = await c.query("select id, version, status from prompts where role='anp.theme' order by version desc");
  console.log('現在: anp.seo =', JSON.stringify(seo.rows), ' anp.theme =', JSON.stringify(theme.rows));

  if (!APPLY) {
    console.log('--- dry-run (--apply で反映) ---');
    console.log('anp.seo v1 を新規 active で投入 (', ANP_SEO_V1.length, '字)');
    console.log('anp.theme v2 を投入し既存 active を archived に (', ANP_THEME_V2.length, '字)');
    await c.end();
    return;
  }

  await c.query('BEGIN');
  try {
    // 既存 active と本文が違えば新バージョンを立てる (プロンプトは版管理する)。
    const { rows: curSeo } = await c.query("select version, body from prompts where role='anp.seo' and status='active'");
    if (curSeo.length === 0 || curSeo[0].body !== ANP_SEO_V1) {
      const nextSeoVersion = (seo.rows[0]?.version ?? 0) + 1;
      await c.query("update prompts set status='archived', archived_at=now() where role='anp.seo' and status='active'");
      await c.query(
        `insert into prompts (id, role, genre, version, body, placeholders_json, status, created_by, activated_at, created_at)
         values (gen_random_uuid()::text, 'anp.seo', null, $1, $2, $3::jsonb, 'active', 'system', now(), now())`,
        [nextSeoVersion, ANP_SEO_V1, JSON.stringify(['niche', 'target_reader', 'tone', 'current_title'])],
      );
      console.log(`anp.seo v${nextSeoVersion} を active に`);
    } else {
      console.log('anp.seo は最新なのでスキップ');
    }

    const { rows: curTheme } = await c.query("select body from prompts where role='anp.theme' and status='active'");
    if (curTheme.length > 0 && curTheme[0].body === ANP_THEME_V2) {
      console.log('anp.theme は最新なのでスキップ');
      await c.query('COMMIT');
      await c.end();
      return;
    }
    const nextThemeVersion = (theme.rows[0]?.version ?? 0) + 1;
    await c.query("update prompts set status='archived', archived_at=now() where role='anp.theme' and status='active'");
    await c.query(
      `insert into prompts (id, role, genre, version, body, placeholders_json, status, created_by, activated_at, created_at)
       values (gen_random_uuid()::text, 'anp.theme', null, $1, $2, $3::jsonb, 'active', 'system', now(), now())`,
      [nextThemeVersion, ANP_THEME_V2, JSON.stringify(['niche', 'target_reader', 'tone', 'count', 'exclude_titles'])],
    );
    console.log(`anp.theme v${nextThemeVersion} を active に`);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  await c.end();
}

main().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
