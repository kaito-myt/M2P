/**
 * プラットフォームのツールレジストリ（ツール選択画面のデータソース）。
 *
 * ツールを増やすときはこの配列に1件足すだけ。URL は環境変数で差し替え可能
 * （本番は各ツールの独自ドメイン、ローカルは各 dev サーバのポート）。
 * SSO のため各ツールはポータルと同一 cookie ドメイン配下に置くのが前提。
 */
export type ToolStatus = 'live' | 'coming_soon';

export interface PlatformTool {
  /** 一意 ID（安定・URL slug 兼用）。 */
  id: string;
  /** 表示名。 */
  name: string;
  /** 一言説明。 */
  description: string;
  /** 遷移先 URL（未設定なら coming_soon 扱い）。 */
  url?: string;
  /** Lucide アイコン名（components 側で解決。logo 未設定時のフォールバック）。 */
  icon: string;
  /** サービスロゴ画像パス（public 配下。設定時はアイコンより優先）。 */
  logo?: string;
  status: ToolStatus;
  /** アクセントカラー（トークンのCSS変数 or 任意色）。 */
  accent?: string;
}

/**
 * A2P (Amazon KDP 書籍) / ANP (note 記事) / 3DP (3Dモデル商材)。
 * A2P の URL は `NEXT_PUBLIC_TOOL_A2P_URL`（未設定時はローカル dev の 3001）。
 * ANP / 3DP は URL 未設定なら「準備中」で点灯しない（壊れたリンクを出さない）。
 */
export function getTools(): PlatformTool[] {
  const a2pUrl = process.env.NEXT_PUBLIC_TOOL_A2P_URL || 'http://localhost:3001';
  const anpUrl = process.env.NEXT_PUBLIC_TOOL_ANP_URL; // 未設定=準備中
  const tdpUrl = process.env.NEXT_PUBLIC_TOOL_3DP_URL; // 未設定=準備中 (本番予定 3dp.m2p.tools)
  return [
    {
      id: 'a2p',
      name: 'A2P',
      description: 'Amazon KDP 書籍の企画〜執筆〜出版〜販促を AI エージェントで自動化。',
      url: a2pUrl,
      icon: 'BookOpen',
      logo: '/tools/a2p.png',
      status: 'live',
      accent: '#f59e0b',
    },
    {
      id: 'anp',
      name: 'ANP',
      description:
        'note 記事の企画〜執筆〜出版〜販促〜収益化をテーマ別マルチアカウントで自動化（Automated Note Publishing）。',
      url: anpUrl,
      icon: 'FileText',
      logo: '/tools/anp.png',
      status: anpUrl ? 'live' : 'coming_soon',
      accent: '#2dd4bf',
    },
    {
      id: '3dp',
      name: '3DP',
      description:
        '3Dモデル商材（ワールド用プロップ・家具・小物／アクセサリ／改変用テクスチャ）を企画・生成・検査して BOOTH で販売（3D Products）。',
      url: tdpUrl,
      icon: 'Box',
      logo: '/tools/3dp.png',
      status: tdpUrl ? 'live' : 'coming_soon',
      accent: '#22c3d6',
    },
  ];
}
