/**
 * docs/11-anp-design.md §3.2 / §7 — ANP (note 記事) 生成パイプライン I/O 契約。
 *
 * A2P の marketer/writer/editor/judge 契約 (`marketer.ts` / `writer.ts` / `editor.ts` /
 * `judge.ts`) を note 記事 (数千字・無料+有料ライン構造) に写像したもの。
 * role 名前空間は `anp.theme` / `anp.outline` / `anp.writer` / `anp.editor` / `anp.judge`
 * (`packages/contracts/src/agents/llm-client.ts` の `AgentRole` に追加済み)。
 *
 * note には A2P の 29 ジャンル体系を適用せず、`NoteAccount.niche` (自由文字列) を
 * 文脈として渡す (genre 引数は常に null — 役割プロンプトは genre=null 既定 1 本のみ)。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 共通: アカウント文脈
// ---------------------------------------------------------------------------

export const NoteAccountContextSchema = z.object({
  niche: z.string().min(1).max(200),
  target_reader: z.string().max(300).nullable().optional(),
  tone: z.string().max(200).nullable().optional(),
});
export type NoteAccountContext = z.infer<typeof NoteAccountContextSchema>;

export const NoteMonetizationPolicySchema = z.object({
  free_ratio: z.number().min(0).max(1).default(0.3),
  price_band: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  membership: z.boolean().default(false),
});
export type NoteMonetizationPolicy = z.infer<typeof NoteMonetizationPolicySchema>;

// ---------------------------------------------------------------------------
// F-ANP-10 — テーマ候補生成 (role='anp.theme')
// ---------------------------------------------------------------------------

export const NoteThemeInputSchema = z.object({
  note_account_id: z.string().min(1),
  job_id: z.string().optional(),
  account: NoteAccountContextSchema,
  count: z.number().int().min(1).max(20).default(5),
  exclude_titles_recent: z.array(z.string()).max(200).default([]),
});
export type NoteThemeInput = z.infer<typeof NoteThemeInputSchema>;

export const NoteThemeCandidateSchema = z.object({
  title: z.string().min(1).max(200),
  hook: z.string().min(1).max(600),
  target_reader: z.string().max(300).optional(),
  recommend_paid: z.boolean().default(false),
  suggested_price: z.number().int().min(0).max(50000).optional(),
  competitors: z.array(z.string().max(200)).max(10).optional(),
  genre: z.string().min(1).max(64),
});
export type NoteThemeCandidate = z.infer<typeof NoteThemeCandidateSchema>;

export const NoteThemeOutputSchema = z.object({
  candidates: z.array(NoteThemeCandidateSchema).min(1).max(20),
});
export type NoteThemeOutput = z.infer<typeof NoteThemeOutputSchema>;

// ---------------------------------------------------------------------------
// F-ANP-11 — 構成生成 (role='anp.outline')
// ---------------------------------------------------------------------------

export const NoteOutlineInputSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().optional(),
  account: NoteAccountContextSchema,
  theme: z.object({
    title: z.string().min(1).max(200),
    hook: z.string().min(1).max(600),
    target_reader: z.string().max(300).optional(),
  }),
  paid: z.boolean(),
  target_chars: z.number().int().min(500).max(20000).default(4000),
});
export type NoteOutlineInput = z.infer<typeof NoteOutlineInputSchema>;

export const NoteOutlineOutputSchema = z.object({
  lead: z.string().min(1).max(1000),
  headings: z.array(z.string().min(1).max(120)).min(2).max(12),
});
export type NoteOutlineOutput = z.infer<typeof NoteOutlineOutputSchema>;

// ---------------------------------------------------------------------------
// F-ANP-12 — 本文執筆 (role='anp.writer')
// ---------------------------------------------------------------------------

export const NoteWriterInputSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().optional(),
  account: NoteAccountContextSchema,
  theme: z.object({
    title: z.string().min(1).max(200),
    hook: z.string().min(1).max(600),
    target_reader: z.string().max(300).optional(),
  }),
  lead: z.string().min(1).max(1000),
  headings: z.array(z.string().min(1).max(120)).min(1).max(12),
  paid: z.boolean(),
  price_jpy: z.number().int().min(0).max(50000).optional(),
  target_chars: z.number().int().min(500).max(20000).default(4000),
  /** 有料記事のみ参照: 無料公開する分量の目安比率 (アカウントの monetization_policy 由来)。 */
  free_ratio: z.number().min(0.05).max(0.95).default(0.3),
  feedback: z.array(z.string().max(2000)).max(20).optional(),
  /**
   * F-ANP-31 相互流入 (最小): 同ジャンルで publish_status='published' の A2P 書籍 (最大2件)。
   * 本文末尾で「自然に触れてよい (必須ではない)」参考情報として writer に渡す。
   */
  related_books: z
    .array(z.object({ title: z.string().min(1).max(200), asin: z.string().min(1).max(20).optional() }))
    .max(2)
    .optional(),
});
export type NoteWriterInput = z.infer<typeof NoteWriterInputSchema>;

export const NoteWriterOutputSchema = z.object({
  body_md: z.string().min(200),
  char_count: z.number().int().min(0),
  /**
   * 有料記事のみ: 無料公開する本文の末尾文字位置 (codepoint index)。
   * `body_md.slice(0, paywall_line_pos)` が無料部分。無料記事は undefined。
   */
  paywall_line_pos: z.number().int().min(0).optional(),
});
export type NoteWriterOutput = z.infer<typeof NoteWriterOutputSchema>;

// ---------------------------------------------------------------------------
// F-ANP-13 — 校閲 (role='anp.editor')
// ---------------------------------------------------------------------------

export const NoteEditorInputSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().optional(),
  account: NoteAccountContextSchema,
  title: z.string().min(1).max(200),
  lead: z.string().min(1).max(1000),
  body_md: z.string().min(1),
  paid: z.boolean(),
  /** 有料記事のみ: writer/前回 editor が確定した無料/有料の区切り位置 (codepoint index)。 */
  paywall_line_pos: z.number().int().min(0).optional(),
  feedback: z.array(z.string().max(2000)).max(20).optional(),
});
export type NoteEditorInput = z.infer<typeof NoteEditorInputSchema>;

export const NoteEditorOutputSchema = z.object({
  lead: z.string().min(1).max(1000),
  body_md: z.string().min(200),
});
export type NoteEditorOutput = z.infer<typeof NoteEditorOutputSchema>;

// ---------------------------------------------------------------------------
// F-ANP-15 — 品質判定 (role='anp.judge')
// ---------------------------------------------------------------------------

export const NoteJudgeInputSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().optional(),
  account: NoteAccountContextSchema,
  title: z.string().min(1).max(200),
  lead: z.string().min(1).max(1000),
  body_md: z.string().min(1),
  paid: z.boolean(),
  price_jpy: z.number().int().min(0).max(50000).optional(),
});
export type NoteJudgeInput = z.infer<typeof NoteJudgeInputSchema>;

export const NoteJudgeOutputSchema = z.object({
  /**
   * 4 軸均等重み平均 (0-100、切り捨て整数)。**呼出側 (judge.ts) が breakdown から再計算して上書きする**契約。
   * LLM は各軸 0-100 を単純合計して 400 点を返すことがあり (2026-09-15 本番初回実走で 3/3 失敗)、
   * ここで max(100) に縛ると再計算前に弾かれてしまう。LLM の値は参考値として緩く受け、上限は付けない。
   */
  score_total: z.number().min(0).catch(0),
  score_breakdown: z.object({
    /** フック強度 (冒頭で読者を掴めているか) */
    hook_strength: z.number().int().min(0).max(100),
    /** 可読性 (短段落・リード文・構成の分かりやすさ) */
    readability: z.number().int().min(0).max(100),
    /** 有料転換見込み (続きが読みたくなるか・ライン位置の妥当性) */
    paid_conversion: z.number().int().min(0).max(100),
    /** 検索流入見込み (タイトル/見出しの検索されやすさ) */
    search_inflow: z.number().int().min(0).max(100),
  }),
  judge_comments: z.record(z.string(), z.string()),
});
export type NoteJudgeOutput = z.infer<typeof NoteJudgeOutputSchema>;

/** judge 合格ライン (docs/11 §7)。A2P Judge の 80 点基準を踏襲。 */
export const NOTE_JUDGE_PASS_THRESHOLD = 80;

// ---------------------------------------------------------------------------
// F-ANP-30 — note 記事の SNS 告知投稿 (role='anp.promo')
// ---------------------------------------------------------------------------

/**
 * 5 チャンネル共通の販促ペルソナ (`promotion_channel_settings.strategy_json` の
 * `AccountStrategyProfile` から抽出、A2P の content_creator と同型)。
 */
export const AnpPromoPersonaSchema = z.object({
  concept: z.string().max(2000).optional(),
  tone_of_voice: z.string().max(1000).optional(),
});
export type AnpPromoPersona = z.infer<typeof AnpPromoPersonaSchema>;

export const AnpPromoContentInputSchema = z.object({
  // TikTok は記事に無関係な動画をオンデマンド生成する経路(tiktok-video.ts)に乗ってしまうため
  // Phase 4 まで対象外とする(docs/11 §3.4/§7)。
  channel: z.enum(['x', 'instagram']),
  persona: AnpPromoPersonaSchema,
  playbook_guidance: z.string().max(4000).optional(),
  article: z.object({
    title: z.string().min(1).max(200),
    hook: z.string().max(600).optional(),
    lead: z.string().max(1000).optional(),
    note_url: z.string().min(1).max(500),
    niche: z.string().max(200),
  }),
});
export type AnpPromoContentInput = z.infer<typeof AnpPromoContentInputSchema>;

export const AnpPromoContentOutputSchema = z.object({
  /** note_url を含まない完成文 (呼出側で URL/ハッシュタグを付与する)。 */
  body: z.string().min(1).max(2000),
});
export type AnpPromoContentOutput = z.infer<typeof AnpPromoContentOutputSchema>;
