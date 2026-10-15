/**
 * 品質判定の内訳読み出し (`lib/judge-feedback.ts`) — F-ANP-57。
 *
 * 2026-10-15: 下限 (70) に 1〜5 点届かない記事が 24 本止まっていたのに、画面にはスコアの
 * 数字しか出ておらず承認も差し戻しも判断できなかった。judge が `Job.result_json` に残して
 * いる軸別コメントを「落ちた理由」として取り出せることを固定する。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@a2p/db', () => ({ prisma: { job: { findMany: vi.fn(), $queryRaw: vi.fn() } } }));

const { parseJudgeResult, toFeedbackItems, JUDGE_AXIS_LABELS } = await import('../judge-feedback');

/** judge が実際に残す形 (pipeline-note-judge.ts の result_json)。 */
function resultJson(overrides: Record<string, unknown> = {}) {
  return {
    score_total: 67,
    score_breakdown: {
      hook_strength: 62,
      readability: 85,
      paid_conversion: 65,
      search_inflow: 78,
    },
    judge_comments: {
      hook_strength: '既出の一般論から始まっており読者を掴めていない',
      readability: '読みやすい',
      paid_conversion: '有料部分が無料部分の言い換えになっている',
      overall: '切り口を変えれば届く',
    },
    retry_count: 2,
    phase: 'needs_human_review',
    ...overrides,
  };
}

describe('parseJudgeResult', () => {
  it('スコアと軸別コメントを取り出す', () => {
    const fb = parseJudgeResult(resultJson())!;
    expect(fb.score_total).toBe(67);
    expect(fb.allAxes).toHaveLength(Object.keys(JUDGE_AXIS_LABELS).length);
    expect(fb.overall).toBe('切り口を変えれば届く');
  });

  it('合格ライン (80) 未満の軸だけを weakAxes にする', () => {
    const fb = parseJudgeResult(resultJson())!;
    expect(fb.weakAxes.map((a) => a.key)).toEqual(['hook_strength', 'paid_conversion', 'search_inflow']);
    expect(fb.weakAxes.find((a) => a.key === 'hook_strength')!.comment).toContain('一般論');
  });

  it('judge 以外の結果や空は null (「理由なし」と区別する)', () => {
    expect(parseJudgeResult(null)).toBeNull();
    expect(parseJudgeResult({})).toBeNull();
    expect(parseJudgeResult({ enqueued: 1 })).toBeNull();
    expect(parseJudgeResult('文字列')).toBeNull();
  });

  it('score_total が欠けても内訳があれば読める', () => {
    const fb = parseJudgeResult(resultJson({ score_total: undefined }))!;
    expect(fb.score_total).toBeNull();
    expect(fb.weakAxes.length).toBeGreaterThan(0);
  });

  it('コメントが空文字なら null にする (「: 」だけの行を作らない)', () => {
    const fb = parseJudgeResult(
      resultJson({ judge_comments: { hook_strength: '   ', overall: '' } }),
    )!;
    expect(fb.allAxes.find((a) => a.key === 'hook_strength')!.comment).toBeNull();
    expect(fb.overall).toBeNull();
  });
});

describe('toFeedbackItems', () => {
  it('worker 側 toFeedbackItems と同じ形の行にする', () => {
    const items = toFeedbackItems(parseJudgeResult(resultJson()));
    expect(items[0]).toBe('品質スコア: 67/100');
    expect(items).toContain('フック強度 (62/100): 既出の一般論から始まっており読者を掴めていない');
    expect(items).toContain('有料転換見込み (65/100): 有料部分が無料部分の言い換えになっている');
    expect(items[items.length - 1]).toBe('総評: 切り口を変えれば届く');
    // 合格している軸 (可読性 85) は理由に混ぜない。
    expect(items.some((line) => line.startsWith('可読性'))).toBe(false);
  });

  it('null なら空配列 (呼び手が汎用文へフォールバックできる)', () => {
    expect(toFeedbackItems(null)).toEqual([]);
  });
});
