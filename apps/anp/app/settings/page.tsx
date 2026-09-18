/**
 * S-ANP-03 — パイプライン設定 (docs/11-anp-design.md §7 Phase2): note 自動公開のマスタスイッチ。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';

import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: {
      anp_auto_publish_enabled: true,
      anp_publish_dry_run: true,
      anp_auto_theme_enabled: true,
      anp_themes_per_day: true,
      anp_autopass_enabled: true,
    },
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-space-relaxed py-space-loose">
      <Link href="/accounts" className="text-caption text-muted no-underline hover:underline">
        {messages.accountDetail.back}
      </Link>

      <header className="mt-space-snug">
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
    </div>
  );
}

// Railway のビルド時に静的プリレンダリングで DB (postgres.railway.internal) へ接続しようとして失敗する
// (2026-09-15 以降の ANP デプロイが全て FAILED だった原因)。DB を読むページは常に動的レンダリングにする。
export const dynamic = 'force-dynamic';
