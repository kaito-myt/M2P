/**
 * F-ANP-21 (docs/11-anp-design.md §3.3/§7) — note 認証リレー。
 *
 * note はサーバー完結の自動再ログインが不可 (reCAPTCHA、docs/11 §2.1) なため、KDP の
 * LINE OTP リレー (`line-auth-relay.ts` の `requestOtpViaLine`) とは異なり「LINE 返信で
 * コードを受け取る」フローは使えない。代わりに:
 *   1. `pipeline.note.publish` / `note.sales.fetch` / `note.publish.status.sync` / `note.engage`
 *      が `not_logged_in` (session_expired) を検知したら `note_auth_requests` に
 *      `purpose='session_expired', status='pending'` 行を作る (同一アカウントの pending が
 *      既にあれば作らない = 連投防止の重複排除)。
 *   2. 新規作成時のみ LINE push で運営者に通知し、再取込コマンドを案内する。
 *   3. `scripts/anp/note-session-capture.mjs` がセッション保存に成功した時点で、当該アカウントの
 *      pending 行を `fulfilled` にし `note_accounts.status` を `active` へ戻す (DB 直更新、
 *      本モジュールは worker 側の作成/通知のみを担当)。
 */
import { createLogger } from '@a2p/contracts/logger';

import { pushLine } from './line-auth-relay.js';

const log = createLogger('worker.note-auth-relay');

export const NOTE_SESSION_EXPIRED_PURPOSE = 'session_expired';

export interface NoteAuthRelayPrisma {
  noteAuthRequest: {
    findFirst: (args: {
      where: { note_account_id: string; purpose: string; status: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    create: (args: {
      data: { purpose: string; status: string; prompt: string; note_account_id: string };
    }) => Promise<{ id: string }>;
  };
}

/** 再取込コマンド (運営者がローカル端末で実行する)。 */
export function noteSessionRecaptureCommand(noteAccountId: string): string {
  return `bash scripts/anp/note-session-capture.sh ${noteAccountId}`;
}

/**
 * セッション失効を検知した際の通知ゲート。同一アカウントの `session_expired` pending 行が
 * 既にあれば何もしない (重複作成・連投通知を防ぐ)。新規作成時のみ LINE push する。
 * 呼出側は本関数とは別に `note_accounts.status='paused'` への更新を行うこと (責務分離)。
 */
export async function notifyNoteSessionExpired(
  prisma: NoteAuthRelayPrisma,
  noteAccountId: string,
  displayName: string,
  notify: (text: string) => Promise<boolean> = pushLine,
): Promise<void> {
  try {
    const existing = await prisma.noteAuthRequest.findFirst({
      where: { note_account_id: noteAccountId, purpose: NOTE_SESSION_EXPIRED_PURPOSE, status: 'pending' },
      select: { id: true },
    });
    if (existing) {
      log.info({ noteAccountId, requestId: existing.id }, 'session_expired already pending — skip duplicate notify');
      return;
    }

    await prisma.noteAuthRequest.create({
      data: {
        purpose: NOTE_SESSION_EXPIRED_PURPOSE,
        status: 'pending',
        prompt: `note アカウント「${displayName}」のセッションが失効しました。`,
        note_account_id: noteAccountId,
      },
    });

    await notify(
      `⚠️ ANP: note アカウント「${displayName}」のセッションが失効しました。` +
        `ローカルで次のコマンドを実行してセッションを再取込してください(自動運用は一時停止中):\n` +
        noteSessionRecaptureCommand(noteAccountId),
    ).catch(() => false);
  } catch (err) {
    log.warn({ err, noteAccountId }, 'notifyNoteSessionExpired failed (ignored)');
  }
}
