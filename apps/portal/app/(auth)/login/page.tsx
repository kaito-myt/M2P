/**
 * ポータル ログイン画面。ここで1回ログインすれば、SSO で各ツールへ素通りできる。
 * Header/Sidebar を持たない例外画面（中央のダークグラスカード）。
 */
import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'ログイン | M2P',
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
    <main className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
      <section
        aria-labelledby="login-heading"
        className="glass fade-up flex w-full max-w-[420px] flex-col gap-7 rounded-[22px] p-8 sm:p-10"
        style={{ boxShadow: '0 30px 80px -30px rgba(0,0,0,0.7)' }}
      >
        <header className="flex flex-col items-center text-center">
          <span className="mb-5 grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/m2p-logo.png" alt="M2P" className="h-full w-full object-contain p-1.5" />
          </span>
          <h1 id="login-heading" className="text-[26px] font-bold tracking-tight text-white">
            M<span className="brand-gradient">2</span>P
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-white/50">
            Money-Making Platform
            <br />
            ツールのハブ。ログインは一度だけ。
          </p>
        </header>

        <LoginForm initialErrorCode={initialErrorCode} callbackUrl={callbackUrl} />

        <footer className="text-center text-[12px] text-white/35">
          <p className="m-0 inline-flex items-center gap-1.5">
            <span className="live-dot" />
            関係者のみアクセスできます
          </p>
        </footer>
      </section>
    </main>
  );
}
