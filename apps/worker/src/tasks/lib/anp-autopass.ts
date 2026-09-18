/**
 * ANP 日次自動運転 (F-ANP-17, docs/11-anp-design.md §7) の設定読み取りヘルパー。
 *
 * `apps/anp` の `/settings` が書き込む AppSettings(singleton) の `anp_auto_theme_enabled` /
 * `anp_themes_per_day` / `anp_theme_cron` / `anp_autopass_enabled` を `note.theme.auto` から
 * 共通で読み出す。A2P の `pipeline-autopass.ts` (readPipelineAutopass) と同型。
 *
 * AppSettings 行が無い場合やクエリ失敗時は全項目 OFF の安全な既定値を返す
 * (誤って自動化が有効になり人手承認ゲートが飛ばされることを防ぐ)。
 */
import { createLogger } from '@a2p/contracts/logger';

export interface AnpAutopassFlags {
  anp_auto_theme_enabled: boolean;
  anp_themes_per_day: number;
  anp_theme_cron: string;
  anp_autopass_enabled: boolean;
}

export interface AnpAutopassPrisma {
  appSettings: {
    findUnique: (args: {
      where: { id: string };
      select: Record<string, boolean>;
    }) => Promise<Record<string, unknown> | null>;
  };
}

const SAFE_DEFAULT: AnpAutopassFlags = {
  anp_auto_theme_enabled: false,
  anp_themes_per_day: 1,
  anp_theme_cron: '0 23 * * *',
  anp_autopass_enabled: false,
};

const log = createLogger('worker.anp-autopass');

/**
 * AppSettings(singleton) から anp_auto_theme_enabled 等を読み出す。
 * 行が無い場合・クエリが失敗した場合は SAFE_DEFAULT (全 OFF) を返す。
 */
export async function readAnpAutopass(prisma: AnpAutopassPrisma): Promise<AnpAutopassFlags> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: {
        anp_auto_theme_enabled: true,
        anp_themes_per_day: true,
        anp_theme_cron: true,
        anp_autopass_enabled: true,
      },
    });
    if (!row) return { ...SAFE_DEFAULT };
    return {
      anp_auto_theme_enabled: Boolean(row.anp_auto_theme_enabled),
      anp_themes_per_day:
        typeof row.anp_themes_per_day === 'number' && row.anp_themes_per_day > 0
          ? row.anp_themes_per_day
          : SAFE_DEFAULT.anp_themes_per_day,
      anp_theme_cron:
        typeof row.anp_theme_cron === 'string' && row.anp_theme_cron.trim().length > 0
          ? row.anp_theme_cron
          : SAFE_DEFAULT.anp_theme_cron,
      anp_autopass_enabled: Boolean(row.anp_autopass_enabled),
    };
  } catch (err) {
    log.warn({ err }, 'failed to read AppSettings for ANP autopass — using safe defaults (all off)');
    return { ...SAFE_DEFAULT };
  }
}
