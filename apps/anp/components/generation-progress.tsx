'use client';

/**
 * GenerationProgress — AI 生成の進捗バー (運営者要望 2026-09-21「生成中の完了目安時間が分からないから
 * 進捗率を見えるように」)。
 *
 * worker が書く実進捗 (`pct` / `stage`) があればそれを表示し、無い区間 (順番待ち・段階の途中) は
 * 経過時間から「目安の総所要時間」に対して滑らかに補間する。実進捗より先には進めない (次の段階の
 * 手前で止まる) ので、100% で待たされる嘘の表示にはならない。
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

export interface GenerationProgressProps {
  /** ジョブ作成時刻 (ISO)。経過時間の起点。 */
  startedAt: string;
  /** 目安の総所要時間 (秒)。残り時間表示と補間に使う。 */
  estimateSec: number;
  /** worker の実進捗 (0〜100)。無ければ null。 */
  pct: number | null;
  /** 段階ラベル (例: 「アイコン生成中」)。 */
  stageLabel: string;
  /** 実進捗が無いときに補間が到達してよい上限 (次の段階の手前)。既定 90。 */
  capPct?: number;
  className?: string;
}

function formatSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} 分` : `${m} 分 ${r} 秒`;
}

export function GenerationProgress(props: GenerationProgressProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = Math.max(0, (nowMs - new Date(props.startedAt).getTime()) / 1000);
  const cap = props.capPct ?? 90;
  // 経過時間ベースの補間 (目安時間で cap に到達する曲線。序盤は速く、終盤は鈍る)。
  const interpolated = cap * (1 - Math.exp(-(elapsed / props.estimateSec) * 2.2));
  const shown = Math.min(99, Math.max(props.pct ?? 0, props.pct !== null ? Math.min(interpolated, props.pct + 15) : interpolated));
  const remaining = Math.max(0, props.estimateSec - elapsed);

  return (
    <div className={props.className} data-testid="generation-progress" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-caption text-muted">
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {props.stageLabel}
        </span>
        <span className="tabular-nums">
          {Math.round(shown)}%（経過 {formatSec(elapsed)}
          {remaining > 0 ? ` / 残り目安 ${formatSec(remaining)}` : ' / まもなく完了'}）
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-pill bg-charcoal-04" aria-hidden="true">
        <div
          className="h-full rounded-pill bg-charcoal transition-[width] duration-700 ease-out"
          style={{ width: `${Math.round(shown)}%` }}
        />
      </div>
    </div>
  );
}
