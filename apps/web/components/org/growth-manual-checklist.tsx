'use client';

/**
 * [F-075 UX] 手動グロースToDoのワンタップUI。
 *
 * IG/TikTok/note はフォロー/いいねの自動化ができない(TikTokはbot検知が厳格で不可)ため、
 * 運営者が手で対応する。その作業コストを最小化するUI: 各ターゲットを
 *   [✓済] [ハンドル＋理由] [開く→(アプリ直リンク)]
 * の1行で表示し、「開く」をタップ→アプリでフォロー→[✓]で進捗保存、と最短手数にする。
 * 「残りを全部開く」で一括タブオープンも可能。
 */
import { useMemo, useOptimistic, useTransition } from 'react';

import { toggleGrowthTarget } from '@/app/actions/org';
import type { GrowthTargetRow } from '@/lib/org-view';

const ACTION_LABEL: Record<GrowthTargetRow['actionType'], string> = {
  follow: 'フォロー',
  like: 'いいね',
  comment: 'コメント',
};

export function GrowthManualChecklist({
  taskId,
  targets,
  completed,
}: {
  taskId: string;
  targets: GrowthTargetRow[];
  completed: string[];
}) {
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    new Set(completed),
    (prev: Set<string>, patch: { key: string; done: boolean }) => {
      const next = new Set(prev);
      if (patch.done) next.add(patch.key);
      else next.delete(patch.key);
      return next;
    },
  );

  const doneCount = useMemo(() => targets.filter((t) => optimistic.has(t.key)).length, [targets, optimistic]);
  const remaining = useMemo(() => targets.filter((t) => !optimistic.has(t.key)), [targets, optimistic]);

  function toggle(key: string, done: boolean) {
    start(async () => {
      setOptimistic({ key, done });
      await toggleGrowthTarget({ task_id: taskId, key, done });
    });
  }

  function openAll() {
    // 残りを新規タブで一括オープン(PC向け・ポップアップブロックに注意)。
    for (const t of remaining.slice(0, 15)) window.open(t.url, '_blank', 'noopener');
  }

  if (targets.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 text-caption">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted">
          手動対応 <span className="font-medium text-charcoal">{doneCount}/{targets.length}</span> 済
        </span>
        {remaining.length > 0 && (
          <button
            type="button"
            onClick={openAll}
            className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-caption text-amber-700 hover:bg-amber-100"
          >
            残り{Math.min(remaining.length, 15)}件を開く
          </button>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-border-warm rounded border border-border-warm">
        {targets.map((t) => {
          const isDone = optimistic.has(t.key);
          return (
            <li key={t.key} className={`flex items-center gap-2 px-2 py-1.5 ${isDone ? 'bg-slate-50 opacity-70' : ''}`}>
              <input
                type="checkbox"
                checked={isDone}
                disabled={pending}
                onChange={(e) => toggle(t.key, e.target.checked)}
                className="h-4 w-4 shrink-0 accent-emerald-600"
                aria-label={`${t.handle} を対応済みにする`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">{ACTION_LABEL[t.actionType]}</span>
                  <span className={`truncate font-medium ${isDone ? 'text-muted line-through' : 'text-charcoal'}`}>{t.handle}</span>
                </div>
                {t.reason && <p className="truncate text-[11px] text-muted">{t.reason}</p>}
              </div>
              <a
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded bg-charcoal px-2.5 py-1 text-caption font-medium text-white hover:bg-charcoal-82"
              >
                開く →
              </a>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted">「開く」でアプリが対象を直接表示 → フォロー/いいね → チェックで完了。</p>
    </div>
  );
}
