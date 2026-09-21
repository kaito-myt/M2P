/**
 * S-ANP-06 — note アカウント設計詳細: 編集・画像生成・再生成・採用/却下 (docs/11-anp-design.md §3.1/§7, F-ANP-01/03)。
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage/operations';
import { NoteAccountDesignSchema } from '@a2p/contracts/agents/anp';

import { messages } from '@/lib/messages';

import { DesignForm } from './design-form';
import { FeedbackForm } from './feedback-form';
import { DesignGeneratingIndicator } from './generating-indicator';

export default async function AccountDesignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const row = await prisma.noteAccountDesign.findUnique({
    where: { id },
    select: {
      id: true,
      brief_json: true,
      design_json: true,
      status: true,
      error: true,
      note_account_id: true,
      avatar_r2_key: true,
      header_r2_key: true,
      consultation_id: true,
      created_at: true,
    },
  });
  if (!row) notFound();

  const idea =
    row.brief_json && typeof row.brief_json === 'object' && 'idea' in row.brief_json
      ? String((row.brief_json as Record<string, unknown>).idea ?? '')
      : '';

  const account = row.note_account_id
    ? await prisma.noteAccount.findUnique({
        where: { id: row.note_account_id },
        select: { id: true, display_name: true, handle: true },
      })
    : null;

  const [avatarUrl, headerUrl] = await Promise.all([
    row.avatar_r2_key ? getSignedDownloadUrl(row.avatar_r2_key, 900, {}, 'avatar.png') : null,
    row.header_r2_key ? getSignedDownloadUrl(row.header_r2_key, 900, {}, 'header.jpg') : null,
  ]);

  const dm = messages.accountDesign;
  const statusLabel = dm.statusLabel[row.status as keyof typeof dm.statusLabel] ?? row.status;

  const designParsed = row.design_json ? NoteAccountDesignSchema.safeParse(row.design_json) : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <Link href="/accounts/design" className="text-caption text-muted no-underline hover:underline">
        {dm.back}
      </Link>

      <header className="mt-space-snug flex items-start justify-between gap-2">
        <div>
          <h1 className="text-sub-heading font-medium text-charcoal">{idea || dm.pageTitle}</h1>
          <p className="mt-1 text-body text-muted">
            {statusLabel} ・ {row.created_at.toLocaleString('ja-JP')}
            {row.consultation_id && (
              <>
                {' ・ '}
                <Link href={`/accounts/design/consult/${row.consultation_id}`} className="text-charcoal underline">
                  {messages.accountConsult.fromConsultLink}
                </Link>
              </>
            )}
          </p>
        </div>
      </header>

      <section className="mt-space-relaxed rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <h2 className="text-card-title font-medium text-charcoal">{dm.detail.briefTitle}</h2>
        <pre className="mt-2 whitespace-pre-wrap break-words text-caption text-muted">
          {JSON.stringify(row.brief_json, null, 2)}
        </pre>
      </section>

      {row.status === 'generating' && (
        <>
          <DesignGeneratingIndicator createdAt={row.created_at.toISOString()} />
          <p className="mt-2 text-caption text-muted">{dm.detail.generatingNotice}</p>
        </>
      )}
      {row.status === 'failed' && (
        <div className="mt-space-relaxed rounded-container border border-red-300 bg-red-50 p-space-relaxed">
          <p className="text-body text-red-700">{dm.detail.failedNotice}</p>
          {row.error && <p className="mt-1 text-caption text-red-600">{row.error}</p>}
        </div>
      )}

      {designParsed?.success && row.status === 'proposed' && (
        <section className="mt-space-loose">
          <h2 className="text-card-title font-medium text-charcoal">{dm.detail.formTitle}</h2>
          <DesignForm
            designId={row.id}
            initial={designParsed.data}
            avatarUrl={avatarUrl}
            headerUrl={headerUrl}
          />
        </section>
      )}

      {row.status === 'adopted' && account && (
        <section className="mt-space-loose rounded-container border border-border-warm bg-cream-light p-space-relaxed">
          <h2 className="text-card-title font-medium text-charcoal">{dm.adopted.title}</h2>
          <p className="mt-1 text-body text-muted">{dm.adopted.description}</p>
          <ul className="mt-2 list-inside list-decimal text-body text-muted">
            {dm.adopted.checklist.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
          <div className="mt-space-snug flex flex-col gap-2">
            <div>
              <span className="text-caption text-muted">{dm.adopted.copyDisplayName}</span>
              <p className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal">
                {account.display_name}
              </p>
            </div>
            {designParsed?.success && (
              <div>
                <span className="text-caption text-muted">{dm.adopted.copyBio}</span>
                <p className="whitespace-pre-wrap rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal">
                  {designParsed.data.bio}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {avatarUrl && (
                <a href={avatarUrl} className="text-caption text-charcoal underline">
                  {dm.adopted.downloadAvatar}
                </a>
              )}
              {headerUrl && (
                <a href={headerUrl} className="text-caption text-charcoal underline">
                  {dm.adopted.downloadHeader}
                </a>
              )}
            </div>
            <div>
              <span className="text-caption text-muted">{dm.adopted.sessionCommand}</span>
              <pre className="overflow-x-auto rounded-card border border-border-warm bg-white px-3 py-2 text-caption text-charcoal">
                bash scripts/anp/note-session-capture.sh {account.id}
              </pre>
            </div>
            <Link
              href={`/accounts/${account.id}`}
              className="inline-block w-fit rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white no-underline"
              data-testid="design-adopted-link-now"
            >
              {dm.adopted.linkNow}
            </Link>
            <Link href={`/accounts/${account.id}`} className="text-caption text-charcoal underline">
              {dm.adopted.viewAccount}
            </Link>
          </div>
        </section>
      )}

      {(row.status === 'proposed' || row.status === 'adopted' || row.status === 'failed') && (
        <section className="mt-space-loose rounded-container border border-border-warm bg-cream-light p-space-relaxed">
          <h2 className="text-card-title font-medium text-charcoal">{dm.detail.feedbackTitle}</h2>
          <FeedbackForm designId={row.id} />
        </section>
      )}
    </div>
  );
}

// Railway ビルド時のプリレンダリングで DB 接続に失敗する既知の罠 (docs/11 §7 申し送り17)。
export const dynamic = 'force-dynamic';
