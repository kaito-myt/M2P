/**
 * タイトルの近似重複判定 — 自社の本/記事が互いに食い合うのを防ぐ。
 *
 * 2026-10-14 の実測: A2P の日次テーマ自動生成が **6 日連続で競馬本を作っていた**。
 *
 *   09-18 オッズ×血統×AI 三刀流で馬券を制す——週末だけで回収率100%超えを狙う
 *   09-20 回収率120%への道：血統×ペース×AIで「負けない馬券」を組み立てる完全戦略書
 *   09-21 競馬データ革命――AIと血統指数で「勝てる軸馬」を科学的に見つける最強予想術
 *   09-22 AIが暴く！秋競馬必勝データ馬券術：スピード指数×血統×オッズで激走馬を狙い撃つ
 *   09-23 競馬で全然勝てない俺が、コース×血統×オッズの「3点セット」だけで回収率100%超えを達成した話
 *
 * 原因は除外判定が **タイトルの完全一致のみ**だったこと
 * (`normalizeTitle` で NFKC + lower-case しても、上の 5 本は 1 文字も同じではない)。
 * ANP 側でも同じことが起きており、競馬 note アカウントの週次リサーチが
 * 「14 本が同一タイトル骨格で自記事同士が区別できない」と自力で指摘している。
 *
 * ここでは**文字バイグラムの Jaccard 係数**で近さを測る。
 * 形態素解析を入れないのは、辞書に無い語 (馬券/回収率/軸馬/トリガミ) が主役の
 * ニッチを扱うため — バイグラムなら辞書不要で、語の順序入れ替えにも強い。
 */

/** 判定に使う正規化: NFKC (全半角統一) + lower-case + 記号と空白の除去。 */
export function normalizeForSimilarity(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    // 記号類は書き手の癖で揺れるだけなので落とす (：―！「」× 等)。
    .replace(/[\s!-/:-@[-`{-~、。・「」『』【】〜ー―─×／]/gu, '');
}

/**
 * バイグラム類似度を信用してよい最小の正規化後文字数。
 *
 * 短い文字列では 1 文字の違いが比率を支配し、無関係な文字列が高い値を出す。
 * 実測: 「テーマ1」と「テーマ10」が 0.67 になり、テストの 10 候補のうち 1 件が
 * 誤って重複判定された。実際の書籍タイトルは 20〜60 字あるのでこの下限は害にならない。
 * 完全一致 (similarity === 1) はこの下限に関係なく重複として扱う。
 */
const MIN_LENGTH_FOR_SIMILARITY = 12;

/** 両方が十分長いか (バイグラム類似度を根拠にしてよいか)。 */
function longEnoughForSimilarity(a: string, b: string): boolean {
  return (
    normalizeForSimilarity(a).length >= MIN_LENGTH_FOR_SIMILARITY &&
    normalizeForSimilarity(b).length >= MIN_LENGTH_FOR_SIMILARITY
  );
}

/** 文字バイグラム集合。1 文字しか無いときはその 1 文字を要素にする。 */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length === 0) return out;
  if (s.length === 1) {
    out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 2 つのタイトルの近さ (0〜1)。1 は完全一致。
 *
 * バイグラム集合の Jaccard 係数 (|A∩B| / |A∪B|)。
 * 語の順序を入れ替えただけの言い換えにも高い値が出る。
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 既出タイトル群の中で最も近いものを返す。しきい値未満なら null。
 *
 * 既定 0.5 は実測から決めた。上の競馬 5 本は互いに 0.2〜0.35 程度で、
 * **バイグラムだけでは企画の重複を捕まえられない** (「血統」「オッズ」「回収率」を
 * 共有していても文字列としては遠い)。そこで語レベルの共有も併せて見る
 * (`sharedKeywords`) — しきい値運用はそちらが主役になる。
 */
export function findNearDuplicate(
  title: string,
  existing: ReadonlyArray<string>,
  threshold = 0.5,
): { title: string; similarity: number } | null {
  let best: { title: string; similarity: number } | null = null;
  for (const e of existing) {
    const s = titleSimilarity(title, e);
    // 完全一致は長さを問わず重複。それ以外は短い文字列で誤検知するので下限を設ける。
    const usable = s === 1 || longEnoughForSimilarity(title, e);
    if (usable && s >= threshold && (best === null || s > best.similarity)) {
      best = { title: e, similarity: s };
    }
  }
  return best;
}

/**
 * タイトルから「企画の骨格語」を抜く。
 *
 * 漢字・カタカナの連続を 2 文字以上で拾う。ひらがなは助詞・活用で揺れるため拾わない
 * (「狙う」「狙い撃つ」で別語になってしまう)。英数字は 2 文字以上を拾う (AI / NISA)。
 */
export function extractKeywords(title: string): Set<string> {
  const normalized = title.normalize('NFKC');
  const out = new Set<string>();
  const re = /[\p{sc=Han}]{2,}|[\p{sc=Katakana}ー]{2,}|[A-Za-z0-9]{2,}/gu;
  for (const m of normalized.matchAll(re)) {
    out.add(m[0].toLowerCase());
  }
  return out;
}

/**
 * 企画の骨格にならない販促の汎用語。これを数えると無関係な実用書同士が
 * 「完全」「最強」だけで重複判定されてしまう。
 */
const GENERIC_PROMO_WORDS = new Set([
  '完全',
  '完全版',
  '完全攻略',
  '完全対応',
  '最強',
  '最新',
  '必勝',
  '革命',
  '科学',
  '科学的',
  '方法',
  '教科書',
  '入門',
  'ガイド',
  'バイブル',
  '大全',
  '全技術',
  '基本',
  '実践',
  '戦略',
  '戦略書',
  '徹底',
  '解説',
  '講座',
  '決定版',
  '選',
  '術',
]);

/**
 * 2 つのタイトルが共有する骨格語。
 *
 * 「オッズ×血統×AI 三刀流で馬券を制す」と
 * 「競馬データ革命――AIと血統指数で『勝てる軸馬』を科学的に見つける最強予想術」は
 * 文字列としては遠いが {ai, 血統, データ, 競馬} を共有する。**企画の重複はここに出る。**
 *
 * 比較は**部分一致**で行う (どちらかが他方を含めば共有とみなす、2 文字以上)。
 * 正規表現は漢字/カタカナの**最長連続**を 1 語として取るので、
 * 「×血統×」からは `血統`、「血統指数」からは `血統指数` が出て**完全一致では繋がらない**
 * (2026-10-14 にこれでテストが落ちて気付いた)。
 * 共有語として返すのは短い側 (`血統`) — 運営者に見せる語として素直なため。
 */
export function sharedKeywords(a: string, b: string): string[] {
  const A = [...extractKeywords(a)].filter((k) => !GENERIC_PROMO_WORDS.has(k));
  const B = [...extractKeywords(b)].filter((k) => !GENERIC_PROMO_WORDS.has(k));
  const shared = new Set<string>();
  for (const ka of A) {
    for (const kb of B) {
      if (ka === kb) {
        shared.add(ka);
      } else if (ka.length >= 2 && kb.includes(ka)) {
        shared.add(ka);
      } else if (kb.length >= 2 && ka.includes(kb)) {
        shared.add(kb);
      }
    }
  }
  return [...shared].sort();
}

export interface ConceptOverlap {
  /** 最も重なっていた既出タイトル。 */
  title: string;
  /** 共有していた骨格語。 */
  shared: string[];
  /** 文字バイグラムの近さ (参考値)。 */
  similarity: number;
}

/**
 * 企画が既出と重なっていないか見る。
 *
 * - 骨格語を `minSharedKeywords` 個以上共有していたら重複とみなす (既定 2)
 * - または文字バイグラムが `similarityThreshold` 以上 (既定 0.5 — 言い換えの検出)
 *
 * **何と重なったかを返す**のが要点。単に弾くだけだと「じゃあ何を書けばいいのか」が
 * 分からず、再生成しても同じ所に戻る。呼出側はこれをプロンプトに戻して
 * 「この骨格は既に◯本ある」と伝える。
 */
export function findConceptOverlap(
  title: string,
  existing: ReadonlyArray<string>,
  opts: { minSharedKeywords?: number; similarityThreshold?: number } = {},
): ConceptOverlap | null {
  const minShared = opts.minSharedKeywords ?? 2;
  const simThreshold = opts.similarityThreshold ?? 0.5;

  let best: ConceptOverlap | null = null;
  for (const e of existing) {
    const shared = sharedKeywords(title, e);
    const similarity = titleSimilarity(title, e);
    const similarityUsable = similarity === 1 || longEnoughForSimilarity(title, e);
    const hit = shared.length >= minShared || (similarityUsable && similarity >= simThreshold);
    if (!hit) continue;
    // 共有語が多い方を優先し、同数なら文字列が近い方を採る。
    if (
      best === null ||
      shared.length > best.shared.length ||
      (shared.length === best.shared.length && similarity > best.similarity)
    ) {
      best = { title: e, shared, similarity };
    }
  }
  return best;
}
