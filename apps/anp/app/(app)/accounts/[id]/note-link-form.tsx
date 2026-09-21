'use client';

/**
 * NoteLinkForm — F-ANP-20: note でログイン中の Cookie を貼り付けてアカウントを連携する
 * (Server Action `linkNoteAccountSession`)。連携状態の表示と手順ガイドも兼ねる。
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { linkNoteAccountSession } from '@/app/actions/accounts';
import { messages } from '@/lib/messages';

const lm = messages.accounts.link;

export interface NoteLinkFormProps {
  noteAccountId: string;
  handle: string | null;
  status: string;
  /** ISO 文字列。null = 未連携。 */
  sessionLinkedAt: string | null;
  sessionSource: string | null;
  hasSession: boolean;
  /** F-ANP-21: 失効検知済み (paused / pending auth request)。 */
  needsReauth: boolean;
}

export function NoteLinkForm(props: NoteLinkFormProps) {
  const router = useRouter();
  const [authToken, setAuthToken] = useState('');
  const [sessionCookie, setSessionCookie] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(!props.hasSession || props.needsReauth);
  const [isPending, startTransition] = useTransition();

  const statusLine = (() => {
    if (props.needsReauth) return { text: lm.statusExpired, tone: 'text-destructive' };
    if (props.hasSession && props.sessionLinkedAt && props.handle) {
      return {
        text: lm.statusLinked(props.handle, new Date(props.sessionLinkedAt).toLocaleString('ja-JP')),
        tone: 'text-emerald-700',
      };
    }
    if (props.hasSession) return { text: lm.statusLinkedViaScript, tone: 'text-emerald-700' };
    return { text: lm.statusNotLinked, tone: 'text-muted' };
  })();

  const canSubmit = authToken.trim().length > 0 || sessionCookie.trim().length > 0;

  const submit = () => {
    if (isPending || !canSubmit) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await linkNoteAccountSession({
        note_account_id: props.noteAccountId,
        auth_token: authToken,
        session_cookie: sessionCookie,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAuthToken('');
      setSessionCookie('');
      setSuccess(lm.success(res.data.handle, res.data.nickname));
      setShowSteps(false);
      router.refresh();
    });
  };

  return (
    <section
      className="rounded-container border border-border-warm bg-cream-light p-space-relaxed"
      data-testid="note-link-form"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-card-title font-medium text-charcoal">{lm.title}</h2>
        <span className={`text-caption ${statusLine.tone}`} data-testid="note-link-status">
          {statusLine.text}
        </span>
      </div>
      <p className="mt-1 text-caption text-muted">{lm.description}</p>

      <button
        type="button"
        onClick={() => setShowSteps((v) => !v)}
        className="mt-space-snug text-caption text-charcoal underline"
      >
        {lm.stepsTitle}
        {showSteps ? ' ▾' : ' ▸'}
      </button>
      {showSteps && (
        <ol className="mt-1 list-inside list-decimal text-caption text-charcoal-82">
          {lm.steps.map((s) => (
            <li key={s} className="mt-0.5">
              {s}
            </li>
          ))}
        </ol>
      )}

      <form
        className="mt-space-snug flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1 text-caption text-muted">
          {lm.authTokenLabel}
          <input
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder={lm.authTokenPlaceholder}
            maxLength={8000}
            disabled={isPending}
            spellCheck={false}
            autoComplete="off"
            className="rounded-card border border-border-warm bg-white px-3 py-2 font-mono text-caption text-charcoal"
            data-testid="note-link-auth-token"
          />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {lm.sessionCookieLabel}
          <input
            value={sessionCookie}
            onChange={(e) => setSessionCookie(e.target.value)}
            placeholder={lm.sessionCookiePlaceholder}
            maxLength={8000}
            disabled={isPending}
            spellCheck={false}
            autoComplete="off"
            className="rounded-card border border-border-warm bg-white px-3 py-2 font-mono text-caption text-charcoal"
            data-testid="note-link-session-cookie"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isPending || !canSubmit}
            className="rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
            data-testid="note-link-submit"
          >
            {isPending ? lm.submitting : lm.submit}
          </button>
          {error && (
            <p role="alert" className="text-caption text-red-600" data-testid="note-link-error">
              {error}
            </p>
          )}
          {success && (
            <p className="text-caption text-emerald-700" data-testid="note-link-success">
              {success}
            </p>
          )}
        </div>
      </form>

      <p className="mt-space-snug text-caption text-muted">
        {lm.scriptAlternative}:{' '}
        <code className="text-charcoal">{messages.accounts.reauthCommand(props.noteAccountId)}</code>
      </p>
    </section>
  );
}
