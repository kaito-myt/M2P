/**
 * S-ANP-08 — note アカウント戦略の AI 相談 (チャット + ブリーフ草案) (docs/11-anp-design.md §3.1/§7, F-ANP-04)。
 *
 * 会話は `ConsultWorkspace` (client) が `getConsultationState` をポーリングして更新する。
 * 初期状態だけ server component で読み、ハイドレーション後は client が真とする。
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadConsultationState } from '@/lib/account-consult-core';
import { messages } from '@/lib/messages';

import { ConsultWorkspace } from './consult-workspace';

export default async function AccountConsultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const state = await loadConsultationState(id);
  if (!state) notFound();

  const cm = messages.accountConsult;

  return (
    <div className="mx-auto flex max-w-6xl flex-col">
      <Link href="/accounts/design/consult" className="text-caption text-muted no-underline hover:underline">
        {cm.backToConsults}
      </Link>

      <header className="mt-space-snug">
        <h1 className="text-sub-heading font-medium text-charcoal">{state.title || cm.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{cm.pageDescription}</p>
      </header>

      <ConsultWorkspace initial={state} />
    </div>
  );
}

// Railway ビルド時のプリレンダリングで DB 接続に失敗する既知の罠 (docs/11 §7 申し送り17)。
export const dynamic = 'force-dynamic';
