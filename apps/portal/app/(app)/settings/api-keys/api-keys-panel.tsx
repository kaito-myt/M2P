'use client';

/**
 * ApiKeysPanel — サービサーごとのカード (状態 / 保存 / 疎通テスト / 削除)。
 */
import { useState, useTransition } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldAlert, Trash2 } from 'lucide-react';

import { revokeApiKey, setApiKey, testApiKey } from '@/app/actions/settings';
import type { ApiKeyTestResult, ApiProvider, ApiProviderMeta } from '@/lib/settings-core';

export interface ApiKeyRowView {
  provider: ApiProvider;
  meta: ApiProviderMeta;
  configured: boolean;
  key_mask: string | null;
  set_at: string | null;
  last_tested_at: string | null;
  last_test: ApiKeyTestResult | null;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('ja-JP') : '—';
}

export function ApiKeysPanel({ rows }: { rows: ApiKeyRowView[] }) {
  return (
    <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
      {rows.map((row) => (
        <ApiKeyCard key={row.provider} row={row} />
      ))}
    </section>
  );
}

function ApiKeyCard({ row }: { row: ApiKeyRowView }) {
  const [state, setState] = useState<ApiKeyRowView>(row);
  const [input, setInput] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'revoke' | null>(null);
  const [, startTransition] = useTransition();

  const run = (kind: 'save' | 'test' | 'revoke') => {
    setBusy(kind);
    setMessage(null);
    startTransition(async () => {
      if (kind === 'save') {
        const res = await setApiKey({ provider: state.provider, key: input });
        if (res.ok) {
          setState((s) => ({ ...s, configured: true, key_mask: res.data.key_mask, set_at: new Date().toISOString(), last_tested_at: null, last_test: null }));
          setInput('');
          setMessage({ tone: 'ok', text: '保存しました。「疎通テスト」で確認できます。' });
        } else setMessage({ tone: 'err', text: res.error });
      } else if (kind === 'test') {
        const res = await testApiKey({ provider: state.provider });
        if (res.ok) {
          setState((s) => ({ ...s, last_tested_at: new Date().toISOString(), last_test: res.data }));
          setMessage({ tone: res.data.ok ? 'ok' : 'err', text: res.data.message });
        } else setMessage({ tone: 'err', text: res.error });
      } else {
        if (!window.confirm(`${state.meta.label} のキーを削除しますか？ このサービサーを使う処理は環境変数のキーが無ければ失敗します。`)) {
          setBusy(null);
          return;
        }
        const res = await revokeApiKey({ provider: state.provider });
        if (res.ok) {
          setState((s) => ({ ...s, configured: false, key_mask: null, set_at: null, last_tested_at: null, last_test: null }));
          setMessage({ tone: 'ok', text: '削除しました。' });
        } else setMessage({ tone: 'err', text: res.error });
      }
      setBusy(null);
    });
  };

  const statusChip = state.configured ? (
    state.last_test ? (
      state.last_test.ok ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-300">
          <CheckCircle2 className="h-3 w-3" /> 疎通 OK
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300">
          <ShieldAlert className="h-3 w-3" /> テスト失敗
        </span>
      )
    ) : (
      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/55">設定済み (未テスト)</span>
    )
  ) : (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/45">未設定</span>
  );

  return (
    <article className="glass rounded-[18px] p-5" data-testid={`api-key-card-${state.provider}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/80">
            <KeyRound className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-white">{state.meta.label}</h2>
            <p className="text-[12px] text-white/45">{state.meta.description}</p>
          </div>
        </div>
        {statusChip}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
        <dt className="text-white/40">現在のキー</dt>
        <dd className="font-mono text-white/80">{state.key_mask ?? '—'}</dd>
        <dt className="text-white/40">設定日時</dt>
        <dd className="text-white/70">{fmt(state.set_at)}</dd>
        <dt className="text-white/40">最終テスト</dt>
        <dd className="text-white/70">
          {fmt(state.last_tested_at)}
          {state.last_test ? ` — ${state.last_test.message}` : ''}
        </dd>
        <dt className="text-white/40">用途</dt>
        <dd className="text-white/70">{state.meta.usedFor}</dd>
      </dl>

      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim().length >= 8) run('save');
        }}
      >
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={state.configured ? `新しいキーで置き換える (${state.meta.keyHint})` : `キーを貼り付け (${state.meta.keyHint})`}
          autoComplete="off"
          spellCheck={false}
          className="field text-[14px]"
          data-testid={`api-key-input-${state.provider}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy !== null || input.trim().length < 8} className="btn-primary rounded-xl px-4 py-2 text-[13px]">
            {busy === 'save' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : state.configured ? '置き換えて保存' : '保存'}
          </button>
          <button type="button" onClick={() => run('test')} disabled={busy !== null || !state.configured} className="btn-ghost rounded-xl px-4 py-2 text-[13px] disabled:opacity-40">
            {busy === 'test' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : '疎通テスト'}
          </button>
          <button type="button" onClick={() => run('revoke')} disabled={busy !== null || !state.configured} className="btn-ghost inline-flex items-center gap-1 rounded-xl px-3 py-2 text-[13px] text-red-300/80 disabled:opacity-40">
            <Trash2 className="h-3.5 w-3.5" /> 削除
          </button>
          <a href={state.meta.consoleUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[12px] text-white/45 no-underline hover:text-white/75">
            キー発行ページ <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {message && (
          <p role={message.tone === 'err' ? 'alert' : undefined} className={`text-[12.5px] ${message.tone === 'ok' ? 'text-emerald-300' : 'text-amber-300'}`}>
            {message.text}
          </p>
        )}
      </form>
    </article>
  );
}
