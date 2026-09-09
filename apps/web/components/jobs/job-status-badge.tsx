'use client';

/**
 * JobStatusBadge — Job ステータスを色・テキストで表示 (S-026, T-09-02).
 *
 * 色のみに依存しない: aria-label で文字情報を補完 (アクセシビリティ).
 * 仕様根拠: docs/04 S-026 / ui-ux-pro-max (color-not-only)
 */
import { messages } from '@/lib/messages';

const m = messages.jobs.status;

type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/**
 * Monotone-ink + semantic-token palette (docs/04 §6.5). No Tailwind default
 * blue/green/red/amber/gray — status reads through the same restrained tones
 * the rest of the app uses: a small dot carries the hue, the label stays ink.
 */
function statusDot(status: string): string {
  switch (status as JobStatus) {
    case 'done':
      return 'bg-success';
    case 'running':
      return 'bg-accent';
    case 'failed':
      return 'bg-destructive';
    case 'cancelled':
      return 'bg-charcoal-40';
    case 'queued':
    default:
      return 'bg-warning';
  }
}

function labelTone(status: string): string {
  switch (status as JobStatus) {
    case 'failed':
      return 'text-destructive';
    case 'cancelled':
      return 'text-charcoal-40';
    default:
      return 'text-charcoal-82';
  }
}

interface JobStatusBadgeProps {
  status: string;
  className?: string;
}

export function JobStatusBadge({ status, className = '' }: JobStatusBadgeProps) {
  const label = m[status as keyof typeof m] ?? status;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-caption tabular-nums ${labelTone(status)} ${className}`}
      aria-label={`ステータス: ${label}`}
      data-status={status}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(status)}`} />
      {label}
    </span>
  );
}
