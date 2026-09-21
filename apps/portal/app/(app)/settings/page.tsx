/**
 * 設定 (ハブ) — プラットフォーム共通の AI モデル割当と API キー管理への入口 (docs/10 §設定)。
 * 各ツール (A2P / ANP) は同じ DB を共有するため、ここでの変更は全ツールに反映される。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Cpu, KeyRound, Settings } from 'lucide-react';

import { prisma } from '@a2p/db';

import { API_PROVIDERS, API_PROVIDER_META } from '@/lib/settings-core';

export const metadata: Metadata = { title: '設定 | M2P' };
export const dynamic = 'force-dynamic';

export default async function SettingsHubPage() {
  const [credentials, activeAssignments, unavailable] = await Promise.all([
    prisma.apiCredential.findMany({ select: { provider: true, last_test_result_json: true } }),
    prisma.modelAssignment.count({ where: { status: 'active', genre: null } }),
    prisma.modelCatalog.count({ where: { is_current: true, available: false } }),
  ]);
  const configured = new Set(credentials.map((c) => c.provider));
  const missing = API_PROVIDERS.filter((p) => !configured.has(p));

  return (
    <div className="mx-auto max-w-5xl">
      <section className="fade-up">
        <div className="glass mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] text-white/55">
          <Settings className="h-3.5 w-3.5" />
          プラットフォーム共通
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">設定</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/55">
          A2P・ANP が共通で使う <strong className="text-white/80">AI モデルの割当</strong>と
          <strong className="text-white/80">各サービサーの API キー</strong>をここで一元管理します。変更は全ツールに即時反映されます。
        </p>
      </section>

      <section className="mt-9 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Link href="/settings/api-keys" className="glass tool-card is-live block rounded-[18px] p-6 no-underline" style={{ ['--accent' as string]: '#34d399' }}>
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: 'linear-gradient(140deg, #34d399, #34d39999)' }}>
              <KeyRound className="h-5 w-5" />
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/55">
              {configured.size} / {API_PROVIDERS.length} 設定済み
            </span>
          </div>
          <h2 className="mt-5 text-[17px] font-semibold text-white">API キー</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/55">
            Anthropic / OpenAI / Google / Tavily のキーを暗号化して保存し、疎通テストします。
          </p>
          {missing.length > 0 && (
            <p className="mt-3 text-[12.5px] text-amber-300/90">
              未設定: {missing.map((p) => API_PROVIDER_META[p].label).join(' / ')}
            </p>
          )}
        </Link>

        <Link href="/settings/models" className="glass tool-card is-live block rounded-[18px] p-6 no-underline" style={{ ['--accent' as string]: '#a78bfa' }}>
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: 'linear-gradient(140deg, #a78bfa, #a78bfa99)' }}>
              <Cpu className="h-5 w-5" />
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/55">
              {activeAssignments} 役割
            </span>
          </div>
          <h2 className="mt-5 text-[17px] font-semibold text-white">AI モデル設定</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/55">
            役割 (マーケター・ライター・判定・note 記事…) ごとに使うモデルを切り替えます。
          </p>
          {unavailable > 0 && (
            <p className="mt-3 text-[12.5px] text-amber-300/90">カタログに呼び出し不可のモデルが {unavailable} 件あります</p>
          )}
        </Link>
      </section>
    </div>
  );
}
