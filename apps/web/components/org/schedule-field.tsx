'use client';

/**
 * ScheduleField — cron を直接書かせず、毎日/毎週/毎時 + JST 時刻で実行スケジュールを指定する UI。
 * 内部で UTC cron 式へ変換し onChange(cron) で親へ返す (保存フォーマットは従来通り cron)。
 */
import { useCallback, useMemo, useState } from 'react';

import { nextCronRunJst } from '@/lib/cron-utils';
import {
  cronToSchedule,
  scheduleToCron,
  describeScheduleJst,
  toHhmm,
  parseHhmm,
  WEEKDAY_LABELS_JA,
  type Schedule,
} from '@/lib/schedule-builder';

const MODE_OPTIONS: Array<{ value: Schedule['mode']; label: string }> = [
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'hourly', label: '毎時 / N時間ごと' },
  { value: 'custom', label: 'カスタム (cron・UTC)' },
];

const inputCls =
  'rounded-button border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60';

export function ScheduleField({
  cron,
  disabled,
  onChange,
  testId,
}: {
  cron: string;
  disabled: boolean;
  onChange: (cron: string) => void;
  testId: string;
}) {
  const [schedule, setSchedule] = useState<Schedule>(() => cronToSchedule(cron));

  const apply = useCallback(
    (next: Schedule) => {
      setSchedule(next);
      onChange(scheduleToCron(next));
    },
    [onChange],
  );

  const setMode = useCallback(
    (mode: Schedule['mode']) => {
      // モード切替時は現在時刻要素を引き継いで初期化
      const cur = schedule;
      const hour = 'hour' in cur ? cur.hour : 9;
      const minute = 'minute' in cur ? cur.minute : 0;
      if (mode === 'daily') apply({ mode, hour, minute });
      else if (mode === 'weekly') apply({ mode, weekday: cur.mode === 'weekly' ? cur.weekday : 1, hour, minute });
      else if (mode === 'hourly') apply({ mode, everyHours: cur.mode === 'hourly' ? cur.everyHours : 6, minute });
      else apply({ mode: 'custom', cron: scheduleToCron(cur) });
    },
    [schedule, apply],
  );

  const previewCron = useMemo(() => scheduleToCron(schedule), [schedule]);
  const nextRun = disabled ? null : nextCronRunJst(previewCron);

  return (
    <div className={`flex flex-col gap-2 ${disabled ? 'opacity-60' : ''}`} data-testid={`${testId}-schedule`}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="実行頻度"
          disabled={disabled}
          value={schedule.mode}
          onChange={(e) => setMode(e.target.value as Schedule['mode'])}
          data-testid={`${testId}-mode`}
          className={inputCls}
        >
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {schedule.mode === 'weekly' && (
          <select
            aria-label="曜日"
            disabled={disabled}
            value={schedule.weekday}
            onChange={(e) => apply({ ...schedule, weekday: parseInt(e.target.value, 10) })}
            data-testid={`${testId}-weekday`}
            className={inputCls}
          >
            {WEEKDAY_LABELS_JA.map((w, i) => (
              <option key={i} value={i}>
                {w}曜
              </option>
            ))}
          </select>
        )}

        {(schedule.mode === 'daily' || schedule.mode === 'weekly') && (
          <label className="flex items-center gap-1.5 text-button-sm text-charcoal">
            <input
              type="time"
              aria-label="時刻 (JST)"
              disabled={disabled}
              value={toHhmm(schedule.hour, schedule.minute)}
              onChange={(e) => {
                const p = parseHhmm(e.target.value);
                if (p) apply({ ...schedule, hour: p.hour, minute: p.minute });
              }}
              data-testid={`${testId}-time`}
              className={inputCls}
            />
            <span className="text-muted">JST</span>
          </label>
        )}

        {schedule.mode === 'hourly' && (
          <div className="flex items-center gap-1.5 text-button-sm text-charcoal">
            <input
              type="number"
              min={1}
              max={23}
              aria-label="実行間隔 (時間)"
              disabled={disabled}
              value={schedule.everyHours}
              onChange={(e) =>
                apply({ ...schedule, everyHours: Math.max(1, Math.min(23, Number(e.target.value) || 1)) })
              }
              data-testid={`${testId}-every`}
              className={`${inputCls} w-20`}
            />
            <span className="text-muted">時間ごと</span>
            <input
              type="number"
              min={0}
              max={59}
              aria-label="分"
              disabled={disabled}
              value={schedule.minute}
              onChange={(e) => apply({ ...schedule, minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })}
              className={`${inputCls} w-20`}
            />
            <span className="text-muted">分</span>
          </div>
        )}

        {schedule.mode === 'custom' && (
          <input
            type="text"
            aria-label="cron 式 (UTC)"
            disabled={disabled}
            value={schedule.cron}
            onChange={(e) => apply({ mode: 'custom', cron: e.target.value })}
            placeholder="0 17 * * *"
            data-testid={`${testId}-cron-input`}
            className={`${inputCls} w-56 font-mono`}
          />
        )}
      </div>

      <p className="text-button-sm text-muted" data-testid={`${testId}-preview`}>
        {describeScheduleJst(schedule)}
        {nextRun ? ` ／ 次回: ${nextRun}` : ''}
      </p>
    </div>
  );
}
