/**
 * Book Cover Resolver — 栞ブログの「良書紹介」記事に、紹介対象の実在書籍の
 * **本物の表紙画像**を引き当てる。
 *
 * 誤書影を絶対に出さないための設計（v2）:
 *  1. LLM で「この記事が扱う実在書籍」を同定し、書名・著者を得る（＋確認用に候補 ISBN も）。
 *  2. **Amazon 書籍検索**（`/s?k=書名 著者&i=stripbooks`）で実在商品の ASIN(=ISBN-10) を取得。
 *     キーレスで網羅性が高く、日本語書籍の版・レーベルを正しく引ける。
 *  3. **各 ASIN の実際の商品ページ(`/dp/<ASIN>`)のタイトルを取得し、LLM 書名と一致する場合のみ採用**。
 *     これが要（かなめ）: ISBN の当てずっぽうではなく「Amazon 自身の商品名」で本人確認する。
 *     LLM が幻覚した ISBN や別の本を機械的に弾ける。
 *  4. 一致した ASIN の Amazon 書影 URL を byte サイズで実在検証（欠品プレースホルダ ~43byte を除外）して返す。
 *
 * すべて **非致命**: 特定できなければ null を返し、呼出側は装丁風 PseudoCover にフォールバックする。
 * LLM 呼出は `createAgentClient('book_cover', …)` 経由で token_usage に記録される。
 *
 * 注意: Amazon への HTTP はデータセンター IP から CAPTCHA でブロックされ得る。ブロック時は
 * 検証が通らず null（＝誤書影ではなくフォールバック）になるだけで、安全側に倒れる。
 */
import type { LLMClient } from '@a2p/contracts/agents';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import { extractLlmJson } from '../lib/sanitize-llm-json.js';
import type { LoggingContext } from '../lib/with-token-logging.js';

/** 同定 LLM に使うモデル（DB 割当に依存せず固定。書誌知識が要るが軽量で足りる）。 */
const IDENTIFY_MODEL = { provider: 'anthropic', model: 'claude-sonnet-5' } as const;

/** Amazon プレースホルダ(1x1, ~43byte)を除外する下限。実表紙は通常 >10KB。 */
const MIN_COVER_BYTES = 1500;

/** 外部 fetch のタイムアウト(ms)。 */
const FETCH_TIMEOUT_MS = 9000;

/** Amazon 検索結果から確認する ASIN の最大数（多すぎるとリクエスト過多）。 */
const MAX_SEARCH_ASINS = 6;

/** ブラウザを装う共通ヘッダ（bot ブロック緩和）。 */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept-Language': 'ja,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

export interface BookIdentity {
  found: boolean;
  bookTitle: string;
  author?: string;
  isbn13: string[];
}

export interface ResolveBookCoverInput {
  /** 記事タイトル（SEO 済みで可）。 */
  title: string;
  /** 記事本文（Markdown, 任意）。冒頭のみ使用。 */
  body?: string;
  /** token_usage 紐付け用（任意）。 */
  jobId?: string;
}

export interface ResolveBookCoverDeps {
  createAgentClient?: typeof defaultCreateAgentClient;
  /** テスト差し替え用 fetch。 */
  fetchImpl?: typeof fetch;
  /** テストで LLM 同定を差し替える（指定時は LLM を呼ばない）。 */
  identify?: (input: ResolveBookCoverInput) => Promise<BookIdentity | null>;
  /** API キー取得の差し替え（一回性バックフィルで DB を介さず env から読む等）。 */
  getApiKey?: (provider: string) => Promise<string>;
}

/* ── ISBN ユーティリティ ─────────────────────────────────────────── */

function cleanIsbn(raw: string): string {
  return String(raw).replace(/[^0-9Xx]/g, '').toUpperCase();
}

/** ISBN-13 (978 prefix) → ISBN-10。変換不能なら null。 */
export function isbn13to10(isbn13: string): string | null {
  const i = cleanIsbn(isbn13);
  if (i.length !== 13 || !i.startsWith('978')) return null;
  const core = i.slice(3, 12);
  let sum = 0;
  for (let k = 0; k < 9; k++) sum += (10 - k) * Number(core[k]);
  const r = (11 - (sum % 11)) % 11;
  return core + (r === 10 ? 'X' : String(r));
}

/**
 * 書名の「中核」を取り出す（副題・レーベル・キャッチを落とす）。
 * LLM が副題込みの書名を返すと、Amazon 商品名の副題と字句が微妙に食い違い(例:「創造的な」vs
 * 「創造力がある」)包含判定が外れる。検索も照合も**中核**で行えば頑健になる。
 * 区切り(空白/：・|／―—-【（()）等)の最初の塊を採る。区切りが無ければ全体。
 */
export function coreTitle(title: string): string {
  const head = title.split(/[\s　：:・|｜/／―—–\-【（(「『［\[]/)[0]?.trim() ?? '';
  return head.length >= 2 ? head : title.trim();
}

/** 照合用の正規化（全半角/大小/記号/空白の揺れを吸収、日本語は残す）。 */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[：:・,，、。.!！?？\-—–―|｜/／「」『』（）()\[\]【】"'’‘“”＝=~〜]/g, '');
}

/**
 * Amazon 商品名(prodTitle) が LLM 書名(bookTitle) と「同じ本」と言えるか。
 * 商品名は「書名(レーベル) 著者 …」の形で書名を含むので、正規化書名の**包含**で判定する。
 * 幻覚 ISBN が指す別の本は商品名に書名を含まないため弾かれる。
 *
 * 短い書名(『優駿』等、正規化3文字未満)は別の本に偶然含まれやすいので、**著者名が商品名に
 * も現れること**を追加要件にして誤マッチを防ぐ。
 */
export function titleConfirms(bookTitle: string, prodTitle: string, author?: string): boolean {
  const nb = normalizeTitle(bookTitle);
  const np = normalizeTitle(prodTitle);
  if (nb.length < 2 || !np.includes(nb)) return false;
  if (nb.length >= 3) return true;
  const na = normalizeTitle(author ?? '');
  return na.length >= 2 && np.includes(na); // 短い書名は著者名の裏取りを必須に
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetchImpl(url, { ...init, headers: BROWSER_HEADERS, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/* ── Amazon 検索 / 商品確認 / 書影 ───────────────────────────────── */

/** Amazon 書籍検索で ASIN(=ISBN-10) 候補を取得（出現順・重複除去・上限あり）。
 *  bot ページや一時的な空応答を引くことがあるので、空なら一度だけ引き直す。 */
async function amazonSearchAsins(query: string, fetchImpl: typeof fetch): Promise<string[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(query)}&i=stripbooks`;
      const res = await withTimeout(fetchImpl, url);
      if (res.ok) {
        const html = await res.text();
        const asins: string[] = [];
        const re = /data-asin="([0-9X]{10})"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) && asins.length < 40) {
          const a = m[1]!;
          if (!asins.includes(a)) asins.push(a);
        }
        if (asins.length) return asins.slice(0, MAX_SEARCH_ASINS);
      }
    } catch {
      /* リトライへ */
    }
    if (attempt === 0) await sleep(1200);
  }
  return [];
}

/** ISBN(10/13, ハイフン可) を ISBN-10 に正規化。できなければ null。 */
function toIsbn10(raw: string): string | null {
  const s = cleanIsbn(raw);
  if (s.length === 10) return s;
  if (s.length === 13) return isbn13to10(s);
  return null;
}

/**
 * NDL(国立国会図書館サーチ)の OpenSearch を書名で引き、**書名が中核と一致する書誌**の
 * ISBN を ISBN-10 で返す。Amazon 検索が引けない書籍(長い和書名等)の保険。
 * NDL は曖昧一致で返すため書名フィルタをかけ、最終的な採否は Amazon 商品名照合に委ねる。
 */
async function ndlSearchIsbn10s(core: string, fetchImpl: typeof fetch): Promise<string[]> {
  try {
    const url = `https://ndlsearch.ndl.go.jp/api/opensearch?title=${encodeURIComponent(core)}&cnt=8`;
    const res = await withTimeout(fetchImpl, url);
    if (!res.ok) return [];
    const xml = await res.text();
    const nc = normalizeTitle(core);
    const out: string[] = [];
    for (const item of xml.split('<item>').slice(1)) {
      const tm = item.match(/<title>([^<]+)<\/title>/);
      if (!tm || !normalizeTitle(tm[1]!).includes(nc)) continue;
      for (const m of item.matchAll(/dcndl:ISBN[^>]*>([0-9Xx-]+)</g)) {
        const i10 = toIsbn10(m[1]!);
        if (i10 && !out.includes(i10)) out.push(i10);
      }
    }
    return out.slice(0, 6);
  } catch {
    return [];
  }
}

/** Amazon 商品ページの実タイトルを取得（本人確認用）。取得不能は null。 */
async function amazonProductTitle(isbn10: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await withTimeout(fetchImpl, `https://www.amazon.co.jp/dp/${isbn10}`);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!m) return null;
    // 「Amazon.co.jp: 書名 : 著者…」「書名 | 著者 |本 | 通販 | Amazon」等の飾りを除去。
    let t = m[1]!.replace(/^Amazon\.co\.jp[:：]?\s*/i, '').replace(/\s*\|\s*Amazon.*$/i, '');
    return t.trim() || null;
  } catch {
    return null;
  }
}

/** ISBN-10 の Amazon 書影 URL 候補（大きい順に試す）。 */
function amazonCoverCandidates(isbn10: string): string[] {
  const base = `https://images-na.ssl-images-amazon.com/images/P/${isbn10}`;
  return [`${base}.09.LZZZZZZZ.jpg`, `${base}.01.LZZZZZZZ.jpg`, `${base}.01._SCLZZZZZZZ_.jpg`];
}

/** URL が実体のある画像（欠品プレースホルダでない）かを byte サイズで検証。 */
async function isRealImage(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await withTimeout(fetchImpl, url);
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.startsWith('image/')) return false;
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > 0) return len >= MIN_COVER_BYTES;
    const buf = await res.arrayBuffer();
    return buf.byteLength >= MIN_COVER_BYTES;
  } catch {
    return false;
  }
}

/**
 * ある ASIN(ISBN-10) について「商品名が書名と一致」かつ「書影が実在」なら書影 URL を返す。
 * どちらか欠ければ null（＝別の本 or 書影なし）。
 */
async function confirmedCover(
  isbn10: string,
  bookTitle: string,
  fetchImpl: typeof fetch,
  author?: string,
): Promise<string | null> {
  const prodTitle = await amazonProductTitle(isbn10, fetchImpl);
  if (!prodTitle || !titleConfirms(bookTitle, prodTitle, author)) return null;
  for (const url of amazonCoverCandidates(isbn10)) {
    if (await isRealImage(url, fetchImpl)) return url;
  }
  return null;
}

/* ── LLM 書籍同定 ────────────────────────────────────────────────── */

const IDENTIFY_SYSTEM = [
  'あなたは日本語のブックレビュー記事から、その記事が紹介している「実在する1冊の書籍」を同定する専門家です。',
  '出力は指定 JSON のみ。前置き・説明・コードフェンスは一切禁止。',
  'bookTitle は副題や煽り文を除いた正式な書名の中核（例:「嫌われる勇気」「平家物語」）。',
  'author は著者/訳者名（日本語表記、不明なら ""）。Amazon 検索に使うため正確に。',
  'isbn13 は日本で流通している版の ISBN-13 を高確度順に最大3件（記号なし13桁, 不確実でも可）。',
  '記事が特定の実在書籍を扱っていない場合のみ found=false。',
].join('\n');

function buildIdentifyUser(input: ResolveBookCoverInput): string {
  const body = (input.body ?? '').slice(0, 1200);
  return [
    `記事タイトル: ${input.title}`,
    '',
    '【記事本文(冒頭)】',
    body || '(本文なし)',
    '',
    '出力 JSON:',
    '{',
    '  "found": boolean,',
    '  "bookTitle": string,',
    '  "author": string,',
    '  "isbn13": string[]',
    '}',
  ].join('\n');
}

function hasIdentityShape(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  return typeof o.bookTitle === 'string';
}

async function identifyBook(
  input: ResolveBookCoverInput,
  makeClient: typeof defaultCreateAgentClient,
  getApiKey?: (provider: string) => Promise<string>,
): Promise<BookIdentity | null> {
  const ctx: LoggingContext = { role: 'book_cover' };
  if (input.jobId) ctx.jobId = input.jobId;

  const clientDeps: Parameters<typeof makeClient>[3] = {
    assignmentOverride: { provider: IDENTIFY_MODEL.provider, model: IDENTIFY_MODEL.model },
  };
  if (getApiKey) clientDeps.getApiKey = getApiKey;
  const client: LLMClient = await makeClient('book_cover', null, ctx, clientDeps);

  const completion = await client.complete({
    role: 'book_cover',
    genre: null,
    messages: [
      { role: 'system', content: IDENTIFY_SYSTEM },
      { role: 'user', content: buildIdentifyUser(input) },
    ],
    maxOutputTokens: 512,
  });

  const parsed = extractLlmJson(completion.text, hasIdentityShape);
  if (parsed === undefined) return null;
  const o = parsed as Record<string, unknown>;
  const isbn13 = Array.isArray(o.isbn13)
    ? o.isbn13.map((x) => cleanIsbn(String(x))).filter((x) => x.length === 13)
    : [];
  return {
    found: o.found !== false,
    bookTitle: String(o.bookTitle ?? '').trim(),
    author: typeof o.author === 'string' ? o.author : undefined,
    isbn13: [...new Set(isbn13)].slice(0, 3),
  };
}

/* ── 公開 API ────────────────────────────────────────────────────── */

/**
 * 記事の紹介対象書籍の実表紙 URL を解決する。特定できなければ null（非致命）。
 * 採用する書影はすべて「Amazon 商品名が書名と一致」した本のものだけ（誤書影を出さない）。
 * @returns Amazon の公開書影 URL（https, 恒久・ホットリンク可）または null。
 */
export async function resolveBookCoverUrl(
  input: ResolveBookCoverInput,
  deps: ResolveBookCoverDeps = {},
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  let identity: BookIdentity | null;
  try {
    identity = deps.identify ? await deps.identify(input) : await identifyBook(input, makeClient, deps.getApiKey);
  } catch {
    return null;
  }
  if (!identity || !identity.found || !identity.bookTitle) return null;

  // 副題込みの書名は Amazon 商品名と字句が食い違い包含照合が外れるため、中核で検索・照合する。
  const core = coreTitle(identity.bookTitle);

  // 候補 ASIN を出現順で集める:
  //   ①「中核 著者」検索 → ②「中核」のみ検索(著者付きで0件のときの保険) → ③LLM 候補 ISBN。
  const queries = [
    [core, identity.author].filter(Boolean).join(' '),
    core,
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);

  const seen = new Set<string>();
  const candidates: string[] = [];
  const add = (a: string): void => {
    if (!seen.has(a)) {
      seen.add(a);
      candidates.push(a);
    }
  };
  for (const q of queries) for (const a of await amazonSearchAsins(q, fetchImpl)) add(a);
  // Amazon 検索は関連書を返すだけで対象書を出さないことがある(長い和書名等)。NDL(書誌)の
  // ISBN と LLM 候補 ISBN も**常に**候補へ足し、最終採否は Amazon 商品名照合に委ねる。
  for (const a of await ndlSearchIsbn10s(core, fetchImpl)) add(a);
  for (const x of identity.isbn13) {
    const a = isbn13to10(x);
    if (a) add(a);
  }

  // 最初に「商品名(中核一致) かつ 書影実在」した ASIN の書影を採用。上限で過剰リクエストを防ぐ。
  for (const isbn10 of candidates.slice(0, 10)) {
    const cover = await confirmedCover(isbn10, core, fetchImpl, identity.author);
    if (cover) return cover;
  }
  return null;
}
