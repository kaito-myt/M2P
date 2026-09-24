/**
 * F-ANP-42 — note 内 SEO ステップ (docs/11-anp-design.md §3.2)。
 *
 * 校閲済みの完成原稿を `anp.seo` に読ませて
 *   - クリックされるタイトル (キーワードを前半に・30 字前後・具体的な数字)
 *   - 検索結果の説明文になるリード (note は meta description を編集できない)
 *   - 見出しへのキーワード反映 (完全一致置換のみ。本文は書き換えない)
 *   - ハッシュタグ 5 個 / キーワード / 内部リンク
 *   - アイキャッチに焼き込むキャッチコピー
 * を決めて `note_articles` に反映する。
 *
 * **ベストエフォート**: このステップが失敗しても記事は従来どおり進む (タイトルは仮題のまま、
 * アイキャッチは文字なし)。SEO のために出版パイプラインを止めない。
 */
import {
  applyHeadingFixes,
  appendInternalLinks,
  type NoteSeoOutput,
} from '@a2p/contracts/agents/anp';
import { generateNoteSeo as defaultGenerateNoteSeo } from '@a2p/agents/anp/seo';
import type { Logger } from '@a2p/contracts/logger';

export interface NoteSeoStepPrisma {
  noteArticle: {
    findUnique: (args: {
      where: { id: string };
      select: Record<string, true>;
    }) => Promise<Record<string, unknown> | null>;
    findMany: (args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      take?: number;
      select: Record<string, true>;
    }) => Promise<Array<Record<string, unknown>>>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

export interface NoteSeoStepInput {
  noteArticleId: string;
  jobId: string;
  noteAccountId: string;
  currentTitle: string;
  hook: string | null;
  account: {
    niche: string;
    tone?: string | null;
    target_reader?: string | null;
    editorial_policy?: string | null;
  };
}

export interface NoteSeoStepDeps {
  generateSeo?: typeof defaultGenerateNoteSeo;
  logger?: Logger;
}

export interface NoteSeoStepResult {
  /** SEO が走って反映できたか。false なら従来どおり (タイトル据え置き・文字なしアイキャッチ)。 */
  applied: boolean;
  title: string;
  eyecatchCopy: string | null;
  eyecatchSub: string | null;
  seo?: NoteSeoOutput;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export async function runNoteSeoStep(
  prisma: NoteSeoStepPrisma,
  input: NoteSeoStepInput,
  deps: NoteSeoStepDeps = {},
): Promise<NoteSeoStepResult> {
  const generateSeo = deps.generateSeo ?? defaultGenerateNoteSeo;
  const fallback: NoteSeoStepResult = {
    applied: false,
    title: input.currentTitle,
    eyecatchCopy: null,
    eyecatchSub: null,
  };

  const row = await prisma.noteArticle.findUnique({
    where: { id: input.noteArticleId },
    select: { body_md: true, lead: true, paid: true, paywall_line_pos: true },
  });
  const bodyMd = asString(row?.body_md);
  if (!bodyMd) return fallback;
  const paid = row?.paid === true;
  const paywallPos = typeof row?.paywall_line_pos === 'number' ? row.paywall_line_pos : null;

  // 内部リンク候補 = 同じアカウントの公開済み記事 (note は URL を貼ると記事カードになる)。
  const published = await prisma.noteArticle
    .findMany({
      where: {
        note_account_id: input.noteAccountId,
        publish_status: 'published',
        id: { not: input.noteArticleId },
      },
      orderBy: { published_at: 'desc' },
      take: 8,
      select: { title: true, note_url: true },
    })
    .catch(() => []);
  const linkCandidates = published
    .map((p) => ({ title: asString(p.title) ?? '', note_url: asString(p.note_url) ?? '' }))
    .filter((p) => p.title.length > 0 && p.note_url.length > 0);

  const recent = await prisma.noteArticle
    .findMany({
      where: { note_account_id: input.noteAccountId, id: { not: input.noteArticleId } },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: { title: true },
    })
    .catch(() => []);

  let seo: NoteSeoOutput;
  try {
    seo = await generateSeo({
      note_article_id: input.noteArticleId,
      job_id: input.jobId,
      account: {
        niche: input.account.niche,
        target_reader: input.account.target_reader ?? null,
        tone: input.account.tone ?? null,
        editorial_policy: input.account.editorial_policy ?? null,
      },
      current_title: input.currentTitle,
      hook: input.hook ?? null,
      body_md: bodyMd,
      published: linkCandidates,
      recent_titles: recent.map((r) => asString(r.title) ?? '').filter((t) => t.length > 0),
    });
  } catch (err) {
    deps.logger?.warn(
      { noteArticleId: input.noteArticleId, jobId: input.jobId, err },
      'anp.seo failed — continuing without SEO optimization',
    );
    return fallback;
  }

  // 有料記事は `paywall_line_pos` が本文の codepoint オフセットなので、見出しを置換すると
  // 位置がズレて有料ラインが本文の途中に食い込む。無料部分と有料部分を先に切り分けて
  // それぞれに適用し、無料部分の新しい長さから位置を計算し直す。
  let nextBody: string;
  let nextPaywallPos: number | null = paywallPos;
  if (paid && paywallPos !== null) {
    const chars = [...bodyMd];
    const free = applyHeadingFixes(chars.slice(0, paywallPos).join(''), seo.headings);
    const rest = applyHeadingFixes(chars.slice(paywallPos).join(''), seo.headings);
    nextPaywallPos = [...free].length;
    nextBody = appendInternalLinks(`${free}${rest}`, seo.internal_links);
  } else {
    nextBody = appendInternalLinks(applyHeadingFixes(bodyMd, seo.headings), seo.internal_links);
  }

  await prisma.noteArticle.update({
    where: { id: input.noteArticleId },
    data: {
      title: seo.title,
      lead: seo.lead,
      body_md: nextBody,
      ...(paid && paywallPos !== null ? { paywall_line_pos: nextPaywallPos } : {}),
      seo_json: {
        primary_keyword: seo.primary_keyword,
        keywords: seo.keywords,
        hashtags: seo.hashtags,
        title_alternatives: seo.title_alternatives,
        internal_links: seo.internal_links,
        rationale: seo.rationale ?? null,
        generated_at: new Date().toISOString(),
      },
      eyecatch_copy: seo.eyecatch_copy,
      eyecatch_sub: seo.eyecatch_sub ?? null,
      eyecatch_alt: seo.eyecatch_alt ?? null,
    },
  });

  return {
    applied: true,
    title: seo.title,
    eyecatchCopy: seo.eyecatch_copy,
    eyecatchSub: seo.eyecatch_sub ?? null,
    seo,
  };
}
