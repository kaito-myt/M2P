import { describe, expect, it } from 'vitest';

import {
  buildNoteBlocks,
  normalizeInline,
  splitFencedSegments,
  splitInlineRuns,
} from '../src/tasks/note-publish/build-blocks.js';

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

/**
 * [F-ANP-48] note には表を作る機能が無い。Markdown の表を段落として流し込むと
 * `| 頭数帯 | レース数 |` というパイプ記号の羅列が公開記事に出てしまう (2026-09-28 運営者報告)。
 */
describe('Markdown の表を table ブロックに切り出す (F-ANP-48)', () => {
  const LF = String.fromCharCode(10);
  const TABLE = [
    '| 頭数帯 | レース数 | 単勝回収率 |',
    '|---|---:|---:|',
    '| 7〜9頭 | 1,842 | 89.7% |',
    '| 10〜12頭 | 2,915 | 92.3% |',
  ].join(LF);

  it('本文中の表を table ブロックにする', () => {
    const md = ['## 集計結果', '', '次の表のとおり。', '', TABLE, '', 'この差は無視できない。'].join(LF);
    const { freeBlocks } = buildNoteBlocks(md, null);
    expect(freeBlocks.map((b) => b.kind)).toEqual(['h2', 'paragraph', 'table', 'paragraph']);
    expect(freeBlocks[2]!.text).toBe(TABLE);
  });

  it('パイプ記号を含む段落ブロックを残さない', () => {
    const md = ['本文', '', TABLE].join(LF);
    const { freeBlocks } = buildNoteBlocks(md, null);
    const paragraphs = freeBlocks.filter((b) => b.kind !== 'table');
    expect(paragraphs.some((b) => b.text.includes('|'))).toBe(false);
  });

  it('有料ラインの後ろにある表も table ブロックになる', () => {
    const md = ['無料パート。', '', TABLE].join(LF);
    const pos = Array.from('無料パート。').length;
    const { freeBlocks, paidBlocks } = buildNoteBlocks(md, pos);
    expect(freeBlocks.map((b) => b.kind)).toEqual(['paragraph']);
    expect(paidBlocks.map((b) => b.kind)).toEqual(['table']);
  });
});

/**
 * [F-ANP-48] note は Markdown を解釈しない。記号をそのまま打つと公開記事に `**` や
 * ``` や `---` や `[文字](URL)` が出る (2026-09-28 実測)。
 */
describe('Markdown 記法を note 向けに開く (F-ANP-48)', () => {
  const LF = String.fromCharCode(10);
  const PARA = LF + LF;

  it('太字は run に分割して記号を残さない', () => {
    const runs = splitInlineRuns('ここが**重要**です');
    expect(runs).toEqual([
      { text: 'ここが', bold: false },
      { text: '重要', bold: true },
      { text: 'です', bold: false },
    ]);
    expect(runs.map((r) => r.text).join('')).not.toContain('*');
  });

  it('対応の取れていない * は落とす', () => {
    const runs = splitInlineRuns('半端な**記号');
    expect(runs.map((r) => r.text).join('')).toBe('半端な記号');
  });

  it('段落ブロックに runs が付き、text には記号が残らない', () => {
    const { freeBlocks } = buildNoteBlocks('これは**太字**の段落です。', null);
    expect(freeBlocks[0]!.kind).toBe('paragraph');
    expect(freeBlocks[0]!.text).toBe('これは太字の段落です。');
    expect(freeBlocks[0]!.runs?.some((r) => r.bold)).toBe(true);
  });

  it('リンクは文字と URL の別行にする (note が自動でリンクにする)', () => {
    expect(normalizeInline('関連記事：[詳しくはこちら](https://note.com/a/n/nb1)')).toBe(
      '関連記事：詳しくはこちら' + LF + 'https://note.com/a/n/nb1',
    );
  });

  it('インラインコードのバッククォートを外す', () => {
    expect(normalizeInline('`npm run build` を実行')).toBe('npm run build を実行');
  });

  it('コードフェンスは code ブロックにする', () => {
    const segs = splitFencedSegments(['前置き', '```', 'const a = 1;', '```', 'あとがき'].join(LF));
    expect(segs.map((x) => x.kind)).toEqual(['text', 'code', 'text']);
    expect(segs[1]!.text).toBe('const a = 1;');
  });

  it('区切り線は hr ブロックにする (`---` を素で打たない)', () => {
    const { freeBlocks } = buildNoteBlocks(['本文A', '', '---', '', '本文B'].join(LF), null);
    expect(freeBlocks.map((b) => b.kind)).toEqual(['paragraph', 'hr', 'paragraph']);
  });

  it('本文にバッククォート/アスタリスク/パイプを残さない', () => {
    const md = [
      '## 見出し**強調**',
      '`code` を含む段落と[リンク](https://note.com/x/n/n1)。',
      '```',
      'raw code',
      '```',
      '---',
      '| a | b |' + LF + '|---|---|' + LF + '| 1 | 2 |',
    ].join(PARA);
    const { freeBlocks } = buildNoteBlocks(md, null);
    for (const b of freeBlocks) {
      if (b.kind === 'table' || b.kind === 'code') continue;
      expect(b.text).not.toContain('`');
      expect(b.text).not.toContain('**');
      expect(b.text).not.toContain('|');
    }
  });
});
