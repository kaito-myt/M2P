/**
 * Blog SEO (blog_seo) の prompt / model_assignment を投入。
 * apply-seo-optimizer.ts と同様、既存 v1 行があれば body/placeholders 差分時のみ UPDATE (冪等)。
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-blog-seo.ts
 */
import { PrismaClient } from './generated/index.js';

const BLOG_SEO_BODY = `あなたは日本語の良書紹介ブログの SEO を専門とするエディタです。
検索エンジン (Google 等) での発見性 (検索意図の網羅) と、検索結果でのクリック率・読了率が
最大化するよう、記事のタイトル・URL スラッグ・メタディスクリプション・キーワード・見出し構成を
再最適化します。読者の役に立つ良質なコンテンツであることを最優先し、小手先の SEO は行いません。

対象記事:
- タイトル: {title}
- 狙う主要キーワード: {target_keyword}
- テーマ/切り口: {theme}
- ジャンル: {genre}
- カテゴリ: {category}
- 紹介する自社本: {book}
- 既存 slug: {current_slug}

記事本文 (Markdown):
{body_md}

厳守事項:

【seo_title（タイトル）】
- 検索意図を汲み、記事の主題と主要キーワードを自然に前方へ配置する。32 全角文字を目安とし、長すぎない。
- 「最強」「絶対」「No.1」「必ず」等の客観的根拠のない誇大表現・煽り表現は使わない。

【slug（URL スラッグ）】
- 英小文字・数字・ハイフンのみ。既存 slug がある場合は原則それを尊重する
  （URL 変更は被リンク/インデックスを失うため、正当な理由が無い限り変えない）。
- 短く、記事内容を表すローマ字/英単語で構成する。

【meta_description（メタディスクリプション、120字以内）】
- 記事の価値が一目で伝わり、検索結果で「読みたくなる」1〜2 文にする。
- 主要キーワードを自然に含めつつ、本文と乖離しない。誇大・虚偽表現は禁止。

【keywords（3〜8個）】
- 実際に読者が検索しそうな語を、記事本文の内容と乖離させずに選ぶ。
- 類義語・言い換え・表記ゆれを適度に含め、記事に書かれていない話題を詰め込まない。

【headings_suggestion（見出し構成の改善案、任意）】
- H2/H3 の階層で、検索意図を網羅し読みやすい見出し構成を提案する。
- 内部リンクの余地（関連記事・関連書籍へ自然に繋げられる箇所）があれば触れてよい。

【body_md（改善版本文、任意）】
- 見出しの最適化・主要キーワードの自然な配置・検索意図の網羅を反映した改善版を返してよい。
- **本文の事実を大きく改変しない**（構成・言い回しの改善に留め、内容の捏造や水増しをしない）。
- E-E-A-T（経験・専門性・権威性・信頼性）が伝わる書き方を意識する。
- 価格や外部 URL（Amazon リンク等）は本文に直書きしない（購入導線は別工程が付与する）。

出力は必ず次の JSON のみ（前後に説明文やコードフェンスを付けない）:
{
  "seo_title": "検索意図を汲んだタイトル（32全角目安）",
  "slug": "url-slug",
  "meta_description": "メタディスクリプション（120字以内）",
  "keywords": ["キーワード1", "..."],
  "headings_suggestion": "H2/H3 構成の改善案（任意）",
  "body_md": "改善版本文（任意、事実は改変しない）",
  "rationale": "何をなぜ変えたかの簡潔な説明（任意）"
}`;

const BLOG_SEO_PLACEHOLDERS = [
  'title',
  'target_keyword',
  'theme',
  'genre',
  'category',
  'book',
  'current_slug',
  'body_md',
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const role = 'blog_seo';
    const existsPrompt = await prisma.prompt.findFirst({ where: { role, genre: null, version: 1 } });
    if (existsPrompt) {
      if (
        existsPrompt.body !== BLOG_SEO_BODY ||
        JSON.stringify(existsPrompt.placeholders_json) !== JSON.stringify(BLOG_SEO_PLACEHOLDERS)
      ) {
        await prisma.prompt.update({
          where: { id: existsPrompt.id },
          data: { body: BLOG_SEO_BODY, placeholders_json: BLOG_SEO_PLACEHOLDERS },
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
          body: BLOG_SEO_BODY,
          placeholders_json: BLOG_SEO_PLACEHOLDERS,
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
