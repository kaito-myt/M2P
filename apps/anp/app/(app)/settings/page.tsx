/**
 * S-ANP-03 — 設定 (docs/11-anp-design.md §5.4 / §7 Phase2)。
 *
 * 運営者要望 (2026-09-21)「設定はモデル設定と運用設定ができるようにして。On/Off は基本トグルで。
 * モデル設定 → AI ロールごとのモデル割り当て設定 & 新たな AI ロール作成。運用設定 → 現状設定してるような
 * 自動公開とかの設定 (1 日のテーマ作成数は各アカウントで設定するようにしましょう)」。
 * タブは URL `?tab=models|ops` で切り替える (既定: models)。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';
import { buildAnpRoleRows, groupCatalog, MODEL_PROVIDERS, type CatalogOption, type CustomRoleMeta, type ModelProvider } from '@/lib/model-settings-core';

import { CustomRolesPanel } from './custom-roles-panel';
import { ModelsPanel } from './models-panel';
import { SettingsForm } from './settings-form';

const TABS = ['models', 'ops'] as const;
type SettingsTab = (typeof TABS)[number];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab: SettingsTab = sp.tab === 'ops' ? 'ops' : 'models';
  const m = messages.settings;

  const [settings, promptRoles, assignments, catalogRows, customRoleRows] = await Promise.all([
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
    prisma.anpAgentRole.findMany({ orderBy: { created_at: 'asc' }, select: { role: true, label: true, description: true, created_at: true } }),
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
  const customRoles: CustomRoleMeta[] = customRoleRows.map((r) => ({ role: r.role, label: r.label, description: r.description, created_at: r.created_at.toISOString() }));
  const modelRows = buildAnpRoleRows(promptRoles, assignments, catalog, customRoles);
  const groupedCatalog = groupCatalog(catalog);

  return (
    <div className="mx-auto flex max-w-5xl flex-col">
      <header>
        <h1 className="text-sub-heading font-medium text-charcoal">{m.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{m.pageDescription}</p>
      </header>

      <nav aria-label={m.tabsLabel} className="mt-space-relaxed flex flex-wrap gap-2" data-testid="settings-tabs">
        {TABS.map((t) => {
          const active = t === tab;
          return (
            <Link
              key={t}
              href={t === 'models' ? '/settings' : `/settings?tab=${t}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-pill border px-3 py-1 text-button-sm no-underline transition-colors',
                active ? 'border-charcoal bg-charcoal text-white' : 'border-border-warm bg-white text-charcoal-82 hover:bg-charcoal-04',
              )}
            >
              {m.tabs[t]}
            </Link>
          );
        })}
      </nav>

      {tab === 'models' ? (
        <>
          <section className="mt-space-relaxed">
            <h2 className="text-section-title text-charcoal">{m.models.title}</h2>
            <p className="mt-1 text-body text-muted">{m.models.description}</p>
            <div className="mt-space-snug">
              <ModelsPanel rows={modelRows} catalog={groupedCatalog} />
            </div>
          </section>
          <section className="mt-space-loose">
            <h2 className="text-section-title text-charcoal">{m.customRoles.title}</h2>
            <p className="mt-1 text-body text-muted">{m.customRoles.description}</p>
            <div className="mt-space-snug">
              <CustomRolesPanel roles={customRoles} catalog={groupedCatalog} />
            </div>
          </section>
        </>
      ) : (
        <section className="mt-space-relaxed">
          <h2 className="text-section-title text-charcoal">{m.ops.title}</h2>
          <p className="mt-1 text-body text-muted">{m.ops.description}</p>
          <div className="mt-space-snug">
            <SettingsForm
              initial={{
                anp_auto_publish_enabled: settings?.anp_auto_publish_enabled ?? false,
                anp_publish_dry_run: settings?.anp_publish_dry_run ?? true,
                anp_auto_theme_enabled: settings?.anp_auto_theme_enabled ?? false,
                anp_themes_per_day: settings?.anp_themes_per_day ?? 1,
                anp_autopass_enabled: settings?.anp_autopass_enabled ?? false,
              }}
            />
          </div>
        </section>
      )}
    </div>
  );
}

// Railway のビルド時に静的プリレンダリングで DB (postgres.railway.internal) へ接続しようとして失敗する
// (2026-09-15 以降の ANP デプロイが全て FAILED だった原因)。DB を読むページは常に動的レンダリングにする。
export const dynamic = 'force-dynamic';
