/**
 * 経営ダッシュボード。M2P 全ツール横断の損益を集約する画面 (docs/10 §5)。
 *
 * **コストは実データで稼働済み。** 各ツール (A2P / ANP) のコスト画面は
 * `token_usage.tool` で自分の活動分だけを集計する方針にしたので (docs/05 §3.3)、
 * 全ツール合算をここで見る。売上/純利益は書籍ロイヤリティと note 売上の
 * 突合が必要なのでまだ枠のまま。
 */
import type { Metadata } from 'next';
import { TrendingUp, Wallet, PiggyBank, BarChart3 } from 'lucide-react';

import { prisma } from '@a2p/db';
import { TOOL_LABEL, TOOL_SHORT_LABEL } from '@a2p/contracts/cost-attribution';

import { getTools } from '@/lib/tools';
import {
  computePlatformCost,
  percentChange,
  platformCostRange,
  type PlatformCostUsageRow,
} from '@/lib/platform-cost-core';

export const metadata: Metadata = {
  title: '経営ダッシュボード | M2P',
};

export const dynamic = 'force-dynamic';

const DEFAULT_BUDGET_JPY = 50_000;

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

/** ツール別のアクセント色 (ツール選択タイルと揃える)。 */
const TOOL_ACCENT: Record<string, string> = {
  a2p: '#34d399',
  anp: '#60a5fa',
  m2p: '#a78bfa',
};

const LEVEL_TEXT: Record<string, string> = {
  green: 'text-emerald-300',
  yellow: 'text-amber-300',
  orange: 'text-orange-300',
  red: 'text-rose-300',
};

export default async function PlatformDashboardPage() {
  const tools = getTools();
  const now = new Date();
  const { start, end } = platformCostRange(now);

  const [usageRaw, settings] = await Promise.all([
    prisma.$queryRaw<Array<{ date: string; tool: string; cost_jpy: unknown; call_count: bigint }>>`
      SELECT
        -- created_at は timestamp WITHOUT time zone に UTC を入れている。そこへ
        -- AT TIME ZONE 'Asia/Tokyo' を 1 回だけ掛けると「この値は東京時刻」と解釈されて
        -- 9 時間引かれる (2026-10-13 実測: 保存値 10-12 22:31 が 10-12 13:31 になる)。
        -- 一度 UTC と宣言してから東京へ変換するのが正しい (= +9h)。
        TO_CHAR(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS date,
        tool,
        SUM(cost_jpy) AS cost_jpy,
        COUNT(*) AS call_count
      FROM token_usage
      WHERE created_at >= ${start} AND created_at < ${end}
      GROUP BY 1, 2
      ORDER BY 1
    `,
    prisma.appSettings
      .findUnique({ where: { id: 'singleton' }, select: { monthly_cost_red_jpy: true } })
      .catch(() => null),
  ]);

  const usage: PlatformCostUsageRow[] = usageRaw.map((u) => ({
    date: u.date,
    tool: u.tool,
    cost_jpy: u.cost_jpy,
    call_count: Number(u.call_count),
  }));

  const d = computePlatformCost({
    usage,
    now,
    budgetJpy: settings?.monthly_cost_red_jpy ?? DEFAULT_BUDGET_JPY,
  });
  const mom = percentChange(d.totalThisMonth, d.totalLastMonth);
  const maxDaily = d.daily.reduce((mx, p) => Math.max(mx, p.cost_jpy), 0);
  const maxTool = d.byTool.reduce((mx, t) => Math.max(mx, t.cost_jpy), 0);

  return (
    <div className="mx-auto max-w-6xl">
      <section className="fade-up">
        <div className="glass mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] text-white/55">
          <BarChart3 className="h-3.5 w-3.5" />
          {d.ym} / 全ツール合算
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">経営ダッシュボード</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/55">
          M2P 上のすべてのツール（A2P・ANP・共通）の AI コストを横断で集約します。
          各ツールの画面は<strong className="text-white/80">そのツール内で発生した分だけ</strong>を表示するので、
          全体の数字はここで見てください。売上・純利益の横断集計は実装中です。
        </p>
      </section>

      {/* KPI */}
      <section aria-label="全体KPI" className="mt-9 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="glass rounded-[18px] p-5" data-testid="kpi-total-cost">
          <div className="flex items-center justify-between">
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: 'linear-gradient(140deg, #a78bfa, #a78bfa88)', color: '#06120c' }}
            >
              <Wallet className="h-5 w-5" />
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40">
              実データ
            </span>
          </div>
          <p className="mt-4 text-[13px] text-white/50">総 AI コスト（当月）</p>
          <p className="mt-1.5 text-[26px] font-semibold tabular-nums text-white">{yen(d.totalThisMonth)}</p>
          <p className="mt-1 text-[12px] text-white/40">
            前月 {yen(d.totalLastMonth)}
            {mom != null ? `（${mom > 0 ? '+' : ''}${mom}%）` : ''}・{d.callsThisMonth.toLocaleString('ja-JP')} 回
          </p>
        </div>

        <div className="glass rounded-[18px] p-5" data-testid="kpi-forecast">
          <div className="flex items-center justify-between">
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: 'linear-gradient(140deg, #fbbf24, #fbbf2488)', color: '#06120c' }}
            >
              <PiggyBank className="h-5 w-5" />
            </span>
            <span className={`text-[11px] ${LEVEL_TEXT[d.level] ?? 'text-white/40'}`}>
              予算比 {d.forecastRatioPct}%
            </span>
          </div>
          <p className="mt-4 text-[13px] text-white/50">月末着地の予測</p>
          <p className="mt-1.5 text-[26px] font-semibold tabular-nums text-white">
            {d.forecastMonthEnd != null ? yen(d.forecastMonthEnd) : '—'}
          </p>
          <p className="mt-1 text-[12px] text-white/40">月次赤ライン {yen(d.budgetJpy)}</p>
        </div>

        <div className="glass rounded-[18px] p-5">
          <div className="flex items-center justify-between">
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: 'linear-gradient(140deg, #34d399, #34d39988)', color: '#06120c' }}
            >
              <TrendingUp className="h-5 w-5" />
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40">
              準備中
            </span>
          </div>
          <p className="mt-4 text-[13px] text-white/50">全体売上・純利益（当月）</p>
          <div className="mt-1.5 h-8 w-32 animate-pulse rounded-md bg-white/[0.06]" />
          <p className="mt-1 text-[12px] text-white/40">書籍ロイヤリティ + note 売上の突合が未実装</p>
        </div>
      </section>

      {/* ツール別コスト内訳 */}
      <section aria-label="ツール別コスト内訳" className="mt-6">
        <div className="glass rounded-[18px] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-white">ツール別の AI コスト（当月）</h2>
            <span className="text-[11px] text-white/35">token_usage.tool で帰属</span>
          </div>
          <ul className="mt-4 divide-y divide-white/[0.06]" data-testid="cost-by-tool">
            {d.byTool.map((t) => {
              const logo = tools.find((x) => x.id === t.tool)?.logo;
              const accent = TOOL_ACCENT[t.tool] ?? '#a78bfa';
              return (
                <li key={t.tool} className="flex items-center gap-4 py-3">
                  {logo ? (
                    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={logo} alt="" className="h-full w-full object-contain p-0.5" />
                    </span>
                  ) : (
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] text-[#06120c]"
                      style={{ background: accent }}
                    >
                      {TOOL_SHORT_LABEL[t.tool].slice(0, 1)}
                    </span>
                  )}
                  <span
                    className="w-16 shrink-0 text-[13.5px] font-medium text-white/85"
                    title={TOOL_LABEL[t.tool]}
                  >
                    {TOOL_SHORT_LABEL[t.tool]}
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: maxTool > 0 ? `${(t.cost_jpy / maxTool) * 100}%` : '0%',
                        background: accent,
                      }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-white/35">
                    {Math.round(t.sharePct)}%
                  </span>
                  <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-white/70">
                    {yen(t.cost_jpy)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-white/35">
            「共通」はどのツールにも属さない活動（AI 組織の経営判断・全社コスト分析）。
            A2P と ANP の両方を見て動くため、片方に寄せずここに集計します。
          </p>
        </div>
      </section>

      {/* 日次推移 */}
      <section aria-label="日次コスト推移" className="mt-6">
        <div className="glass rounded-[18px] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-white">日次推移（当月・全ツール）</h2>
            <span className="text-[11px] text-white/35">最大 {yen(maxDaily)}/日</span>
          </div>
          {d.daily.length === 0 ? (
            <p className="mt-4 text-[13px] text-white/40">当月の記録はまだありません。</p>
          ) : (
            <div className="mt-4 flex items-end gap-1" data-testid="cost-daily">
              {d.daily.map((p) => (
                <div key={p.date} className="flex flex-1 flex-col items-center gap-1" title={`${p.date} ${yen(p.cost_jpy)}`}>
                  <div className="flex h-24 w-full flex-col justify-end overflow-hidden rounded-t">
                    {(['m2p', 'anp', 'a2p'] as const).map((t) =>
                      p.byTool[t] > 0 ? (
                        <div
                          key={t}
                          style={{
                            height: maxDaily > 0 ? `${(p.byTool[t] / maxDaily) * 100}%` : '0%',
                            background: TOOL_ACCENT[t],
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                  <span className="text-[9px] tabular-nums text-white/25">{p.date.slice(8)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
