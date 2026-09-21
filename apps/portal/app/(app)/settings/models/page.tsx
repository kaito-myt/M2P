/**
 * 設定 › AI モデル設定 — 役割ごとの既定モデル (genre=null) を切り替える (docs/10 §設定)。
 * ジャンル別の上書きは A2P の設定画面で扱う (ここでは件数だけ表示)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@a2p/db';

import {
  buildRoleRows,
  groupCatalog,
  MODEL_PROVIDERS,
  ROLE_GROUP_LABEL,
  type CatalogOption,
  type ModelProvider,
  type RoleGroup,
} from '@/lib/settings-core';

import { ModelsPanel } from './models-panel';

export const metadata: Metadata = { title: 'AI モデル設定 | 設定 | M2P' };
export const dynamic = 'force-dynamic';

const A2P_URL = process.env.NEXT_PUBLIC_TOOL_A2P_URL || 'http://localhost:3001';

export default async function ModelsSettingsPage() {
  const [promptRoles, assignments, catalogRows] = await Promise.all([
    prisma.prompt.findMany({ where: { status: 'active' }, distinct: ['role'], select: { role: true } }),
    prisma.modelAssignment.findMany({
      where: { status: 'active' },
      select: { role: true, genre: true, provider: true, model: true, activated_at: true },
    }),
    prisma.modelCatalog.findMany({
      where: { is_current: true },
      select: { provider: true, model: true, available: true, input_price_per_mtok_usd: true, output_price_per_mtok_usd: true },
    }),
  ]);

  const catalog: CatalogOption[] = catalogRows
    .filter((c): c is typeof c & { provider: ModelProvider } => (MODEL_PROVIDERS as readonly string[]).includes(c.provider))
    .map((c) => ({
      provider: c.provider,
      model: c.model,
      available: c.available,
      input_price_per_mtok_usd: Number(c.input_price_per_mtok_usd),
      output_price_per_mtok_usd: Number(c.output_price_per_mtok_usd),
    }));

  const rows = buildRoleRows(promptRoles, assignments, catalog);
  const grouped = groupCatalog(catalog);
  const groups = (Object.keys(ROLE_GROUP_LABEL) as RoleGroup[])
    .map((g) => ({ group: g, label: ROLE_GROUP_LABEL[g], rows: rows.filter((r) => r.group === g) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/settings" className="text-[12.5px] text-white/45 no-underline hover:text-white/75">
        ← 設定
      </Link>
      <section className="fade-up mt-3">
        <h1 className="text-3xl font-bold tracking-tight text-white">AI モデル設定</h1>
        <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-white/55">
          役割ごとに使う LLM を選びます (全ジャンル共通の既定)。保存すると次の呼出から反映され、旧設定は履歴として残ります。
          ジャンル別の上書き (例: 小説だけ別モデル) は{' '}
          <a href={`${A2P_URL}/settings/models`} target="_blank" rel="noopener noreferrer" className="text-emerald-300 underline">
            A2P の設定
          </a>{' '}
          で行います。モデル一覧と料金はカタログ (A2P 側で自動更新) から取ります。
        </p>
      </section>
      <ModelsPanel groups={groups} catalog={grouped} />
    </div>
  );
}
