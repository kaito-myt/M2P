/**
 * 経営ダッシュボード（雛形）。将来 M2P 全ツール横断の売上・コスト・純利益を集約表示する。
 * 現状はプレースホルダ（各ツールの DB を横断集計するコネクタは今後実装）。
 */
import type { Metadata } from 'next';
import { TrendingUp, Wallet, PiggyBank, BarChart3 } from 'lucide-react';
import { getTools } from '@/lib/tools';

export const metadata: Metadata = {
  title: '経営ダッシュボード | M2P',
};

const KPIS = [
  { key: 'revenue', label: '全体売上（当月）', icon: TrendingUp, accent: '#34d399' },
  { key: 'cost', label: '総コスト（当月）', icon: Wallet, accent: '#a78bfa' },
  { key: 'profit', label: '純利益（当月）', icon: PiggyBank, accent: '#fbbf24' },
];

export default function PlatformDashboardPage() {
  const tools = getTools();

  return (
    <div className="mx-auto max-w-6xl">
      <section className="fade-up">
        <div className="glass mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] text-white/55">
          <BarChart3 className="h-3.5 w-3.5" />
          近日公開
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">経営ダッシュボード</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/55">
          M2P 上のすべてのツール（A2P・ANP・今後追加分）の<strong className="text-white/80">売上・コスト・純利益</strong>を
          横断で集約し、プラットフォーム全体の損益をひと目で把握できるようにします。ここは今後実装する枠です。
        </p>
      </section>

      {/* KPI プレビュー（ダミー） */}
      <section aria-label="全体KPI（準備中）" className="mt-9 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {KPIS.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.key} className="glass rounded-[18px] p-5">
              <div className="flex items-center justify-between">
                <span
                  className="grid h-10 w-10 place-items-center rounded-xl"
                  style={{ background: `linear-gradient(140deg, ${k.accent}, ${k.accent}88)`, color: '#06120c' }}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40">
                  準備中
                </span>
              </div>
              <p className="mt-4 text-[13px] text-white/50">{k.label}</p>
              <div className="mt-1.5 h-8 w-32 animate-pulse rounded-md bg-white/[0.06]" />
            </div>
          );
        })}
      </section>

      {/* ツール別内訳（枠だけ） */}
      <section aria-label="ツール別内訳（準備中）" className="mt-6">
        <div className="glass rounded-[18px] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-white">ツール別の損益内訳</h2>
            <span className="text-[11px] text-white/35">集計コネクタ実装後に表示</span>
          </div>
          <ul className="mt-4 divide-y divide-white/[0.06]">
            {tools.map((t) => (
              <li key={t.id} className="flex items-center gap-4 py-3">
                {t.logo ? (
                  <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.logo} alt="" className="h-full w-full object-contain p-0.5" />
                  </span>
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-[11px] text-white/70">
                    {t.name.slice(0, 1)}
                  </span>
                )}
                <span className="w-16 shrink-0 text-[13.5px] font-medium text-white/85">{t.name}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className="h-full w-0 rounded-full bg-white/10" />
                </div>
                <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-white/30">— 円</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
