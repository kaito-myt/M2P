/**
 * 日本語テキストを SVG グリフアウトラインとして敷くための共通ヘルパ。
 *
 * 画像生成 AI に日本語を描かせると崩れるため、A2P/ANP では「絵は AI・文字は実フォント」
 * を徹底する (compose-cover.ts 冒頭の設計思想)。本ファイルはその文字側の土台で、
 * compose-note-eyecatch.ts から使う (compose-promo.ts は既存実装を維持)。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import opentype from 'opentype.js';

const REGULAR_FONT_PATH = fileURLToPath(
  new URL('../assets/fonts/NotoSansJP-Regular.ttf', import.meta.url),
);
const BOLD_FONT_PATH = fileURLToPath(
  new URL('../assets/fonts/NotoSansJP-Bold.ttf', import.meta.url),
);

let regularFont: opentype.Font | null = null;
let boldFont: opentype.Font | null = null;

function loadFont(path: string): opentype.Font {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return opentype.parse(ab);
}

export function loadFonts(): { regular: opentype.Font; bold: opentype.Font } {
  if (!regularFont) regularFont = loadFont(REGULAR_FONT_PATH);
  if (!boldFont) boldFont = loadFont(BOLD_FONT_PATH);
  return { regular: regularFont, bold: boldFont };
}

/** 日本語の禁則: 行頭に置かない約物。 */
const NO_LINE_START = '、。，．・）」』】〉》〕｝］,.!?！？ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ々';

/** 幅で折り返す (日本語は文字単位・簡易禁則つき)。 */
export function wrapByWidth(
  font: opentype.Font,
  text: string,
  fontSize: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of Array.from(text)) {
    if (ch === '\n') {
      lines.push(cur);
      cur = '';
      continue;
    }
    const test = cur + ch;
    if (cur.length > 0 && font.getAdvanceWidth(test, fontSize) > maxWidth) {
      // 行頭に来てはいけない文字なら、前の行に押し込む (ぶら下げ)。
      if (NO_LINE_START.includes(ch)) {
        lines.push(test);
        cur = '';
        continue;
      }
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

/** maxLines 以内に収まる最大フォントサイズを探す。 */
export function fitText(
  font: opentype.Font,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
  maxLines: number,
): { size: number; lines: string[] } {
  let size = startSize;
  let lines = wrapByWidth(font, text, size, maxWidth);
  while (lines.length > maxLines && size > minSize) {
    size -= Math.max(2, Math.round(size * 0.06));
    lines = wrapByWidth(font, text, size, maxWidth);
  }
  return { size, lines };
}

/**
 * 左揃え 1 行分のグリフパス。
 *
 * **1 文字ずつ整数 x で生成する**。opentype.js に文字列をまとめて渡すと、累積 advance が
 * 小数になったところで `MNaN 596.11` のような **NaN 座標**を吐くことがあり、librsvg は
 * それ以降の描画を黙って捨てる (2026-09-25 実測: 「10点出品・7日間の反応を記録」が
 * サムネ上で「10⊥」だけになっていた)。文字単位＋整数座標にすると NaN は出ない。
 */
export function linePathLeft(
  font: opentype.Font,
  text: string,
  size: number,
  x: number,
  baseline: number,
): string {
  const s = Math.round(size);
  const y = Math.round(baseline);
  let cx = x;
  const parts: string[] = [];
  for (const ch of Array.from(text)) {
    const d = font.getPath(ch, Math.round(cx), y, s).toPathData(2);
    // 念のため: それでも NaN が出た文字は飛ばす (1 文字欠けても以降は描画される)。
    if (!d.includes('NaN')) parts.push(d);
    cx += font.getAdvanceWidth(ch, s);
  }
  return parts.join(' ');
}

const NUM_RE = /([0-9０-９]+(?:[.,．][0-9０-９]+)?[万億円%％割倍位個歳日年月週時間分秒人本冊点]*)/;

/** 数字＋単位の連なりを検出して強調用に分割する。 */
export function splitNumberRuns(line: string): Array<{ text: string; num: boolean }> {
  const out: Array<{ text: string; num: boolean }> = [];
  let rest = line;
  while (rest.length > 0) {
    const m = NUM_RE.exec(rest);
    const g = m?.[1];
    if (!m || m.index === undefined || g === undefined) {
      out.push({ text: rest, num: false });
      break;
    }
    if (m.index > 0) out.push({ text: rest.slice(0, m.index), num: false });
    out.push({ text: g, num: true });
    rest = rest.slice(m.index + g.length);
  }
  return out;
}

/** SVG に安全に埋め込めるようエスケープする。 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
