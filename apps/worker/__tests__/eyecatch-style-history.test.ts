/**
 * F-ANP-57 — アイキャッチの画風履歴を引く処理のテスト。
 *
 * **このテストが存在する理由** (2026-10-16):
 * 元の実装は `payload_json: { path: ['note_article_id'], in: ids }` と書いていたが、
 * Prisma の Json フィルタに `in` は無く、実行時に `PrismaClientValidationError` で
 * 弾かれていた。呼び出し側が `.catch(() => [])` でこれを飲んでいたため、
 * **F-ANP-14b「直近と同じ画風を避ける」が実装以来一度も動いていなかった**。
 * 型チェックも通っていた (prisma を `as unknown as` で緩い型に落としていたため)。
 *
 * → フィルタの**形**を固定し、`in` に書き戻されたら落ちるようにする。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  buildArticleIdJsonFilter,
  fetchEyecatchStyleByArticle,
} from '../src/tasks/lib/eyecatch-style-history.js';

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof fetchEyecatchStyleByArticle>[2];

describe('buildArticleIdJsonFilter', () => {
  it('equals の OR に展開する (Prisma の Json フィルタに in は無い)', () => {
    const filter = buildArticleIdJsonFilter(['a1', 'a2']);
    expect(filter).toEqual({
      OR: [
        { payload_json: { path: ['note_article_id'], equals: 'a1' } },
        { payload_json: { path: ['note_article_id'], equals: 'a2' } },
      ],
    });
  });

  it('in を使わない (使うと Prisma が実行時に弾く)', () => {
    const serialized = JSON.stringify(buildArticleIdJsonFilter(['a1']));
    expect(serialized).not.toContain('"in"');
  });

  it('空配列なら OR も空', () => {
    expect(buildArticleIdJsonFilter([])).toEqual({ OR: [] });
  });
});

describe('fetchEyecatchStyleByArticle', () => {
  it('記事 ID → 画風キーを返し、where には OR/equals を渡す', async () => {
    const findMany = vi.fn(async (_args?: unknown) => [
      { payload_json: { note_article_id: 'a1' }, result_json: { style_key: 'retro_poster' } },
      { payload_json: { note_article_id: 'a2' }, result_json: { style_key: 'ink_sketch' } },
    ]);
    const map = await fetchEyecatchStyleByArticle(
      { job: { findMany } },
      ['a1', 'a2'],
      silentLogger,
    );
    expect(map.get('a1')).toBe('retro_poster');
    expect(map.get('a2')).toBe('ink_sketch');

    const args = findMany.mock.calls[0]![0] as unknown as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ kind: 'pipeline.note.eyecatch', status: 'done' });
    expect(args.where.OR).toHaveLength(2);
    expect(args.where).not.toHaveProperty('payload_json');
  });

  it('style_key が無い古いジョブは飛ばし、入っている最新を採る', async () => {
    // orderBy created_at desc で返ってくる想定。先頭が style_key 無し。
    const findMany = vi.fn(async () => [
      { payload_json: { note_article_id: 'a1' }, result_json: { r2_key: 'x' } },
      { payload_json: { note_article_id: 'a1' }, result_json: { style_key: 'riso_print' } },
      { payload_json: { note_article_id: 'a1' }, result_json: { style_key: 'ink_sketch' } },
    ]);
    const map = await fetchEyecatchStyleByArticle({ job: { findMany } }, ['a1'], silentLogger);
    expect(map.get('a1')).toBe('riso_print');
  });

  it('クエリが失敗しても throw せず WARN を出す (無言で機能が消えるのを防ぐ)', async () => {
    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as unknown as Parameters<
      typeof fetchEyecatchStyleByArticle
    >[2];
    const findMany = vi.fn(async () => {
      throw new Error('Unknown argument `in`');
    });
    const map = await fetchEyecatchStyleByArticle({ job: { findMany } }, ['a1'], logger);
    expect(map.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('記事が無ければクエリを投げない', async () => {
    const findMany = vi.fn(async () => []);
    const map = await fetchEyecatchStyleByArticle({ job: { findMany } }, [], silentLogger);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
