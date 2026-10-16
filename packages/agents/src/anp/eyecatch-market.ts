/**
 * F-ANP-57 — 競合サムネの「実物を見る」市場分析。docs/11-anp-design.md §3.2
 *
 * 【なぜ要るか (2026-10-16 運営者指摘「note のサムネ作成ちゃんと市場分析をしたうえで作成してる？」)】
 *
 * F-ANP-56 の週次リサーチ (`anp.research`) は Tavily の**テキスト** (title / url / snippet)
 * しか見ていない。それなのに `art_direction` = 被写体・構図・色・質感・避けるもの
 * (= 完全に視覚の指示) を書かせていた。しかもまとめ段のプロンプトには
 * 「上の一次情報に書かれていないことを『調べた結果』として書かないこと」と書いてある。
 * 出典に画像の話は 1 件も無いので、**画作りだけが根拠のない創作**になっていた。
 *
 * 本番実測で実害も確認できた:
 *   - 競馬アカウントの `art_direction` = 「実写風・曇天の芝・低彩度・差し色 1 色」
 *   - 同じリサーチが見つけた note 競馬面の実物 (`note.com/topic/keiba`) =
 *     「【秋華賞2026 サイン予想】¥1,000」等が黒地×金×煽りで並ぶ面
 *   → **正反対**。しかも `anp.eyecatch` の `buildPrompt` はアカウント指示を「最優先」として
 *     ジャンル既定 (運営者が実物 6 枚を見て 2026-10-13 に決めた勝ち筋) を**丸ごと置き換える**。
 *     つまり「画像を 1 枚も見ていない推測」が「人が実物を見て決めた事実」を上書きしていた。
 *
 * 【このモジュールがやること】
 *  1. Tavily の検索結果から **note の記事ページ**を拾う。トピック/タグ/検索ページ
 *     (`note.com/topic/keiba` 等) に当たっていたら、その HTML から記事リンクを掘る
 *     (= note 自身が並べた「そのジャンルで今読まれている記事」の列がそのまま候補になる)。
 *  2. 各記事の `og:image` (= note のアイキャッチそのもの) を取得する。
 *  3. 画像を**まとめて 1 回のビジョン呼び出し**に渡し、被写体/構図/配色/文字の扱いを
 *     1 枚ずつ記述させ、共通する作法と「自分たちに足りないもの」を出させる。
 *
 * 【エラー方針】ベストエフォート。1 枚も取れなくても throw しない (リサーチを止めない)。
 * 画像が 0 枚なら呼び出し側は従来どおりテキストだけでまとめ、`art_direction_evidence` が
 * 空のままになる — その空が「画作りは推測」の印として `anp.eyecatch` 側で効く。
 */
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteRivalEyecatchObservationSchema,
  type NoteAccountConsultResearchItem,
  type NoteRivalEyecatchObservation,
} from '@a2p/contracts/agents/anp';
import { createLogger } from '@a2p/contracts/logger';

const log = createLogger('agents.anp.eyecatch-market');

/** 外部 fetch のタイムアウト(ms)。 */
const FETCH_TIMEOUT_MS = 9000;
/** ビジョンに渡すサムネの最大枚数。増やすほど高いので、作法が読める最小限にする。 */
const MAX_SHOTS = 6;
/** 記事ページを取りに行く最大件数 (画像が無い記事もあるので枚数より多めに当たる)。 */
const MAX_ARTICLE_FETCHES = 12;
/** 一覧ページ 1 枚から拾う記事リンクの上限。 */
const MAX_LINKS_PER_INDEX = 8;
/** プレースホルダ画像を除外する下限 (note のアイキャッチは通常 >20KB)。 */
const MIN_IMAGE_BYTES = 2000;
/** ビジョンに渡す 1 枚の上限 (これを超えるものは捨てる)。 */
const MAX_IMAGE_BYTES = 4_500_000;
const OBSERVE_MAX_OUTPUT_TOKENS = 4096;

/** ブラウザを装う共通ヘッダ (bot ブロック緩和)。book-cover と同じ値。 */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept-Language': 'ja,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** 実際に画像を取得できた競合サムネ 1 件。 */
export interface RivalEyecatchShot {
  /** 元記事の URL (出典として残す)。 */
  articleUrl: string;
  /** 記事タイトル (分かれば)。 */
  title: string;
  /** サムネ画像の URL。 */
  imageUrl: string;
  /** 画像本体。 */
  image: Buffer;
  mimeType: string;
}

export interface CollectRivalEyecatchesDeps {
  /** テスト差し替え用 fetch。 */
  fetchImpl?: typeof fetch;
  /** 取得する枚数の上限 (既定 6)。 */
  maxShots?: number;
}

function withTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetchImpl(url, { ...init, headers: BROWSER_HEADERS, signal: ctrl.signal }).finally(() =>
    clearTimeout(t),
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** note の**記事**ページか (`note.com/<creator>/n/<id>`)。 */
export function isNoteArticleUrl(url: string): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  if (host !== 'note.com' && !host.endsWith('.note.com')) return false;
  try {
    return /^\/[^/]+\/n\/[A-Za-z0-9]+/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * note の**一覧**ページか (トピック / ハッシュタグ / 検索)。
 *
 * ここが重要で、`note.com/topic/keiba` のような面は **note 自身がそのジャンルで
 * 並べた列**なので、競合サムネの標本としては検索結果より質が高い。
 */
export function isNoteIndexUrl(url: string): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  if (host !== 'note.com' && !host.endsWith('.note.com')) return false;
  try {
    return /^\/(topic|hashtag|search)(\/|$)/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** HTML から note の記事 URL を出現順で拾う (重複除去)。 */
export function extractNoteArticleLinks(html: string, limit = MAX_LINKS_PER_INDEX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /https:\/\/note\.com\/[A-Za-z0-9_-]+\/n\/[A-Za-z0-9]+/g;
  // 相対パスで書かれている場合も拾う。
  const reRel = /"(\/[A-Za-z0-9_-]+\/n\/[A-Za-z0-9]+)"/g;
  for (const m of html.matchAll(re)) {
    const u = m[0];
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= limit) return out;
  }
  for (const m of html.matchAll(reRel)) {
    const u = `https://note.com${m[1]}`;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= limit) return out;
  }
  return out;
}

/** HTML の meta から og:image (無ければ twitter:image) を取り出す。 */
export function extractOgImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) {
      const url = m[1].replace(/&amp;/g, '&').trim();
      if (url.startsWith('http')) return url;
    }
  }
  return null;
}

/** HTML の `<title>` (無ければ og:title)。 */
function extractTitle(html: string): string {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og?.[1]) return og[1].replace(/&amp;/g, '&').trim().slice(0, 200);
  const t = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html);
  return t?.[1] ? t[1].trim().slice(0, 200) : '';
}

/**
 * 検索結果から競合サムネを集める。
 *
 * 候補の作り方:
 *   1. 検索結果の note 記事 URL (そのまま使える)
 *   2. 検索結果の note 一覧ページ → HTML から記事リンクを掘る
 * 2 を先に展開するのは、一覧ページの並びの方が「今そのジャンルで出ているサムネ」に近いため。
 */
export async function collectRivalEyecatches(
  items: readonly NoteAccountConsultResearchItem[],
  deps: CollectRivalEyecatchesDeps = {},
): Promise<RivalEyecatchShot[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxShots = deps.maxShots ?? MAX_SHOTS;
  if (maxShots <= 0) return [];

  const candidates: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();
  const push = (url: string, title: string): void => {
    if (seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, title });
  };

  // 1) 一覧ページを展開 (note が並べた列 = 標本としては最良)
  for (const it of items) {
    if (!isNoteIndexUrl(it.url)) continue;
    try {
      const res = await withTimeout(fetchImpl, it.url);
      if (!res.ok) continue;
      const html = await res.text();
      for (const link of extractNoteArticleLinks(html)) push(link, '');
    } catch (err) {
      log.warn(
        { url: it.url, err: err instanceof Error ? err.message : String(err) },
        'note 一覧ページを取得できなかった',
      );
    }
  }

  // 2) 検索結果に直接出ていた記事ページ
  for (const it of items) {
    if (isNoteArticleUrl(it.url)) push(it.url, it.title);
  }

  if (candidates.length === 0) return [];

  const shots: RivalEyecatchShot[] = [];
  for (const cand of candidates.slice(0, MAX_ARTICLE_FETCHES)) {
    if (shots.length >= maxShots) break;
    try {
      const res = await withTimeout(fetchImpl, cand.url);
      if (!res.ok) continue;
      const html = await res.text();
      const imageUrl = extractOgImage(html);
      if (imageUrl === null) continue;
      const imgRes = await withTimeout(fetchImpl, imageUrl);
      if (!imgRes.ok) continue;
      const ct = imgRes.headers.get('content-type') ?? '';
      if (!ct.startsWith('image/')) continue;
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (buf.byteLength < MIN_IMAGE_BYTES || buf.byteLength > MAX_IMAGE_BYTES) continue;
      shots.push({
        articleUrl: cand.url,
        title: cand.title || extractTitle(html),
        imageUrl,
        image: buf,
        // content-type のパラメータ (charset 等) を落とす。
        mimeType: ct.split(';')[0]!.trim(),
      });
    } catch (err) {
      log.warn(
        { url: cand.url, err: err instanceof Error ? err.message : String(err) },
        '競合サムネを取得できなかった',
      );
    }
  }
  return shots;
}

export interface ObserveRivalEyecatchesArgs {
  client: LLMClient;
  systemPrompt: string;
  shots: readonly RivalEyecatchShot[];
  /** アカウントのニッチ (何の面を見ているかを明示する)。 */
  niche: string;
  /** 自分たちのサムネの作り方 (差分を出させるために渡す)。 */
  ourStyleSummary?: string;
  jobId?: string;
}

/** 観察のユーザーメッセージ。画像の並び順と番号を本文の番号に対応させる。 */
export function buildObserveUserMessage(args: ObserveRivalEyecatchesArgs): string {
  const lines = [
    `# タスク: 「${args.niche}」の note 記事アイキャッチを実物で観察する`,
    '',
    `添付した ${args.shots.length} 枚は、note 上でこのジャンルの記事に実際に付いている`,
    'アイキャッチ画像です。あなたの記憶や一般論ではなく、**この画像に写っているもの**だけを書いてください。',
    '',
    '【画像の対応】',
    ...args.shots.map(
      (s, i) => `${i + 1}. ${s.title || '(タイトル不明)'}\n   ${s.articleUrl}\n   ${s.imageUrl}`,
    ),
  ];
  if (args.ourStyleSummary && args.ourStyleSummary.trim().length > 0) {
    lines.push('', '【自分たちのサムネの現状】', args.ourStyleSummary.trim());
  }
  lines.push(
    '',
    '各画像について、見えたものを具体的に書いてください (抽象的な褒め言葉は不要):',
    '- subject: 何が写っているか。人物の有無、モノの種類、点数。',
    '- composition: 寄りか引きか、主役の位置、余白の取り方、文字との住み分け。',
    '- colors: 実写かイラストか、地の色、彩度の高さ、差し色。',
    '- text: 文字が入っているか。おおよその字数と行数、書体の太さ、縁取り・袋文字・帯の有無、置き場所。',
    '',
    'common_patterns には**複数枚に共通して現れた作法**だけを書いてください (1 枚だけの特徴は書かない)。',
    'our_gap には、上の「自分たちのサムネの現状」と比べて足りていない点を書いてください',
    '(現状が渡されていなければ空文字)。',
    '',
    '出力は次の JSON のみ:',
    '{',
    '  "shots": [ { "image_url": "...", "article_url": "...", "subject": "...", "composition": "...", "colors": "...", "text": "..." }, ... ],',
    '  "common_patterns": ["...", ...],',
    '  "our_gap": "..."',
    '}',
  );
  return lines.join('\n');
}

/**
 * 集めた競合サムネをビジョンモデルに見せて作法を記述させる。
 *
 * `anp.research` の role / client をそのまま使う (新しい role を増やさない)。
 * 理由: role を増やすと `prompts` と `model_assignments` の本番投入が必要になり、
 * 片方が漏れると週次リサーチが丸ごと落ちる。観察はリサーチの一部なので、
 * コストも `anp.research` に帰属させるのが正しい。
 *
 * @throws LLM 呼び出しや schema 検証の失敗 (呼び出し側が catch してベストエフォートにする)
 */
export async function observeRivalEyecatches(
  args: ObserveRivalEyecatchesArgs,
): Promise<NoteRivalEyecatchObservation> {
  if (args.shots.length === 0) {
    return NoteRivalEyecatchObservationSchema.parse({});
  }
  const completion = await args.client.complete<NoteRivalEyecatchObservation>({
    role: 'anp.research',
    genre: null,
    ...(args.jobId !== undefined ? { jobId: args.jobId } : {}),
    messages: [
      { role: 'system', content: args.systemPrompt },
      {
        role: 'user',
        content: buildObserveUserMessage(args),
        images: args.shots.map((s) => ({
          data: s.image.toString('base64'),
          mimeType: s.mimeType,
        })),
      },
    ],
    responseSchema: NoteRivalEyecatchObservationSchema,
    maxOutputTokens: OBSERVE_MAX_OUTPUT_TOKENS,
  });
  return NoteRivalEyecatchObservationSchema.parse(completion.text);
}
