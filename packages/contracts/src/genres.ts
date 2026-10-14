/**
 * ジャンルカタログ — テーマ生成で選べる書籍ジャンルの単一の真実源 (single source of truth)。
 *
 * これまで genre は `['practical','business','self_help']` の 3 値 enum として
 * contracts / worker / web に散在していた。実運用で「投資」「副業」「健康」「公営競技」など
 * より多様なジャンルを扱いたいという要件 (F-001 拡張) に対応するため、ここに一元化する。
 *
 * 設計方針:
 *  - `slug` は DB `theme_candidates.genre` (自由 String 列) に保存される安定キー。
 *    既存行との互換のため practical/business/self_help の slug は変更しない。
 *  - `label` は UI 表示 + LLM プロンプト注入に使う日本語名。
 *  - `group` は UI の <optgroup> 見出し。
 *  - genre は「プロンプト/モデルの選定キー」でもあるが、未定義ジャンルは
 *    `loadActivePrompt`/`loadModelAssignment` が `OR:[{genre},{genre:null}]` で
 *    role 既定 (genre=null) にフォールバックするため、専用プロンプトが無くても動作する。
 *
 * DB マイグレーション不要 (genre は既に String 列)。
 */
import { z } from 'zod';

export interface GenreDef {
  /** DB 保存キー / プロンプト選定キー。安定・不変。 */
  slug: string;
  /** UI + プロンプト用の日本語ラベル。 */
  label: string;
  /** UI の <optgroup> 見出し。 */
  group: string;
}

export const GENRE_CATALOG: readonly GenreDef[] = [
  // ── ビジネス・キャリア ──
  { slug: 'business', label: 'ビジネス書', group: 'ビジネス・キャリア' },
  { slug: 'money', label: '投資・資産運用', group: 'ビジネス・キャリア' },
  { slug: 'money_saving', label: '節約・家計管理', group: 'ビジネス・キャリア' },
  { slug: 'side_business', label: '副業・起業', group: 'ビジネス・キャリア' },
  { slug: 'career', label: '転職・キャリア', group: 'ビジネス・キャリア' },
  { slug: 'marketing', label: 'マーケティング・SNS運用', group: 'ビジネス・キャリア' },
  // ── 自己啓発・メンタル ──
  { slug: 'self_help', label: '自己啓発', group: '自己啓発・メンタル' },
  { slug: 'mental', label: 'メンタル・心の健康', group: '自己啓発・メンタル' },
  { slug: 'communication', label: '話し方・コミュニケーション', group: '自己啓発・メンタル' },
  { slug: 'relationship', label: '人間関係・恋愛', group: '自己啓発・メンタル' },
  { slug: 'habit', label: '習慣・目標達成', group: '自己啓発・メンタル' },
  // ── 実用・暮らし ──
  { slug: 'practical', label: '実用書', group: '実用・暮らし' },
  { slug: 'health', label: '健康・医療', group: '実用・暮らし' },
  { slug: 'diet', label: 'ダイエット・フィットネス', group: '実用・暮らし' },
  { slug: 'cooking', label: '料理・レシピ', group: '実用・暮らし' },
  { slug: 'lifestyle', label: '暮らし・ライフスタイル', group: '実用・暮らし' },
  { slug: 'parenting', label: '子育て・教育', group: '実用・暮らし' },
  { slug: 'beauty', label: '美容・ファッション', group: '実用・暮らし' },
  { slug: 'pet', label: 'ペット・動物', group: '実用・暮らし' },
  // ── 学び・スキル ──
  { slug: 'study', label: '勉強法・資格', group: '学び・スキル' },
  { slug: 'language', label: '語学・英語', group: '学び・スキル' },
  { slug: 'writing', label: '文章術・ライティング', group: '学び・スキル' },
  { slug: 'it_web', label: 'IT・Web・プログラミング', group: '学び・スキル' },
  { slug: 'ai_tech', label: 'AI・最新テクノロジー', group: '学び・スキル' },
  // ── 趣味・エンタメ ──
  { slug: 'hobby', label: '趣味・娯楽', group: '趣味・エンタメ' },
  { slug: 'gambling', label: '公営競技・馬券', group: '趣味・エンタメ' },
  { slug: 'travel', label: '旅行・お出かけ', group: '趣味・エンタメ' },
  { slug: 'spiritual', label: 'スピリチュアル・占い', group: '趣味・エンタメ' },
  { slug: 'history', label: '歴史・教養', group: '趣味・エンタメ' },
  // ── 小説・フィクション ──
  { slug: 'novel', label: '小説・文芸', group: '小説・フィクション' },
  { slug: 'light_novel', label: 'ライトノベル', group: '小説・フィクション' },
  { slug: 'mystery', label: 'ミステリー・推理', group: '小説・フィクション' },
  { slug: 'sf_fantasy', label: 'SF・ファンタジー', group: '小説・フィクション' },
  { slug: 'romance_fiction', label: '恋愛小説', group: '小説・フィクション' },
  { slug: 'historical_novel', label: '時代・歴史小説', group: '小説・フィクション' },
  { slug: 'horror', label: 'ホラー・怪談', group: '小説・フィクション' },
] as const;

/** 全ジャンル slug の配列 (worker の許可セット / zod enum の生成元)。 */
export const GENRE_SLUGS: readonly string[] = GENRE_CATALOG.map((g) => g.slug);

/** slug → 日本語ラベルの逆引きレコード。 */
export const GENRE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  GENRE_CATALOG.map((g) => [g.slug, g.label]),
);

/** UI の <optgroup> 用に group ごとにまとめたビュー。 */
export const GENRE_GROUPS: ReadonlyArray<{ group: string; items: readonly GenreDef[] }> =
  (() => {
    const order: string[] = [];
    const byGroup = new Map<string, GenreDef[]>();
    for (const g of GENRE_CATALOG) {
      if (!byGroup.has(g.group)) {
        byGroup.set(g.group, []);
        order.push(g.group);
      }
      byGroup.get(g.group)!.push(g);
    }
    return order.map((group) => ({ group, items: byGroup.get(group)! }));
  })();

/**
 * slug → 日本語ラベル。未知の slug は slug 自身を返す (素通し)。null/undefined は null。
 * 表示 (formatGenre) と LLM プロンプト注入の両方で使う。
 */
export function genreLabel(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return GENRE_LABELS[slug] ?? slug;
}

/** 既知ジャンル slug か。worker の正規化 (未知→null) 判定に使う。 */
export function isKnownGenre(slug: string | null | undefined): boolean {
  return !!slug && Object.prototype.hasOwnProperty.call(GENRE_LABELS, slug);
}

/**
 * テーマ生成入力の境界検証用 — カタログに載る slug のみ許可。
 * (agent I/O 契約側は自由 String を許容: 既存 DB 行や将来ジャンルを弾かないため。)
 */
export const GenreSlugSchema = z.enum(
  GENRE_SLUGS as [string, ...string[]],
);

/**
 * agent I/O 契約用の緩い genre schema。カタログ外の値 (既存行/移行期) も通す。
 * genre は下流では主にプロンプト文脈 + プロンプト/モデル選定キーであり、
 * 未知値は role 既定にフォールバックするため、ここで弾く必要はない。
 */
export const GenreValueSchema = z.string().min(1).max(64);

// ---------------------------------------------------------------------------
// ジャンル方針 (genre policy) — 実行時にプロンプトへ注入する「ジャンル別の書き方指針」。
//
// 設計: ジャンルは 29 種に増えたが、役割ごとに「全文プロンプト × ジャンル」を用意すると
// 管理不能になる。そこで **役割プロンプトは 1 本 (genre=null 既定)** に集約し、その中の
// `{genre_guidance}` プレースホルダへ、本の genre に応じた方針をここから注入する
// (prompt-loader が差し込む)。ジャンル追加＝ここに 1 行足すだけで全役割に効く。
// ---------------------------------------------------------------------------

/** slug → ジャンル別の書き方方針 (1〜2 文)。未知/ null は汎用方針にフォールバック。 */
export const GENRE_POLICIES: Readonly<Record<string, string>> = {
  business:
    'フレームワーク・データ・事例で説得力を持たせ、意思決定や成果に直結する示唆を与える。',
  money:
    '根拠とリスクを必ず明示し、利回りや儲けの断定・保証はしない。再現可能な考え方と手順を具体的に示す。',
  money_saving:
    '今日から削れる固定費・具体的な手順・金額感を示す。ムリなく続く仕組み化を重視する。',
  side_business:
    '初期費用・収益化までの現実的なステップと落とし穴を、数字を交えて具体的に示す。',
  career:
    '選択肢の比較軸と行動手順を明確にし、市場価値の高め方を具体的に示す。不安を煽らない。',
  marketing:
    '型・事例・数値で語り、すぐ試せる施策と見るべき指標 (KPI) をセットで示す。',
  self_help:
    '読者の感情に寄り添い、行動変容を促す。押し付けず、小さな一歩を具体的に提案する。',
  mental:
    '安心感を与え否定しない。医療の代替と誤解させず、必要時は専門機関の受診目安を添える。',
  communication:
    '場面別の言い換え・例文・型を示し、今日の会話でそのまま使える具体性を持たせる。',
  relationship:
    '具体的な場面と言動例で示す。決めつけず、読者の状況に寄り添う。',
  habit:
    '仕組み化・トリガー・記録など、挫折しない設計を具体的に示す。',
  practical:
    '読者が「今日から実践できる」具体的手順・チェックリスト・テンプレを重視し、抽象論を避ける。',
  health:
    '一般的な知見に基づき、治療効果の保証や断定をしない。受診の目安を添え、安全を最優先する。',
  diet:
    '続けられる方法と具体メニューを示す。極端・危険な方法や効果保証はしない。',
  cooking:
    '分量・手順・時間を明確にし、作りやすさと再現性を担保する。',
  lifestyle:
    '具体的な工夫と before/after を示し、等身大で真似しやすくする。',
  parenting:
    '年齢・場面別に具体的に示す。不安を煽らず、唯一の正解を押し付けない。',
  beauty:
    '具体的な手順・アイテム例を示す。効果保証や過度な断定を避ける。',
  pet:
    '具体的なケアと安全策を示す。健康面は獣医受診の目安を添える。',
  study:
    '手順・スケジュール・教材選びを、再現できる形で数字とともに示す。',
  language:
    '具体フレーズ・練習法・つまずき対策を示し、今日から使える例文を添える。',
  writing:
    '型と、悪文改善の before/after、チェックリストで、すぐ使える技術を示す。',
  it_web:
    '手順とコード/画面例を示す。前提知識を補い、つまずきどころを先回りする。',
  ai_tech:
    '最新かつ正確に。誇張せず、具体的な使い方やプロンプト例など実践できる中身を示す。',
  hobby:
    '初心者がつまずく点を先回りし、道具・手順・楽しみ方を具体的に示す。',
  gambling:
    '期待値・資金管理・データの見方を冷静に示す。射幸心を煽らず、勝ちを保証しない。',
  travel:
    'モデルコース・費用・所要時間・持ち物を具体的に示す。季節や予約の勘所も添える。',
  spiritual:
    '娯楽・内省として提示する。断定・不安商法や、医療/投資の判断への誘導はしない。',
  history:
    '史実に忠実に、通説と諸説を区別する。読み物として面白く、かつ正確に書く。',
  // 小説・フィクション: 実用書ではなく「物語」を書く。説明に頼らず場面・描写・会話で見せる。
  novel:
    'これは実用書ではなく小説・物語である。テーマは物語を通して伝え、人物・情景・心情を具体的な描写で立ち上げる。説明や箇条書きに頼らず、場面と会話で読ませる。',
  light_novel:
    'これはライトノベル(物語)である。会話とキャラクターの魅力でテンポよく牽引し、個性と関係性を際立たせる。実用書的な説明・箇条書きにはしない。',
  mystery:
    'これはミステリー小説である。謎・伏線・手がかりを公正に配置し、論理的な解決へ導く。読者に推理の余地を残し、場面と会話で緊張を作る。',
  sf_fantasy:
    'これはSF・ファンタジー小説である。世界観の理を一貫させ、設定は説明過多を避けて物語の中で見せる。魅力ある舞台と人物を場面で描く。',
  romance_fiction:
    'これは恋愛小説である。二人の感情の機微と距離の変化を、心情描写と会話で丁寧に見せる。説明ではなく場面で関係の進展を描く。',
  historical_novel:
    'これは時代・歴史小説である。時代考証を尊重しつつ人物を生き生きと描く。史実と創作の境を意識し、情景・言葉遣いで時代感を出す。説明文にはしない。',
  horror:
    'これはホラー・怪談(物語)である。恐怖は煽情でなく雰囲気と間で醸成する。日常のほころびから不安を積み上げ、読者の想像を働かせる描写で見せる。',
};

/** 汎用 (ジャンル未指定/未知) の方針。 */
export const GENERIC_GENRE_POLICY =
  '対象ジャンルはユーザーメッセージで指定される。読者の課題解決を最優先し、具体性と再現性を担保する。';

/**
 * フィクション(物語)ジャンルの slug 集合。実用書とは書き方(構成・文体・表現)を分岐するのに使う。
 * 小説はダ・デアル調＋詩的描写で書き、章立て/小見出し/箇条書き等の実用書フォーマットを課さない。
 */
export const FICTION_GENRES: ReadonlySet<string> = new Set([
  'novel',
  'light_novel',
  'mystery',
  'sf_fantasy',
  'romance_fiction',
  'historical_novel',
  'horror',
]);

/** そのジャンルが小説・フィクション(物語)か。実用書系の構成・文体を課さないための判定。 */
export function isFiction(slug: string | null | undefined): boolean {
  return !!slug && FICTION_GENRES.has(slug);
}

/**
 * フィクション共通の文体・表現指針。genreGuidance がフィクションジャンルに追記し、
 * 全役割プロンプト ({genre_guidance}) に注入される。
 */
export const FICTION_STYLE_DIRECTIVE =
  '文体は「だ・である」調で統一する（ですます調にしない）。物語であり実用書ではないため、' +
  '章立て・小見出し・箇条書き・「ポイント」「まとめ」等の実用書フォーマットは使わない。' +
  '説明や状況の要約に逃げず、情景・心情・五感・具体的な所作・自然な会話、比喩・省略・余韻で「見せる」。' +
  '常套句や稚拙な直叙を避け、選び抜いた語と細部の描写で立ち上げる、文学的で詩的な文章にする。';

/**
 * プロンプトの `{genre_guidance}` に注入する 1 行を返す。
 * 例: 「【ジャンル方針：投資・資産運用】根拠とリスクを必ず明示し…」
 * null / 未知 slug は汎用方針にフォールバックする。
 */
export function genreGuidance(slug: string | null | undefined): string {
  if (!slug) return `【ジャンル方針：汎用】${GENERIC_GENRE_POLICY}`;
  const policy = GENRE_POLICIES[slug];
  const label = GENRE_LABELS[slug] ?? slug;
  const base = policy
    ? `【ジャンル方針：${label}】${policy}`
    : `【ジャンル方針：${label}】${GENERIC_GENRE_POLICY}`;
  // フィクションは共通の文体・表現指針を必ず付与する（実用書フォーマット/ですます調を排除）。
  return isFiction(slug) ? `${base}\n【文体・表現】${FICTION_STYLE_DIRECTIVE}` : base;
}

// ---------------------------------------------------------------------------
// 形式ルール (format rules) — 役割プロンプトに実行時注入する「書式の分岐」。
//
// 2026-10-14 の実障害: 役割プロンプトの「品質基準 (常に厳守)」が
//   ・文体は「ですます」調で統一する
//   ・アウトラインの小見出しは `## ` 見出しとして用いる
//   ・各節に具体例/手順/チェックリストを入れる
// を **ジャンルに関係なく** 命じており、末尾に注入される {genre_guidance} の
// フィクション方針 (だ・である調・見出しなし) と正面衝突していた。モデルは先に書かれた
// 「常に厳守」に従うため、小説・ラノベ 20 冊中 17 冊の本文に `##` 見出しが入り、
// 地の文がですます調になった (うち 6 冊は出版済み)。
// さらに editor は「ですます調に揃える」を無条件に実行するため、仮に writer が
// だ・である調で書いても校閲で実用書に戻されていた。
//
// 対策: 書式に関わる規則を役割プロンプト本文から剥がし、ここから注入する。
// ジャンルが増えてもフィクション/ノンフィクションの 2 分岐で済む。
// ---------------------------------------------------------------------------

/** writer に注入する書式ルール (実用書系)。 */
export const NONFICTION_WRITER_FORMAT_RULES = [
  '- 文体：「ですます」調で統一する (後段の編集者が違反を検出し差戻しになる)。',
  '- 小見出し：アウトラインで指定された小見出しは順序通りに `## ` 見出しとして用いる。',
  '- 構成力：各章・各節は「導入→本論 (具体)→小括」の流れを保ち、論理が飛躍しない。',
  '- 具体性：各論点に具体例・手順・数値・チェックリストなど「実践できる中身」を伴わせる。',
  '- 各章の冒頭で、その章を読み終えた後に読者が「できるようになること」「変わること」を',
  '  1 文で明示する (ビフォー→アフターを想起させる)。抽象的な効能ではなく成果を具体的に描く。',
  '- 各節の実践パートには、すぐ試せる最小アクション (今日できる一歩) を 1 つ以上添える。',
  '- 読者がつまずきやすい落とし穴・よくある誤解を先回りで示し、回避策をセットで提示する。',
  '- 二人称で語りかけ、小さな共感を挟んで読者を置いてけぼりにしない。',
  '- 提出前の自己点検 (満たさなければ書き直す): 各節に「具体例・手順・数値・チェックリスト・',
  '  テンプレート」のいずれかが最低 1 つ入っているか / 読者が読後に取れる行動が明確か /',
  '  導入で提示した問い・痛点がその節・章の中で回収されているか / 中身のない一般論で',
  '  字数を埋めていないか。',
].join('\n');

/** writer に注入する書式ルール (小説・物語)。 */
export const FICTION_WRITER_FORMAT_RULES = [
  '- 文体：「だ・である」調 (地の文) で統一する。会話文は自然な口語で書く。ですます調にしない。',
  '- 見出し：**本文に見出しを一切入れない**。`#` や `##` で始まる行を出力してはならない。',
  '  アウトラインの「場面の流れ」は執筆用の内部メモであり、ラベルや見出しとして本文に出さない。',
  '- 箇条書き・手順・チェックリスト・「ポイント」「まとめ」等の実用書フォーマットは使わない。',
  '- 章 (話) は場面の連なりとして滑らかに繋ぐ。場面転換は空行で示し、見出しで区切らない。',
  '- 説明や状況の要約に逃げず、情景・心情・五感・具体的な所作・自然な会話で「見せる」。',
  '  比喩・省略・余韻を使い、常套句や稚拙な直叙を避け、選び抜いた語と細部の描写で立ち上げる。',
  '- 読者への語りかけ (二人称)、ベネフィットの明示、「本章では〜を説明します」のような',
  '  前置きは物語を壊すので書かない。',
  '- 提出前の自己点検: 見出し記号 (`#`) を使っていないか / 地の文にですます調が混ざって',
  '  いないか / 説明で済ませた箇所を描写に直せないか。',
].join('\n');

/** editor に注入する校閲ルール (実用書系)。 */
export const NONFICTION_EDITOR_FORMAT_RULES = [
  '- 文体の統一：「ですます」調に揃える (である調が混在していれば直す)。',
  '- 章内の重複削減と、見出し階層の適正化。',
  '- 読者への配慮：難語の補足、箇条書き化など読みやすさの向上。',
].join('\n');

/** editor に注入する校閲ルール (小説・物語)。 */
export const FICTION_EDITOR_FORMAT_RULES = [
  '- 文体の統一：地の文は「だ・である」調に揃える (ですます調が混在していれば直す)。',
  '  会話文・手紙・引用など「話者の声」として書かれた部分は口語のまま保持する。',
  '- **見出しを入れない / 増やさない**。本文に `#` `##` で始まる行があれば、見出し記号を外して',
  '  地の文に馴染ませる (場面の切れ目は空行で表す)。目次・小見出しの追加は禁止。',
  '- 箇条書き化・手順化・「ポイント」「まとめ」の追加は禁止 (物語を壊す)。',
  '  既に箇条書きになっている描写は地の文に戻す。',
  '- 説明的な要約で情景・心情描写を置き換えない。削るのは重複・冗長・常套句に限る。',
].join('\n');

/** judge に注入する採点の前提 (実用書系)。 */
export const NONFICTION_JUDGE_RUBRIC_NOTE = [
  'この本は**実用書系**である。benefit_clarity は「読者が得られる具体的な価値・メリットの',
  '明確さ」、genre_fit は「実用書として期待される構成 (小見出し・手順・具体例) との適合」',
  'として採点する。',
].join('\n');

/** judge に注入する採点の前提 (小説・物語)。 */
export const FICTION_JUDGE_RUBRIC_NOTE = [
  '**この本は小説・物語である。実用書の基準で採点してはならない。**',
  '',
  '- benefit_clarity は「読者が得られる実用的メリット」ではなく、**物語としての牽引力**',
  '  (続きを読みたくなるか / 人物に感情移入できるか / 情景が立ち上がるか) として採点する。',
  '  ノウハウ・手順・チェックリスト・ベネフィット提示が無いことは減点理由にしない。',
  '- style_consistency は地の文が「だ・である」調で保たれているかで見る。地の文のですます調、',
  '  `#` 見出し、箇条書き、「ポイント」「まとめ」等の実用書フォーマットの混入は**大きく減点**',
  '  する (物語として破綻しているため)。',
  '- genre_fit は当該ジャンルの読者が期待する作風・題材・テンポとの適合として採点する。',
  '- title_alignment はタイトルが約束する物語の方向性と本文が一致しているかで見る。',
].join('\n');

/** `{writer_format_rules}` に注入する文字列。 */
export function writerFormatRules(slug: string | null | undefined): string {
  return isFiction(slug) ? FICTION_WRITER_FORMAT_RULES : NONFICTION_WRITER_FORMAT_RULES;
}

/** `{editor_format_rules}` に注入する文字列。 */
export function editorFormatRules(slug: string | null | undefined): string {
  return isFiction(slug) ? FICTION_EDITOR_FORMAT_RULES : NONFICTION_EDITOR_FORMAT_RULES;
}

/** `{judge_rubric_note}` に注入する文字列。 */
export function judgeRubricNote(slug: string | null | undefined): string {
  return isFiction(slug) ? FICTION_JUDGE_RUBRIC_NOTE : NONFICTION_JUDGE_RUBRIC_NOTE;
}

// ---------------------------------------------------------------------------
// ジャンル自動推定 (classifyGenre)
//
// 2026-10-14 の障害: `theme_candidates.genre` は NOT NULL なので、genre 未指定
// (= 日次自動生成はジャンル横断で企画させるため常に null) の候補は保存時に
// **一律 'practical' が刻印** されていた。結果、ラノベ・小説・競馬本まで実用書として
// 扱われ、writer/editor/judge が実用書ルーブリック (ですます調・章立て・箇条書き) で
// 書き採点してしまっていた (本番実測: practical 70 件中 小説 3・競馬 8 が誤り)。
//
// 一次情報は「Marketer 自身が候補ごとに申告する genre」(ThemeCandidate.genre)。
// 本関数はそれが欠けた場合の決定論的フォールバックで、**確信が持てない限り null を
// 返す** 設計にしている (誤ったジャンルを刻むより未指定で既定に倒す方が害が小さい)。
// ---------------------------------------------------------------------------

/** フィクション判定の強いシグナル。これが無い限りフィクションには分類しない。 */
const FICTION_SIGNALS =
  /小説|物語|ラノベ|ライトノベル|主人公|登場人物|ストーリー|群像劇|本屋大賞|直木賞|芥川賞|文芸|長編|短編|連作|章ではなく話|ヒロイン|異世界|転生|なろう系/;

/** フィクション内の下位ジャンル。上から順に評価し、最初に当たったものを採る。 */
const FICTION_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['light_novel', /ラノベ|ライトノベル|異世界|転生|なろう系|学園|ハーレム|ラブコメ|萌え|勇者|魔王/],
  ['mystery', /ミステリ|推理|探偵|殺人|事件簿|トリック|犯人|密室|謎解き/],
  ['horror', /ホラー|怪談|恐怖|幽霊|呪い|心霊|ゾンビ|怪異/],
  ['sf_fantasy', /ＳＦ|SF小説|ファンタジー|近未来|宇宙|ロボット|魔法|魔術|ディストピア|タイムループ/],
  ['historical_novel', /時代小説|歴史小説|戦国|幕末|江戸|平安|武士|侍|藩/],
  ['romance_fiction', /恋愛小説|ラブストーリー|恋物語|初恋|片想い|失恋/],
  ['novel', /./],
];

/**
 * ノンフィクションの下位ジャンル。上から順に評価し最初に当たったものを採る。
 * 一般語 (practical 等) は入れない — 当たらなければ null を返して既定に委ねる。
 */
const NONFICTION_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['gambling', /競馬|馬券|回収率|オッズ|重賞|単勝|複勝|三連複|三連単|パチンコ|競艇|ボートレース|競輪|期待値で買う|血統/],
  ['money', /新NISA|ＮＩＳＡ|NISA|iDeCo|投資信託|資産運用|株式投資|インデックス投資|配当|老後資金|老後2000万円|老後のお金|マネー術|年金|退職金|資産形成/],
  ['money_saving', /節約|家計|固定費|やりくり|食費|光熱費|ポイ活/],
  ['side_business', /副業|起業|フリーランス|個人事業|物販|せどり|Kindle出版|ネットビジネス|マネタイズ|0→1|ゼロイチ/],
  ['career', /転職|キャリア|面接|履歴書|職務経歴書|昇進|年収アップ|就活/],
  ['marketing', /マーケティング|集客|SNS運用|バズ|インスタ運用|広告運用|ブランディング|LP|コピーライティング/],
  ['ai_tech', /生成AI|ChatGPT|Claude|Gemini|プロンプト|AI活用|LLM|画像生成|AIで(書く|作る|稼ぐ)/],
  ['it_web', /プログラミング|Python|JavaScript|Excel関数|エクセル|Web制作|アプリ開発|データ分析|ノーコード/],
  ['health', /血糖値|自律神経|睡眠|不眠|疲労|疲れが|疲れない|疲れを取|疲れ知らず|健康|血圧|腸活|更年期|肩こり|腰痛|免疫|認知症|長生き|寿命/],
  ['diet', /ダイエット|減量|痩せ|脂肪|筋トレ|体脂肪|糖質制限|トレーニング|フィットネス/],
  ['cooking', /レシピ|作り置き|献立|時短料理|お弁当|つくりかた|料理/],
  ['beauty', /美容|スキンケア|化粧|ヘアケア|ファッション|着こなし|ワードローブ|服選び|肌/],
  ['parenting', /子育て|育児|受験|中学受験|親子|反抗期|幼児|しつけ|教育費/],
  ['pet', /犬|猫|ペット|愛犬|愛猫|しつけ方|ハムスター|小鳥/],
  ['study', /勉強法|資格|試験|独学|暗記|合格|参考書|学び直し/],
  ['language', /英語|英会話|TOEIC|英単語|語学|中国語|韓国語/],
  ['writing', /文章術|ライティング|書き方|文章力|作文|ブログの書き方/],
  ['lifestyle', /断捨離|片づけ|収納|ミニマリスト|暮らし|住まい|丁寧な生活|おひとりさま/],
  ['mental', /メンタル|HSP|繊細さん|不安|ストレス|自己肯定感|感情|うつ|心を整え|マインドフルネス|機嫌/],
  ['communication', /話し方|聞き方|雑談|伝え方|会話|コミュニケーション|言い方|言葉の選び方|説明力|プレゼン/],
  ['relationship', /人間関係|恋愛|夫婦|パートナー|職場の人|距離の置き方|距離のとり方|嫌われ|友人関係/],
  ['habit', /習慣|朝活|朝時間|継続|三日坊主|ルーティン|目標達成|やめる|先延ばし|スマホ脳|スマホ依存|デジタルデトックス|集中力/],
  ['travel', /旅行|観光|モデルコース|ひとり旅|温泉|御朱印|絶景/],
  ['spiritual', /スピリチュアル|占い|風水|引き寄せ|開運|タロット|星座|運気/],
  ['history', /歴史|日本史|世界史|戦国時代|幕末|古代|教養として/],
  ['gambling', /ギャンブル|賭け/],
  ['business', /経営|マネジメント|組織|リーダーシップ|営業|交渉|会議|生産性|仕事術|段取り|タイムマネジメント/],
  ['self_help', /自己啓発|生き方|人生が変わる|幸せ|思考習慣|マインドセット|自分軸/],
  ['hobby', /趣味|ガーデニング|DIY|カメラ|将棋|囲碁|釣り|登山|ゴルフ/],
];

export interface GenreClassifyInput {
  title?: string | null;
  subtitle?: string | null;
  /**
   * フック・想定読者などの長文。**フィクション判定にのみ使う**。
   *
   * 2026-10-14 の実測: フックは「競合の◯◯が売れている」「老後資金の不安が…」等の
   * 市場分析の長文で、ジャンル語を無関係に多数含む。これをノンフィクションの
   * キーワード照合に混ぜると `話し方より「聞き方」で人生が変わる` が health に、
   * `…小さな言葉の選び方` が side_business に落ちるなど精度が落ちた。
   * 一方「本屋大賞」「物語」等のフィクション signal はフックにしか出ないことが多く、
   * かつ実用書のフックには現れないため、フィクション判定にだけ使うのが最適だった。
   */
  context?: string | null;
}

/**
 * タイトル (+副題) から genre slug を推定する。判定できなければ **null**
 * (呼出側が既定値に倒す — 誤ったジャンルを刻むより未指定の方が害が小さい)。
 *
 * フィクションは「強いシグナルが有る」ことを条件にしてから下位ジャンルを決めるため、
 * 実用書を誤って小説に分類しない。
 */
export function classifyGenre(input: GenreClassifyInput): string | null {
  const titleText = [input.title, input.subtitle]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ');
  if (!titleText.trim()) return null;
  const fictionText = input.context ? `${titleText} ${input.context}` : titleText;

  if (FICTION_SIGNALS.test(fictionText)) {
    for (const [slug, re] of FICTION_RULES) {
      if (re.test(fictionText)) return slug;
    }
  }
  for (const [slug, re] of NONFICTION_RULES) {
    if (re.test(titleText)) return slug;
  }
  return null;
}

/**
 * テーマ候補を保存するときの genre 決定ロジック (単一の真実源)。
 * 優先順位:
 *   1. 呼出側が明示したジャンル (UI でユーザーが選択した場合)
 *   2. Marketer が候補ごとに申告したジャンル (カタログに載る slug のみ採用)
 *   3. タイトル/フック等からの決定論的推定
 *   4. 既定 'practical'
 */
export function resolveCandidateGenre(args: {
  explicit?: string | null;
  declared?: string | null;
  title?: string | null;
  subtitle?: string | null;
  context?: string | null;
}): string {
  if (isKnownGenre(args.explicit)) return args.explicit as string;
  if (isKnownGenre(args.declared)) return args.declared as string;
  const classified = classifyGenre({
    title: args.title ?? null,
    subtitle: args.subtitle ?? null,
    context: args.context ?? null,
  });
  if (classified) return classified;
  return 'practical';
}
