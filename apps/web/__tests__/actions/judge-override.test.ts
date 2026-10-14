/**
 * judge-override-core.ts のユニットテスト (F-099).
 *
 * 背景: `pipeline.book.judge` が 80 点未満 + 再キック上限で落とす
 * `needs_human_review` に**承認する導線が無く**、14 冊が最長 1 か月止まっていた
 * (2026-10-14 実測)。承認したら judge 合格時と同じ `thumbnail` に送る、という
 * 「新しい経路を作らない」契約をここで固定する。
 *
 * 検証:
 *  - 承認: needs_human_review → thumbnail + audit_log
 *  - 破棄: needs_human_review → retracted (削除しない) + audit_log
 *  - 別状態の本は conflict で弾く (二重承認・誤操作の防止)
 *  - 未存在は not_found
 */
import { describe, expect, it, vi } from 'vitest';

import { isFail, isOk } from '@a2p/contracts';

import {
  approveJudgeOverrideCore,
  discardJudgeFailedCore,
  JUDGE_APPROVED_STATUS,
  JUDGE_DISCARDED_STATUS,
  JUDGE_GATE_STATUS,
  type JudgeOverrideDeps,
} from '../../lib/judge-override-core';

function makeDeps(book: { id: string; status: string } | null): {
  deps: JudgeOverrideDeps;
  spies: {
    update: ReturnType<typeof vi.fn>;
    audit: ReturnType<typeof vi.fn>;
  };
} {
  const update = vi.fn(async () => ({}));
  const audit = vi.fn(async () => ({}));
  return {
    deps: {
      bookRepo: {
        findUnique: vi.fn(async () => book),
        update,
      },
      auditRepo: { create: audit },
      actorId: 'user_1',
      messages: { error: 'err', notReviewable: 'not reviewable' },
    },
    spies: { update, audit },
  };
}

describe('approveJudgeOverrideCore (F-099)', () => {
  it('judge 合格時と同じ thumbnail へ送る (新しい経路を作らない)', async () => {
    const { deps, spies } = makeDeps({ id: 'b1', status: JUDGE_GATE_STATUS });
    const res = await approveJudgeOverrideCore(deps, { bookId: 'b1', note: 'スコアは低いが出す' });

    expect(isOk(res)).toBe(true);
    expect(spies.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { status: JUDGE_APPROVED_STATUS },
    });
    expect(JUDGE_APPROVED_STATUS).toBe('thumbnail');

    const audited = spies.audit.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(audited.data.action).toBe('book.judge.override_approve');
    expect(audited.data.before_json).toEqual({ status: JUDGE_GATE_STATUS });
    expect(audited.data.after_json).toEqual({
      status: JUDGE_APPROVED_STATUS,
      note: 'スコアは低いが出す',
    });
  });

  it('needs_human_review 以外は conflict (二重承認・誤操作を防ぐ)', async () => {
    const { deps, spies } = makeDeps({ id: 'b1', status: 'done' });
    const res = await approveJudgeOverrideCore(deps, { bookId: 'b1' });

    expect(isFail(res)).toBe(true);
    if (isFail(res)) expect(res.error.code).toBe('conflict');
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.audit).not.toHaveBeenCalled();
  });

  it('未存在の本は not_found', async () => {
    const { deps } = makeDeps(null);
    const res = await approveJudgeOverrideCore(deps, { bookId: 'missing' });
    expect(isFail(res)).toBe(true);
    if (isFail(res)) expect(res.error.code).toBe('not_found');
  });
});

describe('discardJudgeFailedCore (F-099)', () => {
  it('削除せず retracted にする (本文も AI コストも既に発生済みのため)', async () => {
    const { deps, spies } = makeDeps({ id: 'b2', status: JUDGE_GATE_STATUS });
    const res = await discardJudgeFailedCore(deps, { bookId: 'b2' });

    expect(isOk(res)).toBe(true);
    expect(spies.update).toHaveBeenCalledWith({
      where: { id: 'b2' },
      data: { status: JUDGE_DISCARDED_STATUS },
    });
    expect(JUDGE_DISCARDED_STATUS).toBe('retracted');
    const audited = spies.audit.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(audited.data.action).toBe('book.judge.discard');
  });
});
