/**
 * M2P ポータル「設定」(docs/10-platform-portal.md §設定) — プラットフォーム共通の
 * AI モデル割当と各サービサー API キーの管理。DB 非依存の純関数/定数をここに置き、
 * Server Action (`app/actions/settings.ts`) と RSC/テストから共用する。
 *
 * 背景 (運営者要望 2026-09-21): 「M2P の設定の方で AI モデル設定ができるようにして。各サービサーの
 * API キー情報を管理できるようにして」。A2P / ANP は同じ DB (`api_credentials` / `model_assignments` /
 * `model_catalog`) を共有しているため、ポータルで一元管理すれば両ツールに即時反映される
 * (API キーは各プロセスの 60 秒 LRU キャッシュ経由、モデル割当は呼出ごとに DB 参照)。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// API キー (サービサー)
// ---------------------------------------------------------------------------

export const API_PROVIDERS = ['anthropic', 'openai', 'google', 'tavily'] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

export const apiProviderSchema = z.enum(API_PROVIDERS);

export interface ApiProviderMeta {
  id: ApiProvider;
  label: string;
  description: string;
  /** キー発行ページ。 */
  consoleUrl: string;
  /** どのツール/用途で使われるか (表示用)。 */
  usedFor: string;
  /** 入力例 (先頭の形式)。 */
  keyHint: string;
}

export const API_PROVIDER_META: Record<ApiProvider, ApiProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: '企画・執筆・校閲・判定など主要な LLM 呼出。',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    usedFor: 'A2P 書籍パイプライン / ANP 記事パイプライン / 組織エージェント / SNS 生成',
    keyHint: 'sk-ant-…',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: '画像生成 (gpt-image) と一部の LLM 呼出 (SEO 最適化等)。',
    consoleUrl: 'https://platform.openai.com/api-keys',
    usedFor: '表紙・アイコン・カバー・IG カルーセル画像 / seo_optimizer',
    keyHint: 'sk-…',
  },
  google: {
    id: 'google',
    label: 'Google (Gemini / Veo)',
    description: 'Gemini モデルと Veo 動画生成。',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    usedFor: 'モデル割当で google を選んだ役割 / TikTok・IG リール動画のフック生成',
    keyHint: 'AIza…',
  },
  tavily: {
    id: 'tavily',
    label: 'Tavily (Web 検索)',
    description: 'テーマ生成・AI 相談の事前リサーチ用 Web 検索。未設定なら検索無しで動く。',
    consoleUrl: 'https://app.tavily.com/home',
    usedFor: 'A2P テーマ生成の市場リサーチ / ANP アカウント戦略の AI 相談',
    keyHint: 'tvly-…',
  },
};

export const setApiKeyInput = z.object({
  provider: apiProviderSchema,
  key: z.string().trim().min(8).max(2048),
});
export const providerOnlyInput = z.object({ provider: apiProviderSchema });

/** 疎通テスト用エンドポイント (apps/web `api-credentials.ts` と同じ。公式 SDK を持ち込まない)。 */
export function providerTestRequest(provider: Exclude<ApiProvider, 'tavily'>, key: string): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case 'anthropic':
      return { url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } };
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${key}` } };
    case 'google':
      return { url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, headers: {} };
  }
}

export interface ApiKeyTestResult {
  ok: boolean;
  message: string;
  http_status?: number;
  latency_ms?: number;
}

// ---------------------------------------------------------------------------
// AI モデル割当 (役割 → provider/model)
// ---------------------------------------------------------------------------

export const MODEL_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const setModelAssignmentInput = z.object({
  role: z.string().trim().min(1).max(64),
  provider: z.enum(MODEL_PROVIDERS),
  model: z.string().trim().min(1).max(128),
});

export type RoleGroup = 'a2p_book' | 'a2p_promo' | 'org' | 'anp' | 'other';

export const ROLE_GROUP_LABEL: Record<RoleGroup, string> = {
  a2p_book: 'A2P — 書籍パイプライン',
  a2p_promo: 'A2P — 販促 (SNS / 動画)',
  org: '組織エージェント (CEO・本部長)',
  anp: 'ANP — note 記事 / アカウント設計',
  other: 'その他',
};

/** 役割の日本語ラベル。未知の役割は生の role 名を出す。 */
export const ROLE_LABEL: Record<string, string> = {
  marketer: 'マーケター (テーマ企画)',
  writer: 'ライター (本文執筆)',
  writer_outline: 'ライター (目次)',
  editor: '編集者 (校閲)',
  judge: '品質判定',
  thumbnail_text: '表紙コピー',
  thumbnail_image: '表紙画像プロンプト',
  cover_text_check: '表紙文字チェック',
  cover_art_direction: '表紙アートディレクション',
  optimizer: 'プロンプト最適化',
  prompt_editor: 'プロンプト改訂 (CEO 指示)',
  seo_optimizer: 'SEO 最適化 (KDP メタデータ)',
  readings: 'ふりがな',
  book_cover: 'ブログ書影同定',
  outline_review: '目次レビュー',
  sns_strategist: 'SNS アカウント設計',
  content_creator: 'SNS 育成投稿',
  content_optimizer: 'SNS 投稿の日次見直し',
  promoter: 'SNS 販促投稿',
  promo_strategist: '販促プレイブック',
  promo_analyst: '販促分析',
  growth_scout: 'グロース偵察',
  cost_optimizer: 'コスト改善提案',
  tiktok_scenario: 'TikTok シナリオ',
  tiktok_creator: 'TikTok 台本',
  tiktok_editor: 'TikTok 編集',
  tiktok_proofreader: 'TikTok 校正',
  tiktok_marketer: 'TikTok マーケ',
  ceo: 'CEO (方針立案)',
  ceo_chat: 'CEO 対話',
  'anp.theme': 'note テーマ企画',
  'anp.outline': 'note 構成',
  'anp.writer': 'note 執筆',
  'anp.editor': 'note 校閲',
  'anp.judge': 'note 品質判定',
  'anp.promo': 'note 記事の SNS 告知',
  'anp.strategist': 'note アカウント設計 / プロフィール素材',
  'anp.consultant': 'note アカウント戦略の AI 相談',
};

const PROMO_ROLES = new Set([
  'sns_strategist', 'content_creator', 'content_optimizer', 'promoter', 'promo_strategist', 'promo_analyst',
  'growth_scout', 'tiktok_scenario', 'tiktok_creator', 'tiktok_editor', 'tiktok_proofreader', 'tiktok_marketer',
]);
const ORG_ROLES = new Set(['ceo', 'ceo_chat', 'prompt_editor', 'cost_optimizer']);
const BOOK_ROLES = new Set([
  'marketer', 'writer', 'writer_outline', 'editor', 'judge', 'thumbnail_text', 'thumbnail_image', 'cover_text_check',
  'cover_art_direction', 'optimizer', 'seo_optimizer', 'readings', 'book_cover', 'outline_review',
]);

export function roleGroup(role: string): RoleGroup {
  if (role.startsWith('anp.')) return 'anp';
  if (PROMO_ROLES.has(role)) return 'a2p_promo';
  if (ORG_ROLES.has(role)) return 'org';
  if (BOOK_ROLES.has(role)) return 'a2p_book';
  if (role.startsWith('manager') || role.startsWith('org')) return 'org';
  return 'other';
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export interface CatalogOption {
  provider: ModelProvider;
  model: string;
  /** null = 未検証, false = 呼べない (選択肢から外す), true = 呼べる。 */
  available: boolean | null;
  input_price_per_mtok_usd: number;
  output_price_per_mtok_usd: number;
}

export interface RoleAssignmentRow {
  role: string;
  label: string;
  group: RoleGroup;
  /** genre=null (全ジャンル既定) の active 割当。 */
  provider: ModelProvider | null;
  model: string | null;
  activated_at: string | null;
  /** ジャンル別の上書き件数 (A2P 側で管理)。 */
  genre_override_count: number;
  /** 割当先モデルがカタログで available=false (=呼べない) と判定されているか。 */
  unavailable: boolean;
}

export interface RoleSource {
  role: string;
}

export interface ActiveAssignmentSource {
  role: string;
  genre: string | null;
  provider: string;
  model: string;
  activated_at: Date;
}

/**
 * プロンプト/割当に登場する役割の和集合から、役割ごとの行を組み立てる (グループ→ラベル順)。
 */
export function buildRoleRows(
  roles: RoleSource[],
  assignments: ActiveAssignmentSource[],
  catalog: CatalogOption[],
): RoleAssignmentRow[] {
  const unavailable = new Set(catalog.filter((c) => c.available === false).map((c) => `${c.provider}/${c.model}`));
  const names = new Set<string>();
  for (const r of roles) names.add(r.role);
  for (const a of assignments) names.add(a.role);

  const rows: RoleAssignmentRow[] = [];
  for (const role of names) {
    const def = assignments.find((a) => a.role === role && a.genre === null) ?? null;
    const overrides = assignments.filter((a) => a.role === role && a.genre !== null).length;
    rows.push({
      role,
      label: roleLabel(role),
      group: roleGroup(role),
      provider: def && (MODEL_PROVIDERS as readonly string[]).includes(def.provider) ? (def.provider as ModelProvider) : null,
      model: def?.model ?? null,
      activated_at: def ? def.activated_at.toISOString() : null,
      genre_override_count: overrides,
      unavailable: def ? unavailable.has(`${def.provider}/${def.model}`) : false,
    });
  }
  const groupOrder: RoleGroup[] = ['a2p_book', 'a2p_promo', 'org', 'anp', 'other'];
  rows.sort((a, b) => {
    const g = groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group);
    if (g !== 0) return g;
    return a.label.localeCompare(b.label, 'ja');
  });
  return rows;
}

export function groupCatalog(catalog: CatalogOption[]): Record<ModelProvider, CatalogOption[]> {
  const out: Record<ModelProvider, CatalogOption[]> = { anthropic: [], openai: [], google: [] };
  for (const c of catalog) {
    if (c.available === false) continue;
    out[c.provider].push(c);
  }
  for (const p of MODEL_PROVIDERS) out[p].sort((a, b) => a.model.localeCompare(b.model));
  return out;
}
