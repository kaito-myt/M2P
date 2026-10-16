/**
 * F-ANP-57 — 競合サムネの「実物を見る」市場分析のテスト。
 *
 * 守りたい性質:
 *  - note の**一覧**ページ (topic/hashtag/search) から記事リンクを掘れる
 *    (note 自身が並べた列が、競合サムネの標本としては検索結果より質が高い)
 *  - 記事ページの og:image を取って画像本体まで落とせる
 *  - プレースホルダ (極小) と画像でないものを弾く
 *  - 1 枚も取れなくても throw しない
 */
import { describe, expect, it, vi } from 'vitest';

import type { NoteAccountConsultResearchItem } from '@a2p/contracts/agents/anp';

import {
  collectRivalEyecatches,
  extractNoteArticleLinks,
  extractOgImage,
  isNoteArticleUrl,
  isNoteIndexUrl,
} from '../../src/anp/eyecatch-market.js';

describe('URL の判定', () => {
  it('note の記事ページを見分ける', () => {
    expect(isNoteArticleUrl('https://note.com/someone/n/n1234abcd')).toBe(true);
    expect(isNoteArticleUrl('https://note.com/topic/keiba')).toBe(false);
    expect(isNoteArticleUrl('https://example.com/someone/n/n1234')).toBe(false);
    expect(isNoteArticleUrl('not a url')).toBe(false);
  });

  it('note の一覧ページ (トピック/タグ/検索) を見分ける', () => {
    expect(isNoteIndexUrl('https://note.com/topic/keiba')).toBe(true);
    expect(isNoteIndexUrl('https://note.com/hashtag/AI副業')).toBe(true);
    expect(isNoteIndexUrl('https://note.com/search?q=x')).toBe(true);
    expect(isNoteIndexUrl('https://note.com/someone/n/n1234')).toBe(false);
  });
});

describe('HTML の抽出', () => {
  it('一覧ページから記事リンクを出現順・重複なしで拾う', () => {
    const html = `
      <a href="/alice/n/na111">A</a>
      <a href="https://note.com/bob/n/nb222">B</a>
      <a href="/alice/n/na111">A again</a>
    `;
    expect(extractNoteArticleLinks(html)).toEqual([
      'https://note.com/bob/n/nb222',
      'https://note.com/alice/n/na111',
    ]);
  });

  it('og:image を取り出す (属性の順序が逆でも / twitter:image にも落ちる)', () => {
    expect(
      extractOgImage('<meta property="og:image" content="https://img.example/a.png">'),
    ).toBe('https://img.example/a.png');
    expect(
      extractOgImage('<meta content="https://img.example/b.png" property="og:image">'),
    ).toBe('https://img.example/b.png');
    expect(
      extractOgImage('<meta name="twitter:image" content="https://img.example/c.png">'),
    ).toBe('https://img.example/c.png');
    expect(extractOgImage('<meta property="og:title" content="x">')).toBeNull();
    // 相対パスは採らない (note の og:image は常に絶対 URL)
    expect(extractOgImage('<meta property="og:image" content="/rel.png">')).toBeNull();
  });

  it('og:image の &amp; を復元する (署名付き URL が壊れる)', () => {
    expect(
      extractOgImage('<meta property="og:image" content="https://i.example/a.png?w=1&amp;h=2">'),
    ).toBe('https://i.example/a.png?w=1&h=2');
  });
});

/** fetch のスタブ。URL → レスポンスの対応表で返す。 */
function makeFetch(table: Record<string, { body?: string; bytes?: number; ct?: string; status?: number }>) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request) => {
    const key = String(url);
    calls.push(key);
    const hit = table[key];
    if (!hit) return { ok: false, status: 404, headers: new Headers() } as unknown as Response;
    const headers = new Headers({ 'content-type': hit.ct ?? 'text/html; charset=utf-8' });
    return {
      ok: (hit.status ?? 200) < 400,
      status: hit.status ?? 200,
      headers,
      text: async () => hit.body ?? '',
      arrayBuffer: async () => new ArrayBuffer(hit.bytes ?? 0),
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const TOPIC = 'https://note.com/topic/keiba';
const ART1 = 'https://note.com/alice/n/na111';
const ART2 = 'https://note.com/bob/n/nb222';
const IMG1 = 'https://img.example/1.jpg';
const IMG2 = 'https://img.example/2.jpg';

describe('collectRivalEyecatches', () => {
  it('一覧ページを展開して記事の og:image を画像本体まで取る', async () => {
    const { impl } = makeFetch({
      [TOPIC]: { body: `<a href="/alice/n/na111">a</a><a href="/bob/n/nb222">b</a>` },
      [ART1]: {
        body: `<title>記事1</title><meta property="og:image" content="${IMG1}">`,
      },
      [ART2]: {
        body: `<meta property="og:title" content="記事2"><meta property="og:image" content="${IMG2}">`,
      },
      [IMG1]: { ct: 'image/jpeg', bytes: 50_000 },
      [IMG2]: { ct: 'image/png', bytes: 60_000 },
    });
    const items: NoteAccountConsultResearchItem[] = [{ query: 'q', title: 'note 競馬', url: TOPIC }];
    const shots = await collectRivalEyecatches(items, { fetchImpl: impl });
    expect(shots.map((s) => s.articleUrl)).toEqual([ART1, ART2]);
    expect(shots[0]!.imageUrl).toBe(IMG1);
    expect(shots[0]!.title).toBe('記事1');
    expect(shots[0]!.mimeType).toBe('image/jpeg');
    expect(shots[0]!.image.byteLength).toBe(50_000);
    // og:title からタイトルを拾える
    expect(shots[1]!.title).toBe('記事2');
  });

  it('検索結果に直接出ていた記事ページも候補にする', async () => {
    const { impl } = makeFetch({
      [ART1]: { body: `<meta property="og:image" content="${IMG1}">` },
      [IMG1]: { ct: 'image/jpeg', bytes: 30_000 },
    });
    const items: NoteAccountConsultResearchItem[] = [
      { query: 'q', title: '記事1', url: ART1 },
      { query: 'q', title: '無関係', url: 'https://example.com/blog' },
    ];
    const shots = await collectRivalEyecatches(items, { fetchImpl: impl });
    expect(shots).toHaveLength(1);
    expect(shots[0]!.title).toBe('記事1');
  });

  it('極小画像 (プレースホルダ) と画像でないものを弾く', async () => {
    const { impl } = makeFetch({
      [ART1]: { body: `<meta property="og:image" content="${IMG1}">` },
      [ART2]: { body: `<meta property="og:image" content="${IMG2}">` },
      [IMG1]: { ct: 'image/gif', bytes: 43 },
      [IMG2]: { ct: 'text/html', bytes: 90_000 },
    });
    const items: NoteAccountConsultResearchItem[] = [
      { query: 'q', title: 'a', url: ART1 },
      { query: 'q', title: 'b', url: ART2 },
    ];
    expect(await collectRivalEyecatches(items, { fetchImpl: impl })).toEqual([]);
  });

  it('maxShots で打ち切る', async () => {
    const { impl } = makeFetch({
      [ART1]: { body: `<meta property="og:image" content="${IMG1}">` },
      [ART2]: { body: `<meta property="og:image" content="${IMG2}">` },
      [IMG1]: { ct: 'image/jpeg', bytes: 20_000 },
      [IMG2]: { ct: 'image/jpeg', bytes: 20_000 },
    });
    const items: NoteAccountConsultResearchItem[] = [
      { query: 'q', title: 'a', url: ART1 },
      { query: 'q', title: 'b', url: ART2 },
    ];
    const shots = await collectRivalEyecatches(items, { fetchImpl: impl, maxShots: 1 });
    expect(shots).toHaveLength(1);
  });

  it('note の URL が無ければ 1 回も fetch しない', async () => {
    const { impl, calls } = makeFetch({});
    const items: NoteAccountConsultResearchItem[] = [
      { query: 'q', title: 'x', url: 'https://example.com/a' },
    ];
    expect(await collectRivalEyecatches(items, { fetchImpl: impl })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('fetch が落ちても throw せず次の候補へ進む', async () => {
    const impl = vi.fn(async (url: string | URL | Request) => {
      const key = String(url);
      if (key === ART1) throw new Error('ECONNRESET');
      if (key === ART2) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => `<meta property="og:image" content="${IMG2}">`,
          arrayBuffer: async () => new ArrayBuffer(0),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(25_000),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const items: NoteAccountConsultResearchItem[] = [
      { query: 'q', title: 'a', url: ART1 },
      { query: 'q', title: 'b', url: ART2 },
    ];
    const shots = await collectRivalEyecatches(items, { fetchImpl: impl });
    expect(shots.map((s) => s.articleUrl)).toEqual([ART2]);
  });
});
