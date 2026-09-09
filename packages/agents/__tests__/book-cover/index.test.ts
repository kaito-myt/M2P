/**
 * book_cover リゾルバ (resolveBookCoverUrl) 単体テスト。
 *
 * LLM 同定は deps.identify で固定し、Amazon の検索/商品ページ/書影 HTTP を deps.fetchImpl で
 * 差し替えて「検索→商品名で本人確認→書影の byte 実在検証」を検証する。要点は
 * **商品名が書名と一致した ASIN の書影しか採らない（誤書影を出さない）** こと。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { resolveBookCoverUrl, isbn13to10, titleConfirms, coreTitle } = await import('../../src/book-cover/index.js');

const AMZ_IMG = 'https://images-na.ssl-images-amazon.com/images/P/';

/** Amazon 検索/商品/書影を模した fetch。 */
function makeFetch(opts: {
  search?: Record<string, string[]>; // query部分文字列 -> ASIN配列
  dpTitle?: Record<string, string>; // asin -> 商品ページtitle
  imgBytes?: Record<string, number>; // asin -> 書影byte
}): typeof fetch {
  return (async (url: string) => {
    if (url.includes('/s?k=')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('k') ?? '');
      const key = Object.keys(opts.search ?? {}).find((k) => q.includes(k));
      const asins = key ? opts.search![key]! : [];
      const html = asins.map((a) => `<div data-asin="${a}">`).join('');
      return { ok: true, text: async () => html } as unknown as Response;
    }
    if (url.includes('/dp/')) {
      const asin = url.split('/dp/')[1]!.split(/[/?]/)[0]!;
      const title = opts.dpTitle?.[asin] ?? '';
      return { ok: true, text: async () => `<title>${title}</title>` } as unknown as Response;
    }
    if (url.startsWith(AMZ_IMG)) {
      const asin = url.slice(AMZ_IMG.length).split('.')[0]!;
      const bytes = opts.imgBytes?.[asin] ?? 43;
      return {
        ok: true,
        headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/jpeg' : String(bytes)) },
        arrayBuffer: async () => new ArrayBuffer(bytes),
      } as unknown as Response;
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

describe('isbn13to10', () => {
  it('978 系 ISBN-13 を ISBN-10 に変換する', () => {
    expect(isbn13to10('9784478025819')).toBe('4478025819');
    expect(isbn13to10('978-4-16-791022-3')).toBe('4167910225');
  });
  it('979 系や桁数不正は null', () => {
    expect(isbn13to10('9791234567896')).toBeNull();
    expect(isbn13to10('123')).toBeNull();
  });
});

describe('coreTitle', () => {
  it('副題・レーベルを落として中核だけにする', () => {
    expect(coreTitle('LISTEN 知性豊かで創造的な人になれる')).toBe('LISTEN');
    expect(coreTitle('本好きの下剋上 司書になるためには手段を選んでいられません')).toBe('本好きの下剋上');
    expect(coreTitle('嫌われる勇気')).toBe('嫌われる勇気');
    expect(coreTitle('読んでいない本について堂々と語る方法')).toBe('読んでいない本について堂々と語る方法');
  });
});

describe('titleConfirms', () => {
  it('商品名が書名を包含すれば true', () => {
    expect(titleConfirms('平家物語', '平家物語 (池澤夏樹=個人編集 日本文学全集) | 古川日出男')).toBe(true);
    expect(titleConfirms('嫌われる勇気', '嫌われる勇気 自己啓発の源流「アドラー」の教え')).toBe(true);
  });
  it('別の本(書名を含まない)は false', () => {
    expect(titleConfirms('平家物語', 'ヒーロー! | 白岩玄')).toBe(false);
    expect(titleConfirms('LISTEN', '人材マネジメント革命')).toBe(false);
  });
  it('短い書名(『優駿』)は著者名の裏取りが必要', () => {
    // 商品名に書名を含んでも、著者不一致なら別の本として false
    expect(titleConfirms('優駿', '容疑者Xの献身 | 東野圭吾', '宮本輝')).toBe(false);
    // 書名も著者も一致すれば true
    expect(titleConfirms('優駿', '優駿(上) (新潮文庫) | 宮本輝', '宮本輝')).toBe(true);
    // 著者情報が無ければ短い書名は採らない(誤マッチ回避)
    expect(titleConfirms('優駿', '優駿(上) (新潮文庫) | 宮本輝')).toBe(false);
  });
});

describe('resolveBookCoverUrl', () => {
  it('検索上位の ASIN の商品名が一致し書影が実在すれば、その書影を返す', async () => {
    const url = await resolveBookCoverUrl(
      { title: '平家物語の魅力と読み方' },
      {
        identify: async () => ({ found: true, bookTitle: '平家物語', author: '古川日出男', isbn13: [] }),
        fetchImpl: makeFetch({
          search: { 平家物語: ['4309728790'] },
          dpTitle: { '4309728790': '平家物語 (池澤夏樹=個人編集 日本文学全集) | 古川日出男' },
          imgBytes: { '4309728790': 23000 },
        }),
      },
    );
    expect(url).toBe(`${AMZ_IMG}4309728790.09.LZZZZZZZ.jpg`);
  });

  it('別の本の ASIN（商品名が書名と不一致）は採らず、一致する次候補を採る', async () => {
    const url = await resolveBookCoverUrl(
      { title: '平家物語入門' },
      {
        identify: async () => ({ found: true, bookTitle: '平家物語', author: '', isbn13: [] }),
        fetchImpl: makeFetch({
          search: { 平家物語: ['4309024483', '4309728790'] }, // 先頭は別の本
          dpTitle: {
            '4309024483': 'ヒーロー! | 白岩玄', // 幻覚 ISBN が指した別の本 → 弾く
            '4309728790': '平家物語 (日本文学全集) | 古川日出男',
          },
          imgBytes: { '4309024483': 23000, '4309728790': 23000 },
        }),
      },
    );
    expect(url).toBe(`${AMZ_IMG}4309728790.09.LZZZZZZZ.jpg`);
  });

  it('商品名は一致するが書影が欠品(小サイズ)なら null', async () => {
    const url = await resolveBookCoverUrl(
      { title: 'マイナー書籍の話' },
      {
        identify: async () => ({ found: true, bookTitle: 'マイナー書籍', author: '', isbn13: [] }),
        fetchImpl: makeFetch({
          search: { マイナー書籍: ['4000000000'] },
          dpTitle: { '4000000000': 'マイナー書籍 とても地味な本' },
          // imgBytes 既定43 → 欠品
        }),
      },
    );
    expect(url).toBeNull();
  });

  it('検索が空でも LLM 候補 ISBN を商品名確認して採れる', async () => {
    const url = await resolveBookCoverUrl(
      { title: '嫌われる勇気の要点' },
      {
        identify: async () => ({ found: true, bookTitle: '嫌われる勇気', author: '', isbn13: ['9784478025819'] }),
        fetchImpl: makeFetch({
          search: {}, // 検索ヒットなし
          dpTitle: { '4478025819': '嫌われる勇気 自己啓発の源流「アドラー」の教え' },
          imgBytes: { '4478025819': 56000 },
        }),
      },
    );
    expect(url).toBe(`${AMZ_IMG}4478025819.09.LZZZZZZZ.jpg`);
  });

  it('特定書籍でない(found=false)なら null', async () => {
    const url = await resolveBookCoverUrl(
      { title: '今週読んだ本まとめ' },
      { identify: async () => ({ found: false, bookTitle: '', isbn13: [] }), fetchImpl: makeFetch({}) },
    );
    expect(url).toBeNull();
  });

  it('同定が例外を投げても throw せず null（非致命）', async () => {
    const url = await resolveBookCoverUrl(
      { title: 'x' },
      {
        identify: async () => {
          throw new Error('llm down');
        },
        fetchImpl: makeFetch({}),
      },
    );
    expect(url).toBeNull();
  });
});
