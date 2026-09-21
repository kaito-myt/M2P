'use client';

/**
 * CustomRolesPanel — カスタム AI ロールの一覧 (削除) と作成フォーム (docs/11 §5.4)。
 * 作成すると `prompts` にシステムプロンプト v1、`model_assignments` に割当ができ、上の「AI モデル設定」表にも
 * 行として現れる (以後のモデル変更はそちらで行う)。
 */
import { useState, useTransition } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { createAnpAgentRole, deleteAnpAgentRole } from '@/app/actions/model-settings';
import { messages } from '@/lib/messages';
import type { CatalogOption, CustomRoleMeta, ModelProvider } from '@/lib/model-settings-core';

const PROVIDER_LABEL: Record<ModelProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };
const m = messages.settings.customRoles;

export function CustomRolesPanel({ roles, catalog }: { roles: CustomRoleMeta[]; catalog: Record<ModelProvider, CatalogOption[]> }) {
  const [list, setList] = useState(roles);
  const [open, setOpen] = useState(roles.length === 0);
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [provider, setProvider] = useState<ModelProvider>('anthropic');
  const [model, setModel] = useState<string>(catalog.anthropic[0]?.model ?? '');
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<'create' | string | null>(null);
  const [, startTransition] = useTransition();

  const options = catalog[provider] ?? [];
  const canCreate = /^[a-z][a-z0-9_]{1,30}$/.test(slug) && label.trim().length > 0 && systemPrompt.trim().length >= 20 && model.length > 0;

  const create = () => {
    setBusy('create');
    setMessage(null);
    startTransition(async () => {
      const res = await createAnpAgentRole({ slug, label, description, system_prompt: systemPrompt, provider, model });
      if (res.ok) {
        setList((prev) => [...prev, { role: res.data.role, label: label.trim(), description: description.trim() || null, created_at: new Date().toISOString() }]);
        setSlug('');
        setLabel('');
        setDescription('');
        setSystemPrompt('');
        setMessage({ tone: 'ok', text: m.created(res.data.role) });
      } else setMessage({ tone: 'err', text: res.error });
      setBusy(null);
    });
  };

  const remove = (role: string, roleLabel: string) => {
    if (!window.confirm(m.confirmDelete(roleLabel))) return;
    setBusy(role);
    setMessage(null);
    startTransition(async () => {
      const res = await deleteAnpAgentRole({ role });
      if (res.ok) {
        setList((prev) => prev.filter((r) => r.role !== role));
        setMessage({ tone: 'ok', text: m.deleted });
      } else setMessage({ tone: 'err', text: res.error });
      setBusy(null);
    });
  };

  return (
    <div className="flex flex-col gap-space-snug" data-testid="custom-roles-panel">
      {list.length === 0 ? (
        <p className="text-body text-muted">{m.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => (
            <li key={r.role} className="flex items-start justify-between gap-3 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
              <div className="min-w-0">
                <p className="text-body font-medium text-charcoal">
                  {r.label} <code className="ml-1 text-caption text-muted">{r.role}</code>
                </p>
                {r.description && <p className="mt-0.5 text-caption text-muted">{r.description}</p>}
                <p className="mt-0.5 text-caption text-muted">{m.createdAt(new Date(r.created_at).toLocaleString('ja-JP'))}</p>
              </div>
              <button
                type="button"
                onClick={() => remove(r.role, r.label)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-card border border-border-warm bg-white px-2.5 py-1.5 text-button-sm text-red-700 disabled:opacity-50"
                data-testid={`custom-role-delete-${r.role}`}
              >
                {busy === r.role ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} {m.delete}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-container border border-border-warm bg-white p-space-relaxed">
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-body font-medium text-charcoal" aria-expanded={open} data-testid="custom-role-toggle-form">
          <Plus className="h-4 w-4" /> {m.createTitle}
        </button>
        {open && (
          <form
            className="mt-space-snug flex flex-col gap-space-snug"
            onSubmit={(e) => {
              e.preventDefault();
              if (canCreate) create();
            }}
          >
            <div className="grid grid-cols-1 gap-space-snug sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-caption text-muted">
                {m.slug}
                <div className="flex items-center rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal">
                  <span className="text-muted">anp.</span>
                  <input value={slug} onChange={(e) => setSlug(e.target.value.trim().toLowerCase())} maxLength={31} placeholder={m.slugPlaceholder} className="min-w-0 flex-1 bg-transparent outline-none" data-testid="custom-role-slug" />
                </div>
                <span className="text-caption text-muted">{m.slugHint}</span>
              </label>
              <label className="flex flex-col gap-1 text-caption text-muted">
                {m.label}
                <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder={m.labelPlaceholder} className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal" data-testid="custom-role-label" />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-caption text-muted">
              {m.descriptionField}
              <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder={m.descriptionPlaceholder} className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal" data-testid="custom-role-description" />
            </label>
            <label className="flex flex-col gap-1 text-caption text-muted">
              {m.systemPrompt}
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={8} maxLength={20000} placeholder={m.systemPromptPlaceholder} className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal" data-testid="custom-role-prompt" />
              <span className="text-caption text-muted">{m.systemPromptHint}</span>
            </label>
            <div className="grid grid-cols-1 gap-space-snug sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-caption text-muted">
                {m.provider}
                <select
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value as ModelProvider;
                    setProvider(p);
                    setModel(catalog[p][0]?.model ?? '');
                  }}
                  className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal"
                  data-testid="custom-role-provider"
                >
                  {(Object.keys(PROVIDER_LABEL) as ModelProvider[]).map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-caption text-muted">
                {m.model}
                <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal" data-testid="custom-role-model">
                  {options.map((o) => (
                    <option key={o.model} value={o.model}>
                      {o.model}
                      {o.available === null ? messages.settings.models.unverifiedSuffix : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={busy !== null || !canCreate} className="inline-flex items-center gap-1.5 rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50" data-testid="custom-role-create">
                {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {m.create}
              </button>
              <span className="text-caption text-muted">{m.wiringNotice}</span>
            </div>
          </form>
        )}
        {message && (
          <p role={message.tone === 'err' ? 'alert' : undefined} className={`mt-2 text-caption ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
