import { describe, expect, it } from 'vitest';

import {
  paidAreaAnchor,
  type NotePublishBlock,
} from '../src/tasks/note-publish/playwright-note-publish-port.js';

function block(text: string, kind: NotePublishBlock['kind'] = 'paragraph'): NotePublishBlock {
  return { kind, text };
}

describe('paidAreaAnchor (有料エリア設定画面の位置合わせ用テキスト)', () => {
  it('有料側の先頭ブロックの 1 行目を返す', () => {
    expect(paidAreaAnchor([block('ここから先の手順を書きます。'), block('次')])).toBe(
      'ここから先の手順を書きます。',
    );
  });

  it('見出し記号を落とす (note の表示には出ないため)', () => {
    expect(paidAreaAnchor([block('## 実際の作業手順', 'h2')])).toBe('実際の作業手順');
  });

  it('箇条書き記号と太字記号を落とす', () => {
    expect(paidAreaAnchor([block('- **重要な前提**を先に置く', 'bullet')])).toBe(
      '重要な前提を先に置く',
    );
  });

  it('複数行ブロックは 1 行目だけ使う', () => {
    expect(paidAreaAnchor([block('1行目です\n2行目です')])).toBe('1行目です');
  });

  it('40 字で切る (長文の完全一致は note の折り返しで壊れる)', () => {
    const long = 'あ'.repeat(80);
    expect(paidAreaAnchor([block(long)])).toHaveLength(40);
  });

  it('有料ブロックが無ければ空文字 (呼出側は割合にフォールバックする)', () => {
    expect(paidAreaAnchor([])).toBe('');
  });
});
