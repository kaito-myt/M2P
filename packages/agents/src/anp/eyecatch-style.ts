/**
 * note アイキャッチの画風バリエーション (F-ANP-14b → **F-ANP-54 でジャンル別に分割**)。
 * docs/11-anp-design.md §3.2
 *
 * 【2026-09-24】運営者指摘「記事のサムネがすべて一緒」「AI 感が強すぎる」への対応。
 * 原因は単一の汎用プロンプトで、gpt-image が毎回「明るい部屋でノートPCを見る人物＋青く光る脳/回路の
 * ホログラム」という学習上の最頻出構図に収束していたこと。対策は 2 つ:
 *   1. **記事ごとに画風レシピを決定的に振る** (記事 id のハッシュで選択)
 *   2. **AI っぽさの原因になるモチーフを名指しで禁止**
 *
 * 【2026-10-13】運営者指摘「まだ画像とタイトルが微妙」+ 売れている記事のサムネ 6 枚の提示。
 * 画風を分けても**描かれるモノが毎回同じ** (クリップボード / 書類の束 / 円グラフ) だったのと、
 * **ジャンルによって勝ち筋が正反対**だったことが分かった。
 *   - 副業・AI 系 = 明るい地・かわいいキャラ・やわらかい色
 *   - 競馬・予想系 = 黒地・ゴールド・劇的な明暗・煽り
 * 片方の作法をもう片方に当てると必ず外す。そこで画風レシピ自体をジャンルで分け、
 * ジャンルの定義そのものは `@a2p/contracts/note-genre` の 1 箇所に置いた。
 *
 * すべて DB 非依存の純関数。
 */
import { classifyNicheGenre, type NoteGenreKey } from '@a2p/contracts/note-genre';

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
 * 副業・AI 系および汎用の画風レシピ。
 * どれも「写真/イラストのストック AI 画像」に寄らないよう、画材・時代性・構図の癖を具体的に指定する。
 */
export const LIGHT_STYLES: readonly EyecatchStyle[] = [
  {
    key: 'kawaii_mascot',
    medium:
      '丸みのあるかわいいマスコットキャラクターのフラットイラスト。太さの均一な線、やわらかいベタ塗り、頬に淡い赤み。絵本のような親しみやすさ。',
    composition: 'キャラクター 1 体を画面の片側に置き、反対側は大きく余白にする。小物は 1 つまで。',
    palette: '生成りの地 + パステル 2 色。輪郭線は濃いグレー。',
  },
  {
    key: 'flat_editorial',
    medium: '現代の雑誌エディトリアル向けのフラットなベクターイラスト。均一な太さの線、ベタ塗り、紙のような微かな質感。',
    composition: '主題となるモノ (道具・象徴物) を大きく 1 つだけ画面中央よりやや左に配置し、右側を大きく余白にする。',
    palette: '2〜3 色の限定パレット (明るい暖色 + 生成りの背景 + 差し色 1 色)。地は必ず明るく。',
  },
  {
    key: 'paper_collage',
    medium: '切り貼りしたコラージュ (色紙・方眼紙のテクスチャ)。わずかに影が落ち、紙の縁が見える。',
    composition: '主題 1 つを中心からあえて外して置き、余白に手書き風の矢印や丸印を 1 つだけ添える (文字は書かない)。',
    palette: 'クラフト紙のベージュ + 朱色か藍の差し色。全体に明るく。',
  },
  {
    key: 'film_still_life',
    medium: '自然光で撮ったフィルム写真 (35mm、粒状感あり、色かぶりを残す)。CG 的な完璧さを避ける。',
    composition: '窓辺や机の上の静物を斜め上から。人物は写さない。主題 1 つに寄り、背景は大きくぼかす。',
    palette: '午後の窓光。白飛びを恐れず明るく。',
  },
  {
    key: 'riso_print',
    medium: 'リソグラフ印刷風 (2 色刷り、版ずれ、粒状のインク、ムラのある塗り)。',
    composition: '幾何学的に単純化した主題を画面いっぱいに 1 つ。背景は無地かハーフトーンの網点のみ。',
    palette: '蛍光ピンク or 蛍光オレンジと、明るい地の 2 色刷り。',
  },
  {
    key: 'ink_sketch',
    medium: '万年筆の線画に淡い水彩を薄く乗せた手描きスケッチ。線は不均一で、にじみを残す。',
    composition: '横長の紙面に主題を 1 つ。余白を大きく取り、紙の白を活かす。',
    palette: 'インクのセピア + 水彩の淡い青緑 or 黄土。',
  },
  {
    key: 'minimal_object',
    medium: 'スタジオ物撮り写真。やわらかい単一光源で、輪郭のはっきりした影を落とす。',
    composition: '無地の明るい背景に主題のモノを 1 つだけ真横 or 真上から。影も構図の一部として大きく使う。',
    palette: '背景は明るい 1 色 + モノの素材色。',
  },
  {
    key: 'retro_poster',
    medium: '1960〜70 年代の公共ポスター風のシルクスクリーン (ベタ面、輪郭の単純化、わずかな版ずれ)。',
    composition: '主題を大胆にトリミングして画面いっぱいに。遠近を無視した平面構成。',
    palette: 'マスタード / テラコッタ / オフホワイトの中から 3 色。地は明るく。',
  },
];

/**
 * 競馬・予想系の画風レシピ。
 * 運営者提示の参考サムネ (「北海道スプリントカップ」「地方競馬 期待度S」「勝負軸馬」) の系統。
 * **明るい・淡い・かわいい**は読者に「弱い」と受け取られるので、このジャンルでは使わない。
 */
export const DRAMATIC_STYLES: readonly EyecatchStyle[] = [
  {
    key: 'night_track_photo',
    medium:
      '夜のレース場を望遠で捉えた報道写真。ナイター照明の強い逆光、舞う砂と水しぶき、被写体ブレを残した疾走感。',
    composition: '被写体を画面の右半分に大きく、左下は暗く落として沈める。地平線は入れない。',
    palette: '黒を基調に、照明の金色とわずかな青。ハイライトは思い切り飛ばす。',
  },
  {
    key: 'gold_emblem',
    medium: 'ゴールドの箔押しポスター。バロック調の装飾枠、月桂冠や王冠のレリーフ、舞う金の紙吹雪。',
    composition: '中央に紋章のような象徴を 1 つだけ据え、周囲は装飾で囲む。左右対称でよい。',
    palette: '漆黒の地 + 金の箔 + 深紅の差し色。',
  },
  {
    key: 'anime_hype',
    medium: '少年漫画のクライマックス風イラスト。集中線、炎や稲妻のエフェクト、極端なコントラストの彩色。',
    composition: '主役を 1 体だけ斜めに大きく配置し、エフェクトを背景いっぱいに走らせる。',
    palette: '原色の赤・紫・黄を強く。地は暗く。',
  },
  {
    key: 'metal_poster',
    medium: '金属の質感を強調したスポーツポスター。研磨された鋼、鋭い反射、ハードな影、細かい傷の質感。',
    composition: '主題を斜めに切り取って画面いっぱいに。奥は黒に沈める。',
    palette: '黒 + 銀 + 一点だけの赤。',
  },
];

/** 後方互換の別名 (既定 = 明るい系)。 */
export const EYECATCH_STYLES: readonly EyecatchStyle[] = LIGHT_STYLES;

/** ジャンル別の画風セット (`@a2p/contracts/note-genre` の分析に対応)。 */
export const GENRE_STYLES: Record<NoteGenreKey, readonly EyecatchStyle[]> = {
  gamble: DRAMATIC_STYLES,
  money: LIGHT_STYLES,
  default: LIGHT_STYLES,
};

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
 * 記事 id から画風を決定的に選ぶ。`recentStyleKeys` を渡すと、直近で使った画風を
 * 避けて次の候補にずらす (連続する記事の見た目が揃うのを防ぐ)。
 * `niche` を渡すとそのジャンルの画風セットから選ぶ。
 */
export function pickEyecatchStyle(
  seed: string,
  recentStyleKeys: readonly string[] = [],
  niche?: string | null,
): EyecatchStyle {
  const styles = GENRE_STYLES[classifyNicheGenre(niche).key];
  const total = styles.length;
  const start = hashString(seed) % total;
  for (let i = 0; i < total; i++) {
    const candidate = styles[(start + i) % total]!;
    if (!recentStyleKeys.includes(candidate.key)) return candidate;
  }
  return styles[start]!;
}

/**
 * AI っぽさ・使い回し感の主因になるモチーフの禁止リスト (プロンプト末尾に必ず入れる)。
 *
 * 【2026-10-13 追記】本番のアイキャッチ 8 枚を実見したところ、画風レシピを分けても
 * **描かれるモノが毎回同じ**になっていた。競馬の記事にも AI 副業の記事にも、
 * クリップボード / チェックリスト / 書類の束 / 円グラフ + 棒グラフ / ペンが出る。
 * 画像モデルは「記事の内容」を具体物に翻訳できないと、この「それっぽい事務用品」に逃げる。
 * 逃げ道を名指しで塞ぐ (= 記事固有のモノを描くしかなくする) のがこのリストの役目。
 */
export const EYECATCH_BANNED_MOTIFS: readonly string[] = [
  '光るホログラム・半透明の青い UI・空中に浮かぶアイコンや吹き出し',
  '回路基板状の脳、ネットワーク状の球体、データの粒子やパーティクル',
  '腕組みのビジネスパーソン、笑顔のオフィスの人物、ノートPCを見つめるだけの人物',
  '観葉植物＋白い机＋マグカップの「AI 記事のよくある机」',
  'レンズフレア、過度なボケ (ボケの丸)、歯車と電球の比喩',
  // ↓ 2026-10-13 に実測した「毎回これになる」逃げ道。記事の内容と無関係に出てくる。
  'クリップボード、チェックリスト、チェックマーク、バインダー、付箋、書類の束',
  '円グラフ・棒グラフ・右肩上がりの折れ線を紙やモニタに描いたもの、ダッシュボード風の図表',
  'ペンと手帳、虫眼鏡、電卓、クリップ、ステープラーを並べただけの絵',
  '机の上に小物を散らした俯瞰の平置き構図 (フラットレイ)',
  'ノートPC・スマートフォンだけを主題にすること (場面の一部として小さく写すのは可)',
  '文字・数字・ロゴ・透かし・UI のキャプション (画像内に一切描かない)',
];
