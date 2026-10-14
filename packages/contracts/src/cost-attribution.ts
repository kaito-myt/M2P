/**
 * コスト帰属 (`token_usage.tool`) — M2P プラットフォーム上のどのツールの活動として
 * AI コストを数えるかの単一定義。docs/05 §3.3 / docs/10 §5。
 *
 * **なぜ必要か**: role 名だけでは帰属が決まらない。`growth_scout` / `promo_strategist` /
 * `content_creator` のような**共有エージェント**は A2P (書籍の販促) と ANP (note) の
 * 両方から呼ばれるし、cron から呼ばれる場合は `job_id` も無いので後から辿れない。
 * 2026-10-13 時点で実際に:
 *   - A2P のコストダッシュボードは `token_usage` を**無条件に全件**集計していて
 *     note の生成コスト (10 月 ¥7,063) まで A2P の数字に乗っていた。
 *   - ANP のコストダッシュボードは `role LIKE 'anp.%'` で絞っていたため、
 *     `note.engage` が呼ぶ `growth_scout` (10 月 ¥1,809) を**取りこぼしていた**。
 * 両方が逆方向にずれていた。記録時に帰属を 1 列持たせて解消する。
 *
 * **原則**: 各ツールの画面はそのツールの活動だけを集計する。全ツール合算は
 * プラットフォーム (`apps/portal`) 側で見る。
 */

/** コストを帰属させる単位。`m2p` = どのツールにも属さないプラットフォーム活動。 */
export type ToolKey = 'a2p' | 'anp' | '3dp' | 'm2p';

export const TOOL_KEYS: readonly ToolKey[] = ['a2p', 'anp', '3dp', 'm2p'] as const;

/** 既定値。未知の role は書籍側として数える (A2P が第1ツールで既存行の大半がこれ)。 */
export const DEFAULT_TOOL: ToolKey = 'a2p';

export const TOOL_LABEL: Record<ToolKey, string> = {
  a2p: 'A2P (Amazon KDP 出版)',
  anp: 'ANP (note 記事出版)',
  '3dp': '3DP (3Dモデル商材)',
  m2p: 'M2P (プラットフォーム共通)',
};

/** 短いラベル (バッジ/表の見出し用)。 */
export const TOOL_SHORT_LABEL: Record<ToolKey, string> = {
  a2p: 'A2P',
  anp: 'ANP',
  '3dp': '3DP',
  m2p: '共通',
};

/**
 * どのツールにも属さない「経営・プラットフォーム」ロール。
 *
 * 判定の線引きは**入力の広さ**で引く:
 *  - 1 冊の本を見る役 (`metadata_worker`/`sales_analyst`/`market_analyst`) → `a2p`
 *  - 1 本の note 記事/アカウントを見る役 (`anp.*`) → `anp`
 *  - 事業全体を見る役 → `m2p`
 *
 * AI 組織 (docs/06 の CEO + 本部長) は A2P と ANP の**両方**を見て意思決定する
 * (実例: 2026-10-08 に AI CEO が `anp_auto_theme_enabled=false` を決めている)。
 * 片方のツールに付けると「自分のツールで起きた活動」ではなくなるので `m2p` にする。
 * 全社のコスト分析 (`cost_optimizer`/`cost_accountant`) と、note を含む全チャンネルを
 * 横断で見る役 (`promo_analyst`/`account_strategist`) も同じ理由で `m2p`。
 */
const PLATFORM_ROLES: ReadonlySet<string> = new Set([
  'ceo',
  'ceo_chat',
  'prompt_editor',
  'editorial_mgr',
  'publish_mgr',
  'analytics_mgr',
  'promo_mgr',
  'ops_mgr',
  'finance_mgr',
  'cost_optimizer',
  'cost_accountant',
  'promo_analyst',
  'account_strategist',
]);

/**
 * role から既定の帰属を決める。
 *
 * - `anp.*` → ANP (名前空間で分離済み)
 * - 経営/プラットフォームロール → M2P
 * - それ以外 → A2P (書籍パイプラインと書籍の販促)
 *
 * 共有エージェントは**この既定では決まらない**ので、呼出側 (worker タスク) が
 * `LoggingContext.tool` を明示して上書きする。下の注記を参照。
 */
export function defaultToolForRole(role: string): ToolKey {
  if (role.startsWith('anp.')) return 'anp';
  // 3DP も role 名前空間で分離する (`tdp.*`)。docs/12 §7。
  if (role.startsWith('tdp.')) return '3dp';
  if (PLATFORM_ROLES.has(role)) return 'm2p';
  return DEFAULT_TOOL;
}

/**
 * **channel から帰属は決められない** (ここに `toolForChannel` を置こうとして気付いた罠)。
 *
 * `PROMOTION_CHANNELS` には `note` が含まれる — A2P は「書籍を紹介する note 記事」を
 * 販促チャンネルとして持っている (`promotion_posts.channel='note'`)。一方 ANP は
 * 自前の `note_accounts`/`note_articles` で note に記事を出す。つまり `channel='note'`
 * は A2P の販促にも ANP 本体にもなりうる。実際 `growth_scout` は
 * `note.engage` (ANP) と `promotion.growth.todo` (A2P の販促ToDo) の両方から
 * `channel='note'` で呼ばれている。
 *
 * したがって共有エージェントの帰属は**呼出側 (worker タスク) が明示する**。
 * エージェントは `deps.tool` を受け取って `LoggingContext.tool` に流すだけにする。
 */

/** 文字列が ToolKey か。DB から読んだ値の検証用。 */
export function isToolKey(v: unknown): v is ToolKey {
  return typeof v === 'string' && (TOOL_KEYS as readonly string[]).includes(v);
}

/** DB の値を ToolKey に正規化する (未知値/NULL は既定へ)。 */
export function normalizeToolKey(v: unknown): ToolKey {
  return isToolKey(v) ? v : DEFAULT_TOOL;
}

// ---------------------------------------------------------------------------
// 集計期間 (JST)
// ---------------------------------------------------------------------------

/**
 * JST の「前月初 / 当月初 / 翌月初」を UTC の `Date` で返す。
 *
 * `token_usage.created_at` は **timestamp WITHOUT time zone に UTC を入れている**ので、
 * JST の月初は UTC 月初 -9h。各ツールのコスト画面はこれを使って月を切る
 * (以前は A2P が UTC 月境界、ANP が JST 月境界で、同じ月の数字が画面で食い違っていた)。
 *
 * SQL 側で日付ラベルを作るときは `created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo'`。
 * **`AT TIME ZONE 'Asia/Tokyo'` を 1 回だけ掛けるのは誤り** — timestamp without time zone に
 * 対しては「この値は東京時刻」という解釈になり 9 時間**引かれる**
 * (2026-10-13 実測: 保存値 10-12 22:31 → 10-12 13:31。正しくは 10-13 07:31)。
 */
export function jstMonthRange(now: Date): { prevMonthStart: Date; monthStart: Date; nextMonthStart: Date } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const at = (year: number, month: number) => new Date(Date.UTC(year, month, 1) - 9 * 3600_000);
  return { prevMonthStart: at(y, m - 1), monthStart: at(y, m), nextMonthStart: at(y, m + 1) };
}

/** JST の 'YYYY-MM'。 */
export function jstYearMonth(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}
