/**
 * F-051 — Promoter エージェント (販促施策プラン生成) の I/O 契約。
 *
 * 出版した本を「売れる」状態に持っていくための具体的な販促プランを生成する。
 * 出力は DB `promotion_plans.plan_json` にそのまま保存される。
 */
import { z } from 'zod';
import { GenreValueSchema } from '../genres.js';

export const PromotionInputSchema = z.object({
  jobId: z.string().optional(),
  bookId: z.string(),
  genre: GenreValueSchema.nullable(),
  /** 本の企画・メタ情報 (販促プランの根拠)。 */
  book: z.object({
    title: z.string().min(1).max(200),
    subtitle: z.string().max(200).optional(),
    hook: z.string().max(800).optional(),
    target_reader: z.string().max(300).optional(),
    description: z.string().max(4000).optional(),
    keywords: z.array(z.string()).max(10).default([]),
    price_jpy: z.number().int().optional(),
    author: z.string().max(120).optional(),
  }),
  /** 直近の売上/レビュー実績 (あれば施策を状況に合わせる)。 */
  performance: z
    .object({
      recent_royalty_jpy: z.number().int().optional(),
      review_count: z.number().int().optional(),
      avg_stars: z.number().optional(),
    })
    .optional(),
  /**
   * F-064: web検索リサーチに基づく販促プレイブック要約(今伸びている型/フック/
   * ハッシュタグ/避けるべきこと)。SNS投稿文を書く際にこれを反映する。空なら従来どおり。
   */
  playbook_guidance: z.string().max(6000).default(''),
});
export type PromotionInput = z.infer<typeof PromotionInputSchema>;

/** ローンチ直後にやるべきタスク 1 件。 */
export const LaunchTaskSchema = z.object({
  task: z.string().min(1).max(300),
  timing: z.string().max(80).optional(), // 例: "出版当日", "出版後3日以内"
});
export type LaunchTask = z.infer<typeof LaunchTaskSchema>;

/** 継続施策カレンダー 1 件。 */
export const OngoingActionSchema = z.object({
  when: z.string().min(1).max(80), // 例: "毎週", "出版1ヶ月後"
  action: z.string().min(1).max(300),
});
export type OngoingAction = z.infer<typeof OngoingActionSchema>;

/**
 * 一部の LLM(特に大きなネスト構造)は、配列/オブジェクトのフィールドを
 * **JSON 文字列化して**返すことがある(例: promo_copy を "{\"x_posts\":[...]}" として返す)。
 * その場合 zod 検証が落ち、プラン生成が失敗する/空になる。ここでは検証前に
 * 「JSON 配列/オブジェクトらしき文字列」を parse して本来の型へ戻す(頑健化)。
 */
function jsonish<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<z.ZodTypeAny, z.output<T>, unknown> {
  return z.preprocess((v) => {
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
        try {
          return JSON.parse(t);
        } catch {
          return v;
        }
      }
    }
    return v;
  }, schema) as z.ZodEffects<z.ZodTypeAny, z.output<T>, unknown>;
}

export const PromotionPlanOutputSchema = z.object({
  /** 全体の販促方針 (日本語)。 */
  summary: z.string().min(1).max(1200),
  /** 価格戦略。 */
  pricing: jsonish(
    z.object({
      launch_price_jpy: z.number().int().min(0),
      regular_price_jpy: z.number().int().min(0),
      /** KDP セレクト (独占) 登録を推奨するか。 */
      kdp_select_recommended: z.boolean(),
      /** 無料キャンペーン / Kindle カウントダウンなどの使い方 (日本語)。 */
      tactics: jsonish(z.array(z.string().min(1).max(300)).max(8).default([])),
    }),
  ),
  /** カテゴリ / キーワードの再最適化アクション。 */
  category_keyword_actions: jsonish(z.array(z.string().min(1).max(300)).max(10).default([])),
  /** レビュー獲得アクション。 */
  review_actions: jsonish(z.array(z.string().min(1).max(300)).max(10).default([])),
  /** ローンチ直後チェックリスト。 */
  launch_checklist: jsonish(z.array(LaunchTaskSchema).max(15).default([])),
  /** そのままコピペできる告知文。 */
  promo_copy: jsonish(
    z.object({
      /** X (Twitter) 投稿案 (複数、各 140 字目安)。 */
      x_posts: jsonish(z.array(z.string().min(1).max(300)).max(6).default([])),
      /** note 記事の下書き (見出し + 本文)。 */
      note_article: z.string().max(4000).default(''),
      /**
       * そのまま公開できる完成した良書紹介/告知ブログ記事 (見出し + 本文, 1200字以上)。
       * 骨子・構成案・箇条書きの「案」ではなく、公開可能な本文を入れる
       * (フィールド名は互換のため blog_outline のまま。中身は完成記事)。
       */
      blog_outline: z.string().max(6000).default(''),
    }),
  ),
  /** 継続施策カレンダー。 */
  ongoing_calendar: jsonish(z.array(OngoingActionSchema).max(12).default([])),
});
export type PromotionPlanOutput = z.infer<typeof PromotionPlanOutputSchema>;
