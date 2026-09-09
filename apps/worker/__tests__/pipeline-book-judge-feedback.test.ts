import { describe, expect, it } from 'vitest';

import { toFeedbackItems } from '../src/tasks/pipeline-book-judge.js';

/**
 * 判定所見 → 再キック feedback item 分割 (2026-09-01 実障害の回帰テスト)。
 * 受け側 RevisionFeedbackItemSchema / FeedbackItemSchema は body max(2000)・配列 max(50)。
 */
describe('toFeedbackItems', () => {
  it('短い所見は 1 item にそのまま入る', () => {
    const items = toFeedbackItems('品質スコア: 65/100\n- 論理的一貫性 (42/100): 名前が章で変わる');
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ body: '品質スコア: 65/100\n- 論理的一貫性 (42/100): 名前が章で変わる', priority: 'must' });
  });

  it('長い複数行の所見は行を跨がず 2000 字以内の複数 item に分割し、内容を欠落させない', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `- 軸${i} (50/100): ${'あ'.repeat(300)}`);
    const text = lines.join('\n');
    const items = toFeedbackItems(text);

    expect(items.length).toBeGreaterThan(1);
    for (const it of items) {
      expect(it.body.length).toBeLessThanOrEqual(2000);
      expect(it.priority).toBe('must');
    }
    // 連結すると元テキストに戻る (行境界で切っているため改行で再結合できる)
    expect(items.map((i) => i.body).join('\n')).toBe(text);
  });

  it('1 行が 2000 字を超える場合は固定長で分割する', () => {
    const text = '総評: ' + 'い'.repeat(5000);
    const items = toFeedbackItems(text);
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const it of items) expect(it.body.length).toBeLessThanOrEqual(2000);
    expect(items.map((i) => i.body).join('')).toBe(text);
  });

  it('item 数は 50 を超えない', () => {
    const text = Array.from({ length: 200 }, () => 'う'.repeat(1900)).join('\n');
    expect(toFeedbackItems(text)).toHaveLength(50);
  });

  it('空行だけの所見は空配列', () => {
    expect(toFeedbackItems('\n\n')).toEqual([]);
  });
});
