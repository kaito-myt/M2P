/**
 * note アイキャッチの文字合成 (F-ANP-41)。
 *
 * 運営者指摘「タイトルとアイキャッチが読者の目を引くようなものではない」への対応。
 * note のタイムラインはサムネイルが小さく、絵だけだと何の記事か伝わらない。そこで
 *   1. 画像 AI には **文字のない絵** だけを描かせる (日本語は必ず崩れるため)
 *   2. その上に Noto Sans JP のアウトラインでキャッチコピーを焼き込む
 * という A2P の表紙と同じ「絵と文字は別レイヤー」方式を note にも適用する。
 *
 * レイアウト: 1280×670 (note 推奨 1.91:1)。下 2/3 に暗いグラデーションを敷き、
 * 左下にキャッチ (最大 3 行・自動フィット)、その下にサブコピー。数字はアクセント色。
 */
import sharp from 'sharp';

import {
  advanceWidth,
  escapeXml,
  fitText,
  linePathLeft,
  loadFonts,
  splitNumberRuns,
  wrapByWidth,
} from './text-layout.js';

/** note 推奨のアイキャッチサイズ。 */
export const NOTE_EYECATCH_WIDTH = 1280;
export const NOTE_EYECATCH_HEIGHT = 670;

export interface NoteEyecatchText {
  /** 主役のキャッチコピー (全角 8〜20 文字程度)。 */
  copy: string;
  /** 補足の 1 行 (任意・全角 24 文字程度まで)。 */
  sub?: string | null;
  /** 左上の小さなラベル (任意。例: 競馬予想 / 保存版)。 */
  badge?: string | null;
}

export interface NoteEyecatchOptions {
  /** 数字・下線のアクセント色。既定はやや暖色のゴールド。 */
  accent?: string;
  /** 出力 JPEG 品質 (既定 88)。 */
  quality?: number;
}

/** ニッチ名からアクセント色を決める (同じニッチなら常に同じ色)。 */
export function accentForNiche(niche: string | null | undefined): string {
  const palette = ['#f2b33d', '#4fb0e0', '#e0678a', '#5cc08a', '#b98ce0', '#e08a4f'];
  if (!niche) return palette[0]!;
  let h = 2166136261;
  for (const ch of niche) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return palette[h % palette.length]!;
}

/**
 * 行数が最小になるサイズの中で最大のものを選ぶ。
 *
 * `fitText` は「maxLines に収まるまで縮める」だけなので、「7つの型で迷う時間を減らす」が
 * 104px で 2 行に割れて 2 行目が「らす」だけ、のような孤立行が出た。少し縮めれば 1 行に
 * 収まるならその方が圧倒的に読みやすいので、行数優先で選び直す。
 */
function fitBalanced(
  font: Parameters<typeof fitText>[0],
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
  maxLines: number,
): { size: number; lines: string[] } {
  const base = fitText(font, text, maxWidth, startSize, minSize, maxLines);
  let best = base;
  for (let size = base.size; size >= minSize; size -= 2) {
    const lines = wrapByWidth(font, text, size, maxWidth);
    if (lines.length < best.lines.length) best = { size, lines };
  }
  return best;
}

/** 1 行を描画 (数字はアクセント色、それ以外は白、暗いハロー付き)。 */
function drawCopyLine(
  bold: Parameters<typeof linePathLeft>[0],
  line: string,
  size: number,
  x: number,
  baseline: number,
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
      `<path d="${d}" fill="none" stroke="#05070b" stroke-width="${(size * 0.12).toFixed(1)}" stroke-linejoin="round" opacity="0.55"/>`,
    );
    fill.push(`<path d="${d}" fill="${r.num ? accent : '#ffffff'}"/>`);
    cx += advanceWidth(bold, r.text, size);
  }
  return [...halo, ...fill].join('');
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
  const accent = opts.accent ?? '#f2b33d';

  const copy = text.copy.trim();
  if (copy.length === 0) throw new Error('composeNoteEyecatch: copy is required');
  const sub = text.sub?.trim() ?? '';
  const badge = text.badge?.trim() ?? '';

  const base = sharp(bg).resize(W, H, { fit: 'cover', position: 'centre' });

  // --- スクリム: 下から上へ暗くする (どんな絵でも白文字が読めるように) ---
  const scrim = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#05070b" stop-opacity="0.90"/>
        <stop offset="0.38" stop-color="#05070b" stop-opacity="0.66"/>
        <stop offset="0.72" stop-color="#05070b" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#05070b" stop-opacity="0.06"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#g)"/>
  </svg>`;

  const parts: string[] = [];
  const textWidth = W - M * 2;

  // --- キャッチ (主役)。下端から積み上げる ---
  const bottomSafe = 54;
  let cursorY = H - bottomSafe;

  if (sub) {
    const subSize = 30;
    const subLines = wrapByWidth(regular, sub, subSize, textWidth).slice(0, 2);
    for (let i = subLines.length - 1; i >= 0; i -= 1) {
      const baseline = cursorY;
      parts.push(
        `<path d="${linePathLeft(regular, subLines[i]!, subSize, M, baseline)}" fill="none" stroke="#05070b" stroke-width="5" stroke-linejoin="round" opacity="0.5"/>`,
      );
      parts.push(
        `<path d="${linePathLeft(regular, subLines[i]!, subSize, M, baseline)}" fill="#e8ecf2"/>`,
      );
      cursorY -= subSize * 1.35;
    }
    cursorY -= 14;
  }

  const { size: copySize, lines: copyLines } = fitBalanced(bold, copy, textWidth, 104, 52, 3);
  const copyLH = copySize * 1.26;
  for (let i = copyLines.length - 1; i >= 0; i -= 1) {
    parts.push(drawCopyLine(bold, copyLines[i]!, copySize, M, cursorY, accent));
    cursorY -= copyLH;
  }

  // --- アクセントの下線 (キャッチの直上)。最上行のアセンダより上に置く
  //     (行数に関係なく文字に重ならないよう、ベースラインから字面の高さ分を引いて算出する)。 ---
  const topBaseline = cursorY + copyLH;
  const ruleY = Math.round(topBaseline - copySize * 1.02 - 16);
  parts.push(`<rect x="${M}" y="${ruleY}" width="96" height="8" rx="4" fill="${accent}"/>`);

  // --- バッジ (左上) ---
  if (badge) {
    const bSize = 26;
    const padX = 20;
    const bH = 50;
    const bW = advanceWidth(bold, badge, bSize) + padX * 2;
    parts.push(
      `<rect x="${M}" y="44" width="${bW.toFixed(0)}" height="${bH}" rx="${bH / 2}" fill="${accent}"/>`,
    );
    parts.push(
      `<path d="${linePathLeft(bold, badge, bSize, M + padX, 44 + bH / 2 + bSize * 0.34)}" fill="#14100a"/>`,
    );
  }

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;

  return base
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
