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

/** あるジャンルで選べる画風キーの一覧 (リサーチに「選べる札」を見せるため)。 */
export function styleKeysForNiche(niche?: string | null): string[] {
  return GENRE_STYLES[classifyNicheGenre(niche).key].map((st) => st.key);
}

/**
 * 記事 id から画風を決定的に選ぶ。`recentStyleKeys` を渡すと、直近で使った画風を
 * 避けて次の候補にずらす (連続する記事の見た目が揃うのを防ぐ)。
 * `niche` を渡すとそのジャンルの画風セットから選ぶ。
 *
 * 【F-ANP-57b (2026-10-16)】`allowedKeys` で**候補そのものを絞れる**ようにした。
 *
 * なぜ必要か: 週次リサーチが実物のサムネと自分の画風別実績を突き合わせて
 * 「`paper_collage` / `flat_editorial` を軸に。閲覧 0 本が集中する `ink_sketch` /
 * `riso_print` / `film_still_life` / `kawaii_mascot` は線が細くトーンが沈み主役が小さい」と
 * 結論したのに、画風の選択はハッシュのくじ引きだったので**負けと判定された画風が
 * 引かれ続け、その具体的なレシピ (medium/composition/palette) がプロンプトに出ていた**。
 * アカウント指示を「最優先」と書いても、後ろに矛盾する具体値が並べば負ける
 * — F-ANP-56 §5 で踏んだのと同じ構図。
 *
 * ローテーション自体は残す (全部を 1 つの画風に固定すると「サムネが全部一緒」に戻る)。
 * **絞った結果が空なら無視して全候補から選ぶ** — リサーチが知らないキーを書いても
 * アイキャッチ生成は止めない。
 */
export function pickEyecatchStyle(
  seed: string,
  recentStyleKeys: readonly string[] = [],
  niche?: string | null,
  allowedKeys: readonly string[] = [],
): EyecatchStyle {
  const all = GENRE_STYLES[classifyNicheGenre(niche).key];
  const allowed = allowedKeys.length > 0 ? all.filter((st) => allowedKeys.includes(st.key)) : all;
  const styles = allowed.length > 0 ? allowed : all;
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
 *
 * 【2026-10-19】文言 (text) と検出パターン (pattern) を**同じ要素に持つ**。以前は添字で対にしており、
 * 片方に行を挿入するだけで WARN のラベルが全部ずれる (唯一の観測面が嘘をつく) 構造だった。
 * pattern は art direction の**文面**を検査する正規表現。裸の単語 (「グラフ」「アイコン」「浮かぶ」) だと
 * 「雲が浮かぶ青空」のような無害な文まで落とすので、禁止リストの文脈 (指定する言い回し) に絞る。
 * pattern=null は画像内に描く文字の禁止で、art direction の文面検査の対象外。
 */
export const BANNED_MOTIFS: ReadonlyArray<{ text: string; pattern: RegExp | null }> = [
  {
    text: '光るホログラム・半透明の青い UI・空中に浮かぶアイコンや吹き出し',
    pattern: /ホログラム|半透明の青|空中に浮か(ぶ|べ)|吹き出し|(円形|丸い|浮遊|小さな|ベクター)の?アイコン|アイコン[^。]{0,14}(添え|置|並べ|浮か|散ら|配置|入れ)/,
  },
  {
    text: '回路基板状の脳、ネットワーク状の球体、データの粒子やパーティクル',
    pattern: /回路基板|ネットワーク状|パーティクル|データの粒子/,
  },
  {
    text: '腕組みのビジネスパーソン、笑顔のオフィスの人物、ノートPCを見つめるだけの人物',
    pattern: /腕組み|笑顔のオフィス|(ノートPC|PC|パソコン)に向かう/i,
  },
  {
    // 2026-10-19: 副業アカの art_direction がこの組み合わせを指定し、別記事 2 本が同一の絵になった。
    text: 'フラットなベクターの会社員・バストアップ人物イラスト＋周囲に浮遊する円形アイコン (時計・書類・グラフ) の組み合わせ',
    pattern: /会社員|サラリーマン|オフィスワーカー|ビジネスマン|社会人|ビジネスパーソン|バストアップ|フラットな(ベクター|ベクトル)/,
  },
  {
    text: '観葉植物＋白い机＋マグカップの「AI 記事のよくある机」',
    pattern: /観葉植物|マグカップ|コーヒーカップ|机まわり|デスクまわり/,
  },
  {
    text: 'レンズフレア、過度なボケ (ボケの丸)、歯車と電球の比喩',
    pattern: /レンズフレア|ボケの丸|歯車|電球/,
  },
  // ↓ 2026-10-13 に実測した「毎回これになる」逃げ道。記事の内容と無関係に出てくる。
  {
    text: 'クリップボード、チェックリスト、チェックマーク、バインダー、付箋、書類の束',
    pattern: /クリップボード|チェックリスト|チェックマーク|バインダー|付箋|書類/,
  },
  {
    text: '円グラフ・棒グラフ・右肩上がりの折れ線を紙やモニタに描いたもの、ダッシュボード風の図表',
    pattern: /円グラフ|棒グラフ|折れ線|右肩上がり|ダッシュボード|グラフを(描|入れ|添え|置)|(モニタ|画面|紙)[^。]{0,8}グラフ/,
  },
  {
    text: 'ペンと手帳、虫眼鏡、電卓、クリップ、ステープラーを並べただけの絵',
    pattern: /ペンと手帳|虫眼鏡|電卓|ステープラー|ホチキス/,
  },
  {
    text: '机の上に小物を散らした俯瞰の平置き構図 (フラットレイ)',
    pattern: /フラットレイ|平置き/,
  },
  {
    // 「場面の一部として小さく写すのは可」なので、「主題・だけ」相当の文脈語と組んだ文だけ当てる。
    text: 'ノートPC・スマートフォンだけを主題にすること (場面の一部として小さく写すのは可)',
    pattern: /(ノートPC|ノートパソコン|スマートフォン|スマホ)(だけ|のみ|[0-9一二三]台|[0-9一二三]点|[^。]{0,6}(主題|主役))|(ノートPC|ノートパソコン|スマートフォン|スマホ)を[^。]{0,16}(1台|一台|だけ|のみ)|(主題|主役)[^。]{0,10}(ノートPC|ノートパソコン|スマホ|スマートフォン)/i,
  },
  { text: '文字・数字・ロゴ・透かし・UI のキャプション (画像内に一切描かない)', pattern: null },
];

export const EYECATCH_BANNED_MOTIFS: readonly string[] = BANNED_MOTIFS.map((m) => m.text);

const POSITIVE_PLACEMENT = /(添え|置き|置く|配置|並べ|散ら|描き|描く|入れ|据え|載せ|浮か|使い)/;
const AVOIDS = /(描かない|入れない|置かない|添えない|並べない|使わない|避け|しない|不要|禁止|NG)/;

export interface DroppedSentence {
  sentence: string;
  /** 当たった禁止モチーフの文言 (BANNED_MOTIFS[].text)。 */
  motif: string;
}

/**
 * art direction の文面から、禁止モチーフを指定している文を見つける。
 *
 * 【2026-10-19】禁止リストは「プロンプト末尾の注意書き」でしかなく、先頭に「これが最優先」と置かれた
 * art_direction が同じモチーフを**指定**していると、モデルは指定の方に従った (副業アカの別記事 2 本が
 * 会社員イラスト＋ノートPC＋マグカップ＋浮遊アイコンのほぼ同一の絵になった)。
 * 優先順位は 禁止 > アカウント指示 > 既定。実物を見て書かれた指示 (grounded) でも例外にしない。
 *
 * 呼び出し側 (sanitizeAccountDirection) は **1 文でも当たったら指示全体を捨てる**。
 * 被写体の文だけ消して「モチーフは合計4点まで」のような残骸が「最優先」に昇格するのが最悪の結果になるため。
 * kept は診断用 (当たらなかった文)。
 */
export function stripBannedMotifs(text: string): { kept: string; dropped: DroppedSentence[] } {
  const dropped: DroppedSentence[] = [];
  const keptParts: string[] = [];
  const parts = text.match(/[^。！？!?\n]*(?:[。！？!?]+|\n|$)/g) ?? [];
  for (const part of parts) {
    if (part.trim().length === 0) continue;
    // 回避・否定の文 (「〜は描かない」) は検出対象外。art_direction は出力指定で「避けるもの」を書かせるため、
    // 否定の記述で全体破棄 (= 機能している指示が丸ごと消える) になってはいけない。
    // マッチ位置「以降」の否定語だけを見る: 「会社員を置き、文字と重ねない」のような正の指定 + 別件の否定は落とす。
    const hit = BANNED_MOTIFS.find((m) => {
      if (m.pattern === null) return false;
      const found = part.match(m.pattern);
      if (found === null) return false;
      const after = part.slice(found.index ?? 0);
      const avoid = after.match(AVOIDS);
      if (avoid === null) return true;
      // 禁止語と回避語の間に配置動詞があれば、回避語は別の節にかかる (「アイコンを添え、背景には何も置かない」)。
      return POSITIVE_PLACEMENT.test(after.slice(0, avoid.index ?? 0));
    });
    if (hit) dropped.push({ sentence: part.trim(), motif: hit.text });
    else keptParts.push(part);
  }
  return { kept: keptParts.join('').trim(), dropped };
}
