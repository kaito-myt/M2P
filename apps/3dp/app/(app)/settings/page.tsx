/**
 * S-3DP-06 設定 (docs/12-3dp-design.md §9.8)。
 * タブは 4 つ (安全装置 / 企画と価格 / 生成 / 判定値)。媒体と運用のタブは対応する機能が入るときに足す (§7.3a)。
 * 項目と範囲は settings-groups-core の GROUP_KEYS が持つ。ここにもタブ側にも書き写さない。
 */
import { prisma } from '@a2p/db';

import { jstMonthRange } from '@/lib/home-core';
import { messages } from '@/lib/messages';
import { resolveTab } from '@/lib/settings-tabs-core';
import { loadTdpSettings, type TdpSettingsReader } from '@/lib/tdp-settings';

import { GatesTab } from './_tabs/gates';
import { GenerationTab } from './_tabs/generation';
import { PlanPriceTab } from './_tabs/plan-price';
import { SafetyTab } from './_tabs/safety';
import { TabNav } from './_tabs/tab-nav';

const m = messages.settings;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const tab = resolveTab((await searchParams).tab);
  const { start, end } = jstMonthRange(new Date());

  const [loaded, listedThisMonth] = await Promise.all([
    loadTdpSettings(prisma as unknown as TdpSettingsReader),
    prisma.tdpProduct.count({ where: { listed_at: { gte: start, lt: end } } }).catch(() => null),
  ]);
  const { settings, degraded, warnings, reason } = loaded;
  // 生のエラー文 (接続先・SQL を含みうる) は画面に出さず、ログに残す (§17.11)。
  if (warnings.length > 0) console.error('[3dp/settings]', warnings);

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <header>
        <h1 className="text-sub-heading text-charcoal">{m.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{m.pageDescription}</p>
        <p className="mt-space-snug max-w-2xl text-caption text-charcoal-82" data-testid="tdp-proposal-notice">
          {m.proposalNotice}
        </p>
      </header>

      {(degraded || warnings.length > 0) && (
        <div role="alert" className="mt-space-relaxed border-y border-border-warm py-space-snug" data-testid="tdp-settings-warning">
          <p className="text-button-sm font-medium text-destructive">
            {reason === 'no_row' ? m.degraded.noRow : m.degraded.readFailed}
          </p>
          {degraded && <p className="mt-1 text-caption text-muted">{m.degraded.readOnly}</p>}
        </div>
      )}

      <div className="mt-space-relaxed">
        <TabNav active={tab} />
      </div>

      <div className="mt-space-loose">
        {tab === 'safety' && <SafetyTab settings={settings} listedThisMonth={listedThisMonth} readOnly={degraded} />}
        {tab === 'plan_price' && <PlanPriceTab settings={settings} readOnly={degraded} />}
        {tab === 'generation' && <GenerationTab settings={settings} readOnly={degraded} />}
        {tab === 'gates' && <GatesTab settings={settings} readOnly={degraded} />}
      </div>
    </div>
  );
}

// Railway のビルド時に静的プリレンダリングで DB へ接続しようとして失敗するため、
// DB を読むページは常に動的レンダリングにする (ANP で実害があった)。
export const dynamic = 'force-dynamic';
