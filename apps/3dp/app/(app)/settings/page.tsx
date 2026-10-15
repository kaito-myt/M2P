/**
 * S-3DP-06 設定 (docs/12-3dp-design.md §9)。
 *
 * Inc-1 で実際に動かすのは BOOTH の AI 生成物規制 (2025-07-18) に対する 2 つの安全装置:
 *   R-1 月間出品上限  = `app_settings.tdp_monthly_publish_limit`
 *   R-2 禁止語リスト  = `app_settings.tdp_derivative_denylist`
 * 価格帯・生成プロバイダ・API キーは、生成が入る Inc-2 で足す
 * (API キーはポータルの「API 管理」が持つので 3DP 側には置かない方針)。
 */
import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { buildQuotaView, jstMonthRange } from '@/lib/home-core';

import { DenylistForm } from './denylist-form';
import { LimitForm } from './limit-form';

const m = messages.settings;

/** 設定画面に出す「常時有効な判定」。derivative-guard.ts の DerivativeRiskKind と対応。 */
const BUILTIN_KINDS = [
  'style_imitation',
  'fan_work_wording',
  'specific_avatar_fit',
  'creator_reference',
  'denylisted_term',
  'trademark_marker',
] as const;

export default async function SettingsPage() {
  const now = new Date();
  const { start, end } = jstMonthRange(now);

  const [settings, listedThisMonth] = await Promise.all([
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { tdp_monthly_publish_limit: true, tdp_derivative_denylist: true },
    }),
    prisma.tdpProduct.count({ where: { listed_at: { gte: start, lt: end } } }),
  ]);

  const limit = settings?.tdp_monthly_publish_limit ?? 8;
  const denylist = settings?.tdp_derivative_denylist ?? [];
  const quota = buildQuotaView({ listedThisMonth, monthlyLimit: limit });

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <header>
        <h1 className="text-sub-heading text-charcoal">{m.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{m.pageDescription}</p>
      </header>

      {/* R-1 月間出品上限 */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.limitTitle}</h2>
        <p className="mt-1 max-w-2xl text-caption text-muted">{m.limitDescription}</p>
        <div className="mt-space-relaxed">
          <LimitForm initialLimit={limit} listedThisMonth={quota.listed} remaining={quota.remaining} />
        </div>
      </section>

      {/* R-2 禁止語リスト */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.denylistTitle}</h2>
        <p className="mt-1 max-w-2xl text-caption text-muted">{m.denylistDescription}</p>
        <div className="mt-space-relaxed">
          <DenylistForm initialTerms={[...denylist]} />
        </div>
        <p className="mt-space-snug max-w-2xl text-caption text-muted">{m.denylistNote}</p>
      </section>

      {/* 常時有効な判定 (読み取り専用の説明) */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.builtinTitle}</h2>
        <p className="mt-1 max-w-2xl text-caption text-muted">{m.builtinDescription}</p>

        <ul className="mt-space-relaxed divide-y divide-border-warm border-y border-border-warm">
          {BUILTIN_KINDS.map((kind) => (
            <li key={kind} className="flex flex-wrap items-baseline gap-x-space-snug px-space-tight py-space-relaxed">
              <code className="shrink-0 text-caption text-charcoal-40">{kind}</code>
              <span className="min-w-0 flex-1 text-button-sm text-charcoal-82">
                {messages.derivativeKinds[kind]}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-space-relaxed">
          <h3 className="text-button-sm font-medium text-charcoal">{messages.derivativeAllowed.title}</h3>
          <ul className="mt-1 list-disc pl-5 text-caption text-muted">
            <li>{messages.derivativeAllowed.styles}</li>
            <li>{messages.derivativeAllowed.platforms}</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

// Railway のビルド時に静的プリレンダリングで DB へ接続しようとして失敗するため、
// DB を読むページは常に動的レンダリングにする (ANP で実害があった)。
export const dynamic = 'force-dynamic';
