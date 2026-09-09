/**
 * F-075 — 手動グロース偵察担当 (growth_scout) の I/O 契約。
 *
 * IG/TikTok/note はフォロー/いいねの公式APIが無く自動化できないため、web_search で
 * 「そのニッチ(読書/本紹介)で実際にフォローすべき実在アカウント」「いいね/コメントすべき
 * 投稿の型」を具体的に特定し、運営者が手で実行できる ToDo リストを出力する。
 * 出力は generateText + extractLlmJson で受けるため、形状ドリフトに強い緩めのスキーマにする。
 */
import { z } from 'zod';

import { GenreValueSchema } from '../genres.js';

export const GrowthScoutInputSchema = z.object({
  channel: z.string().min(1),
  genre: GenreValueSchema.nullable().optional(),
  /** アカウントのコンセプト（戦略より）。 */
  concept: z.string().nullable().optional().default(''),
  /** 想定読者/ターゲット層（戦略より）。 */
  target_audience: z.string().nullable().optional().default(''),
  /** 1回のToDoで提示する手動アクションの目標件数。 */
  daily_target: z.number().int().min(1).max(30).default(15),
  /** 直近投稿サンプル（現状把握用・任意）。 */
  recent_posts: z.array(z.string()).default([]),
});
export type GrowthScoutInput = z.infer<typeof GrowthScoutInputSchema>;

/** 手動で実行する1アクション（フォロー/いいね/コメント）。 */
export const GrowthActionSchema = z.object({
  /** 種別。 */
  action_type: z.enum(['follow', 'like', 'comment']),
  /** 対象プラットフォーム（instagram | tiktok | note 等）。 */
  platform: z.string().default(''),
  /** 対象の @ハンドル/ユーザー名（フォロー時は必須級・任意）。 */
  target_handle: z.string().default(''),
  /** 対象の投稿/プロフィール URL（分かれば）。 */
  target_url: z.string().default(''),
  /** 対象が何か（どんなアカウント/どんな投稿か）。 */
  target_desc: z.string().min(1),
  /** なぜ engage すべきか（親和性・理由）。 */
  reason: z.string().default(''),
  /** 優先度。 */
  priority: z.enum(['high', 'mid', 'low']).default('mid'),
});
export type GrowthAction = z.infer<typeof GrowthActionSchema>;

/** growth_scout の出力（手動グロース ToDo）。 */
export const GrowthScoutOutputSchema = z.object({
  channel: z.string().default(''),
  /** リサーチ要約（このニッチで誰/何を狙うべきか）。 */
  summary: z.string().default(''),
  /** 具体アクション一覧。 */
  actions: z.array(GrowthActionSchema).min(1).max(40),
  /** 探索に使う推奨ハッシュタグ/検索語。 */
  search_hashtags: z.array(z.string()).default([]),
  /** 補足メモ（運営者向けの注意/コツ）。 */
  notes: z.array(z.string()).default([]),
});
export type GrowthScoutOutput = z.infer<typeof GrowthScoutOutputSchema>;
