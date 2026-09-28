/**
 * note アイキャッチの文字合成 (F-ANP-41 → F-ANP-49 で作法を全面見直し)。
 *
 * 運営者指摘「タイトルとアイキャッチが読者の目を引くようなものではない」への対応。
 * note のタイムラインはサムネイルが小さく、絵だけだと何の記事か伝わらない。そこで
 *   1. 画像 AI には **文字のない絵** だけを描かせる (日本語は必ず崩れるため)
 *   2. その上に Noto Sans JP のアウトラインでキャッチコピーを焼き込む
 * という A2P の表紙と同じ「絵と文字は別レイヤー」方式を note にも適用する。
 *
 * 【2026-09-28 改訂】運営者指定の参考記事
 * (https://note.com/dandy_clam132/n/nd2fbe6c407eb 「note サムネイル作成ガイド」) の作法を
 * そのままレイアウト規則として実装した。要点:
 *   - 閲覧判断は 3 秒。要素を厳選し、文字は短く太く、背景と明暗差をつける。
 *   - 文字サイズは **2 種類だけ** (主役 + 補足)。3 種類以上混ぜない / 全部同じにしない。
 *     主役は文字数で決める: 6 字以内=100 / 7〜12 字=80 / 13 字以上=70。**40 以下は禁止**
 *     (スマホで読めない)。補足は主役の 6 割。
 *   - 配色は 3 色以内 (ベース 70% / メイン 25% / アクセント 5%)。推奨 5 パターンから
 *     ニッチごとに固定で選び、**同じアカウントは常に同じ配色** = 統一感で「あの人の
 *     サムネ」と認識させる (絵柄は記事ごとに変える = F-ANP-14b と役割分担)。
 *   - 文字を重ねる部分は **暗くする + ぼかす** ことで文字を浮かせる。
 *
 * レイアウト: 1280×670 (note 推奨 1.91:1 / Canva の note テンプレと同寸なので、上記の
 * 文字サイズをそのまま px として使える)。
 */
import sharp from 'sharp';

import {
  advanceWidth,
  escapeXml,
  linePathLeft,
  loadFonts,
  splitNumberRuns,
  wrapByWidth,
} from './text-layout.js';

/** note 推奨のアイキャッチサイズ。 */
export const NOTE_EYECATCH_WIDTH = 1280;
export const NOTE_EYECATCH_HEIGHT = 670;

/** 文字サイズの下限 (参考記事: 40 以下はスマホで読めない)。 */
const MIN_COPY_SIZE = 48;
const MAX_COPY_LINES = 2;

export interface NoteEyecatchText {
  /** 主役のキャッチコピー (全角 6〜16 文字程度。短いほど強い)。 */
  copy: string;
  /** 補足の 1 行 (任意・全角 20 文字程度まで)。 */
  sub?: string | null;
  /** 左上の小さなラベル (任意。例: 競馬予想 / 保存版)。 */
  badge?: string | null;
}

/**
 * 3 色構成 (参考記事の推奨パターン)。`base` は地 (70%)、`main` は文字 (25%)、
 * `accent` は数字・下線・バッジ (5%)。
 */
export interface NoteEyecatchScheme {
  key: string;
  /** 日本語のパレット名 (画像プロンプトにそのまま渡して絵の色も揃える)。 */
  label: string;
  /** ベース = スクリム/地の色。 */
  base: string;
  /** メイン = 文字色。 */
  main: string;
  /** アクセント = 数字・下線・バッジ。 */
  accent: string;
  /** アクセント面の上に乗せる文字色 (バッジ用)。 */
  onAccent: string;
}

/** 参考記事の「推奨配色パターン」5 種。 */
export const NOTE_EYECATCH_SCHEMES: readonly NoteEyecatchScheme[] = [
  {
    key: 'blue_white_orange',
    label: '青 × 白 × オレンジ (信頼感 + ポップ)',
    base: '#0a2545',
    main: '#ffffff',
    accent: '#ff8f2d',
    onAccent: '#1b1205',
  },
  {
    key: 'black_gold_white',
    label: '黒 × ゴールド × 白 (高級感 + シック)',
    base: '#08090c',
    main: '#ffffff',
    accent: '#e3b658',
    onAccent: '#14100a',
  },
  {
    key: 'blue_white_gray',
    label: 'ブルー × ホワイト × グレー (爽やか)',
    base: '#123449',
    main: '#ffffff',
    accent: '#8fb8d4',
    onAccent: '#0d2231',
  },
  {
    key: 'orange_beige_brown',
    label: 'オレンジ × ベージュ × ブラウン (温かみ)',
    base: '#2e1d12',
    main: '#f7edde',
    accent: '#f0902a',
    onAccent: '#241505',
  },
  {
    key: 'navy_gold_white',
    label: 'ネイビー × ゴールド × ホワイト (洗練)',
    base: '#0e1a33',
    main: '#ffffff',
    accent: '#d7b45c',
    onAccent: '#141007',
  },
];

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
 * サムネイルに統一感が出る (参考記事の「差別化戦略: 同じデザインルールを続ける」)。
 */
export function schemeForNiche(niche: string | null | undefined): NoteEyecatchScheme {
  if (!niche) return NOTE_EYECATCH_SCHEMES[0]!;
  return NOTE_EYECATCH_SCHEMES[hash(niche) % NOTE_EYECATCH_SCHEMES.length]!;
}

/** ニッチのアクセント色 (後方互換。内部的には `schemeForNiche` と同じ)。 */
export function accentForNiche(niche: string | null | undefined): string {
  return schemeForNiche(niche).accent;
}

export interface NoteEyecatchOptions {
  /** 配色。未指定なら青×白×オレンジ。`accent` だけ渡された場合はそれを優先する。 */
  scheme?: NoteEyecatchScheme;
  /** 数字・下線のアクセント色 (後方互換)。 */
  accent?: string;
  /** 出力 JPEG 品質 (既定 88)。 */
  quality?: number;
}

/**
 * 参考記事の「長さによる文字サイズ」。6 字以内=100 / 7〜12 字=80 / 13 字以上=70。
 * 絵文字・サロゲートペアを 1 文字と数えるため codepoint 数で判定する。
 */
export function copySizeForLength(copy: string): number {
  const n = Array.from(copy.replace(/\s+/g, '')).length;
  if (n <= 6) return 100;
  if (n <= 12) return 80;
  return 70;
}

/** 補足の文字サイズ (主役の 6 割。ただし 44 を下回らない = 参考記事の「40 以下は禁止」)。 */
export function subSizeFor(copySize: number): number {
  return Math.min(60, Math.max(44, Math.round(copySize * 0.6)));
}

/**
 * 文字数で決めたサイズから始め、指定幅・行数に収まるまで 2px ずつ縮める。
 * `MIN_COPY_SIZE` まで縮めても収まらない場合は行数を増やす (読めない大きさにはしない)。
 */
export function fitCopy(
  font: Parameters<typeof wrapByWidth>[0],
  copy: string,
  maxWidth: number,
): { size: number; lines: string[] } {
  const start = copySizeForLength(copy);
  for (let size = start; size >= MIN_COPY_SIZE; size -= 2) {
    const lines = wrapByWidth(font, copy, size, maxWidth);
    if (lines.length <= MAX_COPY_LINES) return { size, lines };
  }
  return { size: MIN_COPY_SIZE, lines: wrapByWidth(font, copy, MIN_COPY_SIZE, maxWidth).slice(0, 3) };
}

/** 1 行を描画 (数字はアクセント色、それ以外はメイン色、暗いハロー付き)。 */
function drawCopyLine(
  bold: Parameters<typeof linePathLeft>[0],
  line: string,
  size: number,
  x: number,
  baseline: number,
  scheme: NoteEyecatchScheme,
  accent: string,
): string {
  const runs = splitNumberRuns(line);
  let cx = x;
  const halo: string[] = [];
  const fill: string[] = [];
  for (const r of runs) {
    if (r.text.length === 0) continue;
    const d = linePathLeft(bold, r.text, size, cx, baseline);
    halo.push(
      `<path d="${d}" fill="none" stroke="#04060a" stroke-width="${(size * 0.14).toFixed(1)}" stroke-linejoin="round" opacity="0.6"/>`,
    );
    fill.push(`<path d="${d}" fill="${r.num ? accent : scheme.main}"/>`);
    cx += advanceWidth(bold, r.text, size);
  }
  return [...halo, ...fill].join('');
}

/**
 * 文字を載せる帯を「暗く + ぼかす」(参考記事: 画像を暗くするかぼかしを入れて文字を浮かす)。
 * 下端に向かって効きが強くなるマスクを掛けるので、絵の主題 (上 2/3) は鮮明なまま残る。
 */
async function blurTextArea(baseBuf: Buffer, W: number, H: number): Promise<Buffer> {
  const bandTop = Math.round(H * 0.4);
  const bandH = H - bandTop;
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${bandH}">
    <defs>
      <linearGradient id="m" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#ffffff" stop-opacity="1"/>
        <stop offset="0.55" stop-color="#ffffff" stop-opacity="0.85"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${bandH}" fill="url(#m)"/>
  </svg>`;
  const band = await sharp(baseBuf)
    .extract({ left: 0, top: bandTop, width: W, height: bandH })
    .blur(9)
    .ensureAlpha()
    .composite([{ input: Buffer.from(mask), blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(baseBuf)
    .composite([{ input: band, top: bandTop, left: 0 }])
    .png()
    .toBuffer();
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
  const M = 64;
  const scheme = opts.scheme ?? NOTE_EYECATCH_SCHEMES[0]!;
  const accent = opts.accent ?? scheme.accent;

  const copy = text.copy.trim();
  if (copy.length === 0) throw new Error('composeNoteEyecatch: copy is required');
  const sub = text.sub?.trim() ?? '';
  const badge = text.badge?.trim() ?? '';

  const resized = await sharp(bg).resize(W, H, { fit: 'cover', position: 'centre' }).png().toBuffer();
  const softened = await blurTextArea(resized, W, H).catch(() => resized);

  // --- スクリム: ベースカラーを下から重ねる (どんな絵でも文字が読めるように) ---
  const scrim = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="${scheme.base}" stop-opacity="0.94"/>
        <stop offset="0.40" stop-color="${scheme.base}" stop-opacity="0.78"/>
        <stop offset="0.72" stop-color="${scheme.base}" stop-opacity="0.30"/>
        <stop offset="1" stop-color="${scheme.base}" stop-opacity="0.06"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#g)"/>
  </svg>`;

  const parts: string[] = [];
  const textWidth = W - M * 2;
  const subSize = subSizeFor(copySizeForLength(copy));

  // --- 下から積み上げる: 補足 → キャッチ ---
  const bottomSafe = 56;
  let cursorY = H - bottomSafe;

  if (sub) {
    // 補足は 1 行に収める (参考記事: 文字が長すぎると敬遠される)。
    const subLines = wrapByWidth(regular, sub, subSize, textWidth).slice(0, 1);
    for (const line of subLines) {
      const d = linePathLeft(regular, line, subSize, M, cursorY);
      parts.push(
        `<path d="${d}" fill="none" stroke="#04060a" stroke-width="${(subSize * 0.16).toFixed(1)}" stroke-linejoin="round" opacity="0.55"/>`,
      );
      parts.push(`<path d="${d}" fill="${scheme.main}" opacity="0.94"/>`);
      cursorY -= subSize * 1.35;
    }
    cursorY -= 12;
  }

  const { size: copySize, lines: copyLines } = fitCopy(bold, copy, textWidth);
  const copyLH = copySize * 1.24;
  for (let i = copyLines.length - 1; i >= 0; i -= 1) {
    parts.push(drawCopyLine(bold, copyLines[i]!, copySize, M, cursorY, scheme, accent));
    cursorY -= copyLH;
  }

  // --- アクセントの下線 (キャッチの直上)。最上行のアセンダより上に置く
  //     (行数に関係なく文字に重ならないよう、ベースラインから字面の高さ分を引いて算出する)。 ---
  const topBaseline = cursorY + copyLH;
  const ruleY = Math.round(topBaseline - copySize * 1.02 - 18);
  parts.push(`<rect x="${M}" y="${ruleY}" width="104" height="9" rx="4" fill="${accent}"/>`);

  // --- バッジ (左上)。補足と同じ文字サイズ = 画面上の文字サイズは 2 種類だけ ---
  if (badge) {
    const padX = 22;
    const bH = Math.round(subSize * 1.7);
    const bW = advanceWidth(bold, badge, subSize) + padX * 2;
    parts.push(
      `<rect x="${M}" y="44" width="${bW.toFixed(0)}" height="${bH}" rx="${bH / 2}" fill="${accent}"/>`,
    );
    parts.push(
      `<path d="${linePathLeft(bold, badge, subSize, M + padX, 44 + bH / 2 + subSize * 0.34)}" fill="${scheme.onAccent}"/>`,
    );
  }

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;

  return sharp(softened)
    .composite([
      { input: Buffer.from(scrim), top: 0, left: 0 },
      { input: Buffer.from(overlay), top: 0, left: 0 },
    ])
    .jpeg({ quality: opts.quality ?? 88, mozjpeg: true })
    .toBuffer();
}

/** 画像の alt に使う説明文 (SEO/アクセシビリティ)。 */
export function defaultEyecatchAlt(title: string, niche: string): string {
  return escapeXml(`${niche}の記事「${title}」のアイキャッチ画像`).slice(0, 120);
}
