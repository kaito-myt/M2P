/**
 * F-052b — 所有ブログの PublisherPort 実装。
 *
 * 第三者プラットフォームではなく **ツール自身のブログ** (blog_posts テーブル + 公開 /blog ページ)
 * に投稿するため、外部接続なしで「作成〜運用まで完全自律」できる。
 * publish() は blog_posts 行を published で作成し、公開 URL を返す。
 *
 * 公開前 SEO: blog_seo エージェントで seo_title/slug/meta_description/body_md を再最適化してから
 * 保存する。SEO は **非致命 (NON-FATAL)** — 失敗しても元のタイトル/本文で必ず公開まで進む。
 */
import { randomUUID } from 'node:crypto';

import { optimizeBlogSeo as defaultOptimizeBlogSeo, resolveBookCoverUrl as defaultResolveBookCoverUrl } from '@a2p/agents';
import type { BlogSeoInput, BlogSeoOutput } from '@a2p/contracts/agents/blog-seo';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import type { PublishInput, PublishResult, PublisherPort } from './publisher-port.js';

export interface BlogPublisherDeps {
  prisma?: {
    blogPost: {
      create: (args: {
        data: {
          slug: string;
          title: string;
          body_md: string;
          meta_description?: string | null;
          cover_image_url?: string | null;
          status: string;
          published_at: Date;
        };
      }) => Promise<{ slug: string }>;
    };
  };
  /** 公開 URL のベース (例: https://app.example.com)。未設定なら相対 URL を返す。 */
  baseUrl?: string;
  now?: () => Date;
  generateSlug?: () => string;
  /** 公開前 SEO 最適化 (テスト差し替え/無効化用)。null 明示で SEO をスキップ。 */
  optimizeBlogSeo?: ((input: BlogSeoInput) => Promise<BlogSeoOutput>) | null;
  /** 紹介対象書籍の実表紙 URL 解決 (テスト差し替え/無効化用)。null 明示でスキップ。 */
  resolveBookCoverUrl?: ((input: { title: string; body?: string }) => Promise<string | null>) | null;
  logger?: Logger;
}

function defaultSlug(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

/** 公開ブログに骨子/構成案を出さないための最低文字数。これ未満は未完成とみなす。
 *  「栞=要点だけ」の良書紹介は短めの完成投稿(600字前後)も許容するため、骨子は主に語(SKELETON_MARKERS)で
 *  弾き、長さ閾値は極端な断片のみブロックする低めの値にする。 */
const MIN_BLOG_BODY_CHARS = 450;

/** 骨子/構成案/未完成テンプレを示す語。本文に含まれていたら公開しない。 */
const SKELETON_MARKERS = ['骨子', '構成案', 'タイトル案'];

/**
 * 本文が「骨子/構成案などの未完成物」なら理由を返す (公開スキップ用)。
 * 完成本文なら null。promoter/blog-outline の骨子が公開ブログへ再流入するのを防ぐ安全ガード。
 */
function detectSkeletonBody(body: string): string | null {
  const hitMarker = SKELETON_MARKERS.find((m) => body.includes(m));
  if (hitMarker) {
    return `skeleton marker「${hitMarker}」を含む未完成本文`;
  }
  if (body.length < MIN_BLOG_BODY_CHARS) {
    return `本文が短すぎる (${body.length}字 < ${MIN_BLOG_BODY_CHARS}字) — 未完成の可能性`;
  }
  return null;
}

/** LLM が返した slug を英小文字・数字・ハイフンに正規化する (念のためのサニタイズ)。 */
function sanitizeSlug(raw: string): string {
  const s = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return s;
}

export function createBlogPublisherPort(deps: BlogPublisherDeps = {}): PublisherPort {
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NonNullable<BlogPublisherDeps['prisma']>);
  const now = deps.now ?? (() => new Date());
  const genSlug = deps.generateSlug ?? defaultSlug;
  const baseUrl = (deps.baseUrl ?? process.env.PROMOTION_BLOG_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  const runSeo =
    deps.optimizeBlogSeo === null
      ? null
      : deps.optimizeBlogSeo ?? ((input: BlogSeoInput) => defaultOptimizeBlogSeo(input));
  const runCover =
    deps.resolveBookCoverUrl === null
      ? null
      : deps.resolveBookCoverUrl ?? ((input: { title: string; body?: string }) => defaultResolveBookCoverUrl(input));
  const log = deps.logger ?? createLogger('worker.promotion.blog-publisher');

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      const body = input.body?.trim();
      if (!body) {
        return { ok: false, reason: 'invalid', message: 'empty blog body' };
      }
      // 安全ガード: 骨子/構成案/未完成テンプレは公開ブログに出さない (再流入防止)。
      const skeletonReason = detectSkeletonBody(body);
      if (skeletonReason) {
        log.warn({ len: body.length }, `blog body looks like a skeleton — skip publishing: ${skeletonReason}`);
        return { ok: false, reason: 'invalid', message: `skeleton/incomplete blog body: ${skeletonReason}` };
      }
      let title = input.title?.trim() || '新刊のお知らせ';
      let bodyMd = body;
      let metaDescription: string | null = null;
      let coverImageUrl: string | null = null;
      let preferredSlug: string | undefined;

      // 公開前 SEO 最適化 (非致命): 失敗しても元のタイトル/本文で公開する。
      if (runSeo) {
        try {
          const seo = await runSeo({ title, body_md: bodyMd });
          if (seo.seo_title?.trim()) title = seo.seo_title.trim();
          if (seo.body_md?.trim()) bodyMd = seo.body_md.trim();
          if (seo.meta_description?.trim()) metaDescription = seo.meta_description.trim();
          if (seo.slug?.trim()) {
            const cleaned = sanitizeSlug(seo.slug);
            if (cleaned) preferredSlug = cleaned;
          }
        } catch (err) {
          log.warn({ err }, 'blog SEO optimization failed — publishing with original content');
        }
      }

      // 紹介対象書籍の実表紙を解決 (非致命)。特定できなければ null → 一覧は装丁風カバーで描画。
      if (runCover) {
        try {
          coverImageUrl = await runCover({ title, body: bodyMd });
          if (coverImageUrl) log.info({ coverImageUrl }, 'resolved real book cover for blog post');
        } catch (err) {
          log.warn({ err }, 'book cover resolution failed — publishing without cover');
        }
      }

      // slug 衝突は稀。SEO 由来 slug を最初に試し、衝突/枯渇時はランダムへフォールバック。
      let slug = preferredSlug ?? genSlug();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const row = await prisma.blogPost.create({
            data: {
              slug,
              title,
              body_md: bodyMd,
              meta_description: metaDescription,
              cover_image_url: coverImageUrl,
              status: 'published',
              published_at: now(),
            },
          });
          const url = baseUrl ? `${baseUrl}/blog/${row.slug}` : `/blog/${row.slug}`;
          return { ok: true, externalUrl: url };
        } catch (err) {
          // unique 衝突なら slug を変えて再試行、それ以外は失敗扱い。
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < 2 && /unique|P2002/i.test(msg)) {
            slug = genSlug();
            continue;
          }
          return { ok: false, reason: 'unknown', message: msg };
        }
      }
      return { ok: false, reason: 'unknown', message: 'slug generation exhausted' };
    },
  };
}
