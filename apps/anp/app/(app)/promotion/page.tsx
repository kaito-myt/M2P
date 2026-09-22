/**
 * S-ANP-10 — 販促施策 (docs/11-anp-design.md §3.4 F-ANP-32)。
 *
 * 運営者要望 (2026-09-21)「メニューに販促施策を作って。アカウントごとに販促施策が設定できるようにして。
 * ページの右上あたりにアカウント切替…各アカウントごとに X、IG、TikTok、ブログでの販促施策を確認できるようにして。
 * 各媒体はページ内にさらにタブで分かれるようにして」。アカウント切替は記事一覧と同じピル型ボタン
 * (「アカウントの切替も…ステータスと同じようにボタンにして」)。状態は URL `?account=&channel=`。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { AccountPills } from '@/components/account-pills';
import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';
import { loadLinkedPromotionAccount } from '@/lib/promotion-accounts-core';
import { isZernioConfigured, listZernioAccounts } from '@/lib/zernio';
import {
  NOTE_PROMOTION_CHANNELS,
  PROMOTION_POST_CHANNEL,
  isNotePromotionChannel,
  loadAccountPromotionState,
  summarizePromotionPosts,
  toPromotionPostView,
  type NotePromotionChannel,
} from '@/lib/promotion-core';

import { PromotionPanel } from './promotion-panel';

export const dynamic = 'force-dynamic';

const m = messages.promotion;

export default async function PromotionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const accounts = await prisma.noteAccount.findMany({
    where: { status: { not: 'archived' } },
    orderBy: [{ status: 'asc' }, { created_at: 'asc' }],
    select: { id: true, display_name: true, handle: true, niche: true },
  });
  const requested = typeof sp.account === 'string' ? sp.account : '';
  const account = accounts.find((a) => a.id === requested) ?? accounts[0] ?? null;
  const channel: NotePromotionChannel = isNotePromotionChannel(sp.channel) ? sp.channel : 'x';
  // F-ANP-33c: Zernio OAuth の戻り (/api/zernio/callback) からのフラッシュ表示。
  const flash: { tone: 'ok' | 'err'; text: string } | null =
    typeof sp.linked === 'string' && sp.linked
      ? { tone: 'ok', text: m.link.flashLinked(m.channelLabel[isNotePromotionChannel(sp.linked) ? sp.linked : channel], typeof sp.linked_handle === 'string' ? sp.linked_handle : '') }
      : typeof sp.link_error === 'string' && sp.link_error
        ? { tone: 'err', text: m.link.flashError(sp.link_error) }
        : null;

  const hrefFor = (o: { account?: string; channel?: NotePromotionChannel }) => {
    const q = new URLSearchParams();
    const acc = o.account ?? account?.id ?? '';
    const ch = o.channel ?? channel;
    if (acc) q.set('account', acc);
    if (ch !== 'x') q.set('channel', ch);
    const qs = q.toString();
    return qs ? `/promotion?${qs}` : '/promotion';
  };

  // promotion_posts は NoteArticle と FK を持たない (docs/11 §6) ので、アカウントの記事 id で絞る。
  const articles = account
    ? await prisma.noteArticle.findMany({ where: { note_account_id: account.id }, select: { id: true, title: true } })
    : [];
  const titleById = new Map(articles.map((a) => [a.id, a.title]));
  const [state, postRows, linked, zernio] = account
    ? await Promise.all([
        loadAccountPromotionState(account.id, channel),
        articles.length > 0
          ? prisma.promotionPost.findMany({
              where: { channel: PROMOTION_POST_CHANNEL[channel], note_article_id: { in: articles.map((a) => a.id) } },
              orderBy: { scheduled_for: 'desc' },
              take: 30,
              select: {
                id: true,
                status: true,
                body: true,
                scheduled_for: true,
                posted_at: true,
                external_url: true,
                error: true,
                impressions: true,
                likes: true,
                reposts: true,
                replies: true,
                note_article_id: true,
              },
            })
          : Promise.resolve([]),
        loadLinkedPromotionAccount(account.id, channel),
        channel === 'x' || channel === 'instagram' || channel === 'tiktok'
          ? (async () => {
              if (!isZernioConfigured()) return { configured: false, accounts: [] };
              try {
                return { configured: true, accounts: await listZernioAccounts(channel) };
              } catch {
                return { configured: true, accounts: [] };
              }
            })()
          : Promise.resolve(null),
      ])
    : [null, [], null, null];
  const posts = postRows.map((r) =>
    toPromotionPostView({
      ...r,
      article_title: r.note_article_id ? (titleById.get(r.note_article_id) ?? null) : null,
      article_id: r.note_article_id,
    }),
  );
  const summary = summarizePromotionPosts(postRows);

  return (
    <div className="mx-auto flex max-w-6xl flex-col">
      <header className="flex flex-wrap items-start justify-between gap-space-snug">
        <div>
          <h1 className="text-sub-heading font-medium text-charcoal">{m.pageTitle}</h1>
          <p className="mt-1 text-body text-muted">{m.pageDescription}</p>
        </div>
        {accounts.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <span className="text-caption text-muted">{m.accountSwitch}</span>
            <AccountPills
              accounts={accounts.map((a) => ({ id: a.id, label: a.display_name }))}
              activeId={account?.id ?? ''}
              hrefFor={(id) => hrefFor({ account: id })}
              ariaLabel={m.accountSwitch}
              className="justify-end"
              testId="promotion-account-pills"
            />
          </div>
        )}
      </header>

      {!account ? (
        <p className="mt-space-relaxed text-body text-muted">
          {m.noAccounts}{' '}
          <Link href="/accounts/new" className="text-charcoal underline">
            {m.createAccount}
          </Link>
        </p>
      ) : (
        <>
          <p className="mt-space-snug text-caption text-muted">
            {account.display_name}
            {account.handle ? ` (@${account.handle})` : ''} ／ {account.niche}
            {' ・ '}
            <Link href={`/accounts/${account.id}`} className="text-charcoal underline">
              {m.accountDetailLink}
            </Link>
          </p>

          {/* 媒体タブ */}
          <nav aria-label={m.channelTabsLabel} className="mt-space-relaxed flex flex-wrap gap-2" data-testid="promotion-channel-tabs">
            {NOTE_PROMOTION_CHANNELS.map((ch) => {
              const active = ch === channel;
              return (
                <Link
                  key={ch}
                  href={hrefFor({ channel: ch })}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-pill border px-3 py-1 text-button-sm no-underline transition-colors',
                    active ? 'border-charcoal bg-charcoal text-white' : 'border-border-warm bg-white text-charcoal-82 hover:bg-charcoal-04',
                  )}
                >
                  {m.channelLabel[ch]}
                </Link>
              );
            })}
          </nav>

          {state && linked && (
            <PromotionPanel key={`${account.id}:${channel}`} noteAccountId={account.id} initial={state} posts={posts} summary={summary} linked={linked} zernio={zernio} flash={flash} />
          )}
        </>
      )}
    </div>
  );
}
