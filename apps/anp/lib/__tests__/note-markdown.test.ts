import { describe, expect, it } from 'vitest';

import { parseNoteMarkdown, splitInlineRuns } from '../note-markdown';

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
      {
        type: 'paragraph',
        text: 'これは導入の段落です。\n複数行になることもあります。',
        runs: [{ text: 'これは導入の段落です。\n複数行になることもあります。', bold: false }],
      },
      { type: 'heading', level: 3, text: 'ポイント' },
      { type: 'list', items: ['1つ目', '2つ目', '3つ目'] },
      { type: 'paragraph', text: '最後の段落。', runs: [{ text: '最後の段落。', bold: false }] },
    ]);
  });

  it('空文字は空配列を返す', () => {
    expect(parseNoteMarkdown('')).toEqual([]);
  });

  it('見出しの無い単純な本文は段落として扱う', () => {
    expect(parseNoteMarkdown('ただの文章です。')).toEqual([
      { type: 'paragraph', text: 'ただの文章です。', runs: [{ text: 'ただの文章です。', bold: false }] },
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

describe('Markdown 記法の表示 (F-ANP-48)', () => {
  const LF = String.fromCharCode(10);

  it('太字は runs に分かれ、記号は残らない', () => {
    const blocks = parseNoteMarkdown('これは**重要**です。');
    const p = blocks[0] as Extract<ReturnType<typeof parseNoteMarkdown>[number], { type: 'paragraph' }>;
    expect(p.text).toBe('これは重要です。');
    expect(p.runs).toEqual([
      { text: 'これは', bold: false },
      { text: '重要', bold: true },
      { text: 'です。', bold: false },
    ]);
  });

  it('リンクは「文字 (URL)」、インラインコードはバッククォートを外す', () => {
    const blocks = parseNoteMarkdown('詳しくは[こちら](https://note.com/a/n/nb1)。`npm` も。');
    const p = blocks[0] as Extract<ReturnType<typeof parseNoteMarkdown>[number], { type: 'paragraph' }>;
    expect(p.text).toBe('詳しくはこちら (https://note.com/a/n/nb1)。npm も。');
  });

  it('区切り線とコードブロックを別ブロックにする', () => {
    const blocks = parseNoteMarkdown(['本文', '', '---', '', '```', 'code();', '```'].join(LF));
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'rule', 'code']);
    const code = blocks[2] as Extract<ReturnType<typeof parseNoteMarkdown>[number], { type: 'code' }>;
    expect(code.text).toBe('code();');
  });

  it('splitInlineRuns は対応の取れていない * を落とす', () => {
    expect(
      splitInlineRuns('半端な**記号')
        .map((r) => r.text)
        .join(''),
    ).toBe('半端な記号');
  });
});
