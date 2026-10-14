/**
 * 本文承認の一括実行 (2026-10-14) のテスト。
 *
 * F-100 の修復で小説 11 冊を校閲し直したら全冊が `content_review` に入り、
 * 1 冊ずつしか進められなかったため追加した機能。
 * **1 冊の失敗で全体を止めない**ことが要件 (他タブで先に承認された本が混ざる)。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  ApproveContentBulkSchema,
  approveBookContentBulkCore,
} from '../../lib/content-approval-bulk-core';

const deps = (approveOne: (id: string) => Promise<{ ok: boolean; error?: string }>) => ({
  approveOne,
  fallbackError: '本文承認に失敗しました',
});

describe('ApproveContentBulkSchema', () => {
  it('1〜50 件を受ける', () => {
    expect(ApproveContentBulkSchema.safeParse({ book_ids: ['a'] }).success).toBe(true);
    expect(
      ApproveContentBulkSchema.safeParse({ book_ids: Array.from({ length: 50 }, (_, i) => `b${i}`) })
        .success,
    ).toBe(true);
  });

  it('空配列と 51 件以上は弾く', () => {
    expect(ApproveContentBulkSchema.safeParse({ book_ids: [] }).success).toBe(false);
    expect(
      ApproveContentBulkSchema.safeParse({ book_ids: Array.from({ length: 51 }, (_, i) => `b${i}`) })
        .success,
    ).toBe(false);
  });
});

describe('approveBookContentBulkCore', () => {
  it('全件成功したら approved に並ぶ', async () => {
    const r = await approveBookContentBulkCore(['a', 'b', 'c'], deps(async () => ({ ok: true })));
    expect(r.approved).toEqual(['a', 'b', 'c']);
    expect(r.failed).toEqual([]);
  });

  it('1 冊が失敗しても残りは進める (他タブで先に承認された本が混ざる)', async () => {
    const r = await approveBookContentBulkCore(
      ['a', 'b', 'c'],
      deps(async (id) => (id === 'b' ? { ok: false, error: 'この本は本文承認の対象ではありません' } : { ok: true })),
    );
    expect(r.approved).toEqual(['a', 'c']);
    expect(r.failed).toEqual([{ book_id: 'b', error: 'この本は本文承認の対象ではありません' }]);
  });

  it('理由を返さない失敗は既定のエラー文にする', async () => {
    const r = await approveBookContentBulkCore(['a'], deps(async () => ({ ok: false })));
    expect(r.failed[0]!.error).toBe('本文承認に失敗しました');
  });

  it('例外もその 1 冊の失敗として扱い、残りを続ける', async () => {
    const r = await approveBookContentBulkCore(
      ['a', 'b'],
      deps(async (id) => {
        if (id === 'a') throw new Error('DB 接続エラー');
        return { ok: true };
      }),
    );
    expect(r.approved).toEqual(['b']);
    expect(r.failed).toEqual([{ book_id: 'a', error: 'DB 接続エラー' }]);
  });

  it('順に 1 冊ずつ呼ぶ (並列にしてジョブ投入を重ねない)', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const approveOne = vi.fn(async (id: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(id);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true };
    });
    await approveBookContentBulkCore(['a', 'b', 'c'], deps(approveOne));
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxInFlight).toBe(1);
  });

  it('全件失敗でも結果を返す (例外にしない)', async () => {
    const r = await approveBookContentBulkCore(
      ['a', 'b'],
      deps(async () => ({ ok: false, error: 'conflict' })),
    );
    expect(r.approved).toEqual([]);
    expect(r.failed).toHaveLength(2);
  });
});
