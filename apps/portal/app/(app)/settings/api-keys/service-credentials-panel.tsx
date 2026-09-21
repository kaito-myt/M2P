'use client';

/**
 * ServiceCredentialsPanel — サービス連携 (R2 / LINE / Amazon Ads) の多項目フォーム
 * (状態 / 保存 / 環境変数から取り込み / 疎通テスト / 削除)。仕様は @a2p/credentials/spec の SERVICE_PROVIDER_META。
 */
import { useState, useTransition } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Plug, ShieldAlert, Trash2 } from 'lucide-react';

import { importServiceCredentialsFromEnv, revokeServiceCredentials, setServiceCredentials, testServiceCredentials } from '@/app/actions/settings';
import type { ApiKeyTestResult, ServiceFields, ServiceProvider, ServiceProviderMeta } from '@/lib/settings-core';

export interface ServiceCredentialRowView {
  provider: ServiceProvider;
  meta: ServiceProviderMeta;
  configured: boolean;
  /** 秘密項目をマスクした現在値 (DB 登録時のみ)。 */
  masked_fields: ServiceFields | null;
  key_mask: string | null;
  set_at: string | null;
  last_tested_at: string | null;
  last_test: ApiKeyTestResult | null;
  /** ポータルの環境変数に必須項目が揃っているか。 */
  env_configured: boolean;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('ja-JP') : '—';
}

export function ServiceCredentialsPanel({ rows }: { rows: ServiceCredentialRowView[] }) {
  return (
    <section className="mt-6 grid grid-cols-1 gap-5">
      {rows.map((row) => (
        <ServiceCard key={row.provider} row={row} />
      ))}
    </section>
  );
}

function initialInputs(row: ServiceCredentialRowView): ServiceFields {
  const out: ServiceFields = {};
  for (const f of row.meta.fields) {
    // 非秘密項目は現在値を初期表示、秘密項目は空 (空のまま保存 = 変更なし)。
    if (!f.secret) out[f.key] = row.masked_fields?.[f.key] ?? (f.options ? f.options[0]!.value : '');
    else out[f.key] = '';
  }
  return out;
}

function ServiceCard({ row }: { row: ServiceCredentialRowView }) {
  const [state, setState] = useState<ServiceCredentialRowView>(row);
  const [inputs, setInputs] = useState<ServiceFields>(() => initialInputs(row));
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'revoke' | 'import' | null>(null);
  const [, startTransition] = useTransition();

  const canSave = state.meta.fields.every((f) => {
    if (!f.required) return true;
    const v = (inputs[f.key] ?? '').trim();
    if (v.length > 0) return true;
    // 既存の秘密項目は空欄で「変更なし」
    return f.secret && !!state.masked_fields?.[f.key];
  });

  const run = (kind: 'save' | 'test' | 'revoke' | 'import') => {
    setBusy(kind);
    setMessage(null);
    startTransition(async () => {
      if (kind === 'save') {
        const fields: ServiceFields = {};
        for (const f of state.meta.fields) fields[f.key] = (inputs[f.key] ?? '').trim();
        const res = await setServiceCredentials({ provider: state.provider, fields });
        if (res.ok) {
          setState((s) => ({ ...s, configured: true, key_mask: res.data.key_mask, masked_fields: res.data.masked_fields, set_at: new Date().toISOString(), last_tested_at: null, last_test: null }));
          setInputs((prev) => {
            const next = { ...prev };
            for (const f of state.meta.fields) if (f.secret) next[f.key] = '';
            return next;
          });
          setMessage({ tone: 'ok', text: '保存しました。「疎通テスト」で確認できます。1 分以内に各ツールへ反映されます。' });
        } else setMessage({ tone: 'err', text: res.error });
      } else if (kind === 'import') {
        const res = await importServiceCredentialsFromEnv({ provider: state.provider });
        if (res.ok) {
          setState((s) => ({ ...s, configured: true, key_mask: res.data.key_mask, masked_fields: res.data.masked_fields, set_at: new Date().toISOString(), last_tested_at: null, last_test: null }));
          setInputs((prev) => {
            const next = { ...prev };
            for (const f of state.meta.fields) next[f.key] = f.secret ? '' : (res.data.masked_fields[f.key] ?? '');
            return next;
          });
          setMessage({ tone: 'ok', text: '環境変数の接続情報を DB に取り込みました。以後は M2P の設定が優先されます。' });
        } else setMessage({ tone: 'err', text: res.error });
      } else if (kind === 'test') {
        const res = await testServiceCredentials({ provider: state.provider });
        if (res.ok) {
          setState((s) => ({ ...s, last_tested_at: new Date().toISOString(), last_test: res.data }));
          setMessage({ tone: res.data.ok ? 'ok' : 'err', text: res.data.message });
        } else setMessage({ tone: 'err', text: res.error });
      } else {
        if (!window.confirm(`${state.meta.label} の接続情報を削除しますか？ 環境変数が無ければこのサービスを使う処理は停止します。`)) {
          setBusy(null);
          return;
        }
        const res = await revokeServiceCredentials({ provider: state.provider });
        if (res.ok) {
          setState((s) => ({ ...s, configured: false, key_mask: null, masked_fields: null, set_at: null, last_tested_at: null, last_test: null }));
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
  ) : state.env_configured ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-300">
      <CheckCircle2 className="h-3 w-3" /> 環境変数にて設定済み
    </span>
  ) : (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/45">未設定</span>
  );

  return (
    <article className="glass rounded-[18px] p-5" data-testid={`service-card-${state.provider}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/80">
            <Plug className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-white">{state.meta.label}</h2>
            <p className="text-[12px] text-white/45">{state.meta.description}</p>
          </div>
        </div>
        {statusChip}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
        <dt className="text-white/40">現在の設定</dt>
        <dd className="font-mono text-white/80">
          {state.key_mask ?? (state.env_configured ? <span className="font-sans text-white/60">環境変数 (DB 未登録)</span> : '—')}
          {state.key_mask && state.env_configured && <span className="ml-2 font-sans text-[11px] text-white/40">環境変数にも設定あり (DB 優先)</span>}
        </dd>
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
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) run('save');
        }}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {state.meta.fields.map((f) => {
            const current = state.masked_fields?.[f.key];
            const placeholder = f.secret
              ? current
                ? `${current} (変更しない場合は空欄)`
                : f.hint ?? ''
              : f.hint ?? '';
            return (
              <label key={f.key} className="flex flex-col gap-1 text-[12px] text-white/55">
                <span>
                  {f.label}
                  {f.required && <span className="ml-1 text-amber-300/80">*</span>}
                </span>
                {f.options ? (
                  <select value={inputs[f.key] ?? ''} onChange={(e) => setInputs((p) => ({ ...p, [f.key]: e.target.value }))} className="field text-[14px]" data-testid={`service-input-${state.provider}-${f.key}`}>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.secret ? 'password' : 'text'}
                    value={inputs[f.key] ?? ''}
                    onChange={(e) => setInputs((p) => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    className="field text-[14px]"
                    data-testid={`service-input-${state.provider}-${f.key}`}
                  />
                )}
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy !== null || !canSave} className="btn-primary rounded-xl px-4 py-2 text-[13px]">
            {busy === 'save' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : state.configured ? '更新して保存' : '保存'}
          </button>
          {state.env_configured && !state.configured && (
            <button type="button" onClick={() => run('import')} disabled={busy !== null} className="btn-ghost rounded-xl px-4 py-2 text-[13px] text-sky-200 disabled:opacity-40">
              {busy === 'import' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : '環境変数の設定を DB に取り込む'}
            </button>
          )}
          <button type="button" onClick={() => run('test')} disabled={busy !== null || !state.configured} className="btn-ghost rounded-xl px-4 py-2 text-[13px] disabled:opacity-40">
            {busy === 'test' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : '疎通テスト'}
          </button>
          <button type="button" onClick={() => run('revoke')} disabled={busy !== null || !state.configured} className="btn-ghost inline-flex items-center gap-1 rounded-xl px-3 py-2 text-[13px] text-red-300/80 disabled:opacity-40">
            <Trash2 className="h-3.5 w-3.5" /> 削除
          </button>
          <a href={state.meta.consoleUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[12px] text-white/45 no-underline hover:text-white/75">
            発行ページ <ExternalLink className="h-3 w-3" />
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
