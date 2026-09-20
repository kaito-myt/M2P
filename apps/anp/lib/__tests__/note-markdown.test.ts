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
