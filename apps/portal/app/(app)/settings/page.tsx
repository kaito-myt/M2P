/**
 * 設定 (ハブ) — プラットフォーム共通の API 管理 (サービサー API キー＋サービス連携) への入口と、各ツールのモデル設定への案内 (docs/10 §10.4b)。
 * 各ツール (A2P / ANP) は同じ DB を共有するため、ここでの変更は全ツールに反映される。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Cpu, KeyRound, Settings } from 'lucide-react';

import { prisma } from '@a2p/db';

import { serviceFieldsFromEnv } from '@a2p/credentials/spec';

import { API_PROVIDERS, API_PROVIDER_META, SERVICE_PROVIDERS, SERVICE_PROVIDER_META, envKeyFor } from '@/lib/settings-core';
import { getTools } from '@/lib/tools';

export const metadata: Metadata = { title: '設定 | M2P' };
export const dynamic = 'force-dynamic';

export default async function SettingsHubPage() {
  const credentials = await prisma.apiCredential.findMany({ select: { provider: true } });
  const configured = new Set(credentials.map((c) => c.provider));
  const envOnly = API_PROVIDERS.filter((p) => !configured.has(p) && envKeyFor(p) !== null);
  const missing = API_PROVIDERS.filter((p) => !configured.has(p) && envKeyFor(p) === null);
  const servicesEnvOnly = SERVICE_PROVIDERS.filter((p) => !configured.has(p) && serviceFieldsFromEnv(p) !== null);
  const servicesMissing = SERVICE_PROVIDERS.filter((p) => !configured.has(p) && serviceFieldsFromEnv(p) === null);
  const servicesConfigured = SERVICE_PROVIDERS.filter((p) => configured.has(p)).length;
  const tools = getTools();

  return (
    <div className="mx-auto max-w-5xl">
      <section className="fade-up">
        <div className="glass mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] text-white/55">
          <Settings className="h-3.5 w-3.5" />
          プラットフォーム共通
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">設定</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/55">
          A2P・ANP が共通で使う<strong className="text-white/80">各サービサーの API キーと外部サービスの接続情報 (R2 / LINE / Amazon Ads)</strong>を M2P で一元管理します。
          変更は全ツールに 1 分以内に反映されます。AI モデルの割当は役割がツールごとに異なるため、各ツールの設定で行います。
        </p>
      </section>

      <section className="mt-9 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Link href="/settings/api-keys" className="glass tool-card is-live block rounded-[18px] p-6 no-underline" style={{ ['--accent' as string]: '#34d399' }}>
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: 'linear-gradient(140deg, #34d399, #34d39999)' }}>
              <KeyRound className="h-5 w-5" />
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/55">
              キー {API_PROVIDERS.filter((p) => configured.has(p)).length}/{API_PROVIDERS.length} ・ 連携 {servicesConfigured}/{SERVICE_PROVIDERS.length}
            </span>
          </div>
          <h2 className="mt-5 text-[17px] font-semibold text-white">API 管理</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/55">
            Anthropic / OpenAI / Google / Tavily のキーと、Cloudflare R2 / LINE / Amazon Ads の接続情報を暗号化して保存し、疎通テストします。
          </p>
          {(envOnly.length > 0 || servicesEnvOnly.length > 0) && (
            <p className="mt-3 text-[12.5px] text-sky-300/90">
              環境変数にて設定済み (DB 未取込): {[...envOnly.map((p) => API_PROVIDER_META[p].label), ...servicesEnvOnly.map((p) => SERVICE_PROVIDER_META[p].label)].join(' / ')}
            </p>
          )}
          {(missing.length > 0 || servicesMissing.length > 0) && (
            <p className="mt-3 text-[12.5px] text-amber-300/90">
              未設定: {[...missing.map((p) => API_PROVIDER_META[p].label), ...servicesMissing.map((p) => SERVICE_PROVIDER_META[p].label)].join(' / ')}
            </p>
          )}
        </Link>

        <div className="glass block rounded-[18px] p-6">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: 'linear-gradient(140deg, #a78bfa, #a78bfa99)' }}>
            <Cpu className="h-5 w-5" />
          </span>
          <h2 className="mt-5 text-[17px] font-semibold text-white">AI モデル設定 (各ツール側)</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/55">
            役割 (マーケター・ライター・判定・note 記事…) はツールごとに異なるため、モデルの割当は各ツールの設定で行います。
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
            {tools.map((t) =>
              t.url ? (
                <li key={t.id}>
                  <a href={`${t.url}${t.id === 'a2p' ? '/settings/models' : '/settings'}`} target="_blank" rel="noopener noreferrer" className="text-emerald-300 underline">
                    {t.name} のモデル設定を開く
                  </a>
                </li>
              ) : (
                <li key={t.id} className="text-white/40">{t.name}: 準備中</li>
              ),
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
