'use client';

/**
 * ModelsPanel — `anp.*` 役割ごとの provider/model セレクタ。行単位で保存する。
 */
import { useState, useTransition } from 'react';
import { Check, Loader2, ShieldAlert } from 'lucide-react';

import { setAnpModelAssignment } from '@/app/actions/model-settings';
import { messages } from '@/lib/messages';
import type { AnpRoleAssignmentRow, CatalogOption, ModelProvider } from '@/lib/model-settings-core';

const PROVIDER_LABEL: Record<ModelProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };
const mm = messages.settings.models;

export function ModelsPanel({ rows, catalog }: { rows: AnpRoleAssignmentRow[]; catalog: Record<ModelProvider, CatalogOption[]> }) {
  return (
    <div className="overflow-x-auto rounded-container border border-border-warm">
      <table className="w-full min-w-[760px] border-collapse text-body">
        <thead>
          <tr className="border-b border-border-warm bg-cream-light text-caption text-muted">
            <th className="px-3 py-2 text-left font-medium">{mm.columnRole}</th>
            <th className="px-3 py-2 text-left font-medium">{mm.columnCurrent}</th>
            <th className="px-3 py-2 text-left font-medium">{mm.columnChange}</th>
            <th className="px-3 py-2 text-left font-medium">{mm.columnPrice}</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <RoleRow key={row.role} row={row} catalog={catalog} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleRow({ row, catalog }: { row: AnpRoleAssignmentRow; catalog: Record<ModelProvider, CatalogOption[]> }) {
  const [current, setCurrent] = useState({ provider: row.provider, model: row.model, activated_at: row.activated_at });
  const [provider, setProvider] = useState<ModelProvider>(row.provider ?? 'anthropic');
  const [model, setModel] = useState<string>(row.model ?? catalog[row.provider ?? 'anthropic'][0]?.model ?? '');
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const options = catalog[provider] ?? [];
  const selected = options.find((o) => o.model === model) ?? null;
  const dirty = provider !== current.provider || model !== current.model;

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await setAnpModelAssignment({ role: row.role, provider, model });
      if (res.ok) {
        setCurrent({ provider, model, activated_at: new Date().toISOString() });
        setMessage({ tone: 'ok', text: mm.saved });
      } else setMessage({ tone: 'err', text: res.error });
    });
  };

  return (
    <tr className="border-b border-border-warm align-top last:border-b-0" data-testid={`anp-model-row-${row.role}`}>
      <td className="px-3 py-2.5">
        <div className="font-medium text-charcoal">{row.label}</div>
        <div className="font-mono text-caption text-muted">{row.role}</div>
        {row.description && <div className="mt-0.5 text-caption text-muted">{row.description}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {current.model ? (
          <>
            <div className="font-mono text-caption text-charcoal">
              {PROVIDER_LABEL[current.provider ?? 'anthropic']} / {current.model}
            </div>
            <div className="text-caption text-muted">{current.activated_at ? new Date(current.activated_at).toLocaleString('ja-JP') : ''}</div>
            {row.unavailable && current.model === row.model && (
              <div className="mt-0.5 inline-flex items-center gap-1 text-caption text-amber-700">
                <ShieldAlert className="h-3 w-3" /> {mm.unavailableNotice}
              </div>
            )}
          </>
        ) : (
          <span className="text-caption text-amber-700">{mm.unassigned}</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-2">
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as ModelProvider;
              setProvider(p);
              setModel(catalog[p][0]?.model ?? '');
            }}
            className="rounded-card border border-border-warm bg-white px-2 py-1.5 text-body text-charcoal"
            aria-label="provider"
          >
            {(Object.keys(PROVIDER_LABEL) as ModelProvider[]).map((p) => (
              <option key={p} value={p} disabled={catalog[p].length === 0}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="max-w-[280px] rounded-card border border-border-warm bg-white px-2 py-1.5 font-mono text-caption text-charcoal"
            aria-label="model"
          >
            {options.map((o) => (
              <option key={o.model} value={o.model}>
                {o.model}
                {o.available === null ? mm.unverifiedSuffix : ''}
              </option>
            ))}
          </select>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-caption text-muted">
        {selected ? `$${selected.input_price_per_mtok_usd} / $${selected.output_price_per_mtok_usd}` : '—'}
      </td>
      <td className="px-3 py-2.5">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || isPending || !model}
          className="inline-flex items-center gap-1 rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {mm.save}
        </button>
        {message && <div className={`mt-1 text-caption ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{message.text}</div>}
      </td>
    </tr>
  );
}
