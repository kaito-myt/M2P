'use client';

/**
 * DesignGeneratingIndicator — 設計案生成中 (status='generating') の進捗表示 + 自動更新。
 * `note.account.design` は LLM 1 回 (Opus, 長い JSON) なので実進捗は無く、経過時間ベースの
 * 目安表示だけを出す。4 秒ごとに `router.refresh()` して、提案済みになったら自動で画面が切り替わる。
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { GenerationProgress } from '@/components/generation-progress';
import { messages } from '@/lib/messages';

const REFRESH_MS = 4000;
/** 目安の所要時間 (秒)。Opus の設計案 JSON は 60〜120 秒。 */
const ESTIMATE_SEC = 90;

export function DesignGeneratingIndicator({ createdAt }: { createdAt: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [router]);

  return (
    <GenerationProgress
      className="mt-space-relaxed rounded-card border border-border-warm bg-white px-3 py-2"
      startedAt={createdAt}
      estimateSec={ESTIMATE_SEC}
      pct={null}
      stageLabel={messages.accountDesign.detail.generatingStage}
      capPct={95}
    />
  );
}
