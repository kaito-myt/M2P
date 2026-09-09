/**
 * S-027 設定画面 (T-07-09).
 *
 * RSC page: fetches AppSettings singleton + ApiCredential statuses.
 * Serializes for client via settings-view.ts, then renders SettingsPageShell.
 *
 * Scope: NotificationSettings / ThresholdSettings / AutoApprovalToggle /
 *        DataRetention / KdpSubmissionSettings (disabled) / ApiCredentialsList.
 */
import type { Metadata } from 'next';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { serializeSettingsPage } from '@/lib/settings-view';
import { SettingsPageShell } from '@/components/settings/settings-page-shell';
import { PageHeading } from '@/components/common/page-heading';

export const metadata: Metadata = {
  title: `${messages.settings.pageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

const m = messages.settings;

const DEFAULT_SETTINGS = {
  notification_email_to: '',
  notification_kinds_json: {},
  cost_per_book_warn_jpy: 500,
  cost_per_book_pause_jpy: 750,
  monthly_cost_yellow_jpy: 40000,
  monthly_cost_orange_jpy: 47500,
  monthly_cost_red_jpy: 50000,
  catalog_price_change_threshold: 0.10,
  prompt_auto_approval_enabled: false,
  prompt_auto_approval_rollback_h: 24,
  sales_auto_fetch_enabled: false,
  sales_auto_fetch_cron: '0 17 * * *',
  kdp_auto_submit_enabled: false,
  kdp_submit_dry_run: false,
  kdp_creation_paused_until: null,
  kdp_submit_timeout_minutes: 10,
  kdp_submit_retry_count: 2,
  job_log_retention_days: 90,
  r2_archive_threshold_days: 365,
  ai_disclosure_text: '',
};

export default async function SettingsPage() {
  const [rawSettings, rawCredentials] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: 'singleton' } }),
    prisma.apiCredential.findMany({
      select: {
        provider: true,
        key_mask: true,
        last_tested_at: true,
        last_test_result_json: true,
      },
    }),
  ]);

  const settings = rawSettings ?? DEFAULT_SETTINGS;

  const pageData = serializeSettingsPage(settings as Parameters<typeof serializeSettingsPage>[0], rawCredentials);

  return (
    <div className="flex flex-col gap-space-loose" data-testid="settings-page">
      <PageHeading eyebrow={m.breadcrumbOps} title={m.pageTitle} description={m.pageSubtitle} />

      <SettingsPageShell data={pageData} />
    </div>
  );
}
