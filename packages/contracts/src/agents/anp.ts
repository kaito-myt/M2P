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

/**
 * 記事の方針 (editorial_policy) の最大長。UI は 7 区分 (各 800〜2000 字) に分けて入力するため
 * 連結すると 1 万字近くなる。エージェント入力の上限が小さいと ZodError でパイプラインが止まる。
 */
export const EDITORIAL_POLICY_MAX = 12000;

// ---------------------------------------------------------------------------
// 共通: アカウント文脈
// ---------------------------------------------------------------------------

export const NoteAccountContextSchema = z.object({
  niche: z.string().min(1).max(200),
  target_reader: z.string().max(300).nullable().optional(),
  tone: z.string().max(200).nullable().optional(),
  /**
   * F-ANP-07 (2026-09-21): 記事の方針・トンマナ (書くこと/書かないこと・構成の癖・語尾・NG 表現・CTA の
   * 入れ方など)。アカウント詳細で運営者が編集 or AI 生成する。theme/outline/writer/editor/judge の
   * ユーザーメッセージに「【記事の方針・トンマナ】」ブロックとして注入される。
   */
  // 2026-09-24: 上限 3000 では足りず **本番のテーマ自動生成が ZodError(too_big) で連日失敗していた**
  // (7 区分 × 各 800〜2000 字 = 実データで 4,400 字)。UI の入力上限 (合計 ~10,300 字) + 見出し分を
  // 吸収できる 12,000 字に引き上げる。プロンプトが膨らみすぎないかはコスト側で監視する。
  editorial_policy: z.string().max(EDITORIAL_POLICY_MAX).nullable().optional(),
  /**
   * F-ANP-08 (2026-09-21): 収益化方針 (有料比率・無料公開割合・価格帯・メンバーシップ)。
   * テーマ生成のユーザーメッセージに「【収益化方針】」ブロックとして注入される (theme 以外は無視)。
   */
  monetization: z.lazy(() => NoteMonetizationPolicySchema).optional(),
});
export type NoteAccountContext = z.infer<typeof NoteAccountContextSchema>;

export const NoteMonetizationPolicySchema = z.object({
  /** 有料記事の本文のうち無料公開する分量の目安比率 (ペイウォール位置)。 */
  free_ratio: z.number().min(0).max(1).default(0.3),
  price_band: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  membership: z.boolean().default(false),
  /**
   * F-ANP-08 (2026-09-21): 記事全体に占める有料記事の目安比率。テーマ生成 (anp.theme) に
   * 「候補のうち約 N 件を recommend_paid=true」として注入する。未指定なら AI 任せ (従来どおり)。
   */
  paid_ratio: z.number().min(0).max(1).optional(),
});
export type NoteMonetizationPolicy = z.infer<typeof NoteMonetizationPolicySchema>;

/** `note_accounts.monetization_policy_json` (unknown/Json) を安全にパースする。失敗時は既定値。 */
export function parseNoteMonetizationPolicy(json: unknown): NoteMonetizationPolicy {
  const parsed = NoteMonetizationPolicySchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : NoteMonetizationPolicySchema.parse({});
}

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
  /**
   * F-ANP-16 価格・有料の自動提案 (最小, docs/11 申し送り8): judge が本文の完成度を見た上で
   * 「有料化を推奨するか」「推奨するならいくらか」を提案する。note の KYC 未完了のため
   * 呼出側 (pipeline.note.judge) はこの提案を `NoteArticle.paid` には反映しない
   * (paid は判定完了時に必ず false へ強制し、`price_jpy` に提案値だけを保存する)。
   */
  recommend_paid: z.boolean().optional(),
  suggested_price_jpy: z.number().int().min(0).max(50000).optional(),
});
export type NoteJudgeOutput = z.infer<typeof NoteJudgeOutputSchema>;

/**
 * judge 合格ライン (docs/11 §7)。
 * F-ANP-44 (2026-09-24): 運営者の設計方針
 *   85 点以上 → 公開 / 70〜84 → 校閲 (editor) へ / 69 以下 → 構成からやり直し (writer)
 * に合わせて 80 → 85 に引き上げ、低スコア帯の差し戻し先を分けた。
 */
export const NOTE_JUDGE_PASS_THRESHOLD = 85;
/** これ未満は「校閲では直らない」とみなし、構成 (outline) から書き直す。 */
export const NOTE_JUDGE_REWRITE_THRESHOLD = 70;

/** judge スコアから次の工程を決める (docs/11 §7, F-ANP-44)。 */
export function routeByJudgeScore(
  scoreTotal: number,
  retryCount: number,
  retryLimit: number,
): 'ready' | 'editor' | 'writer' | 'needs_human_review' {
  if (scoreTotal >= NOTE_JUDGE_PASS_THRESHOLD) return 'ready';
  if (retryCount >= retryLimit) return 'needs_human_review';
  return scoreTotal < NOTE_JUDGE_REWRITE_THRESHOLD ? 'writer' : 'editor';
}

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
  /**
   * 運営者要望「投稿にSNSのキャラクター性が出るように」— 5チャンネル共通ペルソナの
   * 人物設定(口癖・一人称・日常・価値観・弱み等)。省略時は呼出元が
   * `resolveCharacterSheet` で既定値(`DEFAULT_PERSONA_CHARACTER_SHEET`)を渡す。
   */
  character_sheet: z.string().max(2000).optional(),
});
export type AnpPromoPersona = z.infer<typeof AnpPromoPersonaSchema>;

// ---------------------------------------------------------------------------
// F-ANP-32 (2026-09-21) — アカウント別・媒体別の販促施策 (`note_accounts.promotion_policy_json`)
//
// 運営者要望「メニューに販促施策を作って。アカウントごとに販促施策が設定できるようにして。…各アカウントごとに
// X、IG、TikTok、ブログでの販促施策を確認できるようにして」への対応。媒体ごとに ON/OFF・方針・ハッシュタグ・
// 投稿頻度・CTA を持ち、`promotion.note.article` (X/IG 告知) と `promotion.note.article.video` (TikTok) が参照する。
// ---------------------------------------------------------------------------

export const NOTE_PROMOTION_CHANNELS = ['x', 'instagram', 'tiktok', 'blog'] as const;
export type NotePromotionChannel = (typeof NOTE_PROMOTION_CHANNELS)[number];

export const NotePromotionChannelPolicySchema = z.object({
  /** この媒体で告知するか。未指定の既定: x/instagram=true、tiktok=settings_json.tiktok_enabled、blog=false。 */
  enabled: z.boolean().optional(),
  /** 施策・方針 (何を/どう告知するか。書き手のキャラ、NG、狙う読者)。anp.promo に注入。 */
  policy: z.string().max(3000).optional(),
  /** 常に付けるハッシュタグ (# は付けても付けなくてもよい)。 */
  hashtags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** 週あたりの投稿目安 (表示・将来の頻度制御用)。 */
  posts_per_week: z.number().int().min(0).max(70).optional(),
  /** 記事へ誘導する決まり文句 (例: 「続きは note で」)。 */
  cta: z.string().max(300).optional(),
  /** AI 生成した根拠メモ (表示のみ)。 */
  rationale: z.string().max(2000).optional(),
  updated_at: z.string().optional(),
});
export type NotePromotionChannelPolicy = z.infer<typeof NotePromotionChannelPolicySchema>;

export const NotePromotionPolicySchema = z.object({
  x: NotePromotionChannelPolicySchema.optional(),
  instagram: NotePromotionChannelPolicySchema.optional(),
  tiktok: NotePromotionChannelPolicySchema.optional(),
  blog: NotePromotionChannelPolicySchema.optional(),
});
export type NotePromotionPolicy = z.infer<typeof NotePromotionPolicySchema>;

/** `note_accounts.promotion_policy_json` を安全にパースする。失敗時は空 (= 既定挙動)。 */
export function parseNotePromotionPolicy(json: unknown): NotePromotionPolicy {
  const parsed = NotePromotionPolicySchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : {};
}

/** 媒体の実効 ON/OFF (未指定の既定は上記コメントのとおり)。 */
export function isNotePromotionChannelEnabled(
  policy: NotePromotionPolicy,
  channel: NotePromotionChannel,
  settings: { tiktok_enabled?: boolean | undefined },
): boolean {
  const explicit = policy[channel]?.enabled;
  if (explicit !== undefined) return explicit;
  if (channel === 'x' || channel === 'instagram') return true;
  if (channel === 'tiktok') return settings.tiktok_enabled === true;
  return false;
}

/** F-ANP-32: AI に販促施策を作らせる (role anp.strategist)。 */
export const NotePromotionPolicyInputSchema = z.object({
  note_account_id: z.string().min(1),
  job_id: z.string().optional(),
  channel: z.enum(NOTE_PROMOTION_CHANNELS),
  account: z.object({
    display_name: z.string().max(100),
    handle: z.string().max(64).nullable().optional(),
    niche: z.string().max(200),
    target_reader: z.string().max(300).nullable().optional(),
    tone: z.string().max(200).nullable().optional(),
    bio: z.string().max(400).nullable().optional(),
    editorial_policy: z.string().max(EDITORIAL_POLICY_MAX).nullable().optional(),
    concept: z.string().max(2000).nullable().optional(),
  }),
  existing_policy: NotePromotionChannelPolicySchema.optional(),
  instruction: z.string().max(2000).optional(),
  reference_images: z.array(z.object({ data: z.string().min(1), mimeType: z.string().min(1) })).max(4).optional(),
});
export type NotePromotionPolicyInput = z.infer<typeof NotePromotionPolicyInputSchema>;

export const NotePromotionPolicyOutputSchema = z.object({
  policy: z.string().min(1).max(3000),
  hashtags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  posts_per_week: z.number().int().min(0).max(70).optional(),
  cta: z.string().max(300).optional(),
  rationale: z.string().max(2000).optional(),
});
export type NotePromotionPolicyOutput = z.infer<typeof NotePromotionPolicyOutputSchema>;

export const AnpPromoContentInputSchema = z.object({
  // TikTok は記事に無関係な動画をオンデマンド生成する経路(tiktok-video.ts)に乗ってしまうため
  // Phase 4 まで対象外とする(docs/11 §3.4/§7)。
  channel: z.enum(['x', 'instagram']),
  persona: AnpPromoPersonaSchema,
  playbook_guidance: z.string().max(4000).optional(),
  /** F-ANP-32: アカウント別・媒体別の販促施策 (運営者設定)。あれば必ず守る。 */
  account_policy: z.string().max(3000).optional(),
  account_cta: z.string().max(300).optional(),
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

// ---------------------------------------------------------------------------
// F-ANP-01/03 — note アカウント設計 (role='anp.strategist')
//
// 運営者要望「note は別アカウントを作ります。どのようなアカウントにするかの設計もツール上で
// 行えるようにしといてくださいね」への対応。運営者はニッチの自由記述 (brief) だけを渡し、
// AI が表示名/handle 候補・bio・発信の柱・収益方針・投稿頻度・初回テーマ・アイコン/ヘッダー
// 画像プロンプトまで一括設計する (`sns_strategist` の note 版)。
// ---------------------------------------------------------------------------

/** note urlname (ハンドル) の制約: 半角英数字とアンダースコアのみ。 */
export const NOTE_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

export const NoteAccountDesignPersonaTypeSchema = z.enum(['person', 'brand']);
export type NoteAccountDesignPersonaType = z.infer<typeof NoteAccountDesignPersonaTypeSchema>;

/** 運営者の入力 (ブリーフ)。`idea` 以外は任意。 */
export const NoteAccountDesignBriefSchema = z.object({
  /** やりたいこと・ニッチの自由記述 (必須)。 */
  idea: z.string().min(1).max(2000),
  /** 収益目標・狙い (任意)。 */
  goal: z.string().max(1000).optional(),
  target_reader_hint: z.string().max(500).optional(),
  /** 無料中心/有料重視/メンバーシップ 等の方針ヒント (任意)。 */
  monetization_hint: z.string().max(500).optional(),
  /** NG・避けたい事 (任意)。 */
  constraints: z.string().max(1000).optional(),
  persona_type: z.enum(['person', 'brand', 'auto']).default('auto'),
  /** 参考にしたい note/SNS アカウント (任意)。 */
  reference_accounts: z.array(z.string().max(300)).max(10).optional(),
  /**
   * 「フィードバックして再生成」時に前回設計への追加指示を積む (worker が新しい
   * `NoteAccountDesign` 行の brief_json にこの内容を追記して再生成する)。
   */
  feedback: z.string().max(2000).optional(),
});
export type NoteAccountDesignBrief = z.infer<typeof NoteAccountDesignBriefSchema>;

export const NoteAccountDesignContentPillarSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  example_titles: z.array(z.string().max(200)).max(10).default([]),
});
export type NoteAccountDesignContentPillar = z.infer<typeof NoteAccountDesignContentPillarSchema>;

export const NoteAccountDesignMonetizationPolicySchema = z.object({
  free_ratio: z.number().min(0).max(1).default(0.3),
  price_band: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  membership: z.boolean().default(false),
  /** どこから有料にするか (無料パートの引き方) の方針を1文で。 */
  paid_line_strategy: z.string().max(600).default(''),
});
export type NoteAccountDesignMonetizationPolicy = z.infer<
  typeof NoteAccountDesignMonetizationPolicySchema
>;

export const NoteAccountDesignPostingCadenceSchema = z.object({
  times_per_week: z.number().int().min(1).max(21).default(3),
  /** 例: 「毎週火・金・日の21:00」。 */
  time_of_day: z.string().max(200).default(''),
});
export type NoteAccountDesignPostingCadence = z.infer<typeof NoteAccountDesignPostingCadenceSchema>;

export const NoteAccountDesignFirstThemeSchema = z.object({
  title: z.string().min(1).max(200),
  hook: z.string().max(600).default(''),
});
export type NoteAccountDesignFirstTheme = z.infer<typeof NoteAccountDesignFirstThemeSchema>;

export const NoteAccountDesignKpiTargetsSchema = z.object({
  followers_30d: z.number().int().min(0).default(0),
  articles_30d: z.number().int().min(0).default(0),
  revenue_90d_jpy: z.number().int().min(0).default(0),
});
export type NoteAccountDesignKpiTargets = z.infer<typeof NoteAccountDesignKpiTargetsSchema>;

/**
 * AI が出す note アカウント設計案本体。運営者は UI 上で各項目を編集し、採用時に
 * `note_accounts` へ書き写す (display_name_candidates/handle_candidates はラジオで1つ選ぶ)。
 */
export const NoteAccountDesignSchema = z.object({
  display_name_candidates: z.array(z.string().min(1).max(60)).min(1).max(5),
  handle_candidates: z.array(z.string().min(1).max(32)).min(1).max(5),
  /** note プロフィール文 (140字以内目安)。 */
  bio: z.string().min(1).max(400),
  /** ポジショニング宣言 (1〜2文)。 */
  concept: z.string().min(1).max(600),
  target_reader: z.string().min(1).max(400),
  tone: z.string().min(1).max(300),
  persona_type: NoteAccountDesignPersonaTypeSchema,
  /** 人物型のときのみ 400〜800字目安。ブランド型なら null。 */
  character_sheet: z.string().max(1000).nullable().default(null),
  content_pillars: z.array(NoteAccountDesignContentPillarSchema).min(1).max(8),
  /** `@a2p/contracts` の genre slug 配列 (カタログ外の値も緩く許容)。 */
  genre_policy: z.array(z.string().max(64)).max(10).default([]),
  monetization_policy: NoteAccountDesignMonetizationPolicySchema,
  posting_cadence: NoteAccountDesignPostingCadenceSchema,
  first_themes: z.array(NoteAccountDesignFirstThemeSchema).min(1).max(10),
  kpi_targets: NoteAccountDesignKpiTargetsSchema,
  /** アイコン (正方形) 生成プロンプト。文字なし。人物型なら `withPersonaVisualRules` を別途適用。 */
  avatar_prompt: z.string().min(1).max(3000),
  /** ヘッダー (note 推奨 1280x670 目安・横長) 生成プロンプト。文字なし。 */
  header_prompt: z.string().min(1).max(3000),
  /** なぜこの設計か (3〜5行)。 */
  rationale: z.string().max(2000).optional(),
});
export type NoteAccountDesign = z.infer<typeof NoteAccountDesignSchema>;

// ---------------------------------------------------------------------------
// F-ANP-17 — アカウント別パイプライン自動パス設定 (`note_accounts.settings_json`)
//
// グローバル `AppSettings` (anp_auto_theme_enabled 等) をアカウント単位で上書きする。
// 各キーは未指定 (undefined) ならグローバル既定値に従う (docs/11-anp-design.md §3.2/§7)。
// ---------------------------------------------------------------------------

export const NoteAccountSettingsSchema = z.object({
  /** note.theme.auto によるテーマ自動生成を有効化するか。未指定ならグローバルに従う。 */
  auto_theme_enabled: z.boolean().optional(),
  /** 1日のテーマ自動生成数。未指定ならグローバルに従う。 */
  themes_per_day: z.number().int().min(1).max(20).optional(),
  /** 自動生成テーマを承認なしで採用しパイプラインを自動起動するか。未指定ならグローバルに従う。 */
  autopass_enabled: z.boolean().optional(),
  /** note.publish.dispatch による自動公開を有効化するか。未指定ならグローバルに従う。 */
  auto_publish_enabled: z.boolean().optional(),
  /** [Phase 4] 公開記事の TikTok 連動動画 (`promotion.note.article.video`) を作るか。既定 false。 */
  tiktok_enabled: z.boolean().optional(),
  /**
   * [F-ANP-16b] 有料記事の自動公開を許可するか (既定 false)。note の本人確認 (KYC) が完了して
   * いないアカウントで有料を選ぶと「本人情報の登録」モーダルで止まるため、運営者が KYC を
   * 済ませたアカウントだけ ON にする。OFF の間は judge が `paid=false` に落として無料公開する。
   */
  paid_publish_enabled: z.boolean().optional(),
});
export type NoteAccountSettings = z.infer<typeof NoteAccountSettingsSchema>;

/** `note_accounts.settings_json` (unknown/Json) を安全にパースする。失敗時は空 (=全てグローバル追従)。 */
export function parseNoteAccountSettings(json: unknown): NoteAccountSettings {
  const parsed = NoteAccountSettingsSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : {};
}

// ---------------------------------------------------------------------------
// F-ANP-04 — note アカウント戦略の AI 相談 (role='anp.consultant')
//
// 運営者要望 (2026-09-21)「ANP で最初アカウント戦略策定する時に、AI に相談しながらリサーチや
// 戦略策定を行えるようにして」への対応。ブリーフを一発入力する F-ANP-01 の前段として、
// 運営者 ⇔ AI アドバイザーがチャットで壁打ちし、必要に応じて Web リサーチ (Tavily) を挟みながら
// ニッチ/読者/収益化/人物設定を固めていく。AI は会話のたびに「ブリーフ草案」を更新し、
// 運営者が納得した時点で草案をそのまま `NoteAccountDesignBrief` として設計生成へ渡す。
// ---------------------------------------------------------------------------

/** 会話の 1 ターン (古い順)。`operator` = 運営者 / `advisor` = AI アドバイザー。 */
export const NoteAccountConsultTurnSchema = z.object({
  role: z.enum(['operator', 'advisor']),
  content: z.string(),
});
export type NoteAccountConsultTurn = z.infer<typeof NoteAccountConsultTurnSchema>;

/**
 * AI が会話から組み立てる「ブリーフ草案」。`NoteAccountDesignBrief` と同じキーだが全て任意
 * (会話の初期はまだ何も決まっていないため)。`idea` が埋まった時点で設計生成に渡せる。
 */
export const NoteAccountConsultBriefDraftSchema = z.object({
  idea: z.string().max(2000).optional(),
  goal: z.string().max(1000).optional(),
  target_reader_hint: z.string().max(500).optional(),
  monetization_hint: z.string().max(500).optional(),
  constraints: z.string().max(1000).optional(),
  persona_type: z.enum(['person', 'brand', 'auto']).optional(),
  reference_accounts: z.array(z.string().max(300)).max(10).optional(),
});
export type NoteAccountConsultBriefDraft = z.infer<typeof NoteAccountConsultBriefDraftSchema>;

/** 段階 1: 返答前に Web リサーチが必要かを AI が判断し、検索クエリを出す。 */
export const NoteAccountConsultResearchPlanSchema = z.object({
  /** 実行する検索クエリ (0〜3 件)。空なら検索せず会話のみで返答する。 */
  queries: z.array(z.string().min(1).max(200)).max(3).default([]),
  /** なぜ検索する/しないか (ログ用)。 */
  reason: z.string().max(300).optional(),
});
export type NoteAccountConsultResearchPlan = z.infer<typeof NoteAccountConsultResearchPlanSchema>;

/** リサーチ結果 1 件 (advisor メッセージの `research_json` に保存し、UI で出典として出す)。 */
export const NoteAccountConsultResearchItemSchema = z.object({
  query: z.string(),
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
});
export type NoteAccountConsultResearchItem = z.infer<typeof NoteAccountConsultResearchItemSchema>;

/** 段階 2: AI アドバイザーの返答 (JSON)。 */
export const NoteAccountConsultOutputSchema = z.object({
  /** 運営者への返答 (Markdown 可)。 */
  reply: z.string().min(1).max(8000),
  /** 会話全体を反映した最新のブリーフ草案 (毎回フル置換)。 */
  brief_draft: NoteAccountConsultBriefDraftSchema.default({}),
  /** 草案が設計生成に渡せる水準に達したか (idea/読者/収益方針が固まった)。 */
  ready_to_design: z.boolean().default(false),
  /** 次に運営者へ聞くべき質問 (0〜3 件)。UI でクリック送信のショートカットにする。 */
  suggested_questions: z.array(z.string().max(200)).max(3).default([]),
});
export type NoteAccountConsultOutput = z.infer<typeof NoteAccountConsultOutputSchema>;

/**
 * ブリーフ草案 → `NoteAccountDesignBrief`。`idea` が無ければ null (まだ設計に渡せない)。
 * 空文字のフィールドは落とす。
 */
export function briefDraftToDesignBrief(
  draft: NoteAccountConsultBriefDraft,
): NoteAccountDesignBrief | null {
  const idea = draft.idea?.trim();
  if (!idea) return null;
  const pick = (v: string | undefined): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  const refs = (draft.reference_accounts ?? []).map((r) => r.trim()).filter((r) => r.length > 0);
  return NoteAccountDesignBriefSchema.parse({
    idea,
    ...(pick(draft.goal) ? { goal: pick(draft.goal) } : {}),
    ...(pick(draft.target_reader_hint) ? { target_reader_hint: pick(draft.target_reader_hint) } : {}),
    ...(pick(draft.monetization_hint) ? { monetization_hint: pick(draft.monetization_hint) } : {}),
    ...(pick(draft.constraints) ? { constraints: pick(draft.constraints) } : {}),
    persona_type: draft.persona_type ?? 'auto',
    ...(refs.length > 0 ? { reference_accounts: refs.slice(0, 10) } : {}),
  });
}

// ---------------------------------------------------------------------------
// F-ANP-05 — note プロフィール素材の生成 (role='anp.strategist' を流用)
//
// 運営者要望 (2026-09-21)「アカウント詳細ページで、アイコン、カバー画像を生成して DL できるように
// して。自己紹介文も生成してコピーできるようにして」への対応。設計案 (F-ANP-01) を経ずに作った
// アカウントでも、台帳情報 (表示名/ニッチ/想定読者/トーン) から bio と画像プロンプトを作る。
// ---------------------------------------------------------------------------

/** note の自己紹介 (プロフィール文) は 140 字上限。 */
export const NOTE_BIO_MAX_CHARS = 140;

export const NoteAccountProfileTargetSchema = z.enum(['bio', 'visuals', 'editorial', 'promotion']);
export type NoteAccountProfileTarget = z.infer<typeof NoteAccountProfileTargetSchema>;

/** 生成の入力 (worker が note_accounts + 採用済み設計案から組み立てる)。 */
export const NoteAccountProfileInputSchema = z.object({
  display_name: z.string().min(1).max(100),
  handle: z.string().max(32).optional(),
  niche: z.string().min(1).max(500),
  target_reader: z.string().max(500).optional(),
  tone: z.string().max(300).optional(),
  concept: z.string().max(1000).optional(),
  character_sheet: z.string().max(3000).optional(),
  content_pillars: z.array(z.string().max(200)).max(10).optional(),
  persona_type: z.enum(['person', 'brand']).optional(),
  /** 既存の自己紹介文 (あれば「これを改善する」指示になる)。 */
  existing_bio: z.string().max(1000).optional(),
  /** 運営者からの追加指示 (例: もっとカジュアルに / 顔出しなし)。 */
  instruction: z.string().max(1000).optional(),
  /**
   * F-ANP-06: 添付された参考画像 (ビジョン入力)。`data` は base64 (プレフィックス無し) または URL、
   * `mimeType` は image/*。worker が R2 から読んで縮小したものを渡す。
   */
  reference_images: z
    .array(z.object({ data: z.string().min(1), mimeType: z.string().min(1) }))
    .max(4)
    .optional(),
});
export type NoteAccountProfileInput = z.infer<typeof NoteAccountProfileInputSchema>;

/** AI 出力。bio は 140 字以内を指示するが、超過は呼出側で切らず UI に文字数を出して運営者が調整する。 */
export const NoteAccountProfileOutputSchema = z.object({
  bio: z.string().min(1).max(600),
  bio_alternatives: z.array(z.string().min(1).max(600)).max(3).default([]),
  avatar_prompt: z.string().min(1).max(3000),
  header_prompt: z.string().min(1).max(3000),
  persona_type: z.enum(['person', 'brand']),
});
export type NoteAccountProfileOutput = z.infer<typeof NoteAccountProfileOutputSchema>;

/**
 * F-ANP-07 — 記事の方針・トンマナの AI 生成 (targets=['editorial'])。
 * 想定読者・トーン・方針本文を `note_accounts` に保存し、記事パイプライン全体に効かせる。
 */
/**
 * F-ANP-07b (2026-09-22): 記事の方針を 5 区分に分けて扱う (運営者要望「『主なテーマ』『記事のフォーマット』
 * 『文末表現/禁止事項』『CTA』『その他』にテキストボックス自体分けた方が読みやすい」)。
 * DB (`note_accounts.editorial_policy`) とプロンプト注入は従来どおり 1 本のテキストで、
 * `composeEditorialPolicy` が「【見出し】」付きで連結し、`parseEditorialPolicy` が UI 用に分割する。
 */
export const EDITORIAL_SECTION_KEYS = ['themes', 'format', 'style_rules', 'cta', 'quality', 'seo', 'other'] as const;
export type EditorialSectionKey = (typeof EDITORIAL_SECTION_KEYS)[number];

export const EDITORIAL_SECTION_HEADINGS: Record<EditorialSectionKey, string> = {
  themes: '主なテーマ',
  format: '記事のフォーマット',
  style_rules: '文末表現・禁止事項',
  cta: 'CTA',
  quality: '品質判定項目',
  seo: 'SEO対策',
  other: 'その他',
};

export const NoteEditorialSectionsSchema = z.object({
  themes: z.string().max(1500).default(''),
  format: z.string().max(1500).default(''),
  style_rules: z.string().max(1500).default(''),
  cta: z.string().max(800).default(''),
  /**
   * F-ANP-42: note 内 SEO の方針 (運営者要望 2026-09-24「記事の方針のところに SEO 対策という
   * 項目もつけましょうか」)。狙うキーワード領域・よく使うハッシュタグ・避ける語などを書くと
   * `anp.seo` がタイトル/リード/タグを決めるときの制約として使う。
   */
  seo: z.string().max(1500).default(''),
  /** 品質判定 (anp.judge) が減点基準として使う項目 (運営者要望 2026-09-22「品質判定項目も設けましょうか」)。 */
  quality: z.string().max(1500).default(''),
  other: z.string().max(2000).default(''),
});
export type NoteEditorialSections = z.infer<typeof NoteEditorialSectionsSchema>;

export function emptyEditorialSections(): NoteEditorialSections {
  return { themes: '', format: '', style_rules: '', cta: '', quality: '', seo: '', other: '' };
}

/** 各区分 → 1 本のテキスト (空の区分は出さない)。全て空なら ''。 */
export function composeEditorialPolicy(sections: Partial<NoteEditorialSections>): string {
  const parts: string[] = [];
  for (const key of EDITORIAL_SECTION_KEYS) {
    const body = (sections[key] ?? '').trim();
    if (body.length === 0) continue;
    parts.push(`【${EDITORIAL_SECTION_HEADINGS[key]}】`, body);
  }
  return parts.join('\n');
}

const HEADING_TO_KEY: Record<string, EditorialSectionKey> = Object.fromEntries(
  (Object.entries(EDITORIAL_SECTION_HEADINGS) as Array<[EditorialSectionKey, string]>).map(([k, h]) => [h, k]),
) as Record<string, EditorialSectionKey>;

/** 見出しの無い旧テキスト (箇条書きの「・【ラベル】…」) を、ラベルのキーワードで区分に振り分ける。 */
export function classifyEditorialLine(line: string): EditorialSectionKey {
  const m = /^[・\-*]?\s*[【\[]([^】\]]+)[】\]]/.exec(line.trim());
  const label = m ? m[1]! : line.slice(0, 24);
  if (/SEO|検索|キーワード|ハッシュタグ|タグ/i.test(label)) return 'seo';
  if (/品質|減点|判定|チェック|審査/.test(label)) return 'quality';
  if (/CTA|導線|フォロー|次に読む/i.test(label)) return 'cta';
  if (/語尾|人称|禁止|表現|文末|口調|呼びかけ|NG/.test(label)) return 'style_rules';
  if (/型|構成|フォーマット|長さ|見出し|冒頭|段落|有料記事の設計|設計/.test(label)) return 'format';
  if (/テーマ|書くこと|書かない|扱う|範囲|柱|ジャンル/.test(label)) return 'themes';
  return 'other';
}

/**
 * 1 本のテキスト → 5 区分。「【主なテーマ】」等の見出しがあればそれで分割、無ければ行単位でキーワード分類する
 * (旧形式の AI 生成テキストもそれなりに収まる)。
 */
export function parseEditorialPolicy(text: string | null | undefined): NoteEditorialSections {
  const out = emptyEditorialSections();
  const src = (text ?? '').replace(/\r\n?/g, '\n').trim();
  if (src.length === 0) return out;
  const lines = src.split('\n');
  const hasHeadings = lines.some((l) => HEADING_TO_KEY[l.trim().replace(/^【|】$/g, '')] !== undefined && /^【.+】$/.test(l.trim()));
  if (hasHeadings) {
    let current: EditorialSectionKey = 'other';
    const buckets: Record<EditorialSectionKey, string[]> = { themes: [], format: [], style_rules: [], cta: [], quality: [], seo: [], other: [] };
    for (const raw of lines) {
      const t = raw.trim();
      const heading = /^【(.+)】$/.exec(t);
      if (heading && HEADING_TO_KEY[heading[1]!] !== undefined) {
        current = HEADING_TO_KEY[heading[1]!]!;
        continue;
      }
      buckets[current].push(raw);
    }
    for (const key of EDITORIAL_SECTION_KEYS) out[key] = buckets[key].join('\n').trim();
    return out;
  }
  // 旧形式: 「・【ラベル】本文」の箇条書き、または見出し無しの自由文。行を継続行ごとに束ねてから分類する。
  const chunks: string[] = [];
  for (const raw of lines) {
    const t = raw.trimEnd();
    if (t.trim().length === 0) continue;
    if (/^[・\-*]/.test(t.trim()) || chunks.length === 0) chunks.push(t);
    else chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n${t}`;
  }
  const buckets: Record<EditorialSectionKey, string[]> = { themes: [], format: [], style_rules: [], cta: [], quality: [], seo: [], other: [] };
  for (const c of chunks) buckets[classifyEditorialLine(c)].push(c);
  for (const key of EDITORIAL_SECTION_KEYS) out[key] = buckets[key].join('\n').trim();
  return out;
}

export const NoteAccountEditorialOutputSchema = z.object({
  target_reader: z.string().min(1).max(300),
  tone: z.string().min(1).max(200),
  /** F-ANP-07b: 5 区分。worker が `composeEditorialPolicy` で 1 本のテキストにして保存する。 */
  sections: NoteEditorialSectionsSchema,
  /** 旧出力との互換 (sections が無い応答用)。 */
  editorial_policy: z.string().max(EDITORIAL_POLICY_MAX).optional(),
  rationale: z.string().max(1000).optional(),
});
export type NoteAccountEditorialOutput = z.infer<typeof NoteAccountEditorialOutputSchema>;

// ---------------------------------------------------------------------------
// F-ANP-42 — note 内 SEO + クリックされるタイトル (role='anp.seo')
// ---------------------------------------------------------------------------
// 運営者要望「note内でのSEO対策も自動でやってくれるように」+「タイトルとアイキャッチが
// 読者の目を引くようなものではないからもっと工夫して」。完成原稿を読んでから
// タイトル/リード/キーワード/ハッシュタグ/見出し/アイキャッチのコピーを一括で決める。
//
// note の仕様上の制約 (2026-09-24 実地確認):
//  - meta description は編集できない → **リード文が検索結果の説明になる** ので、
//    リードは「結論 + 読むと何が分かるか」を 120 字前後で書く。
//  - 公開設定画面で設定できるのは **ハッシュタグ (最大 5 個程度を推奨)**。
//  - 記事 URL は note 側が採番する (スラッグ最適化は不可)。

export const NoteSeoHeadingFixSchema = z.object({
  /** 本文中の既存見出し行 (## / ### を除いたテキスト)。完全一致で置換する。 */
  original: z.string().min(1).max(120),
  /** キーワードを含んだ改善後の見出し。 */
  improved: z.string().min(1).max(120),
});
export type NoteSeoHeadingFix = z.infer<typeof NoteSeoHeadingFixSchema>;

export const NoteSeoInputSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().optional(),
  account: z.object({
    niche: z.string().min(1),
    target_reader: z.string().nullable().optional(),
    tone: z.string().nullable().optional(),
    editorial_policy: z.string().nullable().optional(),
  }),
  current_title: z.string().min(1),
  hook: z.string().nullable().optional(),
  body_md: z.string().min(1),
  /** 同じアカウントの公開済み記事 (内部リンク候補)。 */
  published: z
    .array(z.object({ title: z.string().min(1), note_url: z.string().min(1) }))
    .max(20)
    .default([]),
  /** 直近で使ったタイトル (言い回しの重複を避ける)。 */
  recent_titles: z.array(z.string()).max(20).default([]),
});
export type NoteSeoInput = z.infer<typeof NoteSeoInputSchema>;

export const NoteSeoOutputSchema = z.object({
  /** 30 文字前後・主要キーワードを前半に置いたクリックされるタイトル。 */
  title: z.string().min(6).max(70),
  /** 代替案 (UI 表示用)。 */
  title_alternatives: z.array(z.string().min(6).max(70)).max(4).default([]),
  /** 検索結果の説明文になるリード (結論先出し・120 字前後)。 */
  lead: z.string().min(20).max(400),
  /** 主要キーワード (ロングテール 3 語以上を推奨)。 */
  primary_keyword: z.string().min(2).max(60),
  /** 共起語を含む関連キーワード。 */
  keywords: z.array(z.string().min(1).max(60)).min(1).max(10),
  /** note の公開設定で付けるハッシュタグ (# 無しで返す)。 */
  hashtags: z.array(z.string().min(1).max(30)).min(1).max(5),
  /** 見出しの改善案 (キーワードを含める / 見出しだけで要点が分かる)。 */
  headings: z.array(NoteSeoHeadingFixSchema).max(12).default([]),
  /** アイキャッチに焼き込むキャッチコピー (全角 8〜20 字)。 */
  eyecatch_copy: z.string().min(2).max(24),
  /** キャッチの下に置く 1 行 (任意・全角 24 字まで)。 */
  eyecatch_sub: z.string().max(30).nullable().optional(),
  /** 画像の代替テキスト。 */
  eyecatch_alt: z.string().max(120).nullable().optional(),
  /** 内部リンクとして本文末に添える公開済み記事の URL。 */
  internal_links: z.array(z.string().min(1)).max(3).default([]),
  /** なぜこのタイトルなのか (UI 表示・改善の記録用)。 */
  rationale: z.string().max(600).optional(),
});
export type NoteSeoOutput = z.infer<typeof NoteSeoOutputSchema>;

/**
 * anp.seo の見出し改善を本文に適用する。`## 見出し` / `### 見出し` 行だけを
 * 完全一致で置換するので、本文の他の部分は一切壊さない (LLM に本文を書き直させない)。
 */
export function applyHeadingFixes(bodyMd: string, fixes: readonly NoteSeoHeadingFix[]): string {
  if (fixes.length === 0) return bodyMd;
  const map = new Map<string, string>();
  for (const f of fixes) {
    const from = f.original.trim();
    const to = f.improved.trim();
    if (from.length > 0 && to.length > 0 && from !== to) map.set(from, to);
  }
  if (map.size === 0) return bodyMd;
  return bodyMd
    .split('\n')
    .map((line) => {
      const m = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
      if (!m) return line;
      const replaced = map.get(m[2]!.trim());
      return replaced ? `${m[1]!} ${replaced}` : line;
    })
    .join('\n');
}

/**
 * 本文末に「関連記事」ブロックを付ける (note は URL を貼ると自動で記事カードになる)。
 * 既に同じ URL がある場合は追加しない。
 */
export function appendInternalLinks(bodyMd: string, urls: readonly string[]): string {
  const fresh = urls.map((u) => u.trim()).filter((u) => u.length > 0 && !bodyMd.includes(u));
  if (fresh.length === 0) return bodyMd;
  const block = ['', '## あわせて読みたい', ...fresh].join('\n');
  return `${bodyMd.replace(/\s+$/, '')}\n${block}\n`;
}
