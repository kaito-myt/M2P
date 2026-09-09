/**
 * バッチ計画一覧 (T-03-09 推奨パート).
 *
 * BatchPlan の status 別カウント + 直近 7 件の簡易リスト。
 * 詳細画面は SP-04 以降 (BatchPlan 詳細 UI が必要になったら別タスク)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { cn } from '@/lib/cn';
import { formatJstDateTime } from '@/lib/datetime';

export const metadata: Metadata = {
  title: `${messages.batches.listPageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

const m = messages.batches;

const STATUS_KEYS = [
  'scheduled',
  'running',
  'done',
  'failed',
  'cancelled',
] as const;
type StatusKey = (typeof STATUS_KEYS)[number];

function statusLabel(s: string): string {
  if (s === 'scheduled' || s === 'running' || s === 'done' || s === 'failed' || s === 'cancelled') {
    return m.statusCounts[s];
  }
  return s;
}

// パイプライン工程 → 日本語の「今やっている処理」ラベル (名詞。状態サフィックスは別途付与)。
const STAGE_NOUN: Record<string, string> = {
  'pipeline.book.kickoff': '準備',
  'pipeline.book.marketer': '企画・リサーチ',
  'pipeline.book.writer.outline': '構成作成',
  'pipeline.book.writer.chapters.dispatch': '本文執筆準備',
  'pipeline.book.writer.chapter': '本文執筆',
  'pipeline.book.editor': '編集',
  'pipeline.book.thumbnail.text': '表紙コピー作成',
  'pipeline.book.thumbnail.image': '表紙画像生成',
  'pipeline.book.judge': '品質審査',
  'pipeline.book.seo': 'メタデータ最適化',
  'pipeline.book.export': '出力生成',
};

interface LatestJob {
  kind: string;
  status: string;
}

/**
 * 本の現在工程ラベルを組み立てる。book.status と最新パイプラインジョブから
 * 「本文執筆中」「編集完了」「品質審査で失敗」等の分かりやすい表示にする。
 */
function stageDisplay(
  bookStatus: string | undefined,
  latest: LatestJob | undefined,
): { text: string; tone: 'done' | 'failed' | 'running' } {
  if (bookStatus === 'published') return { text: '出版済み', tone: 'done' };
  if (bookStatus === 'done') return { text: '完成', tone: 'done' };
  if (!latest) {
    // ジョブがまだ無い = キュー投入待ち。
    return { text: '順番待ち', tone: 'running' };
  }
  const noun = STAGE_NOUN[latest.kind] ?? latest.kind.replace('pipeline.book.', '');
  if (latest.status === 'failed') return { text: `${noun}で失敗`, tone: 'failed' };
  if (latest.status === 'running') return { text: `${noun}中`, tone: 'running' };
  if (latest.status === 'queued') return { text: `${noun}待ち`, tone: 'running' };
  // done: この工程は完了、次工程へ移行中。
  return { text: `${noun}完了`, tone: 'running' };
}

export default async function BatchesListPage() {
  const [counts, recent] = await Promise.all([
    prisma.batchPlan.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.batchPlan.findMany({
      orderBy: { created_at: 'desc' },
      take: 7,
      include: {
        items: {
          select: { id: true, theme_id: true, status: true, book: { select: { id: true, title: true, status: true } } },
        },
      },
    }),
  ]);

  // BatchPlanItem.theme_id は ThemeCandidate への Prisma リレーションが無いため JS で結合する。
  // (item に book が付いていれば book.title を優先、無ければ採用テーマ名を表示。)
  const themeIds = Array.from(
    new Set(recent.flatMap((b) => b.items.map((i) => i.theme_id).filter((x): x is string => Boolean(x)))),
  );
  const themes = themeIds.length
    ? await prisma.themeCandidate.findMany({ where: { id: { in: themeIds } }, select: { id: true, title: true } })
    : [];
  const themeTitleById = new Map(themes.map((t) => [t.id, t.title]));

  // 各本の「現在工程」を出すため、最新の pipeline.book.* ジョブを 1 冊 1 件だけ取得する。
  const bookIds = Array.from(
    new Set(
      recent.flatMap((b) => b.items.map((i) => i.book?.id).filter((x): x is string => Boolean(x))),
    ),
  );
  const jobs = bookIds.length
    ? await prisma.job.findMany({
        where: { book_id: { in: bookIds }, kind: { startsWith: 'pipeline.book.' } },
        select: { book_id: true, kind: true, status: true },
        orderBy: { created_at: 'desc' },
      })
    : [];
  const latestJobByBook = new Map<string, LatestJob>();
  for (const j of jobs) {
    if (j.book_id && !latestJobByBook.has(j.book_id)) {
      latestJobByBook.set(j.book_id, { kind: j.kind, status: j.status });
    }
  }

  function itemLabel(item: (typeof recent)[number]['items'][number]): { title: string; status: string } {
    const title = item.book?.title ?? (item.theme_id ? themeTitleById.get(item.theme_id) : undefined) ?? m.list.noThemes;
    return { title, status: item.book?.status ?? item.status };
  }

  const countByStatus: Record<StatusKey, number> = {
    scheduled: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const c of counts) {
    if ((STATUS_KEYS as readonly string[]).includes(c.status)) {
      countByStatus[c.status as StatusKey] = c._count._all;
    }
  }

  return (
    <div className="flex flex-col gap-space-loose">
      <header className="flex flex-col gap-space-snug">
        <nav aria-label="breadcrumb" className="text-button-sm text-muted">
          <Link href="/dashboard" className="no-underline hover:underline">
            {m.breadcrumbHome}
          </Link>
          <span aria-hidden="true"> &gt; </span>
          <Link href="/themes" className="no-underline hover:underline">
            {m.breadcrumbPipeline}
          </Link>
          <span aria-hidden="true"> &gt; </span>
          <span>{m.breadcrumbBatches}</span>
        </nav>
        <div className="flex flex-col">
          <h1 className="text-sub-heading text-foreground">{m.listPageTitle}</h1>
          <p className="text-body text-muted">{m.listPageSubtitle}</p>
        </div>
      </header>

      <section
        data-testid="batches-status-summary"
        className="grid grid-cols-2 gap-space-snug md:grid-cols-5"
      >
        {STATUS_KEYS.map((s) => (
          <div
            key={s}
            data-testid={`batches-status-${s}`}
            className="rounded-card border border-border-warm bg-cream px-space-relaxed py-space-snug"
          >
            <div className="text-button-sm text-muted">{m.statusCounts[s]}</div>
            <div className="text-sub-heading text-foreground">
              {countByStatus[s]}
              <span className="ml-1 text-button-sm text-muted">{m.list.countSuffix}</span>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-space-snug text-card-title text-foreground">
          {m.list.recentHeading}
        </h2>
        {recent.length === 0 ? (
          <div
            data-testid="batches-empty-state"
            className="rounded-card border border-border-warm bg-cream-light p-space-loose text-center"
          >
            <p className="text-body text-charcoal">{m.list.empty}</p>
            <div className="mt-space-snug flex justify-center">
              <Link
                href="/themes"
                className="text-button-sm text-foreground underline hover:no-underline"
              >
                {m.list.goToThemes}
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border-warm bg-cream">
            <table
              data-testid="batches-table"
              className="w-full border-collapse text-button-sm"
            >
              <thead>
                <tr className="border-b border-border-warm text-left text-muted">
                  <th className="px-space-relaxed py-2 font-medium">{m.list.colId}</th>
                  <th className="px-space-relaxed py-2 font-medium">{m.list.colPlannedAt}</th>
                  <th className="px-space-relaxed py-2 font-medium">{m.list.colConcurrency}</th>
                  <th className="px-space-relaxed py-2 font-medium">{m.list.colItems}</th>
                  <th className="px-space-relaxed py-2 font-medium">{m.list.colThemes}</th>
                  <th className="px-space-relaxed py-2 font-medium">{m.list.colStatus}</th>
                  <th className="px-space-relaxed py-2 font-medium">{m.list.colPredictedCost}</th>
                  <th className="px-space-relaxed py-2 font-medium">{m.list.colCreatedAt}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((b) => (
                  <tr
                    key={b.id}
                    data-testid={`batch-plan-row-${b.id}`}
                    className="border-b border-border-warm/60 last:border-b-0"
                  >
                    <td className="px-space-relaxed py-2 font-mono text-charcoal-82">
                      {b.id.slice(0, 12)}…
                    </td>
                    <td className="px-space-relaxed py-2 whitespace-nowrap text-charcoal-82">
                      {formatJstDateTime(b.planned_at)}
                    </td>
                    <td className="px-space-relaxed py-2 text-charcoal-82">
                      {b.concurrency}
                    </td>
                    <td className="px-space-relaxed py-2 text-charcoal-82">
                      {b.items.length}
                    </td>
                    {/* 対象テーマ: 書籍タイトルのみ（工程はステータス列に横並びで表示） */}
                    <td className="px-space-relaxed py-2 align-top text-charcoal-82">
                      {b.items.length === 0 ? (
                        <span className="text-muted">{m.list.noThemes}</span>
                      ) : (
                        <ul className="flex max-w-[22rem] flex-col gap-0.5">
                          {b.items.map((item) => {
                            const { title, status } = itemLabel(item);
                            return (
                              <li key={item.id} className="flex h-5 items-center gap-1.5">
                                <span
                                  className={cn(
                                    'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                                    status === 'done' || status === 'published'
                                      ? 'bg-success'
                                      : status === 'failed'
                                        ? 'bg-destructive'
                                        : 'bg-warning',
                                  )}
                                  title={status}
                                />
                                {item.book ? (
                                  <Link href={`/books/${item.book.id}`} className="truncate hover:underline">
                                    {title}
                                  </Link>
                                ) : (
                                  <span className="truncate">{title}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                    {/* ステータス: 書籍ごとの現在工程を対象テーマと同じ行順で横並び表示 + 計画ステータス/内訳 */}
                    <td className="px-space-relaxed py-2 align-top text-foreground">
                      {b.items.length > 0 && (
                        <ul className="flex flex-col gap-0.5">
                          {b.items.map((item) => {
                            const stage = item.book
                              ? stageDisplay(item.book.status, latestJobByBook.get(item.book.id))
                              : { text: itemLabel(item).status, tone: 'running' as const };
                            return (
                              <li key={item.id} className="flex h-5 items-center">
                                <span
                                  className={cn(
                                    'shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-caption',
                                    stage.tone === 'done'
                                      ? 'bg-success/10 text-success'
                                      : stage.tone === 'failed'
                                        ? 'bg-destructive/10 text-destructive'
                                        : 'bg-warning/10 text-warning',
                                  )}
                                >
                                  {stage.text}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {/* 計画ステータス + 完成内訳（footer。工程リストの下に置き行整列を崩さない） */}
                      <div className="mt-1.5 border-t border-border-warm/50 pt-1 text-caption text-muted">
                        <span className="text-charcoal-82">計画: {statusLabel(b.status)}</span>
                        {b.items.length > 0 &&
                          (() => {
                            const bs = b.items.map((i) => itemLabel(i).status);
                            const done = bs.filter((s) => s === 'done' || s === 'published').length;
                            const failed = bs.filter((s) => s === 'failed').length;
                            const inprog = bs.length - done - failed;
                            return (
                              <span>
                                {' ・ '}本 {done}/{bs.length} 完成
                                {failed > 0 && <span className="text-destructive"> ・{failed} 失敗</span>}
                                {inprog > 0 && <span className="text-warning"> ・{inprog} 進行中</span>}
                              </span>
                            );
                          })()}
                      </div>
                    </td>
                    <td className="px-space-relaxed py-2 align-top whitespace-nowrap text-charcoal-82">
                      {m.list.jpyPrefix}
                      {b.predicted_cost_jpy.toLocaleString('ja-JP')}
                    </td>
                    <td className="px-space-relaxed py-2 align-top whitespace-nowrap text-charcoal-82">
                      {formatJstDateTime(b.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
