/**
 * ANP の AI モデル設定 (docs/11-anp-design.md §5.4) — `anp.*` 役割の既定モデル (genre=null) を切り替える。
 *
 * 運営者判断 (2026-09-21): 「AI モデル設定については各ツールごとで AI のロールが異なるから M2P 側に持たせなくて
 * よい」→ A2P は `/settings/models` (ジャンル別マトリクス)、ANP は `/settings` の「AI モデル」節で `anp.*` 役割
 * だけを扱う。テーブル (`model_assignments` / `model_catalog`) は A2P と共有。
 * DB 非依存の純関数をここに置き、Server Action (`app/actions/model-settings.ts`) と RSC/テストから共用する。
 */
import { z } from 'zod';

export const ANP_ROLE_PREFIX = 'anp.';

export const MODEL_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const setAnpModelAssignmentInput = z.object({
  role: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((r) => r.startsWith(ANP_ROLE_PREFIX), 'ANP の役割 (anp.*) のみ変更できます'),
  provider: z.enum(MODEL_PROVIDERS),
  model: z.string().trim().min(1).max(128),
});

/** 役割の日本語ラベルと説明 (seed-anp.ts の役割一覧に対応)。未知の役割は生の名前を出す。 */
export const ANP_ROLE_META: Record<string, { label: string; description: string }> = {
  'anp.theme': { label: 'テーマ企画', description: '日次テーマ生成 (note.theme.generate / note.theme.auto)。創作寄り = Claude Opus 推奨' },
  'anp.outline': { label: '構成', description: '記事の見出し構成' },
  'anp.writer': { label: '執筆', description: '本文執筆 (長文)。日本語の文体 = Claude Sonnet 推奨' },
  'anp.editor': { label: '校閲', description: '本文の推敲・整形。整える工程は GPT-5 で十分 (安価)' },
  'anp.judge': { label: '品質判定', description: 'フック/可読性/有料転換/検索流入の採点。GPT は採点が甘い実測があるため Claude Sonnet 推奨' },
  'anp.promo': { label: 'SNS 告知', description: '公開記事の X / Instagram 告知文' },
  'anp.strategist': { label: 'アカウント設計・プロフィール素材', description: '設計案 (表示名/bio/柱/収益方針) と自己紹介文・画像プロンプト' },
  'anp.consultant': { label: 'アカウント戦略の AI 相談', description: '/accounts/design/consult のチャット相手 (Tavily リサーチ込み)' },
};

export function anpRoleLabel(role: string): string {
  return ANP_ROLE_META[role]?.label ?? role;
}

// ---------------------------------------------------------------------------
// カスタム AI ロール (運営者要望 2026-09-21「モデル設定 → AI ロールごとのモデル割り当て設定 & 新たな AI ロール作成」)
// `anp_agent_roles` に表示名/説明、`prompts` にシステムプロンプト (role='anp.<slug>', genre=null, version=1)、
// `model_assignments` に割当を作る。既存の役割と同じ読み方 (loadActivePrompt / loadModelAssignment) で呼べる。
// ---------------------------------------------------------------------------

export const ANP_CUSTOM_ROLE_SLUG_PATTERN = /^[a-z][a-z0-9_]{1,30}$/;

export const createAnpRoleInput = z.object({
  /** 'anp.' を除いた識別子 (英小文字/数字/_、2〜31 文字)。 */
  slug: z.string().trim().regex(ANP_CUSTOM_ROLE_SLUG_PATTERN, 'ロール ID は英小文字で始まり、英小文字・数字・_ のみ 2〜31 文字で入力してください'),
  label: z.string().trim().min(1, '表示名を入力してください').max(60),
  description: z.string().trim().max(300).optional(),
  system_prompt: z.string().trim().min(20, 'システムプロンプトは 20 文字以上で入力してください').max(20000),
  provider: z.enum(MODEL_PROVIDERS),
  model: z.string().trim().min(1).max(128),
});
export type CreateAnpRoleInput = z.infer<typeof createAnpRoleInput>;

export const deleteAnpRoleInput = z.object({
  role: z
    .string()
    .trim()
    .refine((r) => r.startsWith(ANP_ROLE_PREFIX) && !(r in ANP_ROLE_META), '組み込みの役割は削除できません'),
});

export interface CustomRoleMeta {
  role: string;
  label: string;
  description: string | null;
  created_at: string;
}

export function customRoleFromSlug(slug: string): string {
  return `${ANP_ROLE_PREFIX}${slug}`;
}

/** 組み込み (`ANP_ROLE_META`) と衝突しないか。 */
export function isBuiltinAnpRole(role: string): boolean {
  return role in ANP_ROLE_META;
}

export interface CatalogOption {
  provider: ModelProvider;
  model: string;
  /** null = 未検証, false = 呼べない (選択肢から外す), true = 呼べる。 */
  available: boolean | null;
  input_price_per_mtok_usd: number;
  output_price_per_mtok_usd: number;
}

export interface AnpRoleAssignmentRow {
  role: string;
  label: string;
  description: string;
  provider: ModelProvider | null;
  model: string | null;
  activated_at: string | null;
  /** 割当先モデルがカタログで available=false と判定されているか。 */
  unavailable: boolean;
  /** 運営者が作成したカスタムロールか (削除可)。 */
  custom: boolean;
}

export interface ActiveAssignmentSource {
  role: string;
  genre: string | null;
  provider: string;
  model: string;
  activated_at: Date;
}

/** `anp.*` 役割 (プロンプト ∪ 割当) の行を組み立てる。seed の定義順 → 未知は末尾。 */
export function buildAnpRoleRows(
  promptRoles: Array<{ role: string }>,
  assignments: ActiveAssignmentSource[],
  catalog: CatalogOption[],
  customRoles: ReadonlyArray<Pick<CustomRoleMeta, 'role' | 'label' | 'description'>> = [],
): AnpRoleAssignmentRow[] {
  const unavailable = new Set(catalog.filter((c) => c.available === false).map((c) => `${c.provider}/${c.model}`));
  const customByRole = new Map(customRoles.map((c) => [c.role, c]));
  const names = new Set<string>();
  for (const r of promptRoles) if (r.role.startsWith(ANP_ROLE_PREFIX)) names.add(r.role);
  for (const a of assignments) if (a.role.startsWith(ANP_ROLE_PREFIX)) names.add(a.role);
  for (const c of customRoles) if (c.role.startsWith(ANP_ROLE_PREFIX)) names.add(c.role);

  const order = Object.keys(ANP_ROLE_META);
  return [...names]
    .sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
    })
    .map((role) => {
      const def = assignments.find((a) => a.role === role && a.genre === null) ?? null;
      const provider = def && (MODEL_PROVIDERS as readonly string[]).includes(def.provider) ? (def.provider as ModelProvider) : null;
      const custom = customByRole.get(role);
      return {
        role,
        label: custom?.label ?? anpRoleLabel(role),
        description: custom?.description ?? ANP_ROLE_META[role]?.description ?? '',
        provider,
        model: def?.model ?? null,
        activated_at: def ? def.activated_at.toISOString() : null,
        unavailable: def ? unavailable.has(`${def.provider}/${def.model}`) : false,
        custom: custom !== undefined,
      };
    });
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
