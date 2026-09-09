/**
 * ホーム（S-002）の表示専用パーツ群 — エディトリアル/機能美リフレッシュ。
 *
 * 設計方針:
 *  - 枠線付きカードで囲まない。区切りは「余白＋極細のヘアライン＋文字サイズの強弱」。
 *  - 装飾バッジ/過剰なシャドウ・アニメを使わない。状態は文字色と極小の点で表す。
 *  - 配色はモノトーン基調＋アクセント1色（vermilion=accent）だけ。
 *  データ取得は page.tsx(RSC) が行い、ここは整形済みの値を描画するのみ。
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/* ============================================================
 * レイアウト・プリミティブ
 * ========================================================== */

/** セクション見出し（極細のヘアライン＋トラッキングを効かせた小さなラベル＋右リンク）。 */
export function EditorialSection({
  label,
  meta,
  action,
  children,
  className,
}: {
  label: string;
  /** ラベル右に添える小さな補足（件数など）。 */
  meta?: string;
  /** 右端リンク。 */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-t border-border-warm pt-5', className)}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="flex items-baseline gap-2.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {label}
          </span>
          {meta && <span className="text-caption tabular-nums text-charcoal-40">{meta}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 「〜へ」リンク（下線ではなく矢印。アクセントは控えめに）。 */
export function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="shrink-0 text-caption text-muted no-underline transition-colors hover:text-accent focus-visible:outline-none focus-visible:text-accent"
    >
      {label}
      <span aria-hidden="true" className="ml-1">
        →
      </span>
    </Link>
  );
}

/* ============================================================
 * AI会社の稼働状況
 * ========================================================== */

export interface AutonomyProps {
  pills: { label: string; on: boolean }[];
  anyOn: boolean;
  onLabel: string;
  offLabel: string;
  objectiveTitle?: string;
  objectivePeriod?: string;
  objectiveLabel: string;
  noObjective: string;
  tasksSummary: string;
}

/** AI会社の稼働状況（トグルの現在値＋現在の方針）。バッジではなく文字の濃淡で表す。 */
export function AutonomyStatus({
  pills,
  anyOn,
  onLabel,
  offLabel,
  objectiveTitle,
  objectivePeriod,
  objectiveLabel,
  noObjective,
  tasksSummary,
}: AutonomyProps) {
  const onCount = pills.filter((p) => p.on).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2.5">
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', anyOn ? 'bg-accent' : 'bg-charcoal-40')}
          aria-hidden="true"
        />
        <span className="text-button-sm font-medium text-foreground">
          {anyOn ? onLabel : offLabel}
        </span>
        <span className="text-caption tabular-nums text-charcoal-40">
          {onCount}/{pills.length}
        </span>
        <span className="text-caption text-muted">・{tasksSummary}</span>
      </div>

      {/* トグル群：ON=インク、OFF=淡色。中黒区切りで一行に。 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
        {pills.map((p) => (
          <span key={p.label} className={p.on ? 'text-charcoal-82' : 'text-charcoal-40 line-through'}>
            {p.label}
          </span>
        ))}
      </div>

      {/* 現在の方針 */}
      <div className="border-l-2 border-border-warm pl-3">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{objectiveLabel}</div>
        {objectiveTitle ? (
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-button-sm text-foreground">{objectiveTitle}</span>
            {objectivePeriod && <span className="text-caption text-charcoal-40">{objectivePeriod}</span>}
          </div>
        ) : (
          <div className="mt-1 text-caption text-muted">{noObjective}</div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * 進行中ジョブ
 * ========================================================== */

export interface RunningJob {
  id: string;
  stageLabel: string;
  bookTitle: string;
}

export function RunningJobsList({
  jobs,
  moreLabel,
  emptyMessage,
}: {
  jobs: RunningJob[];
  moreLabel?: string;
  emptyMessage: string;
}) {
  if (jobs.length === 0) {
    return <p className="text-caption text-charcoal-40">{emptyMessage}</p>;
  }
  return (
    <ul className="flex flex-col">
      {jobs.map((j) => (
        <li key={j.id} className="flex items-baseline gap-3 border-b border-border-warm/60 py-1.5 last:border-0">
          <span className="w-20 shrink-0 truncate text-caption tracking-[0.04em] text-accent">
            {j.stageLabel}
          </span>
          <span className="min-w-0 flex-1 truncate text-button-sm text-foreground">{j.bookTitle}</span>
        </li>
      ))}
      {moreLabel && <li className="pt-1.5 text-caption text-charcoal-40">{moreLabel}</li>}
    </ul>
  );
}

/* ============================================================
 * パイプライン内訳
 * ========================================================== */

export interface PipelineCount {
  label: string;
  n: number;
  tone?: 'default' | 'danger';
}

export function PipelineBreakdown({
  counts,
  emptyMessage,
}: {
  counts: PipelineCount[];
  emptyMessage: string;
}) {
  const visible = counts.filter((c) => c.n > 0);
  if (visible.length === 0) {
    return <p className="text-caption text-charcoal-40">{emptyMessage}</p>;
  }
  return (
    <ul className="flex flex-col">
      {visible.map((c) => (
        <li key={c.label} className="flex items-baseline justify-between gap-3 py-1">
          <span className={cn('text-button-sm', c.tone === 'danger' ? 'text-accent' : 'text-charcoal-82')}>
            {c.label}
          </span>
          <span
            className={cn(
              'font-display text-[15px] tabular-nums',
              c.tone === 'danger' ? 'text-accent' : 'text-foreground',
            )}
          >
            {c.n}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ============================================================
 * 最近の本
 * ========================================================== */

export interface RecentBook {
  id: string;
  title: string;
  statusLabel: string;
  tone: 'done' | 'progress' | 'danger';
  updatedLabel: string;
}

export function RecentBooksList({
  books,
  emptyMessage,
}: {
  books: RecentBook[];
  emptyMessage: string;
}) {
  if (books.length === 0) {
    return <p className="text-caption text-charcoal-40">{emptyMessage}</p>;
  }
  return (
    <ul className="flex flex-col">
      {books.map((b) => (
        <li
          key={b.id}
          className="flex items-baseline gap-3 border-b border-border-warm/60 py-2 last:border-0"
        >
          <Link
            href={`/books/${b.id}`}
            className="min-w-0 flex-1 truncate text-button-sm text-foreground no-underline hover:text-accent"
          >
            {b.title}
          </Link>
          <span
            className={cn(
              'shrink-0 text-caption tracking-[0.02em]',
              b.tone === 'done'
                ? 'text-charcoal-40'
                : b.tone === 'danger'
                  ? 'text-accent'
                  : 'text-charcoal-82',
            )}
          >
            {b.statusLabel}
          </span>
          <span className="hidden w-16 shrink-0 text-right text-caption tabular-nums text-charcoal-40 sm:inline">
            {b.updatedLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ============================================================
 * 販促・成長
 * ========================================================== */

export interface GrowthChannel {
  channel: string;
  label: string;
  followers: number | null;
  posts: number | null;
}

export function GrowthStrip({
  channels,
  followersLabel,
  postsLabel,
  emptyMessage,
}: {
  channels: GrowthChannel[];
  followersLabel: string;
  postsLabel: string;
  emptyMessage: string;
}) {
  const hasAny = channels.some((c) => c.followers != null || c.posts != null);
  if (!hasAny) {
    return <p className="text-caption text-charcoal-40">{emptyMessage}</p>;
  }
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-4">
      {channels.map((c) => (
        <div key={c.channel} className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted">{c.label}</span>
          <span className="font-display text-2xl tabular-nums text-foreground">
            {c.followers != null ? c.followers.toLocaleString('ja-JP') : '—'}
          </span>
          <span className="text-caption text-charcoal-40">
            {followersLabel}
            {c.posts != null ? ` ・ ${postsLabel} ${c.posts.toLocaleString('ja-JP')}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
 * 未読アラート
 * ========================================================== */

export interface AlertItem {
  id: string;
  label: string;
  severity: 'info' | 'warning' | 'critical';
  timeLabel: string;
}

export function AlertMiniList({
  alerts,
  emptyMessage,
}: {
  alerts: AlertItem[];
  emptyMessage: string;
}) {
  if (alerts.length === 0) {
    return <p className="text-caption text-charcoal-40">{emptyMessage}</p>;
  }
  return (
    <ul className="flex flex-col">
      {alerts.map((a) => (
        <li key={a.id} className="flex items-baseline gap-3 py-1.5">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full',
              a.severity === 'critical'
                ? 'bg-accent'
                : a.severity === 'warning'
                  ? 'bg-charcoal-82'
                  : 'bg-charcoal-40',
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-button-sm text-charcoal-82">{a.label}</span>
          <span className="hidden shrink-0 text-caption tabular-nums text-charcoal-40 sm:inline">
            {a.timeLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ============================================================
 * 要対応リスト（運営者の「私がやること」）
 * ========================================================== */

export interface ActionRow {
  label: string;
  count: number;
  href: string;
  must?: number;
}

/**
 * 要対応。カードのグリッドではなく一覧。0件は淡く、1件以上はインク＋アクセントの件数で強調。
 * すべて0なら落ち着いた一文だけを出す。
 */
export function ActionList({
  rows,
  allClearLabel,
}: {
  rows: ActionRow[];
  allClearLabel: string;
}) {
  const pending = rows.filter((r) => r.count > 0 || (r.must ?? 0) > 0);
  const clear = rows.filter((r) => !(r.count > 0 || (r.must ?? 0) > 0));

  return (
    <div className="flex flex-col">
      {pending.length === 0 ? (
        <p className="text-button-sm text-charcoal-82">{allClearLabel}</p>
      ) : (
        <ul className="flex flex-col">
          {pending.map((r) => (
            <li key={r.label} className="border-b border-border-warm/60 last:border-0">
              <Link
                href={r.href}
                data-testid="dashboard-action-card"
                className="group flex items-baseline gap-4 py-2.5 no-underline"
              >
                <span className="min-w-0 flex-1 text-button-sm text-foreground group-hover:text-accent">
                  {r.label}
                  {(r.must ?? 0) > 0 && (
                    <span className="ml-2 text-caption text-accent">要修正 {r.must}</span>
                  )}
                </span>
                <span className="font-display text-xl leading-none tabular-nums text-accent">
                  {r.count}
                </span>
                <span
                  aria-hidden="true"
                  className="w-3 text-caption text-charcoal-40 group-hover:text-accent"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* 対応不要のカテゴリは畳んで淡く一行に */}
      {clear.length > 0 && (
        <p className="mt-3 text-caption text-charcoal-40">
          対応不要：{clear.map((r) => r.label).join('・')}
        </p>
      )}
    </div>
  );
}
