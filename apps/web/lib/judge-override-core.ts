/**
 * [F-099] 品質判定ゲート (needs_human_review) の人間判断 — コアロジック。
 *
 * ## なぜ要るか (2026-10-14 実測)
 * `pipeline.book.judge` は `score_total < 80` かつ再キック上限で
 * `Book.status='needs_human_review'` に落とす。ところが**この状態を承認する導線が
 * どこにも無かった**:
 *   - `/content-review` も `ContentApprovalBanner` も `status='content_review'` 専用
 *   - `approveBookContent` は `status !== 'content_review'` を conflict で弾く
 * 結果、14 冊が最長 1 か月 (最古 2026-09-16) 止まっていた。
 *
 * ## 承認したらどうなるか
 * judge 合格時 (`pipeline-book-judge.ts` の分岐 A) と**まったく同じ遷移**にする:
 *   `status='thumbnail'` → `/covers` でカバー採用 → `pipeline.book.export`
 * 新しい経路を作らないので、以降の挙動は合格した本と完全に同じになる。
 * (対象 14 冊はいずれも生成済みカバーを 3〜6 枚持っているので、採用するだけで進む。)
 *
 * ## 破棄
 * 本文も AI コストも既に発生済みなので**削除はしない**。`retracted` にして
 * ライブラリの既定表示から外すだけにする (後から理由を監査ログで追える)。
 */
import { fail, ok, type ActionResult } from '@a2p/contracts';

export interface JudgeOverrideBookRow {
  id: string;
  status: string;
}

export interface JudgeOverrideDeps {
  bookRepo: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; status: true };
    }): Promise<JudgeOverrideBookRow | null>;
    update(args: { where: { id: string }; data: { status: string } }): Promise<unknown>;
  };
  auditRepo: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  actorId: string | null;
  messages: {
    error: string;
    notReviewable: string;
  };
}

/** このゲートが扱える状態。ここ以外から呼ばれたら conflict を返す。 */
export const JUDGE_GATE_STATUS = 'needs_human_review';
/** 承認後の状態 = judge 合格時と同じ (サムネ承認ゲート)。 */
export const JUDGE_APPROVED_STATUS = 'thumbnail';
/** 破棄後の状態。削除はしない。 */
export const JUDGE_DISCARDED_STATUS = 'retracted';

async function transition(
  deps: JudgeOverrideDeps,
  args: { bookId: string; nextStatus: string; action: string; note?: string | null },
): Promise<ActionResult<{ book_id: string }>> {
  const book = await deps.bookRepo.findUnique({
    where: { id: args.bookId },
    select: { id: true, status: true },
  });
  if (!book) return fail('not_found', deps.messages.error);
  if (book.status !== JUDGE_GATE_STATUS) {
    return fail('conflict', deps.messages.notReviewable);
  }

  await deps.bookRepo.update({
    where: { id: args.bookId },
    data: { status: args.nextStatus },
  });

  await deps.auditRepo.create({
    data: {
      actor_id: deps.actorId,
      action: args.action,
      target_kind: 'book',
      target_id: args.bookId,
      before_json: { status: JUDGE_GATE_STATUS },
      after_json: { status: args.nextStatus, note: args.note ?? null },
    },
  });

  return ok({ book_id: args.bookId });
}

/** 判定不合格を人間が覆して出版へ進める。 */
export async function approveJudgeOverrideCore(
  deps: JudgeOverrideDeps,
  args: { bookId: string; note?: string | null },
): Promise<ActionResult<{ book_id: string }>> {
  return transition(deps, {
    bookId: args.bookId,
    nextStatus: JUDGE_APPROVED_STATUS,
    action: 'book.judge.override_approve',
    note: args.note ?? null,
  });
}

/** 出版しないと決めた本を片付ける (削除はしない)。 */
export async function discardJudgeFailedCore(
  deps: JudgeOverrideDeps,
  args: { bookId: string; note?: string | null },
): Promise<ActionResult<{ book_id: string }>> {
  return transition(deps, {
    bookId: args.bookId,
    nextStatus: JUDGE_DISCARDED_STATUS,
    action: 'book.judge.discard',
    note: args.note ?? null,
  });
}
