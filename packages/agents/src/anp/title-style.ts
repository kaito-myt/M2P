/**
 * note タイトルの型バリエーション (F-ANP-53, docs/11-anp-design.md §3.2)。
 *
 * 運営者指摘 (2026-10-13)「まだ画像とタイトルが微妙」への対応。
 *
 * 【何が起きていたか】 v4 プロンプト (2026-09-29 活性) 以降に生成された 100 本を数えたところ:
 *   - `｜` を含む ... 96 / 100
 *   - 数字を含む ... 100 / 100
 *   - 読者ラベル (週末派 / 会社員 等) を含む ... 73 / 100
 * 全部が「{主題}｜{読者ラベル}が{数字}{単位}」という**同じ 1 つの型**だった。
 * v4 プロンプト自身が「悪い例」として挙げていた形そのものが出続けていた。
 *
 * 【なぜプロンプトで直らなかったか】 原因は指示ではなく**文脈**だった。
 *   1. `anp.theme` の仮題が既に `X｜Y` 形式で、`anp.seo` はそれを「推敲」してしまう (アンカリング)。
 *   2. 直近 10 件のタイトルを「言い回しが被らないように」と渡していたが、10 件全部が同じ型
 *      なので、**最強の few-shot 例**として働き、プロンプトの指示を上書きしていた。
 *      (同じ失敗は販促の content_creator でも起きている: 例文が tips だったので全投稿が
 *       tips になった。例として見せたものが出力を決める。)
 *
 * 【対策】 アイキャッチの画風で実績のある手法をそのまま使う = **記事ごとに型を決定的に振り、
 * その 1 つだけを提示する**。候補を並べて「どれかに乗せろ」と言うと最頻出の型に収束するので、
 * 選択肢を渡さない。加えて直近で繰り返されている言い回しを機械的に抽出して名指しで禁止する。
 *
 * すべて DB 非依存の純関数。
 */

import { classifyNicheGenre, type NoteGenreKey } from '@a2p/contracts/note-genre';

export interface TitlePattern {
  /** 表示用のキー (ログ/テスト用)。 */
  key: string;
  /** 日本語の型名 (プロンプトに出す)。 */
  label: string;
  /** その型の作り方。プロンプトにそのまま貼る。 */
  rule: string;
  /** 型の見本 (文言のコピーは禁止。構造だけ真似させる)。 */
  examples: readonly string[];
  /** この型は `｜` で 2 段に割るか。 */
  usesBar: boolean;
}

/**
 * タイトルの型。**`｜` を使うのは 8 個中 1 個だけ**にしてある。
 * `｜` 自体が悪いのではなく、「全部が `｜`」が悪い (タイムラインで同じ顔に見える)。
 */
export const TITLE_PATTERNS: readonly TitlePattern[] = [
  {
    key: 'result_first',
    label: '結果先出し型',
    rule: '「〜した結果、○○だった」。読者が知りたい結論の数字をタイトルで先に言い切る。もったいぶらない。',
    examples: [
      '上がり最速馬を次走で買い続けた結果、複勝率は38.4%だった',
      '30日間noteを書き続けて、初めて有料記事を出した結果',
    ],
    usesBar: false,
  },
  {
    key: 'loss_confession',
    label: '損失・失敗の告白型',
    rule: '自分の損・失敗・ゼロを主語にする。きれいな成功談より読まれる。何を失って何が分かったかまで書く。',
    examples: ['3か月で5万円溶かして、やっと買わない日を作れた', '売上0円のまま10点出品して分かったこと'],
    usesBar: false,
  },
  {
    key: 'inner_voice',
    label: '内心の独り言型',
    rule: '読者が心の中で言っている言葉を「」でそのまま置き、その答えが記事にあると示す。検索語ではなく独り言を使う。',
    examples: ['「何から始めれば?」の答えが、いつまでも見つからない理由', '「今日は見送り」が言えない人の共通点'],
    usesBar: false,
  },
  {
    key: 'assertion',
    label: '言い切り提案型',
    rule: '記事の結論を 1 つだけ断言する。「最初にやるべきは〜です」「〜だけ見ればいい」。説明調で終わらせない。',
    examples: ['最初にやるべきは「15秒の自己紹介動画」です', '馬体重は、±0kgかどうかだけ見ればいい'],
    usesBar: false,
  },
  {
    key: 'duration_log',
    label: '期間・回数の実録型',
    rule: '「◯日間」「◯件」「◯年分」と期間や回数を頭に置き、そこで何が残ったかを続ける。端数のほうが実体験に見える。',
    examples: ['1年で2,600本出して残った型', '48,239頭を数えたら、馬体重の見方が変わった'],
    usesBar: false,
  },
  {
    key: 'counter_common',
    label: '常識ひっくり返し型',
    rule: 'よく言われている定説を先に置き、「実は違った」と返す。定説は読者が本当に信じているものを選ぶ。',
    examples: ['「人気薄の複勝は美味しい」は、6年分では成り立たなかった', 'AI副業の「まず実績作り」を半年やって後悔した'],
    usesBar: false,
  },
  {
    key: 'comparison',
    label: '比較・使い分け型',
    rule: 'A と B を並べ、どちらをいつ使うかを問う。両方を実際に試した事実を添える。',
    examples: ['ChatGPTとClaude、両方に課金して10日。実際どう使い分けてる？', '単勝と複勝、同じ馬で1年買い続けた差'],
    usesBar: false,
  },
  {
    key: 'verdict',
    label: '判定提示型 (競馬系)',
    rule: '「買う / 消す」「アリ / ナシ」の判定を 1 行で出す。条件 (コース・クラス・人気) は具体的に書く。',
    examples: ['外枠の1番人気は消し、2〜4番人気は買い', '稍重の東京芝1600mは、1番人気を信じていい'],
    usesBar: false,
  },
  {
    key: 'how_to_amount',
    label: '金額・到達点の作り方型 (副業系)',
    rule: '金額や到達点を先に置き、その作り方を続ける。参考サムネ「副業 最初の1万円をつくる方法」の型。',
    examples: ['最初の1万円は、校正の仕事でつくる', '月3万円までは、AIに任せないほうが早い'],
    usesBar: false,
  },
  {
    key: 'reader_two_stage',
    label: '属性 ｜ 中身の 2 段型',
    rule: '`｜` で 2 段にする。前半は「誰の・どんな状況か」、後半は「中で何が読めるか」。前半に読者が自分だと分かる語を置く。',
    examples: [
      'AI副業を始めたいのに何も決められない人へ｜候補を1つに絞る3つの質問',
      '65歳から始めたAI副業｜初心者の私が実際にやっている5つのこと',
    ],
    usesBar: true,
  },
];

/**
 * ジャンル別に使う型と、その優先順 (`@a2p/contracts/note-genre` の分析に対応)。
 *
 * 競馬系の読者は「結論」に反応するので判定・言い切りを前に、副業系の読者は
 * 「自分にもできそうか」で決めるので金額・失敗・独り言を前に置く。
 * `｜` の 2 段型はどちらでも最後 (使い過ぎていたので優先度を落とす)。
 */
export const GENRE_TITLE_PATTERNS: Record<NoteGenreKey, readonly string[]> = {
  gamble: [
    'verdict',
    'assertion',
    'result_first',
    'counter_common',
    'duration_log',
    'loss_confession',
    'comparison',
    'reader_two_stage',
  ],
  money: [
    'how_to_amount',
    'loss_confession',
    'inner_voice',
    'result_first',
    'assertion',
    'duration_log',
    'counter_common',
    'reader_two_stage',
  ],
  default: [
    'result_first',
    'inner_voice',
    'assertion',
    'loss_confession',
    'duration_log',
    'counter_common',
    'comparison',
    'reader_two_stage',
  ],
};

/** そのジャンルで使う型を優先順に並べて返す。 */
export function patternsForNiche(niche?: string | null): readonly TitlePattern[] {
  const order = GENRE_TITLE_PATTERNS[classifyNicheGenre(niche).key];
  const byKey = new Map(TITLE_PATTERNS.map((p) => [p.key, p]));
  return order.map((k) => byKey.get(k)).filter((p): p is TitlePattern => p !== undefined);
}

/** 文字列の安定ハッシュ (FNV-1a)。同じ記事 id は常に同じ型になる。 */
export function hashTitleSeed(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 直近タイトルのうち `｜` で 2 段にしているものの割合。 */
export function barRatio(titles: readonly string[]): number {
  if (titles.length === 0) return 0;
  const n = titles.filter((t) => t.includes('｜') || t.includes('|')).length;
  return n / titles.length;
}

/**
 * 記事 id から型を決定的に選ぶ。
 *
 * 直近が `｜` だらけ (4 割以上) のときは `｜` を使う型を飛ばす。これで**偏りが自動的に
 * 戻る**: 今は 96% なので `｜` の型は当面出ず、割合が 4 割を切ったらまた回り始める。
 */
export function pickTitlePattern(
  seed: string,
  recentTitles: readonly string[] = [],
  niche?: string | null,
): TitlePattern {
  const pool = patternsForNiche(niche);
  const total = pool.length;
  const start = hashTitleSeed(seed) % total;
  const barHeavy = barRatio(recentTitles) >= 0.4;
  for (let i = 0; i < total; i += 1) {
    const candidate = pool[(start + i) % total]!;
    if (barHeavy && candidate.usesBar) continue;
    return candidate;
  }
  return pool[start]!;
}

const HIRAGANA_ONLY = /^[぀-ゟー]+$/;
/** 言い回しとして意味を持たない記号・区切りだけの断片。 */
const PUNCT_ONLY = /^[\s｜|、。・，．/?？!！「」『』（）()【】〜ー:：-]+$/;

export interface RecurringPhraseOptions {
  /** 何割以上のタイトルに出たら「繰り返し」とみなすか (既定 0.4)。 */
  minRatio?: number;
  /** 除外する語 (ニッチ名など、繰り返して当然のキーワード)。 */
  exclude?: readonly string[];
  /** 返す最大件数 (既定 8)。 */
  limit?: number;
}

/**
 * 直近タイトルに繰り返し出てくる言い回しを抽出する。
 *
 * 「週末派」「会社員が」のような**その時々の収束先**を機械的に見つけるためのもので、
 * 語のリストを人間が保守しなくても、次に別の言い回しへ収束したら自動で検出できる。
 * ニッチ名 (= 検索キーワードなので繰り返して当然) は `exclude` で外す。
 */
export function recurringPhrases(
  titles: readonly string[],
  options: RecurringPhraseOptions = {},
): string[] {
  const minRatio = options.minRatio ?? 0.4;
  const limit = options.limit ?? 8;
  const exclude = options.exclude ?? [];
  if (titles.length < 3) return [];

  const threshold = Math.max(2, Math.ceil(minRatio * titles.length));
  const counts = new Map<string, number>();
  for (const title of titles) {
    const chars = Array.from(title);
    const seen = new Set<string>();
    for (let len = 3; len <= 8; len += 1) {
      for (let i = 0; i + len <= chars.length; i += 1) {
        seen.add(chars.slice(i, i + len).join(''));
      }
    }
    for (const phrase of seen) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  const kept = [...counts.entries()]
    .filter(([phrase, n]) => {
      if (n < threshold) return false;
      if (PUNCT_ONLY.test(phrase)) return false;
      // 助詞の連なり等 (「のでは」「という」) は言い回しの指摘として役に立たない。
      if (HIRAGANA_ONLY.test(phrase) && Array.from(phrase).length <= 4) return false;
      return !exclude.some((e) => e.length > 0 && (e.includes(phrase) || phrase === e));
    })
    .sort((a, b) => b[1] - a[1] || Array.from(b[0]).length - Array.from(a[0]).length);

  // 同じ回数でより長い言い回しに含まれる断片は落とす (「派が」は「週末派が」に吸収)。
  const out: string[] = [];
  for (const [phrase, n] of kept) {
    if (out.some((longer) => longer.includes(phrase) && (counts.get(longer) ?? 0) === n)) continue;
    out.push(phrase);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 型の `usesBar` に合う候補を本採用にする。
 *
 * LLM が指示を無視して `｜` 形に戻した場合でも、代替案の中に型に合うものがあればそれを
 * 採用する。**文字列は一切書き換えない** (生成していない文を作らない) ので、合う候補が
 * 無ければ元のまま通す。
 */
export function enforceTitlePattern<T extends { title: string; title_alternatives: string[] }>(
  output: T,
  pattern: TitlePattern,
): T {
  const hasBar = (t: string): boolean => t.includes('｜') || t.includes('|');
  if (hasBar(output.title) === pattern.usesBar) return output;

  const swap = output.title_alternatives.find((t) => hasBar(t) === pattern.usesBar);
  if (swap === undefined) return output;

  return {
    ...output,
    title: swap,
    title_alternatives: [output.title, ...output.title_alternatives.filter((t) => t !== swap)].slice(0, 4),
  };
}
