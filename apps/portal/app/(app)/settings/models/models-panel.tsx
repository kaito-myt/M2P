'use client';

/**
 * ModelsPanel — 役割ごとの provider/model セレクタ (グループ別)。行単位で保存する。
 */
import { useState, useTransition } from 'react';
import { Check, Loader2, ShieldAlert } from 'lucide-react';

import { setModelAssignment } from '@/app/actions/settings';
import type { CatalogOption, ModelProvider, RoleAssignmentRow, RoleGroup } from '@/lib/settings-core';

const PROVIDER_LABEL: Record<ModelProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };

export interface ModelsPanelProps {
  groups: Array<{ group: RoleGroup; label: string; rows: RoleAssignmentRow[] }>;
  catalog: Record<ModelProvider, CatalogOption[]>;
}

export function ModelsPanel({ groups, catalog }: ModelsPanelProps) {
  return (
    <div className="mt-8 flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.group} className="glass rounded-[18px] p-5" aria-label={g.label}>
          <h2 className="text-[15px] font-semibold text-white">{g.label}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-white/35">
                  <th className="py-2 pr-3 font-medium">役割</th>
                  <th className="py-2 pr-3 font-medium">現在</th>
                  <th className="py-2 pr-3 font-medium">変更</th>
                  <th className="py-2 pr-3 font-medium">料金 (入力/出力 $/1M tok)</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row) => (
                  <RoleRow key={row.role} row={row} catalog={catalog} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function RoleRow({ row, catalog }: { row: RoleAssignmentRow; catalog: Record<ModelProvider, CatalogOption[]> }) {
  const [current, setCurrent] = useState<{ provider: ModelProvider | null; model: string | null; activated_at: string | null }>({
    provider: row.provider,
    model: row.model,
    activated_at: row.activated_at,
  });
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
      const res = await setModelAssignment({ role: row.role, provider, model });
      if (res.ok) {
        setCurrent({ provider, model, activated_at: new Date().toISOString() });
        setMessage({ tone: 'ok', text: '保存しました' });
      } else setMessage({ tone: 'err', text: res.error });
    });
  };

  return (
    <tr className="border-t border-white/[0.06] align-top" data-testid={`model-row-${row.role}`}>
      <td className="py-2.5 pr-3">
        <div className="font-medium text-white/85">{row.label}</div>
        <div className="font-mono text-[11px] text-white/35">
          {row.role}
          {row.genre_override_count > 0 ? ` ・ ジャンル別上書き ${row.genre_override_count} 件` : ''}
        </div>
      </td>
      <td className="py-2.5 pr-3 text-white/70">
        {current.model ? (
          <>
            <div className="font-mono text-[12.5px]">
              {PROVIDER_LABEL[current.provider ?? 'anthropic']} / {current.model}
            </div>
            <div className="text-[11px] text-white/35">{current.activated_at ? new Date(current.activated_at).toLocaleString('ja-JP') : ''}</div>
            {row.unavailable && current.model === row.model && (
              <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-300">
                <ShieldAlert className="h-3 w-3" /> 呼び出し不可と判定
              </div>
            )}
          </>
        ) : (
          <span className="text-amber-300/90">未割当 (呼出時にエラー)</span>
        )}
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as ModelProvider;
              setProvider(p);
              setModel(catalog[p][0]?.model ?? '');
            }}
            className="field w-auto px-2 py-1.5 text-[13px]"
            aria-label="provider"
          >
            {(Object.keys(PROVIDER_LABEL) as ModelProvider[]).map((p) => (
              <option key={p} value={p} disabled={catalog[p].length === 0}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="field w-auto max-w-[280px] px-2 py-1.5 font-mono text-[12.5px]" aria-label="model">
            {options.map((o) => (
              <option key={o.model} value={o.model}>
                {o.model}
                {o.available === null ? ' (未検証)' : ''}
              </option>
            ))}
          </select>
        </div>
      </td>
      <td className="py-2.5 pr-3 font-mono text-[12px] text-white/55">
        {selected ? `$${selected.input_price_per_mtok_usd} / $${selected.output_price_per_mtok_usd}` : '—'}
      </td>
      <td className="py-2.5">
        <button type="button" onClick={save} disabled={!dirty || isPending || !model} className="btn-primary inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12.5px]">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          保存
        </button>
        {message && (
          <div className={`mt-1 text-[11.5px] ${message.tone === 'ok' ? 'text-emerald-300' : 'text-amber-300'}`}>{message.text}</div>
        )}
      </td>
    </tr>
  );
}
