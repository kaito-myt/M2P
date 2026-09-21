/**
 * S-ANP-09 — 新規 note アカウント作成ウィザード (docs/11-anp-design.md §3.1 F-ANP-01/03/04)。
 *
 * 運営者要望 (2026-09-21)「アカウント設計はタブで分けるのではなく、新規アカウントを作成する際にこのページで
 * AI と相談しながらアカウント作成を行えるようにしたい」への対応。1 ページで
 *   1. AI と相談 (チャット壁打ち → ブリーフ草案)
 *   2. 設計案の生成・編集・画像生成
 *   3. 「この設計でアカウントを作成」→ アカウント詳細 (プロフィール素材・note 連携) へ
 * を進める。状態は URL (`?consult=<id>&design=<id>`) で持つので、再読込しても続きから再開できる。
 * 旧 `/accounts/design*` は履歴閲覧用に残す (サイドメニューからは外した)。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';
import { NoteAccountDesignSchema } from '@a2p/contracts/agents/anp';
import { getSignedDownloadUrl } from '@a2p/storage/operations';

import { loadConsultationState } from '@/lib/account-consult-core';
import { messages } from '@/lib/messages';

import { CreateAccountForm } from '../create-account-form';
import { BriefForm } from '../design/brief-form';
import { StartConsultForm } from '../design/consult/start-consult-form';
import { ConsultWorkspace } from '../design/consult/[id]/consult-workspace';
import { DesignForm } from '../design/[id]/design-form';
import { FeedbackForm } from '../design/[id]/feedback-form';
import { DesignGeneratingIndicator } from '../design/[id]/generating-indicator';

export const dynamic = 'force-dynamic';

const wizardHref = (consultId: string | null, designId: string | null) => {
  const q = new URLSearchParams();
  if (consultId) q.set('consult', consultId);
  if (designId) q.set('design', designId);
  const qs = q.toString();
  return qs ? `/accounts/new?${qs}` : '/accounts/new';
};

export default async function NewAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const consultId = typeof sp.consult === 'string' && sp.consult ? sp.consult : null;
  const designId = typeof sp.design === 'string' && sp.design ? sp.design : null;

  const [consult, design] = await Promise.all([
    consultId ? loadConsultationState(consultId) : Promise.resolve(null),
    designId
      ? prisma.noteAccountDesign.findUnique({
          where: { id: designId },
          select: {
            id: true,
            status: true,
            error: true,
            design_json: true,
            note_account_id: true,
            avatar_r2_key: true,
            header_r2_key: true,
            created_at: true,
          },
        })
      : Promise.resolve(null),
  ]);
  const designParsed = design?.design_json ? NoteAccountDesignSchema.safeParse(design.design_json) : null;
  const signed = async (key: string | null, name: string) => {
    if (!key) return null;
    try {
      return await getSignedDownloadUrl(key, 900, {}, name);
    } catch {
      return null;
    }
  };
  const [avatarUrl, headerUrl] = design
    ? await Promise.all([signed(design.avatar_r2_key, 'avatar.png'), signed(design.header_r2_key, 'header.jpg')])
    : [null, null];
  const adoptedAccount =
    design?.note_account_id
      ? await prisma.noteAccount.findUnique({ where: { id: design.note_account_id }, select: { id: true, display_name: true } })
      : null;

  const w = messages.accountWizard;
  const dm = messages.accountDesign;
  const stepDone = (n: number) => (n === 1 ? !!consult : n === 2 ? design?.status === 'adopted' : false);
  const current = !consultId && !designId ? 1 : design?.status === 'adopted' ? 3 : designId ? 2 : 1;

  return (
    <div className="mx-auto flex max-w-6xl flex-col">
      <Link href="/accounts" className="text-caption text-muted no-underline hover:underline">
        {messages.accountDetail.back}
      </Link>
      <header className="mt-space-snug">
        <h1 className="text-sub-heading font-medium text-charcoal">{w.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{w.pageDescription}</p>
      </header>

      {/* ステッパー */}
      <ol className="mt-space-relaxed flex flex-wrap gap-2 text-caption" aria-label={w.stepsLabel}>
        {w.steps.map((label, i) => {
          const n = i + 1;
          const active = n === current;
          const done = stepDone(n);
          return (
            <li
              key={label}
              className={`rounded-pill border px-3 py-1 ${
                active ? 'border-charcoal bg-charcoal text-white' : done ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-border-warm bg-white text-muted'
              }`}
            >
              {n}. {label}
            </li>
          );
        })}
      </ol>

      {/* Step 1: AI と相談 */}
      <section className="mt-space-loose" aria-labelledby="wizard-step-1">
        <h2 id="wizard-step-1" className="text-section-title text-charcoal">
          {w.step1Title}
        </h2>
        <p className="mt-1 text-body text-muted">{w.step1Description}</p>
        {consult ? (
          <ConsultWorkspace initial={consult} designHrefFor={(id) => wizardHref(consult.id, id)} />
        ) : (
          <div className="mt-space-snug rounded-container border border-border-warm bg-cream-light p-space-relaxed">
            <StartConsultForm hrefFor={(id) => wizardHref(id, null)} />
            <details className="mt-space-relaxed">
              <summary className="cursor-pointer text-caption text-charcoal underline">{w.briefDirect}</summary>
              <BriefForm hrefFor={(id) => wizardHref(null, id)} />
            </details>
            <details className="mt-space-snug">
              <summary className="cursor-pointer text-caption text-charcoal underline">{w.manualCreate}</summary>
              <CreateAccountForm />
            </details>
            <p className="mt-space-snug text-caption text-muted">
              <Link href="/accounts/design/consult" className="underline">
                {w.historyConsults}
              </Link>
              {' ・ '}
              <Link href="/accounts/design" className="underline">
                {w.historyDesigns}
              </Link>
            </p>
          </div>
        )}
      </section>

      {/* Step 2: 設計案 */}
      {design && (
        <section className="mt-space-loose" aria-labelledby="wizard-step-2">
          <h2 id="wizard-step-2" className="text-section-title text-charcoal">
            {w.step2Title}
          </h2>
          <p className="mt-1 text-body text-muted">{w.step2Description}</p>
          {design.status === 'generating' && (
            <>
              <DesignGeneratingIndicator createdAt={design.created_at.toISOString()} />
              <p className="mt-2 text-caption text-muted">{dm.detail.generatingNotice}</p>
            </>
          )}
          {design.status === 'failed' && (
            <div className="mt-space-snug rounded-container border border-red-300 bg-red-50 p-space-relaxed">
              <p className="text-body text-red-700">{dm.detail.failedNotice}</p>
              {design.error && <p className="mt-1 text-caption text-red-600">{design.error}</p>}
            </div>
          )}
          {designParsed?.success && design.status === 'proposed' && (
            <DesignForm designId={design.id} initial={designParsed.data} avatarUrl={avatarUrl} headerUrl={headerUrl} />
          )}
          {(design.status === 'proposed' || design.status === 'failed') && (
            <div className="mt-space-relaxed rounded-container border border-border-warm bg-cream-light p-space-relaxed">
              <h3 className="text-card-title font-medium text-charcoal">{dm.detail.feedbackTitle}</h3>
              <FeedbackForm designId={design.id} hrefFor={(id) => wizardHref(consultId, id)} />
            </div>
          )}
          {design.status === 'rejected' && <p className="mt-space-snug text-body text-muted">{w.designRejected}</p>}
        </section>
      )}

      {/* Step 3: 作成完了 */}
      {design?.status === 'adopted' && adoptedAccount && (
        <section className="mt-space-loose rounded-container border border-emerald-300 bg-emerald-50 p-space-relaxed" aria-labelledby="wizard-step-3">
          <h2 id="wizard-step-3" className="text-section-title text-charcoal">
            {w.step3Title}
          </h2>
          <p className="mt-1 text-body text-charcoal-82">{w.step3Description(adoptedAccount.display_name)}</p>
          <Link
            href={`/accounts/${adoptedAccount.id}`}
            className="mt-space-snug inline-block rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white no-underline"
            data-testid="wizard-goto-account"
          >
            {w.step3Link}
          </Link>
        </section>
      )}
    </div>
  );
}
