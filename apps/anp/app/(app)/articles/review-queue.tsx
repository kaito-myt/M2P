'use client';

/**
 * ReviewQueue — 品質基準に届かず止まっている記事の人間判断ゲート (F-ANP-57)。
 *
 * ## なぜ要るか (2026-10-15 運営者指示)
 * 「ANPもA2P同様にスコアが足りないものは人間判断で承認できるようにしてください」。
 * 承認アクション自体 (`forceReady`) は記事詳細とアカウント詳細に前からあったが、
 * **横断して一覧する場所が無く**、1 本ずつ開かないと承認できなかった。実測で 24 本
 * (最古 2026-09-29) が 65〜68 点のまま放置されていた。A2P の `/content-review` に
 * ある「judge が基準点に届かず止まった本」の節と同じ役割をここに置く。
 *
 * スコアの数字だけでは判断できないので、**落ちた理由 (judge の軸別コメント)** を
 * その場に出す。直させたい場合は 69 点以下で judge 自身が選ぶのと同じ
 * 「構成からやり直す」を既定の推奨にする。
 */
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';

import { forceReadyMany, retryEditor, retryJudge, retryOutline } from '@/app/actions/review';
import { cn } from '@/lib/cn';
import { formatJstShort } from '@/lib/datetime';
import { messages } from '@/lib/messages';

const m = messages.articles.reviewQueue;
const am = messages.accountDetail.reviewActions;

export interface ReviewQueueRow {
  id: string;
  title: string;
  accountId: string;
  accountName: string;
  score: number | null;
  /** judge の軸別コメント。空なら採点が残っていない。 */
  reasons: string[];
  createdAt: string | null;
}

type Action = (input: unknown) => Promise<{ ok: boolean; error?: string }>;

export function ReviewQueue({ rows, floor }: { rows: ReviewQueueRow[]; floor: number }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = selected.size > 0 && selected.size === rows.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = (action: Action, input: unknown, onOk?: () => void) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action(input);
      if (!result.ok) setError(result.error ?? messages.common.unknownError);
      else onOk?.();
    });
  };

  const approve = (ids: string[]) => {
    if (ids.length === 0) return;
    if (!window.confirm(m.confirmApprove(ids.length))) return;
    run(forceReadyMany as Action, { note_article_ids: ids }, () => {
      setNotice(m.approved(ids.length));
      setSelected(new Set());
    });
  };

  const oldestDays = useMemo(() => {
    const times = rows
      .map((r) => (r.createdAt ? new Date(r.createdAt).getTime() : null))
      .filter((t): t is number => t !== null);
    if (times.length === 0) return 0;
    return Math.max(0, Math.round((Date.now() - Math.min(...times)) / 86_400_000));
  }, [rows]);

  return (
    <section className="mt-space-relaxed flex flex-col gap-space-snug" data-testid="articles-review-queue">
      <div className="flex flex-col">
        <h2 className="text-sub-heading font-medium text-charcoal">{m.title}</h2>
        <p className="mt-1 text-body text-muted">{m.description(floor)}</p>
        <p className="mt-1 text-caption text-amber-700">{m.summary(rows.length, oldestDays)}</p>
      </div>

      {/* 一括操作 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelected(allSelected ? new Set() : new Set(allIds))}
          className="rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04"
        >
          {allSelected ? m.clearSelection : m.selectAll}
        </button>
        {selected.size > 0 && <span className="text-caption text-muted">{m.selectedCount(selected.size)}</span>}
        <button
          type="button"
          disabled={isPending || selected.size === 0}
          onClick={() => approve([...selected])}
          className="rounded-card border border-charcoal bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-40"
          data-testid="review-queue-approve-selected"
        >
          {m.approveSelected}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => approve(allIds)}
          className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-40"
        >
          {m.approveAll}
        </button>
      </div>
      <p className="text-caption text-muted">{m.recommendOutline}</p>
      {error && (
        <p role="alert" className="text-caption text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-caption text-emerald-700">
          {notice}
        </p>
      )}

      <ul className="flex flex-col gap-space-snug" data-testid="review-queue-list">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-space-snug rounded-container border border-amber-200 bg-amber-50/40 p-space-snug sm:flex-row sm:items-start"
            data-testid="review-queue-item"
          >
            <input
              type="checkbox"
              checked={selected.has(row.id)}
              onChange={() => toggle(row.id)}
              aria-label={row.title}
              className="mt-1 h-4 w-4 flex-none accent-charcoal"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-space-snug">
                <Link
                  href={`/articles/${row.id}`}
                  className="min-w-0 truncate text-body font-medium text-charcoal no-underline hover:underline"
                >
                  {row.title}
                </Link>
                <Link href={`/accounts/${row.accountId}`} className="text-caption text-muted no-underline hover:underline">
                  {row.accountName}
                </Link>
                <span className="text-caption tabular-nums text-amber-800">
                  {row.score === null ? '—' : m.scoreShort(row.score, floor)}
                </span>
                {row.createdAt && <span className="text-caption text-muted">{formatJstShort(row.createdAt)}</span>}
              </div>

              {/* 落ちた理由 — これが無いと承認も差し戻しも判断できない。 */}
              {row.reasons.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {row.reasons.map((reason, i) => (
                    <li key={i} className="text-caption leading-relaxed text-charcoal-82">
                      ・{reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-caption text-muted">{m.reasonUnknown}</p>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => approve([row.id])}
                  className="rounded-card border border-charcoal bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-40"
                >
                  {am.forceReady}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(retryOutline as Action, { note_article_id: row.id })}
                  className={cn(
                    'rounded-card border px-3 py-1.5 text-button-sm disabled:opacity-40',
                    'border-border-warm bg-white text-charcoal hover:bg-charcoal-04',
                  )}
                >
                  {am.retryOutline}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(retryEditor as Action, { note_article_id: row.id })}
                  className="rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04 disabled:opacity-40"
                >
                  {am.retryEditor}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(retryJudge as Action, { note_article_id: row.id })}
                  className="rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-muted hover:bg-charcoal-04 disabled:opacity-40"
                >
                  {am.retryJudge}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
