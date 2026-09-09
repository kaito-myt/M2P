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
        console.error('[anp login] unexpected', err);
        setErrorCode('unexpected');
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="ログイン"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}
    >
      {error && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="login-error"
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-card)',
            background: 'var(--color-destructive-bg)',
            color: 'var(--color-destructive)',
            fontSize: 14,
            border: '1px solid var(--color-destructive)',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor={usernameId} style={{ fontSize: 14, color: 'var(--color-charcoal-82)' }}>
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
          style={inputStyle}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor={passwordId} style={{ fontSize: 14, color: 'var(--color-charcoal-82)' }}>
          パスワード
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
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
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="button"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            disabled={isPending}
            style={ghostButtonStyle}
          >
            {showPassword ? '隠す' : '表示'}
          </button>
        </div>
      </div>

      <button type="submit" disabled={isPending} data-testid="login-submit" style={primaryButtonStyle}>
        {isPending ? 'ログイン中…' : 'ログイン'}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--color-border-warm)',
  borderRadius: 'var(--radius-card)',
  background: 'var(--color-cream-light)',
  color: 'var(--color-charcoal)',
  fontSize: 16,
  outline: 'none',
};

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  borderRadius: 'var(--radius-card)',
  background: 'var(--color-charcoal)',
  color: 'var(--color-cream-light)',
  border: 'none',
  fontSize: 16,
  fontWeight: 500,
};

const ghostButtonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 'var(--radius-card)',
  background: 'transparent',
  color: 'var(--color-charcoal)',
  border: '1px solid var(--color-charcoal-40)',
  fontSize: 14,
};
