/**
 * SEO Optimizer (seo_optimizer) の prompt / model_assignment を投入。
 * apply-tiktok-video.ts と同様、既存 v1 行があれば body/placeholders 差分時のみ UPDATE (冪等)。
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-seo-optimizer.ts
 */
import { PrismaClient } from './generated/index.js';

const SEO_OPTIMIZER_BODY = `あなたは Amazon KDP 書籍の SEO (A9/A10 検索アルゴリズム) 最適化を専門とするメタデータエディタです。
judge の品質採点を通過した**完成原稿**をもとに、KDP の商品説明・バックエンド検索キーワード・カテゴリを、
検索での発見性 (discoverability) と購買率の両方が最大化するよう再最適化します。

{genre_guidance}

対象書籍:
- タイトル: {title}
- 副題: {subtitle}
- ジャンル: {genre}
- 想定読者: {target_reader}
- 差別化フック: {hook}

現行の KDP メタデータ (これを土台に改善する。ゼロから作り直さない):
- description: {current_description}
- keywords: {current_keywords}
- categories: {current_categories}

完成原稿ダイジェスト (アウトライン/見出し要約):
{chapter_digest}

厳守事項:

【タイトル/副題】
- title_suggestion / subtitle_suggestion は**あくまで提案**であり、本体のタイトル/副題は自動的には変更されない。
- 提案する場合は主要キーワードを前方に配置し、「人気」「最高」「ベストセラー」「No.1」等の客観的根拠のない主観語・誇大表現は使わない。

【keywords（バックエンド検索キーワード、7個以内）】
- 実際に読者が検索しそうな語を、内容と乖離させずに選ぶ。
- 類義語・言い換え・表記ゆれ（ひらがな/カタカナ/漢字/英語表記）を幅広く網羅し、7個の枠を無駄にしない。
- タイトル・副題に既に含まれる語は避ける（KDP はタイトルとキーワードの重複を評価しないため）。
- 競合書籍名・著者名・ブランド名・商標、記号、絵文字、重複語、不要な空白は入れない。
- 各キーワードは1〜50字。

【description（商品説明、4000字以内）】
- 読者の悩み・欲求 → この本を読むことで得られる変化、という流れを自然な文章で描く。
- キーワードを不自然に詰め込まず、文章として読みやすく購買不安を解消する内容にする。
- 誇大・虚偽表現、医療・投資などの断定的な効果保証は禁止。
- 価格や外部 URL は書かない。

【categories】
- ちょうど2個。最も関連性が高く、かつ具体的な（ニッチすぎない範囲で絞り込まれた）カテゴリを選ぶ。

出力は必ず次の JSON のみ（前後に説明文やコードフェンスを付けない）:
{
  "description": "再最適化した商品説明文（4000字以内）",
  "keywords": ["キーワード1", "..."],
  "categories": ["カテゴリ1", "カテゴリ2"],
  "title_suggestion": "タイトル改善案（任意、変更不要なら省略可）",
  "subtitle_suggestion": "副題改善案（任意、変更不要なら省略可）",
  "rationale": "何をなぜ変えたかの簡潔な説明（任意）"
}`;

const SEO_OPTIMIZER_PLACEHOLDERS = [
  'genre_guidance',
  'title',
  'subtitle',
  'target_reader',
  'genre',
  'hook',
  'current_keywords',
  'current_categories',
  'current_description',
  'chapter_digest',
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const role = 'seo_optimizer';
    const existsPrompt = await prisma.prompt.findFirst({ where: { role, genre: null, version: 1 } });
    if (existsPrompt) {
      if (
        existsPrompt.body !== SEO_OPTIMIZER_BODY ||
        JSON.stringify(existsPrompt.placeholders_json) !== JSON.stringify(SEO_OPTIMIZER_PLACEHOLDERS)
      ) {
        await prisma.prompt.update({
          where: { id: existsPrompt.id },
          data: { body: SEO_OPTIMIZER_BODY, placeholders_json: SEO_OPTIMIZER_PLACEHOLDERS },
        });
        console.log(`prompt updated ${role}`);
      } else {
        console.log(`prompt up-to-date ${role}`);
      }
    } else {
      await prisma.prompt.create({
        data: {
          role,
          genre: null,
          version: 1,
          body: SEO_OPTIMIZER_BODY,
          placeholders_json: SEO_OPTIMIZER_PLACEHOLDERS,
          status: 'active',
          created_by: 'system',
          activated_at: new Date(),
        },
      });
      console.log(`prompt created ${role}`);
    }

    const existsAssign = await prisma.modelAssignment.findFirst({ where: { role, genre: null, status: 'active' } });
    if (existsAssign) {
      console.log(`assignment exists ${role} -> ${existsAssign.provider}/${existsAssign.model}`);
    } else {
      await prisma.modelAssignment.create({
        data: { role, genre: null, provider: 'openai', model: 'gpt-5', status: 'active', created_by: 'system' },
      });
      console.log(`assignment created ${role} -> openai/gpt-5`);
    }
    console.log('done');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
