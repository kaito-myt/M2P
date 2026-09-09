'use client';

import { useState, useTransition, useId } from 'react';
import { signIn } from 'next-auth/react';

/**
 * authorize() で throw した CredentialsSignin の `code` を UI 文言に変換。
 *   - `invalid_credentials:<remaining>` … 残り試行回数
 *   - `locked:<ISO unlockAt>`           … 残り MM:SS
 *   - `missing_fields`
 */
function decodeError(code: string | null, now: Date = new Date()): string | null {
  if (!code) return null;
  if (code === 'missing_fields') return 'ユーザー名とパスワードを入力してください。';
  if (code.startsWith('invalid_credentials:')) {
    const remaining = Number.parseInt(code.slice('invalid_credentials:'.length), 10);
    if (Number.isFinite(remaining) && remaining > 0) {
      return `ユーザー名またはパスワードが違います。（あと ${remaining} 回でロックされます）`;
    }
    return 'ユーザー名またはパスワードが違います。';
  }
  if (code.startsWith('locked:')) {
    const unlockAt = new Date(code.slice('locked:'.length));
    if (!Number.isNaN(unlockAt.getTime())) {
      const totalSec = Math.ceil(Math.max(0, unlockAt.getTime() - now.getTime()) / 1000);
      const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const ss = (totalSec % 60).toString().padStart(2, '0');
      return `ログイン試行が多すぎます。${mm}:${ss} 後に再試行してください。`;
    }
  }
  return '予期しないエラーが発生しました。時間をおいて再試行してください。';
}

/** 同一 origin の相対パスのみ許可（オープンリダイレクト防止）。 */
function safeInternalPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  // 相対パス（先頭 '/' かつ '//' でない）のみ許可。
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

interface LoginFormProps {
  initialErrorCode: string | null;
  callbackUrl: string;
}

export function LoginForm({ initialErrorCode, callbackUrl }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(initialErrorCode);
  const [isPending, startTransition] = useTransition();

  const usernameId = useId();
  const passwordId = useId();
  const error = decodeError(errorCode);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorCode(null);
    startTransition(async () => {
      try {
        const result = await signIn('credentials', { username, password, redirect: false });
        if (result?.error) {
          const code =
            (result as { code?: string }).code ??
            (result.error === 'CredentialsSignin' ? 'invalid_credentials:' : result.error);
          setErrorCode(code);
          return;
        }
        window.location.assign(safeInternalPath(callbackUrl));
      } catch (err) {
        console.error('[portal login] unexpected', err);
        setErrorCode('unexpected');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="ログイン" className="flex w-full flex-col gap-4">
      {error && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="login-error"
          className="rounded-xl px-3.5 py-3 text-[13.5px]"
          style={{
            background: 'var(--destructive-bg)',
            color: 'var(--destructive)',
            border: '1px solid color-mix(in oklab, var(--destructive) 40%, transparent)',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={usernameId} className="text-[13px] font-medium text-white/70">
          ユーザー名
        </label>
        <input
          id={usernameId}
          name="username"
          type="text"
          autoComplete="username"
          required
          disabled={isPending}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          data-testid="login-username"
          className="field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={passwordId} className="text-[13px] font-medium text-white/70">
          パスワード
        </label>
        <div className="flex gap-2">
          <input
            id={passwordId}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            disabled={isPending}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="login-password"
            className="field flex-1"
          />
          <button
            type="button"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            disabled={isPending}
            className="btn-ghost shrink-0 rounded-xl px-3.5 text-[13px]"
          >
            {showPassword ? '隠す' : '表示'}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        data-testid="login-submit"
        className="btn-primary mt-1 w-full rounded-xl px-4 py-3 text-[15px]"
      >
        {isPending ? 'ログイン中…' : 'ログイン'}
      </button>
    </form>
  );
}
