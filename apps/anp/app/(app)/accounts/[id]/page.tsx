/**
 * S-ANP-02 — note アカウント詳細: テーマ候補一覧 (承認/却下) + 記事一覧 (docs/11-anp-design.md §7)。
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@a2p/db';
import { parseNoteAccountSettings, parseNoteMonetizationPolicy } from '@a2p/contracts/agents/anp';

import { loadAccountProfileState } from '@/lib/account-profile-core';
import { messages } from '@/lib/messages';

import { AccountSettingsForm } from './account-settings-form';
import { ArticleReviewActions } from './article-review-actions';
import { GenerateThemesButton } from './generate-themes-button';
import { HandleForm } from './handle-form';
import { EditorialPanel } from './editorial-panel';
import { NoteLinkForm } from './note-link-form';
import { ProfilePanel } from './profile-panel';
import { PublishArticleButton } from './publish-article-button';
import { ThemeCard } from './theme-card';

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const account = await prisma.noteAccount.findUnique({
    where: { id },
    select: {
      id: true,
      niche: true,
      display_name: true,
      target_reader: true,
      tone: true,
      status: true,
      handle: true,
      settings_json: true,
      monetization_policy_json: true,
      session_state_enc: true,
      session_linked_at: true,
      session_source: true,
      // F-ANP-01/03: 設計案から作られたアカウントなら、note 側に設定する表示名/bio を再掲する。
      designs: {
        where: { status: 'adopted' },
        orderBy: { created_at: 'desc' },
        take: 1,
        select: { id: true, design_json: true },
      },
    },
  });
  if (!account) notFound();
  const adoptedDesign = account.designs[0] ?? null;
  const profileState = await loadAccountProfileState(id);
  const accountSettings = parseNoteAccountSettings(account.settings_json);
  const monetization = parseNoteMonetizationPolicy(account.monetization_policy_json);

  const [themes, articles, appSettings, pendingReauth] = await Promise.all([
    prisma.noteTheme.findMany({
      where: { note_account_id: id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        hook: true,
        target_reader: true,
        recommend_paid: true,
        suggested_price: true,
        status: true,
      },
    }),
    prisma.noteArticle.findMany({
      where: { note_account_id: id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        paid: true,
        price_jpy: true,
        quality_score: true,
        publish_status: true,
        note_url: true,
        created_at: true,
      },
    }),
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { anp_publish_dry_run: true, anp_auto_theme_enabled: true, anp_themes_per_day: true, anp_autopass_enabled: true, anp_auto_publish_enabled: true },
    }),
    prisma.noteAuthRequest.findFirst({
      where: { note_account_id: id, purpose: 'session_expired', status: 'pending' },
      select: { id: true },
    }),
  ]);
  const globalDryRunEnabled = appSettings?.anp_publish_dry_run ?? true;
  const needsReauth = account.status === 'paused' || !!pendingReauth;

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <Link href="/accounts" className="text-caption text-muted no-underline hover:underline">
        {messages.accountDetail.back}
      </Link>

      <header className="mt-space-snug">
        <h1 className="text-sub-heading font-medium text-charcoal">{account.display_name}</h1>
        <p className="mt-1 text-body text-muted">
          ニッチ: {account.niche}
          {account.target_reader ? ` ／ 想定読者: ${account.target_reader}` : ''}
          {account.tone ? ` ／ トーン: ${account.tone}` : ''}
        </p>
        <HandleForm noteAccountId={account.id} initialHandle={account.handle} initialDisplayName={account.display_name} />
        {needsReauth && (
          <div className="mt-2 rounded-card border border-destructive-bg bg-destructive-bg px-3 py-2">
            <p className="text-caption font-medium text-destructive">{messages.accounts.reauthNeeded}</p>
            <p className="mt-0.5 text-caption text-destructive">{messages.accounts.reauthNeededDescription}</p>
            <code className="mt-1 block text-caption text-destructive">
              {messages.accounts.reauthCommand(account.id)}
            </code>
          </div>
        )}
      </header>

      {/* F-ANP-20: note アカウント連携 (Cookie 貼り付け)。未連携/失効時は先頭に置いて次の一手を明示する。 */}
      <section className="mt-space-loose flex flex-col gap-space-snug">
        {account.status === 'pending_session' && (
          <div className="rounded-container border border-border-warm bg-white p-space-relaxed">
            <h2 className="text-card-title font-medium text-charcoal">{messages.accounts.setupTitle}</h2>
            <p className="mt-1 text-caption text-muted">{messages.accounts.setupDescription}</p>
            <dl className="mt-2 flex flex-col gap-2">
              <div>
                <dt className="text-caption text-muted">{messages.accounts.form.displayName}</dt>
                <dd className="rounded-card border border-border-warm bg-cream-light px-3 py-2 text-body text-charcoal">
                  {account.display_name}
                </dd>
              </div>
              {account.handle && (
                <div>
                  <dt className="text-caption text-muted">{messages.accounts.handleLabel}</dt>
                  <dd className="rounded-card border border-border-warm bg-cream-light px-3 py-2 text-body text-charcoal">
                    {account.handle}
                  </dd>
                </div>
              )}
            </dl>
            {adoptedDesign && (
              <Link href={`/accounts/design/${adoptedDesign.id}`} className="mt-2 inline-block text-caption text-charcoal underline">
                {messages.accounts.setupDesignLink}
              </Link>
            )}
          </div>
        )}
        {profileState && <ProfilePanel noteAccountId={account.id} initial={profileState} />}
        {profileState && <EditorialPanel noteAccountId={account.id} initial={profileState} />}
        <NoteLinkForm
          noteAccountId={account.id}
          handle={account.handle}
          status={account.status}
          sessionLinkedAt={account.session_linked_at ? account.session_linked_at.toISOString() : null}
          sessionSource={account.session_source}
          hasSession={!!account.session_state_enc}
          needsReauth={needsReauth}
        />
      </section>

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{messages.accountDetail.settingsTitle}</h2>
        <div className="mt-space-snug">
          <AccountSettingsForm
            noteAccountId={account.id}
            initial={accountSettings}
            globals={{
              auto_theme_enabled: appSettings?.anp_auto_theme_enabled ?? false,
              themes_per_day: appSettings?.anp_themes_per_day ?? 1,
              autopass_enabled: appSettings?.anp_autopass_enabled ?? false,
              auto_publish_enabled: appSettings?.anp_auto_publish_enabled ?? false,
            }}
            monetization={{
              free_ratio: monetization.free_ratio,
              price_band: monetization.price_band,
              membership: monetization.membership,
              paid_ratio: monetization.paid_ratio,
            }}
          />
        </div>
      </section>

      <section className="mt-space-loose">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-section-title text-charcoal">{messages.accountDetail.themesTitle}</h2>
          <GenerateThemesButton noteAccountId={account.id} />
        </div>
        {themes.length === 0 ? (
          <p className="mt-2 text-body text-muted">{messages.accountDetail.themesEmpty}</p>
        ) : (
          <ul className="mt-space-snug flex flex-col gap-space-snug">
            {themes.map((t) => (
              <ThemeCard key={t.id} theme={t} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{messages.accountDetail.articlesTitle}</h2>
        {articles.length === 0 ? (
          <p className="mt-2 text-body text-muted">{messages.accountDetail.articlesEmpty}</p>
        ) : (
          <ul className="mt-space-snug flex flex-col gap-space-snug">
            {articles.map((a) => {
              const statusLabel =
                messages.accountDetail.articleStatus[
                  a.status as keyof typeof messages.accountDetail.articleStatus
                ] ?? a.status;
              const publishStatusLabel =
                messages.accountDetail.publishStatus[
                  a.publish_status as keyof typeof messages.accountDetail.publishStatus
                ] ?? a.publish_status;
              return (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-2 rounded-container border border-border-warm bg-cream-light p-space-relaxed"
                >
                  <div>
                    <Link
                      href={`/articles/${a.id}`}
                      className="text-body font-medium text-charcoal no-underline hover:underline"
                    >
                      {a.title}
                    </Link>
                    <p className="text-caption text-muted">
                      {a.paid
                        ? `有料 ${a.price_jpy ? `¥${a.price_jpy.toLocaleString('ja-JP')}` : ''}`
                        : a.price_jpy != null
                          ? `無料 ・ ${messages.accountDetail.priceSuggestionLabel(a.price_jpy)}`
                          : '無料'}
                      {a.quality_score != null ? ` ・ スコア ${a.quality_score}` : ''}
                      {` ・ ${publishStatusLabel}`}
                    </p>
                    {a.note_url && (
                      <a
                        href={a.note_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-caption text-charcoal underline"
                      >
                        {a.note_url}
                      </a>
                    )}
                    {(a.status === 'ready' || a.status === 'needs_human_review') && (
                      <PublishArticleButton articleId={a.id} globalDryRunEnabled={globalDryRunEnabled} />
                    )}
                    {a.status === 'needs_human_review' && <ArticleReviewActions articleId={a.id} />}
                  </div>
                  <span className="shrink-0 rounded-pill border border-border-warm px-2 py-0.5 text-caption text-muted">
                    {statusLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// Railway のビルド時に静的プリレンダリングで DB (postgres.railway.internal) へ接続しようとして失敗する
// (2026-09-15 以降の ANP デプロイが全て FAILED だった原因)。DB を読むページは常に動的レンダリングにする。
export const dynamic = 'force-dynamic';
