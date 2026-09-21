/**
 * S-ANP-03 — パイプライン設定 (docs/11-anp-design.md §7 Phase2): note 自動公開のマスタスイッチ。
 */
import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { buildAnpRoleRows, groupCatalog, MODEL_PROVIDERS, type CatalogOption, type ModelProvider } from '@/lib/model-settings-core';

import { ModelsPanel } from './models-panel';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const [settings, promptRoles, assignments, catalogRows] = await Promise.all([
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: {
        anp_auto_publish_enabled: true,
        anp_publish_dry_run: true,
        anp_auto_theme_enabled: true,
        anp_themes_per_day: true,
        anp_autopass_enabled: true,
      },
    }),
    prisma.prompt.findMany({ where: { status: 'active', role: { startsWith: 'anp.' } }, distinct: ['role'], select: { role: true } }),
    prisma.modelAssignment.findMany({
      where: { status: 'active', role: { startsWith: 'anp.' } },
      select: { role: true, genre: true, provider: true, model: true, activated_at: true },
    }),
    prisma.modelCatalog.findMany({
      where: { is_current: true },
      select: { provider: true, model: true, available: true, input_price_per_mtok_usd: true, output_price_per_mtok_usd: true },
    }),
  ]);
  const catalog: CatalogOption[] = catalogRows
    .filter((c): c is typeof c & { provider: ModelProvider } => (MODEL_PROVIDERS as readonly string[]).includes(c.provider))
    .map((c) => ({
      provider: c.provider,
      model: c.model,
      available: c.available,
      input_price_per_mtok_usd: Number(c.input_price_per_mtok_usd),
      output_price_per_mtok_usd: Number(c.output_price_per_mtok_usd),
    }));
  const modelRows = buildAnpRoleRows(promptRoles, assignments, catalog);
  const groupedCatalog = groupCatalog(catalog);

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <header>
        <h1 className="text-sub-heading font-medium text-charcoal">{messages.settings.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{messages.settings.pageDescription}</p>
      </header>

      <section className="mt-space-relaxed">
        <SettingsForm
          initial={{
            anp_auto_publish_enabled: settings?.anp_auto_publish_enabled ?? false,
            anp_publish_dry_run: settings?.anp_publish_dry_run ?? true,
            anp_auto_theme_enabled: settings?.anp_auto_theme_enabled ?? false,
            anp_themes_per_day: settings?.anp_themes_per_day ?? 1,
            anp_autopass_enabled: settings?.anp_autopass_enabled ?? false,
          }}
        />
      </section>

      {/* AI モデル設定 (anp.* 役割)。運営者判断 2026-09-21: モデル割当はツールごとに置く (M2P には持たせない)。 */}
      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{messages.settings.models.title}</h2>
        <p className="mt-1 text-body text-muted">{messages.settings.models.description}</p>
        <div className="mt-space-snug">
          <ModelsPanel rows={modelRows} catalog={groupedCatalog} />
        </div>
      </section>
    </div>
  );
}

// Railway のビルド時に静的プリレンダリングで DB (postgres.railway.internal) へ接続しようとして失敗する
// (2026-09-15 以降の ANP デプロイが全て FAILED だった原因)。DB を読むページは常に動的レンダリングにする。
export const dynamic = 'force-dynamic';
