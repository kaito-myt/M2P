/**
 * S-002 ホーム（経営ミッションコントロール） — docs/04 §4 S-002。
 *
 * 運営者が「① 儲かっているか ② AI会社は動いているか ③ 自分がやることは何か」を
 * 一目で把握するための実データ接続ダッシュボード。
 *
 * 構成:
 *   A. 事業サマリ（当月純利益ヒーロー＋売上/コスト/出版数/品質）
 *   B. AI会社の稼働状況（自律運用トグル＋現在の方針）／進行中ジョブ
 *   C. 要対応（人手が必要な項目を実カウント＋実リンクで）
 *   D. 最近の本／パイプライン内訳／未読アラート
 *   E. 販促・成長（SNSフォロワー）
 */
import type { Metadata } from 'next';
import { prisma } from '@a2p/db';
import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';
import {
  EditorialSection,
  SectionLink,
  AutonomyStatus,
  RunningJobsList,
  PipelineBreakdown,
  RecentBooksList,
  GrowthStrip,
  AlertMiniList,
  ActionList,
  type RunningJob,
  type RecentBook,
  type AlertItem,
  type ActionRow,
} from '@/components/dashboard/home-sections';
import { getCostMeterData } from '@/lib/cost-meter-core';
import { getCommentCounts } from '@/lib/comment-counts-core';
import { serializeOrgAutomation, ORG_AUTOMATION_DEFAULTS } from '@/lib/org-automation-core';
import { getKindLabel } from '@/lib/alerts-view';
import { formatBookStatus, normalizeBookStatus } from '@/lib/books-view';

export const metadata: Metadata = {
  title: `${messages.dashboard.pageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

const m = messages.dashboard;
const h = messages.dashboard.home;

/** JST の年月文字列 (YYYY-MM) を now からの月オフセットで返す。 */
function ymJst(offsetMonths: number): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + offsetMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 円表示（符号付き）。 */
function jpy(n: number): string {
  return `${n < 0 ? '-¥' : '¥'}${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;
}

/** JST の短い日時ラベル (M/D HH:mm)。 */
function fmtJst(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const hh = String(j.getUTCHours()).padStart(2, '0');
  const mm = String(j.getUTCMinutes()).padStart(2, '0');
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${hh}:${mm}`;
}

/** JST の日付ラベル（YYYY.MM.DD（曜））。マストヘッドの日付欄に使う。 */
function todayJst(): string {
  const j = new Date(Date.now() + 9 * 3600 * 1000);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][j.getUTCDay()];
  const mm = String(j.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(j.getUTCDate()).padStart(2, '0');
  return `${j.getUTCFullYear()}.${mm}.${dd}（${wd}）`;
}

/** マストヘッド下の数値フィギュア（ラベル／セリフ数値／増減）。枠で囲まない。 */
function Figure({
  label,
  value,
  sub,
  note,
  noteDir = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  note?: string;
  noteDir?: 'positive' | 'negative' | 'neutral';
}) {
  const noteColor =
    noteDir === 'negative' ? 'text-accent' : noteDir === 'positive' ? 'text-foreground' : 'text-charcoal-40';
  return (
    <div className="flex min-w-[7rem] flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-display text-[28px] leading-none tabular-nums text-foreground">{value}</span>
        {sub && <span className="text-caption text-charcoal-40">{sub}</span>}
      </span>
      {note && <span className={`text-caption ${noteColor}`}>{note}</span>}
    </div>
  );
}

async function getAvgQualityScore(): Promise<{
  value: string;
  change?: string;
  changeDir?: 'positive' | 'negative' | 'neutral';
}> {
  const now = new Date();
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const [thisMonth, lastMonth] = await Promise.all([
    prisma.evalResult.aggregate({ _avg: { score_total: true }, where: { judged_at: { gte: thisMonthStart } } }),
    prisma.evalResult.aggregate({
      _avg: { score_total: true },
      where: { judged_at: { gte: lastMonthStart, lt: thisMonthStart } },
    }),
  ]);

  const current = thisMonth._avg.score_total;
  const previous = lastMonth._avg.score_total;
  if (current == null) return { value: '—' };

  const currentRounded = Math.round(current * 10) / 10;
  const valueStr = currentRounded.toFixed(1);
  if (previous == null) return { value: valueStr };

  const diff = currentRounded - Math.round(previous * 10) / 10;
  const kpiM = m.kpi;
  if (diff > 0) return { value: valueStr, change: kpiM.qualityScoreChangePositive(diff), changeDir: 'positive' };
  if (diff < 0) return { value: valueStr, change: kpiM.qualityScoreChangeNegative(diff), changeDir: 'negative' };
  return { value: valueStr, change: kpiM.qualityScoreChangeFlat, changeDir: 'neutral' };
}

const IN_PROGRESS_STATUSES = ['queued', 'running', 'editing', 'content_review', 'judging', 'thumbnail', 'exporting'] as const;
const STUCK_STATUSES = ['failed', 'needs_human_review', 'paused_cost'] as const;
const DANGER_STATUSES = new Set(['failed', 'needs_human_review', 'paused_cost', 'cancelled', 'retracted']);

export default async function DashboardPage() {
  const ymNow = ymJst(0);
  const ymPrev = ymJst(-1);

  const [
    quality,
    revenueNow,
    revenuePrev,
    cost,
    publishedCount,
    retractedCount,
    statusGroups,
    runningJobRows,
    runningJobsCount,
    alertsUnread,
    alertRows,
    comments,
    kdpPending,
    reauthPending,
    orgTaskGroups,
    objective,
    automationRow,
    recentRows,
    growthRows,
  ] = await Promise.all([
    getAvgQualityScore(),
    prisma.salesRecord.aggregate({ _sum: { royalty_jpy: true, kenp_read: true }, where: { year_month: ymNow } }),
    prisma.salesRecord.aggregate({ _sum: { royalty_jpy: true }, where: { year_month: ymPrev } }),
    getCostMeterData(prisma),
    prisma.book.count({ where: { publish_status: 'published' } }),
    prisma.book.count({ where: { publish_status: 'retracted' } }),
    prisma.book.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.job.findMany({
      where: { status: 'running' },
      orderBy: { started_at: 'asc' },
      take: 6,
      select: { id: true, kind: true, book: { select: { id: true, title: true } } },
    }),
    prisma.job.count({ where: { status: 'running' } }),
    prisma.alert.count({ where: { read_at: null } }),
    prisma.alert.findMany({
      where: { read_at: null },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { id: true, kind: true, severity: true, created_at: true },
    }),
    getCommentCounts(prisma),
    prisma.book.count({ where: { status: { in: ['done', 'needs_human_review'] }, publish_status: { not: 'published' } } }),
    prisma.kdpAuthRequest.count({ where: { status: 'pending' } }),
    prisma.orgTask.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.orgObjective.findFirst({
      where: { status: 'active' },
      orderBy: { created_at: 'desc' },
      select: { title: true, period_label: true },
    }),
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: {
        org_auto_plan_enabled: true,
        org_plan_cron: true,
        org_auto_execute_enabled: true,
        org_execute_cron: true,
        org_ops_watch_enabled: true,
        org_ops_watch_cron: true,
        org_finance_tick_enabled: true,
        org_finance_tick_cron: true,
        org_kdp_auto_publish_enabled: true,
        org_kdp_screen_cron: true,
        org_auto_approve_tasks: true,
      },
    }),
    prisma.book.findMany({
      orderBy: { updated_at: 'desc' },
      take: 8,
      select: { id: true, title: true, status: true, updated_at: true },
    }),
    Promise.all(
      (['x', 'instagram', 'tiktok'] as const).map((channel) =>
        prisma.promotionGrowthSnapshot
          .findFirst({ where: { channel }, orderBy: { captured_at: 'desc' }, select: { followers: true, posts_count: true } })
          .then((row) => ({ channel, followers: row?.followers ?? null, posts: row?.posts_count ?? null })),
      ),
    ),
  ]);

  // ---- 集計 ----
  const revenueNowJpy = revenueNow._sum.royalty_jpy ?? 0;
  const revenuePrevJpy = revenuePrev._sum.royalty_jpy ?? 0;
  const costNowJpy = cost.monthly_cost_jpy;
  const profit = revenueNowJpy - costNowJpy;
  const profitDir: 'positive' | 'negative' | 'neutral' = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
  const profitLabel = profit > 0 ? h.profitBlack : profit < 0 ? h.profitRed : h.profitEven;
  const momPct = revenuePrevJpy > 0 ? Math.round(((revenueNowJpy - revenuePrevJpy) / revenuePrevJpy) * 100) : null;

  const statusCount: Record<string, number> = {};
  for (const g of statusGroups) statusCount[g.status] = g._count._all;
  const inProgressTotal = IN_PROGRESS_STATUSES.reduce((s, k) => s + (statusCount[k] ?? 0), 0);
  const stuckTotal = STUCK_STATUSES.reduce((s, k) => s + (statusCount[k] ?? 0), 0);

  const orgCount: Record<string, number> = {};
  for (const g of orgTaskGroups) orgCount[g.status] = g._count._all;
  const orgHuman = orgCount['needs_human'] ?? 0;
  const orgOpen =
    (orgCount['proposed'] ?? 0) + (orgCount['approved'] ?? 0) + (orgCount['in_progress'] ?? 0) + (orgCount['blocked'] ?? 0);

  const automation = automationRow ? serializeOrgAutomation(automationRow) : ORG_AUTOMATION_DEFAULTS;
  const autonomyPills = [
    { label: h.autonomy.plan, on: automation.org_auto_plan_enabled },
    { label: h.autonomy.execute, on: automation.org_auto_execute_enabled },
    { label: h.autonomy.opsWatch, on: automation.org_ops_watch_enabled },
    { label: h.autonomy.finance, on: automation.org_finance_tick_enabled },
    { label: h.autonomy.kdp, on: automation.org_kdp_auto_publish_enabled },
    { label: h.autonomy.autoApprove, on: automation.org_auto_approve_tasks },
  ];
  const anyOn = autonomyPills.some((p) => p.on);

  const jobs: RunningJob[] = runningJobRows.map((j) => ({
    id: j.id,
    stageLabel: h.stageLabels[j.kind] ?? j.kind.replace('pipeline.book.', ''),
    bookTitle: j.book?.title ?? '—',
  }));
  const jobsMore = runningJobsCount > jobs.length ? h.jobsMore(runningJobsCount - jobs.length) : undefined;

  const pipelineCounts = [
    ...IN_PROGRESS_STATUSES.map((s) => ({
      label: formatBookStatus(normalizeBookStatus(s)),
      n: statusCount[s] ?? 0,
    })),
    { label: h.pipelineFailed, n: stuckTotal, tone: 'danger' as const },
  ];

  const recentBooks: RecentBook[] = recentRows.map((b) => {
    const norm = normalizeBookStatus(b.status);
    const tone: RecentBook['tone'] = norm === 'done' ? 'done' : DANGER_STATUSES.has(norm) ? 'danger' : 'progress';
    return { id: b.id, title: b.title, statusLabel: formatBookStatus(norm), tone, updatedLabel: fmtJst(b.updated_at) };
  });

  const alerts: AlertItem[] = alertRows.map((a) => ({
    id: a.id,
    label: getKindLabel(a.kind),
    severity: a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info',
    timeLabel: fmtJst(a.created_at),
  }));

  const growthChannels = growthRows.map((g) => ({
    channel: g.channel,
    label: h.channelLabel[g.channel] ?? g.channel,
    followers: g.followers,
    posts: g.posts,
  }));

  const actionRows: ActionRow[] = [
    ...(reauthPending > 0
      ? [{ label: h.actions.reauth, count: reauthPending, href: '/kdp/checklist' }]
      : []),
    { label: h.actions.kdp, count: kdpPending, href: '/kdp/checklist' },
    { label: h.actions.contentReview, count: statusCount['content_review'] ?? 0, href: '/content-review' },
    { label: h.actions.thumbnails, count: statusCount['thumbnail'] ?? 0, href: '/covers' },
    { label: h.actions.comments, count: comments.pending, must: comments.must, href: '/comments' },
    { label: h.actions.orgHuman, count: orgHuman, href: '/org/tasks' },
    { label: h.actions.alerts, count: alertsUnread, href: '/alerts' },
    { label: h.actions.needsReview, count: statusCount['needs_human_review'] ?? 0, href: '/books' },
  ];

  return (
    <div data-testid="dashboard-root" className="mx-auto max-w-5xl">
      {/* マストヘッド — 誌面の題字のように、日付と一緒に細い罫で締める */}
      <header className="flex items-baseline justify-between gap-4 border-b border-charcoal pb-2.5">
        <span className="text-[11px] uppercase tracking-[0.22em] text-muted">経営コックピット</span>
        <span className="text-caption tabular-nums text-charcoal-40">{todayJst()}</span>
      </header>

      {/* ヒーロー — この事業で一番大事な一つの数字：当月純利益 */}
      <section className="pb-9 pt-8">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{h.netProfit}</div>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span
            className={cn(
              'font-display text-[64px] leading-[0.9] tabular-nums',
              profit < 0 ? 'text-accent' : 'text-foreground',
            )}
          >
            {jpy(profit)}
          </span>
          <span className={cn('text-button-sm', profit < 0 ? 'text-accent' : 'text-charcoal-82')}>
            {profitLabel}
          </span>
        </div>
        <p className="mt-4 text-caption text-muted">
          売上 <span className="tabular-nums text-charcoal-82">{jpy(revenueNowJpy)}</span>
          {momPct != null && (
            <span className="tabular-nums text-charcoal-40">
              {' '}
              前月比 {momPct >= 0 ? '+' : ''}
              {momPct}%
            </span>
          )}
          <span className="mx-2.5 text-charcoal-40">/</span>
          コスト <span className="tabular-nums text-charcoal-82">{jpy(costNowJpy)}</span>
          <span className="text-charcoal-40"> ・ 予算 {jpy(cost.budget_jpy)}</span>
        </p>
      </section>

      {/* 指標行 — 補助4指標。枠で囲まず、細い縦罫だけで区切る */}
      <section className="grid grid-cols-2 gap-y-6 border-t border-border-warm py-6 sm:grid-cols-4 sm:gap-y-0 sm:divide-x sm:divide-border-warm">
        <div className="sm:pr-6">
          <Figure
            label={h.revenue}
            value={jpy(revenueNowJpy)}
            note={momPct != null ? h.revenueMom(momPct) : h.revenueMomNa}
            noteDir={momPct == null ? 'neutral' : momPct >= 0 ? 'positive' : 'negative'}
          />
        </div>
        <div className="sm:px-6">
          <Figure
            label={h.cost}
            value={jpy(costNowJpy)}
            sub={h.costBudget(cost.budget_jpy)}
            note={cost.level === 'red' ? '予算超過' : cost.level === 'orange' ? '予算逼迫' : undefined}
            noteDir={cost.level === 'red' || cost.level === 'orange' ? 'negative' : 'neutral'}
          />
        </div>
        <div className="sm:px-6">
          <Figure
            label={h.published}
            value={String(publishedCount + retractedCount)}
            sub={h.publishedSuffix}
            note={retractedCount > 0 ? h.publishedBreakdown(publishedCount, retractedCount) : undefined}
          />
        </div>
        <div className="sm:pl-6">
          <Figure
            label={m.kpi.qualityScore}
            value={quality.value}
            sub={quality.value !== '—' ? m.kpi.qualityScoreSuffix : undefined}
            note={quality.change}
            noteDir={quality.changeDir}
          />
        </div>
      </section>

      <div className="mt-3 flex flex-col gap-10">
        {/* 要対応 — 運営者が今やること。AIが自走する中で人手が要る例外だけ */}
        <EditorialSection label={m.actionsHeading}>
          <ActionList
            rows={actionRows}
            allClearLabel="対応が必要な項目はありません。AI会社が自走しています。"
          />
        </EditorialSection>

        {/* 稼働状況 + 進行中ジョブ */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 border-t border-border-warm pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted">{h.autonomyHeading}</span>
              <SectionLink href="/org" label={h.viewOrg} />
            </div>
            <AutonomyStatus
              pills={autonomyPills}
              anyOn={anyOn}
              onLabel={h.autonomyOn}
              offLabel={h.autonomyOff}
              objectiveTitle={objective?.title}
              objectivePeriod={objective?.period_label}
              objectiveLabel={h.objectiveLabel}
              noObjective={h.noObjective}
              tasksSummary={h.orgTasks(orgOpen, orgHuman)}
            />
          </div>
          <div>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <span className="flex items-baseline gap-2.5">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
                  {m.runningJobsHeading}
                </span>
                <span className="text-caption tabular-nums text-charcoal-40">
                  {h.jobsRunning(runningJobsCount)}
                </span>
              </span>
              <SectionLink href="/jobs" label={h.viewJobs} />
            </div>
            <RunningJobsList jobs={jobs} moreLabel={jobsMore} emptyMessage={m.empty.jobs} />
          </div>
        </div>

        {/* 最近の本 + パイプライン内訳 */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 border-t border-border-warm pt-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
                {m.recentBooksHeading}
              </span>
              <SectionLink href="/books" label={h.viewBooks} />
            </div>
            <RecentBooksList books={recentBooks} emptyMessage={m.empty.books} />
          </div>
          <div>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <span className="flex items-baseline gap-2.5">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
                  {h.pipelineHeading}
                </span>
                <span className="text-caption tabular-nums text-charcoal-40">
                  {h.pipelineInProgress} {inProgressTotal}
                </span>
              </span>
              <SectionLink href="/progress" label={h.viewProgress} />
            </div>
            <PipelineBreakdown counts={pipelineCounts} emptyMessage={h.pipelineNone} />
          </div>
        </div>

        {/* 販促・成長 + 未読アラート */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 border-t border-border-warm pt-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted">{h.growthHeading}</span>
              <SectionLink href="/promotion" label={messages.nav.itemPromotion} />
            </div>
            <GrowthStrip
              channels={growthChannels}
              followersLabel={h.followers}
              postsLabel={h.posts}
              emptyMessage={h.growthNone}
            />
          </div>
          <div>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <span className="flex items-baseline gap-2.5">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted">{m.alertsHeading}</span>
                <span className="text-caption tabular-nums text-charcoal-40">{alertsUnread}</span>
              </span>
              <SectionLink href="/alerts" label={h.viewAlerts} />
            </div>
            <AlertMiniList alerts={alerts} emptyMessage={m.empty.alerts} />
          </div>
        </div>
      </div>
    </div>
  );
}
