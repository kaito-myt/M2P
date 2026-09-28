/**
 * Markdown の表を「本物の表に見える画像」に変換する (F-ANP-48)。
 *
 * 【なぜ画像なのか】note のエディタには**表を作る機能が無い** (2026-09-28 調査。note 上の
 * 解説記事でも「画像化」「数式ブロックに TeX」「Gist 埋め込み」の 3 つしか手段が無い)。
 * そのため `| 頭数帯 | レース数 |` のような Markdown をそのまま流し込むと、公開記事に
 * パイプ記号の羅列が出てしまう (運営者報告 2026-09-28)。
 *
 * A2P/ANP の原則どおり **文字は実フォント (Noto Sans JP のアウトライン)** で描くので、
 * 画像生成 AI にも librsvg のフォント設定にも依存せず、日本語が確実に崩れない。
 *
 * 出力は PNG。note は本文カラム幅 (約 620px) に合わせて縮小表示するため、
 * 画像幅は「自然幅」を基準に 700〜1280px に収め、縮小後も本文と同じくらいの
 * 文字サイズになるようにしている。
 */
import sharp from 'sharp';

import { advanceWidth, escapeXml, linePathLeft, loadFonts, wrapByWidth } from './text-layout.js';

export interface MarkdownTable {
  header: string[];
  rows: string[][];
  /** 各列の寄せ (Markdown の `:---:` 記法 + 中身が数値かで決める)。 */
  align: Array<'left' | 'center' | 'right'>;
}

export interface TableImageOptions {
  /** ヘッダ帯の色 (アカウントの配色に合わせる)。 */
  accent?: string;
  /** 最大幅 (既定 1280)。 */
  maxWidth?: number;
}

const FONT_SIZE = 32;
const HEAD_SIZE = 32;
const CELL_PAD_X = 22;
const CELL_PAD_Y = 16;
const LINE_H = 1.38;
const OUTER_PAD = 24;
const MIN_WIDTH = 700;
const MAX_WIDTH = 1280;
/** 1 セルの折り返し上限 (これ以上は列幅を広げる)。 */
const MAX_CELL_LINES = 3;

/** セル内の軽微な Markdown 装飾を落とす (表の中では装飾を描かない)。 */
function plainCell(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .trim();
}

/** `| a | b |` 行をセル配列へ (先頭/末尾のパイプは任意)。 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => plainCell(c));
}

/** `|---|:--:|` のような区切り行か。 */
export function isTableSeparator(line: string): boolean {
  const s = line.trim();
  if (!s.includes('-') || !s.includes('|')) return false;
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(s);
}

/** 表の本文行らしいか (パイプを含む)。 */
export function isTableRow(line: string): boolean {
  const s = line.trim();
  return s.includes('|') && s.replace(/[^|]/g, '').length >= 1 && /\|/.test(s);
}

/** 数値・割合・金額だけのセルか (右寄せにする)。 */
function isNumericCell(s: string): boolean {
  return s.length > 0 && /^[\d.,%¥$+\-−～〜–—/:\s]+$/.test(s);
}

/**
 * Markdown の表 (GFM) をパースする。表として成立しない場合は null。
 */
export function parseMarkdownTable(md: string): MarkdownTable | null {
  const lines = md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;
  if (!isTableRow(lines[0]!) || !isTableSeparator(lines[1]!)) return null;

  const header = splitRow(lines[0]!);
  const sep = splitRow(lines[1]!);
  const align: MarkdownTable['align'] = header.map((_, i) => {
    const s = (sep[i] ?? '').trim();
    if (s.startsWith(':') && s.endsWith(':')) return 'center';
    if (s.endsWith(':')) return 'right';
    return 'left';
  });

  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    if (!isTableRow(line) || isTableSeparator(line)) break;
    const cells = splitRow(line);
    // 列数が足りない/多い行は揃える (LLM 出力のゆらぎ対策)。
    while (cells.length < header.length) cells.push('');
    rows.push(cells.slice(0, header.length));
  }
  if (rows.length === 0) return null;

  // 区切り行で寄せ指定が無い列は、中身が数値なら右寄せにする。
  for (let c = 0; c < header.length; c += 1) {
    if (align[c] !== 'left') continue;
    const body = rows.map((r) => r[c] ?? '').filter((v) => v.length > 0);
    if (body.length > 0 && body.every(isNumericCell)) align[c] = 'right';
  }

  return { header, rows, align };
}

/**
 * 本文から表の領域を切り出す。戻り値は「表でない塊」と「表」の並び。
 * (Markdown 上で表の前後に空行が無いケースがあるため、段落単位ではなく行単位で走査する。)
 */
export function splitTableSegments(text: string): Array<{ kind: 'text' | 'table'; text: string }> {
  const lines = text.split('\n');
  const out: Array<{ kind: 'text' | 'table'; text: string }> = [];
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length === 0) return;
    const joined = buf.join('\n').trim();
    if (joined.length > 0) out.push({ kind: 'text', text: joined });
    buf = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (isTableRow(line) && next !== undefined && isTableSeparator(next)) {
      const table: string[] = [line, next];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]!) && lines[j]!.trim().length > 0) {
        table.push(lines[j]!);
        j += 1;
      }
      if (parseMarkdownTable(table.join('\n'))) {
        flush();
        out.push({ kind: 'table', text: table.join('\n') });
        i = j - 1;
        continue;
      }
    }
    buf.push(line);
  }
  flush();
  return out;
}

/**
 * 画像にできない場合のテキスト版。パイプ記号を残さず「見出し: 値」の行に開く
 * (公開記事に `|---|---|` が出るのを何があっても避けるための最終手段)。
 */
export function tableToPlainText(t: MarkdownTable): string {
  return t.rows
    .map((row) => {
      const head = (row[0] ?? '').trim();
      const rest = t.header
        .slice(1)
        .map((h, i) => {
          const v = (row[i + 1] ?? '').trim();
          return v.length > 0 ? `${h.trim()} ${v}` : '';
        })
        .filter((v) => v.length > 0)
        .join(' / ');
      return head.length > 0 ? `${head}：${rest}` : rest;
    })
    .filter((l) => l.length > 0)
    .join('\n');
}

interface Measured {
  colWidths: number[];
  headLines: string[][];
  bodyLines: string[][][];
  rowHeights: number[];
  headHeight: number;
  width: number;
  height: number;
}

function measure(t: MarkdownTable, maxWidth: number): Measured {
  const { regular, bold } = loadFonts();

  // 1. 折り返さなかった場合の自然幅。
  const natural = t.header.map((h, c) => {
    let w = advanceWidth(bold, h, HEAD_SIZE);
    for (const row of t.rows) w = Math.max(w, advanceWidth(regular, row[c] ?? '', FONT_SIZE));
    return w + CELL_PAD_X * 2;
  });
  const naturalTotal = natural.reduce((a, b) => a + b, 0);
  const usableMax = maxWidth - OUTER_PAD * 2;

  let colWidths: number[];
  if (naturalTotal <= usableMax) {
    colWidths = natural;
  } else {
    // 広い列から順に削って収める (狭い列を潰さない)。
    const minCol = 120;
    colWidths = [...natural];
    let over = naturalTotal - usableMax;
    while (over > 0.5) {
      const widest = colWidths.indexOf(Math.max(...colWidths));
      const room = colWidths[widest]! - minCol;
      if (room <= 1) break;
      const cut = Math.min(room, Math.max(over / 2, 8));
      colWidths[widest] = colWidths[widest]! - cut;
      over -= cut;
    }
  }

  const headLines = t.header.map((h, c) =>
    wrapByWidth(bold, h, HEAD_SIZE, colWidths[c]! - CELL_PAD_X * 2).slice(0, MAX_CELL_LINES),
  );
  const bodyLines = t.rows.map((row) =>
    row.map((cell, c) =>
      wrapByWidth(regular, cell, FONT_SIZE, colWidths[c]! - CELL_PAD_X * 2).slice(0, MAX_CELL_LINES),
    ),
  );

  const headHeight =
    Math.max(1, ...headLines.map((l) => l.length)) * HEAD_SIZE * LINE_H + CELL_PAD_Y * 2;
  const rowHeights = bodyLines.map(
    (row) => Math.max(1, ...row.map((l) => l.length)) * FONT_SIZE * LINE_H + CELL_PAD_Y * 2,
  );

  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const width = Math.round(Math.max(MIN_WIDTH, tableWidth + OUTER_PAD * 2));
  const height = Math.round(
    headHeight + rowHeights.reduce((a, b) => a + b, 0) + OUTER_PAD * 2,
  );
  return { colWidths, headLines, bodyLines, rowHeights, headHeight, width, height };
}

function cellX(x: number, colWidth: number, textWidth: number, align: 'left' | 'center' | 'right'): number {
  if (align === 'right') return x + colWidth - CELL_PAD_X - textWidth;
  if (align === 'center') return x + (colWidth - textWidth) / 2;
  return x + CELL_PAD_X;
}

/**
 * Markdown の表を PNG にする。note の本文にそのまま貼れる見た目
 * (ヘッダ帯 + ゼブラ + ヘアライン) にしている。
 */
export async function renderTableImage(
  table: MarkdownTable,
  opts: TableImageOptions = {},
): Promise<Buffer> {
  const { regular, bold } = loadFonts();
  const accent = opts.accent ?? '#1f4f7a';
  const m = measure(table, opts.maxWidth ?? MAX_WIDTH);
  const W = m.width;
  const H = m.height;

  const tableWidth = m.colWidths.reduce((a, b) => a + b, 0);
  const x0 = Math.round((W - tableWidth) / 2);
  const y0 = OUTER_PAD;

  const parts: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`];

  // --- ヘッダ帯 ---
  parts.push(
    `<rect x="${x0}" y="${y0}" width="${tableWidth}" height="${m.headHeight}" fill="${accent}"/>`,
  );
  {
    let cx = x0;
    for (let c = 0; c < table.header.length; c += 1) {
      const lines = m.headLines[c]!;
      const blockH = lines.length * HEAD_SIZE * LINE_H;
      let baseline = y0 + (m.headHeight - blockH) / 2 + HEAD_SIZE * 0.98;
      for (const line of lines) {
        const tw = advanceWidth(bold, line, HEAD_SIZE);
        const tx = cellX(cx, m.colWidths[c]!, tw, table.align[c] === 'right' ? 'right' : 'left');
        parts.push(`<path d="${linePathLeft(bold, line, HEAD_SIZE, tx, baseline)}" fill="#ffffff"/>`);
        baseline += HEAD_SIZE * LINE_H;
      }
      cx += m.colWidths[c]!;
    }
  }

  // --- 本文行 ---
  let y = y0 + m.headHeight;
  for (let r = 0; r < table.rows.length; r += 1) {
    const rowH = m.rowHeights[r]!;
    if (r % 2 === 1) {
      parts.push(`<rect x="${x0}" y="${y}" width="${tableWidth}" height="${rowH}" fill="#f5f7fa"/>`);
    }
    let cx = x0;
    for (let c = 0; c < table.header.length; c += 1) {
      const lines = m.bodyLines[r]![c] ?? [];
      const blockH = lines.length * FONT_SIZE * LINE_H;
      let baseline = y + (rowH - blockH) / 2 + FONT_SIZE * 0.96;
      // 1 列目は行の見出しなので少し強く見せる。
      const font = c === 0 ? bold : regular;
      for (const line of lines) {
        const tw = advanceWidth(font, line, FONT_SIZE);
        const tx = cellX(cx, m.colWidths[c]!, tw, table.align[c]!);
        parts.push(`<path d="${linePathLeft(font, line, FONT_SIZE, tx, baseline)}" fill="#1b2430"/>`);
        baseline += FONT_SIZE * LINE_H;
      }
      cx += m.colWidths[c]!;
    }
    y += rowH;
    parts.push(
      `<rect x="${x0}" y="${Math.round(y) - 1}" width="${tableWidth}" height="1" fill="#dde3ea"/>`,
    );
  }

  // --- 縦罫 (列の区切り) ---
  {
    let cx = x0;
    for (let c = 0; c < table.header.length - 1; c += 1) {
      cx += m.colWidths[c]!;
      parts.push(
        `<rect x="${Math.round(cx) - 1}" y="${y0 + m.headHeight}" width="1" height="${Math.round(y - y0 - m.headHeight)}" fill="#e6ebf1"/>`,
      );
    }
  }

  // --- 外枠 ---
  parts.push(
    `<rect x="${x0 + 0.5}" y="${y0 + 0.5}" width="${tableWidth - 1}" height="${Math.round(y - y0) - 1}" fill="none" stroke="#d6dde6" stroke-width="1"/>`,
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** 画像の代替テキスト (note の画像説明・アクセシビリティ用)。 */
export function tableImageAlt(t: MarkdownTable): string {
  return escapeXml(`表: ${t.header.filter((h) => h.length > 0).join('・')}`).slice(0, 120);
}
