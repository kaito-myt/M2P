/**
 * 入稿キューの入稿予定 (SubmitEta) を DB から算出して返すローダ。
 * 一覧 (/kdp/checklist) と詳細 (/kdp/checklist/[bookId]) の両方で使う。
 *
 * dispatcher と同じ母集団（`kdp_publish_queued=true` かつ KDP 未投入）を updated_at 昇順で読み、
 * AppSettings の有効フラグ・cron と合わせて computeSubmitSchedule に渡す。
 */
import { prisma } from '@a2p/db';

import { computeSubmitSchedule, type SubmitEta } from './kdp-submit-eta';

const DEFAULT_CRON = '*/30 * * * *';

export async function loadSubmitSchedule(now: Date = new Date()): Promise<Record<string, SubmitEta>> {
  const [settings, books] = await Promise.all([
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { kdp_auto_submit_enabled: true, kdp_auto_submit_cron: true },
    }),
    prisma.book.findMany({
      // dispatcher の対象と同一条件（既に KDP にある本＝published/submitted/retracted は除外）。
      where: {
        kdp_publish_queued: true,
        publish_status: { notIn: ['published', 'submitted', 'retracted'] },
      },
      select: { id: true, updated_at: true, kdp_submit_cooldown_until: true },
      orderBy: { updated_at: 'asc' },
    }),
  ]);

  const schedule = computeSubmitSchedule({
    now,
    cron: settings?.kdp_auto_submit_cron?.trim() || DEFAULT_CRON,
    enabled: Boolean(settings?.kdp_auto_submit_enabled),
    books: books.map((b) => ({
      id: b.id,
      updatedAt: b.updated_at,
      cooldownUntil: b.kdp_submit_cooldown_until,
    })),
  });

  return Object.fromEntries(schedule);
}
