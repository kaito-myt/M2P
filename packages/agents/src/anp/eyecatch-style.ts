/**
 * note アイキャッチの画風バリエーション (F-ANP-14b, docs/11-anp-design.md §3.2)。
 *
 * 運営者指摘 (2026-09-24)「記事のサムネがすべて一緒」「サムネが AI 感が強すぎる」への対応。
 * 原因は単一の汎用プロンプトで、gpt-image が毎回「明るい部屋でノートPCを見る人物＋青く光る脳/回路の
 * ホログラム」という学習上の最頻出構図に収束していたこと。対策は 2 つ:
 *   1. **記事ごとに画風レシピを決定的に振る** (記事 id のハッシュで選択) — 連続する記事が別の絵になる。
 *   2. **AI っぽさの原因になるモチーフを名指しで禁止** (光るホログラム、回路脳、浮遊 UI アイコン、
 *      ノートPCを見つめる人物、レンズフレア、青いグラデ 等)。
 *
 * すべて DB 非依存の純関数。ユニットテストで「同じ記事は同じ、隣接記事は別」を保証する。
 */

export interface EyecatchStyle {
  /** 表示用のキー (ログ/テスト用)。 */
  key: string;
  /** 画風・画材の指定。 */
  medium: string;
  /** 構図の指定。 */
  composition: string;
  /** 配色の指定。 */
  palette: string;
}

/**
 * 画風レシピ。どれも「写真/イラストのストック AI 画像」に寄らないよう、画材・時代性・
 * 構図の癖を具体的に指定する。人物は原則出さない (AI 顔の不気味さと汎用感の主因)。
 */
export const EYECATCH_STYLES: readonly EyecatchStyle[] = [
  {
    key: 'flat_editorial',
    medium: '現代の雑誌エディトリアル向けのフラットなベクターイラスト。均一な太さの線、ベタ塗り、紙のような微かな質感。',
    composition: '主題となるモノ (道具・書類・象徴物) を大きく 1 つだけ画面中央よりやや左に配置し、右側を大きく余白にする。',
    palette: '2〜3 色の限定パレット (くすんだ暖色 + 生成りの背景 + 差し色 1 色)。彩度は低め。',
  },
  {
    key: 'paper_collage',
    medium: '切り貼りしたコラージュ (色紙・新聞・方眼紙のテクスチャ)。わずかに影が落ち、紙の縁が見える。',
    composition: '3〜4 個の要素を斜めに重ねる。中心をあえて外し、余白に手書き風の矢印や丸印を 1 つだけ添える (文字は書かない)。',
    palette: 'クラフト紙のベージュ + インクの黒 + 朱色か藍の差し色。',
  },
  {
    key: 'film_still_life',
    medium: '自然光で撮ったフィルム写真 (35mm、粒状感あり、色かぶりを残す)。CG 的な完璧さを避ける。',
    composition: '机やテーブルの上の静物を斜め上から。人物は写さない。手前にわざと少しボケを作り、奥に生活感のある小物を置く。',
    palette: '午後の窓光。木の色と布の色が中心で、白飛びさせない。',
  },
  {
    key: 'riso_print',
    medium: 'リソグラフ印刷風 (2 色刷り、版ずれ、粒状のインク、ムラのある塗り)。',
    composition: '幾何学的に単純化した主題を画面いっぱいに 1 つ。背景は無地かハーフトーンの網点のみ。',
    palette: '蛍光ピンク or 蛍光オレンジと、濃紺 or 深緑の 2 色刷り。',
  },
  {
    key: 'ink_sketch',
    medium: '万年筆の線画に淡い水彩を薄く乗せた手描きスケッチ。線は不均一で、にじみを残す。',
    composition: '横長の紙面に、関係する道具や風景を左から右へ流れるように 2〜3 点。余白を大きく取る。',
    palette: 'インクのセピア + 水彩の淡い青緑 or 黄土。紙の白を活かす。',
  },
  {
    key: 'minimal_object',
    medium: 'スタジオ物撮り写真。硬めの単一光源で、はっきりした影を意図的に落とす。',
    composition: '無地の背景に主題のモノを 1 つだけ真横 or 真上から。影も構図の一部として大きく使う。',
    palette: '背景は 1 色 (くすんだ色) + モノの素材色。反射や光沢は控えめ。',
  },
  {
    key: 'diagram_chalk',
    medium: '黒板やクラフト紙に描いたチョーク/色鉛筆の図解風 (文字は書かない、記号と矢印だけ)。',
    composition: '単純な図形と矢印で関係性を表す図解。左右対称を避け、余白を残す。',
    palette: '黒板の深緑 or 紺 + 白チョーク + 差し色 1 色。',
  },
  {
    key: 'retro_poster',
    medium: '1960〜70 年代の公共ポスター風のシルクスクリーン (ベタ面、輪郭の単純化、わずかな版ずれ)。',
    composition: '主題を大胆にトリミングして画面いっぱいに。遠近を無視した平面構成。',
    palette: 'マスタード / テラコッタ / オリーブ / オフホワイトの中から 3 色。',
  },
];

/** 文字列の安定ハッシュ (FNV-1a)。同じ id は常に同じ画風になる。 */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 記事 id (＋アカウント id) から画風を決定的に選ぶ。`recentStyleKeys` を渡すと、直近で使った画風を
 * 避けて次の候補にずらす (連続する記事の見た目が揃うのを防ぐ)。
 */
export function pickEyecatchStyle(seed: string, recentStyleKeys: readonly string[] = []): EyecatchStyle {
  const total = EYECATCH_STYLES.length;
  const start = hashString(seed) % total;
  for (let i = 0; i < total; i++) {
    const candidate = EYECATCH_STYLES[(start + i) % total]!;
    if (!recentStyleKeys.includes(candidate.key)) return candidate;
  }
  return EYECATCH_STYLES[start]!;
}

/** AI っぽさの主因になるモチーフの禁止リスト (プロンプト末尾に必ず入れる)。 */
export const EYECATCH_BANNED_MOTIFS: readonly string[] = [
  '光るホログラム・半透明の青い UI・空中に浮かぶアイコンや吹き出し',
  '回路基板状の脳、ネットワーク状の球体、データの粒子やパーティクル',
  'ノートPCを見つめる人物、腕組みのビジネスパーソン、笑顔のオフィスの人物',
  '観葉植物＋白い机＋マグカップの「AI 記事のよくある机」',
  '青〜水色のグラデーション背景、レンズフレア、過度なボケ (ボケの丸)',
  'ロボット、アンドロイド、人型 AI、歯車と電球の比喩',
  '文字・数字・ロゴ・透かし・UI のキャプション (画像内に一切描かない)',
];
