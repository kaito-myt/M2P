/**
 * SEO Optimizer エージェント I/O 契約。
 *
 * 位置付け: judge PASS 後・export 直前に挿入される再最適化ステップ (docs/05 パイプライン §5.3.8/§5.3.9)。
 * Marketer が THEME 段階 (完成前) で作った `kdp_metadata` (description/keywords/categories) を、
 * **完成原稿** を踏まえて Amazon SEO (A9/A10) 観点で再最適化する。DB スキーマ変更は不要
 * (既存 `kdp_metadata` 行の同カラムを UPDATE するのみ、Hard Rule #3)。
 *
 * 設計判断:
 *  - `current_metadata` は呼出側 (worker) が DB `kdp_metadata` から渡す現行値。
 *    エージェントはこれを土台に改善する (ゼロから作り直さない)。
 *  - `chapter_digest` は完成原稿のアウトライン/見出し要約。呼出側で最大文字数に切り詰めて渡す
 *    (このスキーマでは長さ制約を課さない — 呼出側の責務)。
 *  - `title_suggestion`/`subtitle_suggestion` は**提案のみ**。書籍本体のタイトルは変更しない
 *    (judge 済みの確定タイトルへの影響を避けるため、worker 側では保存のみで自動適用しない)。
 */
import { z } from 'zod';
import { GenreValueSchema } from '../genres.js';

export const SeoOptimizerInputSchema = z.object({
  /** `Book.id` */
  book_id: z.string().min(1),
  /** graphile-worker.jobs.id — token_usage.job_id 紐付け用。 */
  job_id: z.string().optional().nullable(),
  /** ジャンル (null = ジャンル横断既定プロンプト fallback)。 */
  genre: GenreValueSchema.nullable(),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  target_reader: z.string().min(1).max(300),
  hook: z.string().max(800).optional(),
  /** 完成原稿のアウトライン/見出し要約 (呼出側で切り詰め済み)。 */
  chapter_digest: z.string().min(1),
  /** 現行 KDP メタデータ (DB `kdp_metadata` から呼出側が渡す)。 */
  current_metadata: z.object({
    description: z.string(),
    keywords: z.array(z.string()),
    categories: z.array(z.string()),
  }),
});
export type SeoOptimizerInput = z.infer<typeof SeoOptimizerInputSchema>;

export const SeoOptimizerOutputSchema = z.object({
  /** 再最適化した商品説明文 (KDP description 上限に合わせ 4000 字以内)。 */
  description: z.string().min(1).max(4000),
  /** バックエンド検索キーワード (最大 7 個、各 1〜50 字)。 */
  keywords: z.array(z.string().min(1).max(50)).min(1).max(7),
  /** KDP カテゴリ (ちょうど 2 個)。 */
  categories: z.array(z.string().min(1).max(200)).length(2),
  /** タイトルの改善提案 (任意、本体タイトルへは自動反映しない)。 */
  title_suggestion: z.string().max(200).optional(),
  /** 副題の改善提案 (任意、本体へは自動反映しない)。 */
  subtitle_suggestion: z.string().max(200).optional(),
  /** 何をなぜ変えたかの簡潔な説明 (任意、運営者向け)。 */
  rationale: z.string().max(1000).optional(),
});
export type SeoOptimizerOutput = z.infer<typeof SeoOptimizerOutputSchema>;
