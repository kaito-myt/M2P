'use client';

/**
 * group の項目を並べて保存するフォーム。項目・範囲は持たない: 項目は GROUP_KEYS から引いた FieldView、
 * 検証はサーバーの `validateGroupPatch`。ここは入力を集めて `updateTdpSettings` に渡すだけ。
 */
import { useEffect, useState, useTransition } from 'react';

import { updateTdpSettings } from '@/app/actions/settings';
import { ProposedValueBadge } from '@/components/proposed-value-badge';
import { messages } from '@/lib/messages';
import type { SettingsGroup } from '@/lib/settings-groups-core';
import { fieldInputText, parseFieldInput, refusalMessage, type FieldView } from '@/lib/settings-tabs-core';

const m = messages.settings;
const inputClass =
  'w-28 rounded-default border border-border-warm bg-cream-light px-2.5 py-1.5 text-right text-body text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

type Draft = Record<string, string>;

function toDraft(fields: FieldView[]): Draft {
  const d: Draft = {};
  for (const f of fields) {
    if (f.kind === 'weights') {
      for (const [k, v] of Object.entries(f.value as Record<string, number>)) d[`${f.key}.${k}`] = String(v);
    } else d[f.key] = fieldInputText(f.value as number | null);
  }
  return d;
}

export function GroupForm({
  group,
  fields,
  readOnly,
}: {
  group: SettingsGroup;
  fields: FieldView[];
  readOnly: boolean;
}) {
  const initial = toDraft(fields);
  const signature = JSON.stringify(initial);
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // 保存後にサーバーの値が変わったら入力欄を合わせる (自分が書いたものと保存されたものを食い違わせない)。
  useEffect(() => {
    setDraft(JSON.parse(signature) as Draft);
  }, [signature]);

  const dirtyKeys = fields.filter((f) =>
    f.kind === 'weights'
      ? Object.keys(f.value as object).some((k) => draft[`${f.key}.${k}`] !== initial[`${f.key}.${k}`])
      : draft[f.key] !== initial[f.key],
  );

  const save = () => {
    setError(null);
    setSaved(false);
    const patch: Record<string, unknown> = {};
    for (const f of dirtyKeys) {
      if (f.kind === 'weights') {
        const w: Record<string, unknown> = {};
        for (const k of Object.keys(f.value as object)) w[k] = parseFieldInput(draft[`${f.key}.${k}`] ?? '', false);
        patch[f.key] = w;
      } else patch[f.key] = parseFieldInput(draft[f.key] ?? '', f.nullable);
    }
    startTransition(async () => {
      const r = await updateTdpSettings({ group, patch });
      if (!r.ok) setError(refusalMessage(r.refusals, r.error));
      else setSaved(true);
    });
  };

  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div data-testid={`tdp-group-form-${group}`}>
      <ul className="divide-y divide-border-warm border-y border-border-warm">
        {fields.map((f) => {
          const meta = m.fields[f.key] ?? { label: f.key, unit: '' };
          return (
            <li key={f.key} className="flex flex-wrap items-center gap-x-space-snug gap-y-space-tight px-space-tight py-space-relaxed">
              <div className="min-w-0 flex-1 basis-64">
                <div className="text-button-sm text-charcoal">{meta.label}</div>
                {f.nullable && <div className="text-caption text-muted">{m.group.nullableHint}</div>}
              </div>
              {f.kind === 'weights' ? (
                <WeightsInputs field={f} draft={draft} set={set} disabled={readOnly || isPending} />
              ) : (
                <label className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft[f.key] ?? ''}
                    disabled={readOnly || isPending}
                    onChange={(e) => set(f.key, e.target.value)}
                    className={inputClass}
                    aria-label={meta.label}
                    data-testid={`tdp-field-${f.key}`}
                  />
                  <span className="w-10 text-caption text-muted">{meta.unit}</span>
                </label>
              )}
              <ProposedValueBadge state={f.state} testId={`tdp-badge-${f.key}`} />
            </li>
          );
        })}
      </ul>

      <div className="mt-space-snug flex flex-wrap items-center gap-space-snug">
        <button
          type="button"
          onClick={save}
          disabled={readOnly || isPending || dirtyKeys.length === 0}
          className="h-[38px] rounded-default border border-border-warm bg-cream-light px-4 text-button-sm text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-40"
          data-testid={`tdp-group-save-${group}`}
        >
          {isPending ? m.group.saving : m.group.save}
        </button>
        {saved && !error && <span className="text-caption text-muted">{m.group.saved}</span>}
      </div>
      {error && (
        <p role="alert" className="mt-space-snug whitespace-pre-line text-caption text-destructive" data-testid={`tdp-group-error-${group}`}>
          {error}
        </p>
      )}
    </div>
  );
}

function WeightsInputs({
  field,
  draft,
  set,
  disabled,
}: {
  field: FieldView;
  draft: Draft;
  set: (k: string, v: string) => void;
  disabled: boolean;
}) {
  const kinds = Object.keys(field.value as object);
  const sum = kinds.reduce((a, k) => a + (Number(draft[`${field.key}.${k}`]) || 0), 0);
  return (
    <div className="flex flex-col gap-1">
      {kinds.map((k) => (
        <label key={k} className="flex items-center justify-end gap-1.5">
          <span className="text-caption text-muted">{m.group.kinds[k] ?? k}</span>
          <input
            type="text"
            inputMode="numeric"
            value={draft[`${field.key}.${k}`] ?? ''}
            disabled={disabled}
            onChange={(e) => set(`${field.key}.${k}`, e.target.value)}
            className={inputClass}
            data-testid={`tdp-field-${field.key}-${k}`}
          />
          <span className="w-10 text-caption text-muted">%</span>
        </label>
      ))}
      <p className={sum === 100 ? 'text-right text-caption text-muted' : 'text-right text-caption text-destructive'}>
        {m.group.weightsSum(sum)} — {m.group.weightsSumNote}
      </p>
    </div>
  );
}
