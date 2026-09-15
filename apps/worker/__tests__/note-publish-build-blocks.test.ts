import { describe, expect, it } from 'vitest';

import { buildNoteBlocks } from '../src/tasks/note-publish/build-blocks.js';

describe('buildNoteBlocks', () => {
  it('見出し/箇条書き/段落を分類する', () => {
    const md = '# 大見出し\n\n本文の段落です。\n\n## 小見出し\n\n- 項目1\n- 項目2';
    const { freeBlocks, paidBlocks } = buildNoteBlocks(md, null);
    expect(paidBlocks).toEqual([]);
    expect(freeBlocks).toEqual([
      { kind: 'h1', text: '大見出し' },
      { kind: 'paragraph', text: '本文の段落です。' },
      { kind: 'h2', text: '小見出し' },
      { kind: 'bullet', text: '- 項目1\n- 項目2' },
    ]);
  });

  it('paywallLinePos で free/paid に分割する', () => {
    const md = '無料パート。続きは有料パート。';
    const pos = Array.from('無料パート。').length;
    const { freeBlocks, paidBlocks } = buildNoteBlocks(md, pos);
    expect(freeBlocks).toEqual([{ kind: 'paragraph', text: '無料パート。' }]);
    expect(paidBlocks).toEqual([{ kind: 'paragraph', text: '続きは有料パート。' }]);
  });

  it('paywallLinePos が範囲外なら全て free 扱い', () => {
    const md = '短い本文';
    const { freeBlocks, paidBlocks } = buildNoteBlocks(md, 999);
    expect(freeBlocks).toEqual([{ kind: 'paragraph', text: '短い本文' }]);
    expect(paidBlocks).toEqual([]);
  });

  it('空文字は空ブロックを返す', () => {
    expect(buildNoteBlocks('', null)).toEqual({ freeBlocks: [], paidBlocks: [] });
  });
});
