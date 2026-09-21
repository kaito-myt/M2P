'use client';

/**
 * S-027 SettingsPageShell (T-07-09).
 *
 * Client container that composes all settings section forms.
 * Receives serialized data from RSC page.
 */
import type { SettingsPageData } from '@/lib/settings-view';

import { NotificationSettingsForm } from './notification-settings-form';
import { ThresholdSettingsForm } from './threshold-settings-form';
import { AutoApprovalToggle } from './auto-approval-toggle';
import { SalesAutoFetchSettings } from './sales-auto-fetch-settings';
import { PromotionAutomationSettings } from './promotion-automation-settings';
import { DataRetentionForm } from './data-retention-form';
import { KdpSubmissionSettingsForm } from './kdp-submission-settings-form';
import { ApiCredentialsPortalNotice } from './api-credentials-portal-notice';

interface SettingsPageShellProps {
  data: SettingsPageData;
}

export function SettingsPageShell({ data }: SettingsPageShellProps) {
  return (
    <div className="flex flex-col gap-space-loose" data-testid="settings-page-shell">
      <NotificationSettingsForm
        initialEmail={data.notification_email_to}
        initialKinds={data.notification_kinds}
      />

      <ThresholdSettingsForm
        initialData={{
          cost_per_book_warn_jpy: data.cost_per_book_warn_jpy,
          cost_per_book_pause_jpy: data.cost_per_book_pause_jpy,
          monthly_cost_yellow_jpy: data.monthly_cost_yellow_jpy,
          monthly_cost_orange_jpy: data.monthly_cost_orange_jpy,
          monthly_cost_red_jpy: data.monthly_cost_red_jpy,
          catalog_price_change_threshold: data.catalog_price_change_threshold,
        }}
      />

      <AutoApprovalToggle
        initialEnabled={data.prompt_auto_approval_enabled}
        initialRollbackHours={data.prompt_auto_approval_rollback_h}
      />

      <SalesAutoFetchSettings
        initialEnabled={data.sales_auto_fetch_enabled}
        initialCron={data.sales_auto_fetch_cron}
      />

      <PromotionAutomationSettings
        initialOnPublish={data.promo_auto_on_publish_enabled}
        initialAutoPost={data.promo_auto_post_enabled}
      />

      <DataRetentionForm
        initialData={{
          job_log_retention_days: data.job_log_retention_days,
          r2_archive_threshold_days: data.r2_archive_threshold_days,
          ai_disclosure_text: data.ai_disclosure_text,
        }}
      />

      <KdpSubmissionSettingsForm
        initialData={{
          kdp_auto_submit_enabled: data.kdp_auto_submit_enabled,
          kdp_submit_dry_run: data.kdp_submit_dry_run,
          kdp_submit_timeout_minutes: data.kdp_submit_timeout_minutes,
          kdp_submit_retry_count: data.kdp_submit_retry_count,
          kdp_creation_paused_until: data.kdp_creation_paused_until,
        }}
      />

      {/* API キーの設定/テスト/削除は M2P ポータルに集約 (2026-09-21)。A2P は状態表示のみ。 */}
      <ApiCredentialsPortalNotice credentials={data.apiCredentials} />
    </div>
  );
}
