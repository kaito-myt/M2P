'use client';

/**
 * LinkedAccountCard — 販促施策の媒体タブごとの「投稿先アカウント連携」(F-ANP-33)。
 *   - X: OAuth 1.0a の 4 項目 + @handle。保存 / 疎通テスト / 解除。
 *   - Instagram / TikTok: Zernio に接続済みのアカウントから選ぶ (未設定なら Zernio アカウント id を手入力)。
 *   - ブログ: 所有ブログは A2P 共通のため連携対象外 (案内のみ)。
 * 未連携の間は channel 既定 (A2P 共通ペルソナ) に投稿される旨を明示する。
 */
import { useState, useTransition } from 'react';
import { CheckCircle2, ExternalLink, Link2, Loader2, ShieldAlert, Unlink } from 'lucide-react';

import { getZernioAccounts, linkPromotionAccount, startZernioConnect, testPromotionAccount, unlinkPromotionAccount } from '@/app/actions/promotion-accounts';
import { messages } from '@/lib/messages';
import type { LinkedPromotionAccountView } from '@/lib/promotion-accounts-core';
import type { NotePromotionChannel } from '@/lib/promotion-view';
import type { ZernioAccountView } from '@/lib/zernio';

const m = messages.promotion.link;

export function LinkedAccountCard({
  noteAccountId,
  channel,
  initial,
  zernio,
  flash,
}: {
  noteAccountId: string;
  channel: NotePromotionChannel;
  initial: LinkedPromotionAccountView;
  zernio: { configured: boolean; accounts: ZernioAccountView[] } | null;
  /** Zernio OAuth の戻りの結果表示。 */
  flash: { tone: 'ok' | 'err'; text: string } | null;
}) {
  const [state, setState] = useState(initial);
  const [handle, setHandle] = useState(initial.handle ?? '');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accessTokenSecret, setAccessTokenSecret] = useState('');
  const [zernioId, setZernioId] = useState(initial.zernio_account_id ?? '');
  const [zernioList, setZernioList] = useState(zernio);
  const [open, setOpen] = useState(!initial.connected);
  // X: 既定は Zernio。OAuth1 直接は「上級」として折りたたみ (運営者要望 2026-09-22「X も Zernio にしたい」)。
  const [xDirect, setXDirect] = useState(channel === 'x' && initial.connected && !initial.zernio_account_id);
  const [busy, setBusy] = useState<'save' | 'test' | 'unlink' | 'reload' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(flash);
  const [connecting, setConnecting] = useState(false);
  const [, startTransition] = useTransition();

  const connectViaZernio = () => {
    setConnecting(true);
    setMessage(null);
    startTransition(async () => {
      const res = await startZernioConnect({ note_account_id: noteAccountId, channel });
      if (res.ok) {
        window.location.assign(res.data.url);
        return;
      }
      setConnecting(false);
      setMessage({ tone: 'err', text: res.error });
    });
  };

  const fieldClass = 'w-full rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal disabled:opacity-60';

  if (channel === 'blog') {
    return (
      <section className="rounded-container border border-border-warm bg-white p-space-relaxed" data-testid="linked-account-blog">
        <h2 className="text-card-title font-medium text-charcoal">{m.title}</h2>
        <p className="mt-1 text-caption text-muted">{m.blogNotice}</p>
      </section>
    );
  }

  const useDirectX = channel === 'x' && xDirect;
  const canSaveX = useDirectX && ((apiKey && apiSecret && accessToken && accessTokenSecret) || (state.connected && !state.zernio_account_id && !apiKey && !apiSecret && !accessToken && !accessTokenSecret));
  const canSaveZernio = !useDirectX && zernioId.trim().length > 0;
  const canSave = useDirectX ? Boolean(canSaveX) : canSaveZernio;

  const run = (kind: 'save' | 'test' | 'unlink' | 'reload') => {
    setBusy(kind);
    setMessage(null);
    startTransition(async () => {
      if (kind === 'save') {
        const res = useDirectX
          ? await linkPromotionAccount({ note_account_id: noteAccountId, channel: 'x', handle, api_key: apiKey, api_secret: apiSecret, access_token: accessToken, access_token_secret: accessTokenSecret })
          : await linkPromotionAccount({ note_account_id: noteAccountId, channel, handle, zernio_account_id: zernioId.trim() });
        if (res.ok) {
          setState(res.data);
          setApiKey('');
          setApiSecret('');
          setAccessToken('');
          setAccessTokenSecret('');
          setOpen(false);
          setMessage({ tone: 'ok', text: m.saved });
        } else setMessage({ tone: 'err', text: res.error });
      } else if (kind === 'test') {
        const res = await testPromotionAccount({ note_account_id: noteAccountId, channel });
        if (res.ok) {
          setState(res.data);
          setMessage({ tone: res.data.last_test?.ok ? 'ok' : 'err', text: res.data.last_test?.message ?? '' });
        } else setMessage({ tone: 'err', text: res.error });
      } else if (kind === 'unlink') {
        if (!window.confirm(m.confirmUnlink)) {
          setBusy(null);
          return;
        }
        const res = await unlinkPromotionAccount({ note_account_id: noteAccountId, channel });
        if (res.ok) {
          setState(res.data);
          setOpen(true);
          setMessage({ tone: 'ok', text: m.unlinked });
        } else setMessage({ tone: 'err', text: res.error });
      } else {
        const res = await getZernioAccounts({ channel });
        if (res.ok) setZernioList(res.data);
        else setMessage({ tone: 'err', text: res.error });
      }
      setBusy(null);
    });
  };

  const statusChip = state.connected ? (
    state.last_test ? (
      state.last_test.ok ? (
        <span className="inline-flex items-center gap-1 rounded-pill border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-caption text-emerald-700">
          <CheckCircle2 className="h-3 w-3" /> {m.statusOk}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-pill border border-amber-300 bg-amber-50 px-2 py-0.5 text-caption text-amber-700">
          <ShieldAlert className="h-3 w-3" /> {m.statusTestFailed}
        </span>
      )
    ) : (
      <span className="rounded-pill border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-caption text-emerald-700">{m.statusLinked}</span>
    )
  ) : (
    <span className="rounded-pill border border-border-warm bg-white px-2 py-0.5 text-caption text-muted">{m.statusNotLinked}</span>
  );

  const zernioOptions = zernioList?.accounts ?? [];
  const selectedZernio = zernioOptions.find((a) => a.id === (state.zernio_account_id ?? ''));

  return (
    <section className="rounded-container border border-border-warm bg-white p-space-relaxed" data-testid={`linked-account-${channel}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-card-title font-medium text-charcoal">{m.title}</h2>
          <p className="mt-1 text-caption text-muted">{state.connected ? m.linkedDescription : m.notLinkedDescription}</p>
        </div>
        {statusChip}
      </div>

      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
        <dt className="text-muted">{m.currentHandle}</dt>
        <dd className="text-charcoal">{state.handle ? `@${state.handle}` : '—'}</dd>
        {channel === 'x' && !state.zernio_account_id && state.token_mask && (
          <>
            <dt className="text-muted">{m.currentCredentials}</dt>
            <dd className="font-mono text-charcoal">{state.token_mask}</dd>
          </>
        )}
        {(channel !== 'x' || state.zernio_account_id || !state.token_mask) && (
          <>
            <dt className="text-muted">{m.currentZernio}</dt>
            <dd className="text-charcoal">
              {state.zernio_account_id ? (selectedZernio ? `${selectedZernio.label} (${state.zernio_account_id})` : state.zernio_account_id) : '—'}
              {selectedZernio?.profileUrl && (
                <a href={selectedZernio.profileUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-charcoal underline">
                  {m.openProfile} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </dd>
          </>
        )}
        {state.last_test && (
          <>
            <dt className="text-muted">{m.lastTest}</dt>
            <dd className={state.last_test.ok ? 'text-emerald-700' : 'text-red-600'}>
              {state.last_test.message}
              {state.last_test.at ? ` (${new Date(state.last_test.at).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })})` : ''}
            </dd>
          </>
        )}
      </dl>

      <div className="mt-space-snug flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal" aria-expanded={open} data-testid={`linked-account-toggle-${channel}`}>
          <Link2 className="h-3.5 w-3.5" /> {state.connected ? m.editLink : m.startLink}
        </button>
        <button type="button" onClick={() => run('test')} disabled={busy !== null || !state.connected} className="rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50" data-testid={`linked-account-test-${channel}`}>
          {busy === 'test' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : m.test.button}
        </button>
        <button type="button" onClick={() => run('unlink')} disabled={busy !== null || !state.exists} className="inline-flex items-center gap-1 rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-red-700 disabled:opacity-50" data-testid={`linked-account-unlink-${channel}`}>
          <Unlink className="h-3.5 w-3.5" /> {m.unlink}
        </button>
      </div>

      {open && (
        <form
          className="mt-space-snug flex flex-col gap-space-snug rounded-card border border-border-warm bg-cream-light p-space-relaxed"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) run('save');
          }}
        >
          <label className="flex flex-col gap-1 text-caption text-muted">
            {m.handle}
            <input value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={64} placeholder={m.handlePlaceholder} className={fieldClass} data-testid={`linked-account-handle-${channel}`} />
          </label>
          {channel === 'x' && (
            <label className="flex items-center gap-2 text-caption text-muted">
              <input type="checkbox" checked={xDirect} onChange={(e) => setXDirect(e.target.checked)} />
              {m.xDirectToggle}
            </label>
          )}
          {useDirectX ? (
            <>
              <p className="text-caption text-muted">{m.xHint}</p>
              <div className="grid grid-cols-1 gap-space-snug sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-caption text-muted">
                  {m.xApiKey}
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" className={fieldClass} data-testid="linked-account-x-api-key" />
                </label>
                <label className="flex flex-col gap-1 text-caption text-muted">
                  {m.xApiSecret}
                  <input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" className={fieldClass} data-testid="linked-account-x-api-secret" />
                </label>
                <label className="flex flex-col gap-1 text-caption text-muted">
                  {m.xAccessToken}
                  <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} autoComplete="off" className={fieldClass} data-testid="linked-account-x-access-token" />
                </label>
                <label className="flex flex-col gap-1 text-caption text-muted">
                  {m.xAccessTokenSecret}
                  <input type="password" value={accessTokenSecret} onChange={(e) => setAccessTokenSecret(e.target.value)} autoComplete="off" className={fieldClass} data-testid="linked-account-x-access-token-secret" />
                </label>
              </div>
              {state.connected && <p className="text-caption text-muted">{m.xKeepHint}</p>}
              <a href="https://developer.x.com/en/portal/dashboard" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-caption text-charcoal underline">
                {m.xConsole} <ExternalLink className="h-3 w-3" />
              </a>
            </>
          ) : (
            <>
              <p className="text-caption text-muted">{m.zernioHint(messages.promotion.channelLabel[channel])}</p>
              {zernioList?.configured && (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={connectViaZernio}
                    disabled={busy !== null || connecting}
                    className="inline-flex w-fit items-center gap-1.5 rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
                    data-testid={`linked-account-zernio-connect-${channel}`}
                  >
                    {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    {connecting ? m.connecting : m.connectViaZernio}
                  </button>
                  <span className="text-caption text-muted">{m.connectViaZernioHint}</span>
                </div>
              )}
              {zernioList?.configured ? (
                <label className="flex flex-col gap-1 text-caption text-muted">
                  {m.zernioAccount}
                  <select value={zernioId} onChange={(e) => setZernioId(e.target.value)} className={fieldClass} data-testid={`linked-account-zernio-${channel}`}>
                    <option value="">{m.zernioSelect}</option>
                    {zernioOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                        {a.needsReconnection ? m.zernioNeedsReconnectSuffix : ''}
                      </option>
                    ))}
                  </select>
                  {zernioOptions.length === 0 && <span className="text-caption text-amber-700">{m.zernioNoAccounts}</span>}
                </label>
              ) : (
                <label className="flex flex-col gap-1 text-caption text-muted">
                  {m.zernioAccountIdManual}
                  <input value={zernioId} onChange={(e) => setZernioId(e.target.value)} maxLength={100} className={fieldClass} data-testid={`linked-account-zernio-id-${channel}`} />
                  <span className="text-caption text-amber-700">{m.zernioNotConfigured}</span>
                </label>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => run('reload')} disabled={busy !== null} className="text-caption text-charcoal underline disabled:opacity-50">
                  {busy === 'reload' ? m.zernioReloading : m.zernioReload}
                </button>
                <a href="https://zernio.com/dashboard" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-caption text-charcoal underline">
                  {m.zernioConsole} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy !== null || !canSave} className="rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50" data-testid={`linked-account-save-${channel}`}>
              {busy === 'save' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : m.save}
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role={message.tone === 'err' ? 'alert' : undefined} className={`mt-2 text-caption ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
