/**
 * 設定 › API キー — 各サービサー (Anthropic / OpenAI / Google / Tavily) のキーを管理 (docs/10 §設定)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { API_PROVIDERS, API_PROVIDER_META, type ApiKeyTestResult } from '@/lib/settings-core';

import { ApiKeysPanel, type ApiKeyRowView } from './api-keys-panel';

export const metadata: Metadata = { title: 'API キー | 設定 | M2P' };
export const dynamic = 'force-dynamic';

export default async function ApiKeysPage() {
  const rows = await prisma.apiCredential.findMany({
    select: { provider: true, key_mask: true, set_at: true, last_tested_at: true, last_test_result_json: true },
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
    };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/settings" className="text-[12.5px] text-white/45 no-underline hover:text-white/75">
        ← 設定
      </Link>
      <section className="fade-up mt-3">
        <h1 className="text-3xl font-bold tracking-tight text-white">API キー</h1>
        <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-white/55">
          キーは AES-256-GCM で暗号化して保存し、画面には末尾のマスクだけを表示します。保存後 1 分以内に A2P / ANP / worker の
          すべてが新しいキーを使い始めます。環境変数 (`ANTHROPIC_API_KEY` 等) より DB のキーが優先されます。
        </p>
      </section>
      <ApiKeysPanel rows={views} />
    </div>
  );
}
