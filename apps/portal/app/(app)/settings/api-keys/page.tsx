/**
 * 設定 › API 管理 — 各サービサーの API キー (Anthropic / OpenAI / Google / Tavily) と
 * サービス連携の接続情報 (Cloudflare R2 / LINE / Amazon Ads) を一元管理 (docs/10 §10.4b)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { decodeServiceCredentials, maskServiceFields, serviceFieldsFromEnv } from '@a2p/credentials';
import { prisma } from '@a2p/db';

import { API_PROVIDERS, API_PROVIDER_META, SERVICE_PROVIDERS, SERVICE_PROVIDER_META, envKeyFor, type ApiKeyTestResult } from '@/lib/settings-core';

import { ApiKeysPanel, type ApiKeyRowView } from './api-keys-panel';
import { ServiceCredentialsPanel, type ServiceCredentialRowView } from './service-credentials-panel';

export const metadata: Metadata = { title: 'API 管理 | 設定 | M2P' };
export const dynamic = 'force-dynamic';

export default async function ApiKeysPage() {
  const rows = await prisma.apiCredential.findMany({
    select: { provider: true, key_enc: true, key_mask: true, set_at: true, last_tested_at: true, last_test_result_json: true },
  });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const views: ApiKeyRowView[] = API_PROVIDERS.map((p) => {
    const row = byProvider.get(p);
    const test = (row?.last_test_result_json ?? null) as ApiKeyTestResult | null;
    return {
      provider: p,
      meta: API_PROVIDER_META[p],
      configured: !!row,
      key_mask: row?.key_mask ?? null,
      set_at: row?.set_at ? row.set_at.toISOString() : null,
      last_tested_at: row?.last_tested_at ? row.last_tested_at.toISOString() : null,
      last_test: test && typeof test.ok === 'boolean' ? test : null,
      // ポータルの環境変数に同名キーがあれば「環境変数にて設定済み」(DB 未登録なら取り込み可)。
      env_configured: envKeyFor(p) !== null,
    };
  });

  const services: ServiceCredentialRowView[] = SERVICE_PROVIDERS.map((p) => {
    const row = byProvider.get(p);
    const test = (row?.last_test_result_json ?? null) as ApiKeyTestResult | null;
    let masked: ServiceCredentialRowView['masked_fields'] = null;
    if (row) {
      try {
        masked = maskServiceFields(p, decodeServiceCredentials(row.key_enc));
      } catch {
        masked = null;
      }
    }
    return {
      provider: p,
      meta: SERVICE_PROVIDER_META[p],
      configured: !!row,
      masked_fields: masked,
      key_mask: row?.key_mask ?? null,
      set_at: row?.set_at ? row.set_at.toISOString() : null,
      last_tested_at: row?.last_tested_at ? row.last_tested_at.toISOString() : null,
      last_test: test && typeof test.ok === 'boolean' ? test : null,
      env_configured: serviceFieldsFromEnv(p) !== null,
    };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/settings" className="text-[12.5px] text-white/45 no-underline hover:text-white/75">
        ← 設定
      </Link>
      <section className="fade-up mt-3">
        <h1 className="text-3xl font-bold tracking-tight text-white">API 管理</h1>
        <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-white/55">
          API キーと外部サービスの接続情報は M2P で一元管理します。AES-256-GCM で暗号化して保存し、画面には末尾のマスクだけを表示します。
          保存後 1 分以内に A2P / ANP / worker のすべてが新しい設定を使い始めます。環境変数で設定済みのものは「環境変数にて設定済み」と表示され、
          「DB に取り込む」でここに移せます (取り込み後は DB の設定が優先)。
        </p>
      </section>

      <h2 className="mt-8 text-[13px] font-semibold uppercase tracking-wider text-white/40">AI サービサー API キー</h2>
      <ApiKeysPanel rows={views} />

      <h2 className="mt-10 text-[13px] font-semibold uppercase tracking-wider text-white/40">サービス連携 (ストレージ / 通知 / 広告)</h2>
      <ServiceCredentialsPanel rows={services} />
    </div>
  );
}
