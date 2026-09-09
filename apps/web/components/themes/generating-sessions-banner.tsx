'use client';

/**
 * テーマ生成の進捗バナー (S-006 上部)。
 *
 * `pipeline.theme.generate` の未完了 Job を「生成中」として、**ジョブ開始からの経過**と
 * **目安時間(約2分)に対する進捗**を1件ずつ表示する。生成は web 検索を伴い 1〜2 分かかる。
 * 一定間隔で router.refresh() し、完了すると一覧に現れる。
 *
 * また直近30分で**失敗したテーマ生成**も表示する（従来は失敗すると「生成中」チップが黙って
 * 消え、生成されない理由が分からなかった。失敗を明示して再生成を促す）。
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { messages } from '@/lib/messages';
import { formatDateTime, type GeneratingSession } from '@/lib/themes-view';

const m = messages.themes.generating;

/** テーマ生成の目安時間（秒）。web 検索込みで概ね 1〜2 分。 */
const ETA_SECONDS = 120;

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}秒`;
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return ss === 0 ? `${mm}分` : `${mm}分${ss}秒`;
}

interface GeneratingSessionsBannerProps {
  sessions: readonly GeneratingSession[];
  failed?: readonly GeneratingSession[];
}

export function GeneratingSessionsBanner({ sessions, failed = [] }: GeneratingSessionsBannerProps) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  // 生成中の間だけ 1 秒ごとに時刻更新（各ジョブの経過を出す）＋ポーリング。
  useEffect(() => {
    if (sessions.length === 0) return;
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    const poll = setInterval(() => router.refresh(), 7000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [router, sessions.length]);

  if (sessions.length === 0 && failed.length === 0) return null;

  const open = [...sessions, ...failed].find((s) => s.jobId === openJobId) ?? null;

  return (
    <section
      data-testid="themes-generating-banner"
      className="flex flex-col gap-space-snug rounded-card border border-border-warm bg-cream-light px-space-relaxed py-space-snug"
    >
      {sessions.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-charcoal border-t-transparent" />
            <span className="text-button-sm font-medium text-charcoal">{m.heading}</span>
            <span className="text-caption text-muted">{sessions.length} 件</span>
          </div>

          <ul className="flex flex-col gap-space-snug">
            {sessions.map((s) => {
              const elapsedSec = Math.max(0, Math.round((nowMs - new Date(s.createdAt).getTime()) / 1000));
              const pct = Math.min(99, Math.round((elapsedSec / ETA_SECONDS) * 100));
              const overdue = elapsedSec > ETA_SECONDS * 2; // 4分超は遅延（詰まりの可能性）
              const remain = Math.max(0, ETA_SECONDS - elapsedSec);
              return (
                <li key={s.jobId} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-space-snug gap-y-0.5 text-button-sm">
                    <button
                      type="button"
                      onClick={() => setOpenJobId(s.jobId)}
                      data-testid={`themes-generating-chip-${s.jobId}`}
                      className="inline-flex items-center gap-1.5 rounded-pill border border-border-warm bg-cream px-2.5 py-0.5 text-caption text-charcoal-82 hover:bg-cream-light"
                    >
                      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${s.status === 'queued' ? 'bg-muted' : 'bg-warning'}`} />
                      {s.genreLabel ? m.chip(s.genreLabel) : m.chipUnknown}
                    </button>
                    <span className="text-caption text-muted">
                      {s.status === 'queued' ? '待機中' : `生成中 · 経過 ${fmtDuration(elapsedSec)}`}
                      {s.status === 'running' && !overdue && ` · 残り目安 約${fmtDuration(remain)}`}
                    </span>
                    {overdue && (
                      <span className="text-caption text-destructive">目安を超過（詰まりの可能性・自動で再確認します）</span>
                    )}
                  </div>
                  <div className="h-1 w-full max-w-md overflow-hidden rounded-pill bg-charcoal-04" aria-hidden>
                    <span
                      className={`block h-full rounded-pill ${overdue ? 'bg-destructive' : 'bg-accent'} transition-all duration-700`}
                      style={{ width: `${s.status === 'queued' ? 4 : pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-caption text-muted">{m.note}</p>
        </>
      )}

      {failed.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border-warm pt-space-snug">
          <span className="text-button-sm font-medium text-destructive">生成に失敗したテーマ（直近30分）</span>
          <ul className="flex flex-col gap-0.5">
            {failed.map((f) => (
              <li key={f.jobId} className="flex flex-wrap items-center gap-x-space-snug text-caption" data-testid={`themes-failed-${f.jobId}`}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                  {f.genreLabel ? m.chip(f.genreLabel) : m.chipUnknown}
                </span>
                <span className="text-muted">{formatDateTime(f.createdAt)}</span>
                {f.error && <span className="truncate text-destructive/80" title={f.error}>{f.error.slice(0, 60)}</span>}
              </li>
            ))}
          </ul>
          <span className="text-caption text-muted">「新規テーマ生成」からやり直せます。繰り返し失敗する場合はモデル設定/アラートをご確認ください。</span>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-space-relaxed"
          role="dialog"
          aria-modal="true"
          data-testid="themes-generating-popup"
          onClick={() => setOpenJobId(null)}
        >
          <div
            className="w-full max-w-md rounded-card border border-border-warm bg-cream-light p-space-loose shadow-l2"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-space-snug text-card-title text-foreground">{m.popupTitle}</h3>
            <dl className="flex flex-col gap-space-snug">
              <Field label={m.fieldGenre} value={open.genreLabel ?? '—'} />
              <Field label={m.fieldKeyword} value={open.keywordOrBrief ?? '—'} />
              <Field label={m.fieldCount} value={open.count != null ? `${open.count} ${m.countUnit}` : '—'} />
              <Field label={m.fieldAccount} value={open.accountLabel ?? '—'} />
              <Field label={m.fieldStartedAt} value={formatDateTime(open.createdAt)} />
              {open.status === 'failed' && open.error && <Field label="エラー" value={open.error} />}
            </dl>
            <div className="mt-space-relaxed flex justify-end">
              <button
                type="button"
                onClick={() => setOpenJobId(null)}
                className="rounded-default border border-border-warm bg-cream px-4 py-1.5 text-button-sm text-charcoal hover:bg-cream-light"
              >
                {m.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-button-sm text-charcoal">{value}</dd>
    </div>
  );
}
