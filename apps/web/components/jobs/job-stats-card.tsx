/**
 * S-025 JobStatsCard (T-09-01, F-045).
 *
 * 3 枚の統計カード: 直近 24h 成功率 / 平均実行時間 / 失敗件数。
 *
 * 仕様根拠: docs/04 S-025 / SP-09 T-09-01
 */
import { messages } from '@/lib/messages';
import { formatAvgDuration, type JobStats } from '@/lib/jobs-view';
import { StatRow } from '@/components/common/stat-row';

interface JobStatsCardProps {
  stats: JobStats;
}

const m = messages.jobs.stats;

export function JobStatsCards({ stats }: JobStatsCardProps) {
  return (
    <StatRow
      testId="job-stats-cards"
      columns={3}
      items={[
        {
          label: m.successRateLabel,
          value: `${stats.success_rate_pct}${m.successRateSuffix}`,
          testId: 'job-stat-success-rate',
        },
        {
          label: m.avgDurationLabel,
          value: formatAvgDuration(stats.avg_duration_ms),
          testId: 'job-stat-avg-duration',
        },
        {
          label: m.failedCountLabel,
          value: `${stats.failed_count.toLocaleString('ja-JP')}${m.failedCountSuffix}`,
          testId: 'job-stat-failed-count',
        },
      ]}
    />
  );
}
