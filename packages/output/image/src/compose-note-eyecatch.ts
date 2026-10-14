/**
 * note アイキャッチの文字合成 (F-ANP-41 → F-ANP-49 → **F-ANP-52 で版面を全面刷新**)。
 *
 * 画像 AI には **文字のない絵** だけを描かせ、その上に Noto Sans JP のアウトラインで
 * キャッチコピーを焼き込む。A2P の表紙と同じ「絵と文字は別レイヤー」方式 (日本語を画像 AI に
 * 描かせると必ず崩れるため)。
 *
 * 【2026-10-13 改訂 — なぜ作り直したか】
 * 運営者から「まだ画像とタイトルが微妙」と指摘があり、本番 8 枚を実見して 2 つの問題を確認した。
 *
 * (1) **絵が死んでいた**。それまでは絵の上にベース色のグラデーション (スクリム) を全面に敷いて
 *     文字を読ませていた。白い絵でも読めるよう不透明度を実測する仕組みまで入れたが、結果として
 *     `aBottom >= 0.94` が常用され、さらに下 60% にぼかしが掛かるため、画面の半分以上が
 *     「濁った茶色/紺のムラ」になっていた。読めるが、汚い。
 *     → グラデーションをやめ、**不透明なベタ色のパネル**に置き換えた。文字はパネルの中にしか
 *       置かないのでコントラストは**構造的に保証**され、絵に掛ける加工はゼロになった。
 *       境界はハードエッジ ⇒「汚れた写真」ではなく「意図したデザイン」に見える。
 *
 * (2) **方向が間違っていた**。運営者から副業系で売れている note のサムネ 3 枚が参考として
 *     提示された。3 枚に共通していたのは次の 5 点で、こちらはすべて逆をやっていた。
 *       - 地が**明るい** (白・クリーム・淡い写真)。こちらは紺/黒/茶の重い面だった。
 *       - **文字が主役**。画面の 1/3〜1/2 を文字が占める。こちらは絵が主役で文字は控えめだった。
 *       - 文字は**太い袋文字** (白フチ) の濃い色。こちらはベタ塗りの白文字だった。
 *       - キーワードに**黄色のマーカー**や**赤い下線**を差す。
 *       - 2/3 枚に**キャラクター/人物**が居る。こちらは「人物は描かない」と禁止していた。
 *     → 配色を明るい 5 種に総入れ替えし、袋文字・マーカー強調・「黄色いボックス」版面を足した。
 *
 * レイアウト: 1280×670 (note 推奨 1.91:1 / Canva の note テンプレと同寸)。
 */
import { classifyNicheGenre, type NoteGenreKey } from '@a2p/contracts/note-genre';
import sharp from 'sharp';

import {
  advanceWidth,
  balanceWrap,
  escapeXml,
  linePathLeft,
  loadFonts,
  splitNumberRuns,
  wrapByWidth,
} from './text-layout.js';

/** note 推奨のアイキャッチサイズ。 */
export const NOTE_EYECATCH_WIDTH = 1280;
export const NOTE_EYECATCH_HEIGHT = 670;

/** 文字サイズの下限 (参考サムネはどれも大きい。小さくするくらいなら行を増やす)。 */
const MIN_COPY_SIZE = 56;
const MIN_SUB_SIZE = 48;
const MAX_COPY_LINES = 2;
/** 文字色と地色に求める最低コントラスト比 (WCAG AA の本文基準)。 */
const SCRIM_TARGET_CONTRAST = 4.5;

/** パネル内側の左右余白。 */
const PAD_X = 64;
/** パネル下端と文字の間 / パネル上端と文字の間。 */
const PAD_BOTTOM = 54;
const PAD_TOP = 34;
/** 左パネルが画面幅に占める割合。 */
const SIDE_PANEL_RATIO = 0.56;
/** 下帯の上端がこれより下がらない = 帯は最低でも画面の 28% を占める。 */
const BOTTOM_PANEL_MAX_TOP = 0.72;
/** パネルの境界に引くアクセント線の太さ。 */
const PANEL_EDGE = 6;
/** 袋文字のフチの太さ (文字サイズに対する比)。参考サムネはどれも太い。 */
const OUTLINE_RATIO = 0.2;
/** 行数を 1 つ減らすために許容する縮小率 (これ以上小さくなるなら行を増やしたほうがよい)。 */
const LINE_DROP_TOLERANCE = 0.92;

export interface NoteEyecatchText {
  /** 主役のキャッチコピー (全角 8〜18 文字程度。読んで意味の通る一言にする)。 */
  copy: string;
  /** 補足の 1 行 (任意・全角 20 文字程度まで)。 */
  sub?: string | null;
  /** 左上の小さなラベル (任意。例: 競馬予想 / 保存版)。 */
  badge?: string | null;
}

/**
 * 配色。運営者提示の参考サムネ (2026-10-13) に合わせ、**すべて明るい地**にしてある。
 * note のタイムラインは白なので、暗い面は「広告/企業っぽい」に見え、明るい面は
 * 「個人の記事」に見える。
 */
export interface NoteEyecatchScheme {
  key: string;
  /** 日本語のパレット名 (画像プロンプトにそのまま渡して絵の色も揃える)。 */
  label: string;
  /** 地 = パネル/帯の色 (明るい)。 */
  base: string;
  /** 文字色 (濃い)。`base` に対して 4.5:1 以上。 */
  main: string;
  /** 淡い差し色 = マーカー強調・黄色ボックス・バッジの地。**上に `main` を載せる**ので明るい色。 */
  accent: string;
  /** 効かせ色 = 罫/下線/パネルの縁。彩度の高い色。 */
  deco: string;
  /** `accent` の面に乗せる文字色。 */
  onAccent: string;
  /** 袋文字のフチの色 (通常は白)。 */
  outline: string;
}

/**
 * 副業・AI 系の配色 (明るい地 × 濃い文字 × 黄マーカー)。
 * 運営者提示の参考サムネ 3 枚がすべてこの系統だった。
 */
export const LIGHT_SCHEMES: readonly NoteEyecatchScheme[] = [
  {
    key: 'cream_charcoal_yellow',
    label: 'クリーム × 炭色 × 黄マーカー (素朴で親しみやすい)',
    base: '#fdf6e4',
    main: '#2f2a24',
    accent: '#ffd84d',
    deco: '#e2574a',
    onAccent: '#2f2a24',
    outline: '#ffffff',
  },
  {
    key: 'white_navy_coral',
    label: '白 × ネイビー × コーラル (清潔で読みやすい)',
    base: '#fbfaf7',
    main: '#1f3356',
    accent: '#ffc9a3',
    deco: '#ef6b4e',
    onAccent: '#1f3356',
    outline: '#ffffff',
  },
  {
    key: 'mint_forest_lemon',
    label: 'ミント × 深緑 × レモン (穏やかで誠実)',
    base: '#f1f7f2',
    main: '#22402f',
    accent: '#f3e7a0',
    deco: '#2f9e6e',
    onAccent: '#22402f',
    outline: '#ffffff',
  },
  {
    key: 'sky_indigo_yellow',
    label: '空色 × インディゴ × 黄 (前向きでポップ)',
    base: '#f0f6fd',
    main: '#1b2d57',
    accent: '#ffde59',
    deco: '#3b7dd8',
    onAccent: '#1b2d57',
    outline: '#ffffff',
  },
  {
    key: 'ivory_brown_amber',
    label: '生成り × 焦茶 × 琥珀 (落ち着いた暮らし系)',
    base: '#fdf3ec',
    main: '#3a2a20',
    accent: '#ffd9a0',
    deco: '#d9732a',
    onAccent: '#3a2a20',
    outline: '#ffffff',
  },
];

/**
 * 競馬・予想系の配色 (黒/濃紺の地 × 箔の文字 × 金の効かせ)。
 * 参考サムネ「地方競馬 期待度S」「北海道スプリントカップ」の系統。
 * **明るい地にすると弱く見える**ので、このジャンルだけは暗い地を使う。
 */
export const DARK_SCHEMES: readonly NoteEyecatchScheme[] = [
  {
    key: 'black_gold',
    label: '黒 × ゴールド (高級感・本命感)',
    base: '#0a0a0e',
    main: '#f8e9bd',
    accent: '#e3bb5c',
    deco: '#c8922a',
    onAccent: '#14100a',
    outline: '#000000',
  },
  {
    key: 'midnight_silver',
    label: '濃紺 × シルバー (夜のレース場)',
    base: '#070d1a',
    main: '#ffffff',
    accent: '#a8cdf0',
    deco: '#3b8fe0',
    onAccent: '#061320',
    outline: '#00060f',
  },
  {
    key: 'crimson_gold',
    label: '深紅 × ゴールド (勝負・一点)',
    base: '#17060a',
    main: '#ffe9a8',
    accent: '#e0b24f',
    deco: '#d8332f',
    onAccent: '#1a1206',
    outline: '#0d0205',
  },
];

/** ジャンル別の配色セット (`@a2p/contracts/note-genre` の分析に対応)。 */
export const GENRE_SCHEMES: Record<NoteGenreKey, readonly NoteEyecatchScheme[]> = {
  gamble: DARK_SCHEMES,
  money: LIGHT_SCHEMES,
  default: LIGHT_SCHEMES,
};

/** 後方互換の別名 (既定 = 明るい配色)。 */
export const NOTE_EYECATCH_SCHEMES: readonly NoteEyecatchScheme[] = LIGHT_SCHEMES;

/** 版面の種類。 */
export type NoteEyecatchLayoutKey = 'bottom_panel' | 'side_panel' | 'highlight_box' | 'full_bleed';

/**
 * 版面 (F-ANP-52)。`subjectHint` は**画像プロンプトにそのまま渡す**ための構図指示で、
 * 「パネルで隠れる領域に主題を置かせない」ことがねらい。版面とプロンプトが食い違うと
 * 主題がパネルの下に埋まって消えるので、必ずこの 1 箇所で対にして持つ。
 */
export interface NoteEyecatchLayout {
  key: NoteEyecatchLayoutKey;
  label: string;
  /** **合成経路**用。「後からパネルで覆う領域に主題を置くな」という構図指示。 */
  subjectHint: string;
  /**
   * **1 パス生成経路**用 (F-ANP-55)。帯やボックスも画像モデルが描くので、
   * 「絵と文字をどう配置した 1 枚にするか」を版面ごとに言葉で渡す。
   */
  textPlacement: string;
}

export const NOTE_EYECATCH_LAYOUTS: readonly NoteEyecatchLayout[] = [
  {
    key: 'bottom_panel',
    label: '下帯 (絵は上 6 割)',
    subjectHint:
      '主題は画面の**上半分の中央**に大きく置く。**下 40% はベタ塗りの帯で完全に覆い隠す**ので、そこには主題も細かい描き込みも置かない (覆われて無駄になる)。',
    textPlacement:
      '**下 40% を 1 色のベタ塗りの帯**にして、その中に文字を左寄せで置く。帯の上辺は水平にきっぱり切る (ぼかさない)。絵は上 60% に収め、主題は上半分の中央に大きく置く。',
  },
  {
    key: 'side_panel',
    label: '左パネル (絵は右 4 割)',
    subjectHint:
      '主題は画面の**右側 4 割の中**に収まるように大きく置く。**左 56% はベタ塗りの面で完全に覆い隠す**ので、そこには主題も細かい描き込みも置かない (覆われて無駄になる)。',
    textPlacement:
      '**左 56% を 1 色のベタ塗りの面**にして、その中に文字を左寄せで置く。境界は垂直にきっぱり切る (ぼかさない)。絵は右 44% に収め、主題はその中に大きく置く。',
  },
  {
    key: 'highlight_box',
    label: '中央カラーボックス (絵は全面・淡く)',
    subjectHint:
      '絵は画面全体に広がる**淡く明るい背景**にする (空・草花・窓辺の光・無地の壁など)。**中央には色のボックスを重ねて文字を載せる**ので、中央は空けて、主題は四隅 (特に右下か左下) に小さめに置く。',
    textPlacement:
      '絵は画面全体に広がる**淡く明るい背景**にし (空・草花・窓辺の光・無地の壁など)、**中央に 1 色のベタ塗りの角丸ボックス**を重ねて、その中に文字を置く。主題は四隅 (特に右下か左下) に小さめに添える。',
  },
  {
    key: 'full_bleed',
    label: '全面 (絵の上に極太の袋文字)',
    subjectHint:
      '絵は画面いっぱいの**劇的な一枚**にする。主題は**右半分**に大きく置き、**左下 1/3 は暗く落ち着いた面**にする (ここに極太の文字を重ねる)。文字と主題が重なると両方が死ぬ。',
    textPlacement:
      '絵は画面いっぱいの**劇的な一枚**にする。パネルや帯は置かず、**絵の上に直接、極太の袋文字**を重ねる。文字は左半分、主題は右半分に置き、**両者を重ねない**。文字が乗る側は暗く (または明るく) 落ち着かせてコントラストを作る。',
  },
];

/**
 * ジャンル別に使う版面。
 * 競馬系の参考サムネは 3 枚とも「絵の上に極太文字」だったので `full_bleed` を主役にし、
 * 副業系の参考サムネは「色ボックス」「明るい地に文字」だったので箱と帯を主役にする。
 */
export const GENRE_LAYOUTS: Record<NoteGenreKey, readonly NoteEyecatchLayoutKey[]> = {
  gamble: ['full_bleed', 'bottom_panel', 'side_panel'],
  money: ['highlight_box', 'bottom_panel', 'side_panel'],
  default: ['bottom_panel', 'highlight_box', 'side_panel'],
};

/** 文字列の安定ハッシュ (FNV-1a)。 */
function hash(value: string): number {
  let h = 2166136261;
  for (const ch of value) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * ニッチから配色を決める。**同じニッチなら常に同じ配色**になるので、アカウントの
 * サムネイルに統一感が出る (「あの人のサムネ」と認識させる)。
 */
export function schemeForNiche(niche: string | null | undefined): NoteEyecatchScheme {
  const set = GENRE_SCHEMES[classifyNicheGenre(niche).key];
  if (!niche) return set[0]!;
  return set[hash(niche) % set.length]!;
}

/**
 * 記事 id から版面を決定的に選ぶ。配色はアカウントで固定 = 統一感、版面は記事ごとに
 * 振る = 単調さの回避、という役割分担にしている。
 */
export function pickNoteEyecatchLayout(
  seed: string,
  niche?: string | null,
): NoteEyecatchLayout {
  const allowed = GENRE_LAYOUTS[classifyNicheGenre(niche).key];
  const key = allowed[hash(seed) % allowed.length]!;
  return NOTE_EYECATCH_LAYOUTS.find((l) => l.key === key)!;
}

/** ニッチのアクセント色 (後方互換。内部的には `schemeForNiche` と同じ)。 */
export function accentForNiche(niche: string | null | undefined): string {
  return schemeForNiche(niche).accent;
}

export interface NoteEyecatchOptions {
  /** 配色。未指定ならクリーム × 炭色 × 黄マーカー。 */
  scheme?: NoteEyecatchScheme;
  /** 版面。未指定なら下帯。 */
  layout?: NoteEyecatchLayout;
  /** マーカー/バッジの差し色 (後方互換)。 */
  accent?: string;
  /** 出力 JPEG 品質 (既定 88)。 */
  quality?: number;
}

/**
 * 文字数で主役の大きさを決める。
 * 参考サムネはどれも**文字が画面の 1/3 以上**を占めるので、以前 (100/80/70) より一回り大きい。
 */
export function copySizeForLength(copy: string): number {
  const n = Array.from(copy.replace(/\s+/g, '')).length;
  if (n <= 6) return 128;
  if (n <= 12) return 104;
  return 84;
}

/** 補足の文字サイズ。主役が大きくなったぶん比率を下げ、主役を食わないようにする。 */
export function subSizeFor(copySize: number): number {
  return Math.min(68, Math.max(MIN_SUB_SIZE, Math.round(copySize * 0.52)));
}

/**
 * 文字数で決めたサイズから始め、指定幅・行数に収まるまで 2px ずつ縮める。
 * `MIN_COPY_SIZE` まで縮めても収まらない場合は行数を増やす (読めない大きさにはしない)。
 */
export function fitCopy(
  font: Parameters<typeof wrapByWidth>[0],
  copy: string,
  maxWidth: number,
  maxLines: number = MAX_COPY_LINES,
): { size: number; lines: string[] } {
  const start = copySizeForLength(copy);
  let best: { size: number; count: number } | null = null;
  for (let size = start; size >= MIN_COPY_SIZE; size -= 2) {
    const lines = wrapByWidth(font, copy, size, maxWidth);
    if (lines.length <= maxLines) {
      best = { size, count: lines.length };
      break;
    }
  }
  if (best === null) {
    return {
      size: MIN_COPY_SIZE,
      lines: wrapByWidth(font, copy, MIN_COPY_SIZE, maxWidth).slice(0, maxLines + 1),
    };
  }

  // ほんの少し (8% まで) 縮めるだけで 1 行減らせるなら、そちらを採る。
  // 実測 (2026-10-13): 「同競馬場経験は加点する」が 104px で 3 行に割れて
  // 「同競馬 / 場経験は / 加点する」と語の途中で折れていた。100px なら 2 行に収まる。
  const floor = Math.max(MIN_COPY_SIZE, Math.round(best.size * LINE_DROP_TOLERANCE));
  for (let size = best.size - 2; size >= floor; size -= 2) {
    const lines = wrapByWidth(font, copy, size, maxWidth);
    if (lines.length < best.count) {
      best = { size, count: lines.length };
      break;
    }
  }

  // 行数が決まったら、2 行目に 1 文字だけ残らないよう割り直す。
  const lines = wrapByWidth(font, copy, best.size, maxWidth);
  return { size: best.size, lines: balanceWrap(font, copy, best.size, maxWidth, lines.length) ?? lines };
}

/**
 * 補足は**必ず 1 行に収める**。幅に入らないときは下限まで縮める。
 * (折り返すと「分類・命名は人が最終 / 確認」のように 2 行目が 2 文字だけ残り、見苦しい。)
 */
export function fitSub(
  font: Parameters<typeof wrapByWidth>[0],
  sub: string,
  maxWidth: number,
  startSize: number,
): { size: number; lines: string[] } {
  for (let size = startSize; size >= MIN_SUB_SIZE; size -= 2) {
    const lines = wrapByWidth(font, sub, size, maxWidth);
    if (lines.length <= 1) return { size, lines };
  }
  return { size: MIN_SUB_SIZE, lines: wrapByWidth(font, sub, MIN_SUB_SIZE, maxWidth).slice(0, 2) };
}

/**
 * 1 行を袋文字で描く。数字には**黄色マーカー**を敷く (参考サムネの「最初の【1万円】」の扱い)。
 *
 * 描く順は「マーカー → 全部のフチ → 全部の塗り」。run ごとに フチ→塗り を繰り返すと、
 * 次の run のフチが前の run の塗りに被って文字が欠けて見える。
 */
function drawCopyLine(
  bold: Parameters<typeof linePathLeft>[0],
  line: string,
  size: number,
  x: number,
  baseline: number,
  scheme: NoteEyecatchScheme,
  accent: string,
  /** マーカーの色。地が `accent` の版面 (黄色ボックス) では別の色を渡す。 */
  markerColor: string = accent,
): string {
  const runs = splitNumberRuns(line);
  const lineWidth = advanceWidth(bold, line, size);
  const markedWidth = runs
    .filter((r) => r.num)
    .reduce((sum, r) => sum + advanceWidth(bold, r.text, size), 0);
  // 行の大半が数字ならマーカーは敷かない (全面が塗り潰されて逆に読みにくい)。
  const marker = markedWidth > 0 && markedWidth <= lineWidth * 0.6;

  const marks: string[] = [];
  const strokes: string[] = [];
  const fills: string[] = [];
  let cx = x;
  for (const r of runs) {
    if (r.text.length === 0) continue;
    const w = advanceWidth(bold, r.text, size);
    if (marker && r.num) {
      marks.push(
        `<rect x="${(cx - size * 0.04).toFixed(1)}" y="${(baseline - size * 0.78).toFixed(1)}" width="${(w + size * 0.08).toFixed(1)}" height="${(size * 0.94).toFixed(1)}" rx="${(size * 0.1).toFixed(1)}" fill="${markerColor}"/>`,
      );
    }
    const d = linePathLeft(bold, r.text, size, cx, baseline);
    // マーカーを敷いた文字は地が `accent` に変わるので、その上で読める色に切り替える
    // (暗い配色で白文字のまま金色マーカーを敷くと読めなくなる)。
    const marked = marker && r.num;
    // マーカーの上に乗る文字は、そのマーカー色に対して読める方を選ぶ。
    const onMarker = contrastRatio(markerColor, scheme.main) >= 4.5 ? scheme.main : scheme.onAccent;
    strokes.push(
      `<path d="${d}" fill="none" stroke="${marked ? markerColor : scheme.outline}" stroke-width="${(size * OUTLINE_RATIO).toFixed(1)}" stroke-linejoin="round"/>`,
    );
    fills.push(`<path d="${d}" fill="${marked ? onMarker : scheme.main}"/>`);
    cx += w;
  }
  return [...marks, ...strokes, ...fills].join('');
}

/** `#rrggbb` を 0〜255 の RGB に。 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim();
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(v.slice(0, 2), 16) || 0,
    g: parseInt(v.slice(2, 4), 16) || 0,
    b: parseInt(v.slice(4, 6), 16) || 0,
  };
}

/** sRGB の相対輝度 (WCAG 2.x)。0 = 黒, 1 = 白。 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const f = (v: number): number => {
    const s = Math.min(255, Math.max(0, v)) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** 2 色のコントラスト比 (WCAG 2.x)。配色パターンを足すときの検証に使う。 */
export function contrastRatio(a: string, b: string): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const la = relativeLuminance(ca.r, ca.g, ca.b);
  const lb = relativeLuminance(cb.r, cb.g, cb.b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 白文字に対するコントラスト比。 */
export function contrastWithWhite(r: number, g: number, b: number): number {
  return 1.05 / (relativeLuminance(r, g, b) + 0.05);
}

/**
 * 白文字が `targetRatio` 以上のコントラストで読めるようにするために必要な、
 * ベース色スクリムの不透明度 (0〜1) を返す。
 *
 * 版面が不透明パネルになった今、キャッチコピーの可読性はこの計算ではなく**構造**で
 * 保証されている。絵の上に文字を置く別用途のために残してある。
 */
export function scrimAlphaForContrast(
  bg: { r: number; g: number; b: number },
  base: { r: number; g: number; b: number },
  targetRatio = SCRIM_TARGET_CONTRAST,
): number {
  for (let step = 0; step <= 50; step += 1) {
    const a = step / 50;
    const r = bg.r * (1 - a) + base.r * a;
    const g = bg.g * (1 - a) + base.g * a;
    const b = bg.b * (1 - a) + base.b * a;
    if (contrastWithWhite(r, g, b) >= targetRatio) return a;
  }
  return 1;
}

interface TextBlock {
  parts: string[];
  height: number;
}

/**
 * キャッチ + 補足のブロックを `topY` を上端として組む。
 * 上から [効かせ色の短い罫] → キャッチ (1〜3 行) → 補足 の順。
 */
function buildTextBlock(args: {
  bold: Parameters<typeof linePathLeft>[0];
  regular: Parameters<typeof linePathLeft>[0];
  copyLines: readonly string[];
  copySize: number;
  sub: string;
  subSize: number;
  subLines: readonly string[];
  x: number;
  topY: number;
  scheme: NoteEyecatchScheme;
  accent: string;
  withRule: boolean;
  /** マーカーの色 (既定 = accent)。 */
  markerColor?: string;
}): TextBlock {
  const parts: string[] = [];
  const copyLH = args.copySize * 1.22;
  let y = args.topY;

  if (args.withRule) {
    parts.push(
      `<rect x="${args.x}" y="${Math.round(y)}" width="104" height="10" rx="5" fill="${args.scheme.deco}"/>`,
    );
    y += 10 + 24;
  }

  args.copyLines.forEach((line, i) => {
    parts.push(
      drawCopyLine(
        args.bold,
        line,
        args.copySize,
        args.x,
        y + args.copySize * 0.88 + i * copyLH,
        args.scheme,
        args.accent,
        args.markerColor ?? args.accent,
      ),
    );
  });
  y += args.copyLines.length * copyLH;

  if (args.sub.length > 0 && args.subLines.length > 0) {
    y += 12;
    for (const line of args.subLines) {
      const d = linePathLeft(args.regular, line, args.subSize, args.x, y + args.subSize * 0.88);
      parts.push(
        `<path d="${d}" fill="none" stroke="${args.scheme.outline}" stroke-width="${(args.subSize * 0.16).toFixed(1)}" stroke-linejoin="round"/>`,
      );
      parts.push(`<path d="${d}" fill="${args.scheme.main}" opacity="0.88"/>`);
      y += args.subSize * 1.35;
    }
  }

  return { parts, height: y - args.topY };
}

/**
 * バッジ (角丸の淡い面 + 濃い文字 + 効かせ色のフチ)。
 * 絵の上に置くことがあるので、フチを付けて明るい写真でも輪郭が消えないようにする。
 */
function buildBadge(
  bold: Parameters<typeof linePathLeft>[0],
  badge: string,
  size: number,
  x: number,
  y: number,
  scheme: NoteEyecatchScheme,
  accent: string,
): string {
  const padX = 22;
  const h = Math.round(size * 1.7);
  const w = advanceWidth(bold, badge, size) + padX * 2;
  return [
    `<rect x="${x}" y="${y}" width="${w.toFixed(0)}" height="${h}" rx="${h / 2}" fill="${accent}" stroke="${scheme.deco}" stroke-width="4"/>`,
    `<path d="${linePathLeft(bold, badge, size, x + padX, y + h / 2 + size * 0.34)}" fill="${scheme.onAccent}"/>`,
  ].join('');
}

/**
 * 背景画像にキャッチコピーを焼き込んで note アイキャッチ (JPEG) を作る。
 *
 * @param bg  画像 AI が生成した「文字なし」の絵
 */
export async function composeNoteEyecatch(
  bg: Buffer,
  text: NoteEyecatchText,
  opts: NoteEyecatchOptions = {},
): Promise<Buffer> {
  const { regular, bold } = loadFonts();
  const W = NOTE_EYECATCH_WIDTH;
  const H = NOTE_EYECATCH_HEIGHT;
  const scheme = opts.scheme ?? NOTE_EYECATCH_SCHEMES[0]!;
  const accent = opts.accent ?? scheme.accent;
  const layout = opts.layout ?? NOTE_EYECATCH_LAYOUTS[0]!;

  const copy = text.copy.trim();
  if (copy.length === 0) throw new Error('composeNoteEyecatch: copy is required');
  const sub = text.sub?.trim() ?? '';
  const badge = text.badge?.trim() ?? '';

  // 絵は一切加工しない (ぼかし・スクリムを掛けない)。見える部分は鮮明なまま残す。
  // 下帯のときは主題が上にあるので上端を基準に切る。
  const resized = await sharp(bg)
    .resize(W, H, { fit: 'cover', position: layout.key === 'bottom_panel' ? 'top' : 'centre' })
    .png()
    .toBuffer();

  const nominalSubSize = subSizeFor(copySizeForLength(copy));
  const parts: string[] = [];

  if (layout.key === 'side_panel') {
    const panelW = Math.round(W * SIDE_PANEL_RATIO);
    const textWidth = panelW - PAD_X - 44;
    const { size: copySize, lines: copyLines } = fitCopy(bold, copy, textWidth, 3);
    // 画面上の文字サイズは 2 種類だけ (主役 + 補足)。バッジも補足と同じサイズを使う。
    const fitted = sub
      ? fitSub(regular, sub, textWidth, nominalSubSize)
      : { size: nominalSubSize, lines: [] };

    parts.push(`<rect x="0" y="0" width="${panelW}" height="${H}" fill="${scheme.base}"/>`);
    parts.push(
      `<rect x="${panelW - PANEL_EDGE}" y="0" width="${PANEL_EDGE}" height="${H}" fill="${scheme.deco}"/>`,
    );

    const badgeH = badge ? Math.round(fitted.size * 1.7) : 0;
    const regionTop = badge ? 44 + badgeH + 36 : PAD_TOP + 20;
    const regionBottom = H - PAD_BOTTOM;
    const common = {
      bold, regular, copyLines, copySize, sub, subSize: fitted.size, subLines: fitted.lines,
      x: PAD_X, scheme, accent, withRule: true,
    };
    const probe = buildTextBlock({ ...common, topY: 0 });
    const topY = Math.max(regionTop, regionTop + (regionBottom - regionTop - probe.height) / 2);
    if (badge) parts.push(buildBadge(bold, badge, fitted.size, PAD_X, 44, scheme, accent));
    parts.push(...buildTextBlock({ ...common, topY }).parts);
  } else if (layout.key === 'full_bleed') {
    // 参考サムネ「北海道スプリントカップ」「勝負軸馬」= 絵の上に極太の袋文字。
    // パネルが無いぶん可読性は袋文字と下側のグラデーションで担保する。地が暗い配色
    // (競馬系) 専用の版面なので、グラデーションは絵の雰囲気を壊さない範囲で薄く掛ける。
    const textWidth = Math.round(W * 0.78);
    const { size: copySize, lines: copyLines } = fitCopy(bold, copy, textWidth, 2);
    const fitted = sub
      ? fitSub(regular, sub, textWidth, nominalSubSize)
      : { size: nominalSubSize, lines: [] };
    const common = {
      bold, regular, copyLines, copySize, sub, subSize: fitted.size, subLines: fitted.lines,
      x: PAD_X, scheme, accent, withRule: true,
    };
    const probe = buildTextBlock({ ...common, topY: 0 });
    const topY = Math.max(PAD_TOP, H - PAD_BOTTOM - probe.height);
    const fadeTop = Math.max(0, Math.round(topY - 120));
    parts.push(
      [
        '<defs><linearGradient id="fb" x1="0" y1="1" x2="0" y2="0">',
        `<stop offset="0" stop-color="${scheme.base}" stop-opacity="0.82"/>`,
        `<stop offset="0.6" stop-color="${scheme.base}" stop-opacity="0.45"/>`,
        `<stop offset="1" stop-color="${scheme.base}" stop-opacity="0"/>`,
        '</linearGradient></defs>',
        `<rect x="0" y="${fadeTop}" width="${W}" height="${H - fadeTop}" fill="url(#fb)"/>`,
      ].join(''),
    );
    if (badge) parts.push(buildBadge(bold, badge, fitted.size, PAD_X, 44, scheme, accent));
    parts.push(...buildTextBlock({ ...common, topY }).parts);
  } else if (layout.key === 'highlight_box') {
    // 参考サムネ「売れるnoteはシンプルだった」= 淡い写真の上に色ボックス + 袋文字。
    const boxPadX = 48;
    const boxPadY = 40;
    const maxBoxW = Math.round(W * 0.86);
    const textWidth = maxBoxW - boxPadX * 2;
    const { size: copySize, lines: copyLines } = fitCopy(bold, copy, textWidth, 2);
    const fitted = sub
      ? fitSub(regular, sub, textWidth, nominalSubSize)
      : { size: nominalSubSize, lines: [] };
    const common = {
      bold, regular, copyLines, copySize, sub, subSize: fitted.size, subLines: fitted.lines,
      // 箱の地が `accent` なので、同じ色のマーカーは見えない。フチ色 (白) で抜く。
      x: 0, scheme, accent, withRule: false, markerColor: scheme.outline,
    };
    const probe = buildTextBlock({ ...common, topY: 0 });

    // ボックスは文字の実寸に合わせる (無駄に大きい箱にしない)。
    const widest = Math.max(
      ...copyLines.map((l) => advanceWidth(bold, l, copySize)),
      ...fitted.lines.map((l) => advanceWidth(regular, l, fitted.size)),
    );
    const boxW = Math.min(maxBoxW, Math.round(widest) + boxPadX * 2);
    const boxH = Math.round(probe.height) + boxPadY * 2;
    const boxX = Math.round((W - boxW) / 2);
    const boxY = Math.max(24, Math.round((H - boxH) / 2));
    parts.push(
      `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="10" fill="${accent}" stroke="${scheme.outline}" stroke-width="8"/>`,
    );
    if (badge) parts.push(buildBadge(bold, badge, fitted.size, PAD_X, 40, scheme, accent));
    parts.push(...buildTextBlock({ ...common, x: boxX + boxPadX, topY: boxY + boxPadY }).parts);
  } else {
    const textWidth = W - PAD_X * 2;
    const { size: copySize, lines: copyLines } = fitCopy(bold, copy, textWidth, 2);
    const fitted = sub
      ? fitSub(regular, sub, textWidth, nominalSubSize)
      : { size: nominalSubSize, lines: [] };
    const common = {
      bold, regular, copyLines, copySize, sub, subSize: fitted.size, subLines: fitted.lines,
      x: PAD_X, scheme, accent, withRule: false,
    };
    const probe = buildTextBlock({ ...common, topY: 0 });

    // 帯は「文字が必ず収まる高さ」を下限にする。文字が増えれば帯が伸びるので、
    // どんなコピーでも文字が絵の上にはみ出すことはない。
    const panelTop = Math.max(
      0,
      Math.min(
        Math.round(H * BOTTOM_PANEL_MAX_TOP),
        Math.round(H - PAD_BOTTOM - probe.height - PAD_TOP),
      ),
    );
    parts.push(`<rect x="0" y="${panelTop}" width="${W}" height="${PANEL_EDGE}" fill="${scheme.deco}"/>`);
    parts.push(
      `<rect x="0" y="${panelTop + PANEL_EDGE}" width="${W}" height="${H - panelTop - PANEL_EDGE}" fill="${scheme.base}"/>`,
    );
    const topY = Math.max(panelTop + PANEL_EDGE + PAD_TOP, H - PAD_BOTTOM - probe.height);
    if (badge) parts.push(buildBadge(bold, badge, fitted.size, PAD_X, 44, scheme, accent));
    parts.push(...buildTextBlock({ ...common, topY }).parts);
  }

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;

  return sharp(resized)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .jpeg({ quality: opts.quality ?? 88, mozjpeg: true })
    .toBuffer();
}

/** 画像の alt に使う説明文 (SEO/アクセシビリティ)。 */
export function defaultEyecatchAlt(title: string, niche: string): string {
  return escapeXml(`${niche}の記事「${title}」のアイキャッチ画像`).slice(0, 120);
}
