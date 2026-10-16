/**
 * `extractTitleId` のテスト。
 *
 * KDP は「その本の下書きが既にある」とき、STEP1 の保存で先へ進まず
 * `.../paperback/new/details?existing=<titleId>&existing=<短縮形>` に留まる
 * (2026-10-16 本番実測)。これを拾えないと `no_title_id` で毎回落ち、
 * その本は永久に進まない。
 */
import { describe, it, expect } from 'vitest';

import { extractTitleId } from './playwright-paperback-draft-port.js';

describe('extractTitleId', () => {
  it('印刷設定ページの URL から取れる', () => {
    expect(extractTitleId('https://kdp.amazon.co.jp/ja_JP/print-setup/paperback/A3KKXK4F3KXFTN/content')).toBe(
      'A3KKXK4F3KXFTN',
    );
  });

  it('existing= から取れる。短縮形が混ざっても長い方を採る', () => {
    expect(
      extractTitleId(
        'https://kdp.amazon.co.jp/ja_JP/title-setup/paperback/new/details?existing=A3KKXK4F3KXFTN&existing=A3KKXK4F3KXF',
      ),
    ).toBe('A3KKXK4F3KXFTN');
  });

  it('existing= が 1 つだけでも取れる', () => {
    expect(extractTitleId('https://kdp.amazon.co.jp/ja_JP/title-setup/paperback/new/details?existing=ABJF3241YLMYN')).toBe(
      'ABJF3241YLMYN',
    );
  });

  it('print-setup があれば existing より優先する', () => {
    expect(extractTitleId('https://kdp.amazon.co.jp/print-setup/paperback/AAAA1111BBBB/content?existing=ZZZZ')).toBe(
      'AAAA1111BBBB',
    );
  });

  it('どちらも無ければ null', () => {
    expect(extractTitleId('https://kdp.amazon.co.jp/ja_JP/bookshelf')).toBeNull();
    expect(extractTitleId('https://kdp.amazon.co.jp/ja_JP/title-setup/paperback/new/details')).toBeNull();
  });
});
