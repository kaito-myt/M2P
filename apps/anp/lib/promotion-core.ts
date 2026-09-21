/**
 * S-ANP-10 販促施策 (docs/11-anp-design.md §3.4 F-ANP-32) — RSC/Server Action 共用の DB ローダ。
 *
 * 運営者要望 (2026-09-21)「メニューに販促施策を作って。アカウントごとに販促施策が設定できるようにして。
 * ページの右上あたりにアカウント切替…各アカウントごとに X、IG、TikTok、ブログでの販促施策を確認できるようにして。
 * 各媒体はページ内にさらにタブで分かれるようにして」。純関数と型は `promotion-view.ts`。
 */
import { isNotePromotionChannelEnabled, parseNoteAccountSettings, parseNotePromotionPolicy, type NotePromotionChannel } from '@a2p/contracts/agents/anp';
import { prisma } from '@a2p/db';

import { NOTE_ACCOUNT_PROFILE_TASK_NAME, failStaleProfileJobs } from './account-profile-core';
import { isNotePromotionChannel, type AccountPromotionState, type PromotionJobView } from './promotion-view';

export * from './promotion-view';

export async function loadAccountPromotionState(noteAccountId: string, channel: NotePromotionChannel): Promise<AccountPromotionState | null> {
  const account = await prisma.noteAccount.findUnique({
    where: { id: noteAccountId },
    select: { promotion_policy_json: true, settings_json: true },
  });
  if (!account) return null;
  const policy = parseNotePromotionPolicy(account.promotion_policy_json);
  const settings = parseNoteAccountSettings(account.settings_json);
  await failStaleProfileJobs(noteAccountId).catch(() => 0);
  const job = await prisma.job.findFirst({
    where: { kind: NOTE_ACCOUNT_PROFILE_TASK_NAME, payload_json: { path: ['note_account_id'], equals: noteAccountId } },
    orderBy: { created_at: 'desc' },
    select: { id: true, status: true, error: true, payload_json: true, result_json: true, created_at: true },
  });
  let jobView: PromotionJobView | null = null;
  if (job) {
    const payload = (job.payload_json ?? {}) as { targets?: unknown; channel?: unknown };
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    if (targets.includes('promotion')) {
      const result = (job.result_json ?? {}) as { progress?: { stage?: unknown; pct?: unknown } };
      const p = result.progress;
      jobView = {
        id: job.id,
        status: job.status,
        channel: isNotePromotionChannel(payload.channel) ? payload.channel : null,
        error: job.error,
        progress: p && typeof p.stage === 'string' && typeof p.pct === 'number' ? { stage: p.stage, pct: Math.max(0, Math.min(100, p.pct)) } : null,
        created_at: job.created_at.toISOString(),
      };
    }
  }
  const generating = jobView !== null && jobView.channel === channel && (jobView.status === 'queued' || jobView.status === 'running');
  return {
    channel,
    policy: policy[channel] ?? null,
    effective_enabled: isNotePromotionChannelEnabled(policy, channel, settings),
    explicit_enabled: policy[channel]?.enabled !== undefined,
    tiktok_enabled: settings.tiktok_enabled === true,
    job: jobView,
    generating,
  };
}

