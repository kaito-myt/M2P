/**
 * ポータル ログイン画面。ここで1回ログインすれば、SSO で各ツールへ素通りできる。
 * Header/Sidebar を持たない例外画面（中央カード）。
 */
import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'ログイン | ANP',
};

interface PageProps {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const initialErrorCode = typeof params.error === 'string' ? params.error : null;
  const callbackUrl =
    typeof params.callbackUrl === 'string' && params.callbackUrl.startsWith('/') && !params.callbackUrl.startsWith('//')
      ? params.callbackUrl
      : '/';

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
      }}
    >
      <section
        aria-labelledby="login-heading"
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--color-cream-light)',
          border: '1px solid var(--color-border-warm)',
          borderRadius: 'var(--radius-container)',
          padding: '40px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px -6px rgba(16,24,40,0.10)',
        }}
      >
        <header style={{ textAlign: 'center' }}>
          <h1 id="login-heading" style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
            ANP
          </h1>
          <p style={{ margin: '8px 0 0', color: 'var(--color-muted)', fontSize: 13 }}>
            Automated Note Publishing ― note の出版と販促を自動化。
          </p>
        </header>

        <LoginForm initialErrorCode={initialErrorCode} callbackUrl={callbackUrl} />

        <footer style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: 12 }}>
          <p style={{ margin: 0 }}>関係者のみアクセスできます。</p>
        </footer>
      </section>
    </main>
  );
}
