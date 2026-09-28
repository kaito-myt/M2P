import { describe, expect, it } from 'vitest';

import { parseNoteMarkdown } from '../note-markdown';

describe('parseNoteMarkdown', () => {
  it('見出し/段落/箇条書きをブロックに分解する', () => {
    const md = [
      '## はじめに',
      '',
      'これは導入の段落です。',
      '複数行になることもあります。',
      '',
      '### ポイント',
      '',
      '- 1つ目',
      '- 2つ目',
      '・3つ目',
      '',
      '最後の段落。',
    ].join('\n');

    expect(parseNoteMarkdown(md)).toEqual([
      { type: 'heading', level: 2, text: 'はじめに' },
      { type: 'paragraph', text: 'これは導入の段落です。\n複数行になることもあります。' },
      { type: 'heading', level: 3, text: 'ポイント' },
      { type: 'list', items: ['1つ目', '2つ目', '3つ目'] },
      { type: 'paragraph', text: '最後の段落。' },
    ]);
  });

  it('空文字は空配列を返す', () => {
    expect(parseNoteMarkdown('')).toEqual([]);
  });

  it('見出しの無い単純な本文は段落として扱う', () => {
    expect(parseNoteMarkdown('ただの文章です。')).toEqual([
      { type: 'paragraph', text: 'ただの文章です。' },
    ]);
  });
});

/**
 * [F-ANP-48] note には表機能が無いので公開時は画像にするが、ANP の記事詳細では
 * <table> として見せる (パイプ記号のまま見せない)。
 */
describe('Markdown の表 (F-ANP-48)', () => {
  const LF = String.fromCharCode(10);
  const TABLE = [
    '| 頭数帯 | レース数 | 単勝回収率 |',
    '|---|---:|---:|',
    '| 7〜9頭 | 1,842 | 89.7% |',
    '| 10〜12頭 | 2,915 | 92.3% |',
  ].join(LF);

  it('ヘッダ・行・寄せを読み取る', () => {
    const blocks = parseNoteMarkdown(['## 集計', '', TABLE, '', 'あとがき'].join(LF));
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'table', 'paragraph']);
    const table = blocks[1] as Extract<ReturnType<typeof parseNoteMarkdown>[number], { type: 'table' }>;
    expect(table.header).toEqual(['頭数帯', 'レース数', '単勝回収率']);
    expect(table.rows).toHaveLength(2);
    expect(table.align).toEqual(['left', 'right', 'right']);
  });

  it('表の行が段落として残らない', () => {
    const blocks = parseNoteMarkdown(TABLE);
    const texts = blocks.filter((b) => b.type === 'paragraph').map((b) => (b as { text: string }).text);
    expect(texts.join('')).not.toContain('|');
  });

  it('区切り行だけで本文行が無ければ表にしない', () => {
    const blocks = parseNoteMarkdown(['| a | b | c |', '|---|---|---|'].join(LF));
    expect(blocks.some((b) => b.type === 'table')).toBe(false);
  });
});
