/**
 * Blog SEO エージェント I/O 契約。
 *
 * 位置付け: 所有ブログ記事 (blog_posts / promotion_posts channel='blog') が生成された後・
 * 公開前に挿入される SEO 再最適化ステップ。seo-optimizer (KDP メタデータ用) を踏襲するが、
 * 対象は Amazon ではなく **検索エンジン (Google 等) 向けのブログ記事 SEO** である。
 *
 * 設計判断:
 *  - `current_slug` は既存があれば尊重する (URL 変更は被リンク/インデックスを失うため)。
 *  - `book` は自社本の紹介記事の場合にタイトル/副題を渡す (記事の文脈補強用、任意)。
 *  - `body_md` (出力) は見出し最適化・内部キーワードの自然配置・検索意図網羅を反映した改善版。
 *    大幅な事実改変はしない (呼出側は改善版があれば差し替え、無ければ原文を使う)。
 *  - 呼出元 (blog publisher) は **NON-FATAL 運用**: SEO 失敗でも記事公開は止めない
 *    (fatal/non-fatal の判断は呼出側の責務であり、本関数自体は throw する)。
 */
import { z } from 'zod';

export const BlogSeoInputSchema = z.object({
  /** graphile-worker.jobs.id — token_usage.job_id 紐付け用 (任意)。 */
  job_id: z.string().optional().nullable(),
  /** 記事が紐づく `Book.id` — token_usage.book_id 紐付け用 (任意、育成記事は null)。 */
  book_id: z.string().optional().nullable(),
  /** 記事タイトル (現行)。 */
  title: z.string().min(1).max(300),
  /** 記事本文 (Markdown)。呼出側で長すぎる場合は切り詰めて渡す。 */
  body_md: z.string().min(1),
  /** 狙う主要キーワード (任意)。 */
  target_keyword: z.string().max(120).optional(),
  /** 記事テーマ/切り口 (任意)。 */
  theme: z.string().max(300).optional(),
  /** 自社本紹介記事の場合の対象書籍 (任意)。 */
  book: z
    .object({
      title: z.string().min(1).max(300),
      subtitle: z.string().max(300).optional(),
    })
    .optional(),
  /** 既存 slug (あれば尊重する)。 */
  current_slug: z.string().max(200).optional(),
  /** ジャンル (任意、文脈補強用の自由文字列)。 */
  genre: z.string().max(120).optional(),
  /** カテゴリ (任意、文脈補強用の自由文字列)。 */
  category: z.string().max(120).optional(),
});
export type BlogSeoInput = z.infer<typeof BlogSeoInputSchema>;

export const BlogSeoOutputSchema = z.object({
  /** 検索意図を汲んだタイトル (32 全角目安、上限 100 字)。 */
  seo_title: z.string().min(1).max(100),
  /** URL スラッグ (英小文字・数字・ハイフンのみ、上限 80 字)。既存があれば尊重した値。 */
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug は英小文字・数字・ハイフンのみ'),
  /** メタディスクリプション (検索結果で読みたくなる、120 字以内)。 */
  meta_description: z.string().min(1).max(120),
  /** 記事本文と乖離させない検索キーワード (3〜8 個、各 1〜50 字)。 */
  keywords: z.array(z.string().min(1).max(50)).min(3).max(8),
  /** H2/H3 構成の改善案 (任意)。 */
  headings_suggestion: z.string().max(2000).optional(),
  /** 見出し最適化・内部キーワード自然配置・検索意図網羅を反映した改善版本文 (任意)。 */
  body_md: z.string().optional(),
  /** 何をなぜ変えたかの簡潔な説明 (任意、運営者向け)。 */
  rationale: z.string().max(1000).optional(),
});
export type BlogSeoOutput = z.infer<typeof BlogSeoOutputSchema>;
