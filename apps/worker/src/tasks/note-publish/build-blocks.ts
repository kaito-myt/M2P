/**
 * `NoteArticle.body_md` (Markdown 相当) を note エディタ流し込み用ブロック列に分解する純関数。
 * docs/11-anp-design.md §2.1 の実 DOM 調査に基づき、`#`/`##` は見出し、`-`/`・` 始まりは
 * 箇条書き、それ以外は段落として扱う。`paywallLinePos` (codepoint index, body_md 内のオフセット)
 * が指定されていれば free/paid の 2 系列に分割する。
 *
 * [F-ANP-48] Markdown の表は **`table` ブロック**として切り出す。note のエディタには表を作る
 * 機能が無く、`| 頭数帯 | レース数 |` をそのまま打ち込むとパイプ記号の羅列が公開されてしまう
 * ため (運営者報告 2026-09-28)、呼出側で表を画像化して `imagePath` を添える。
 */
import { splitTableSegments } from '@a2p/output-image';

import type { NotePublishBlock } from './playwright-note-publish-port.js';

export interface BuildNoteBlocksResult {
  freeBlocks: NotePublishBlock[];
  paidBlocks: NotePublishBlock[];
}

/** 表を含まないテキストを見出し/箇条書き/段落に分解する。 */
function toTextBlocks(text: string): NotePublishBlock[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const blocks: NotePublishBlock[] = [];
  for (const para of paragraphs) {
    const lines = para.split('\n').map((l) => l.trim());
    if (/^##\s+/.test(lines[0] ?? '')) {
      blocks.push({ kind: 'h2', text: lines[0]!.replace(/^##\s+/, '') });
      continue;
    }
    if (/^#\s+/.test(lines[0] ?? '')) {
      blocks.push({ kind: 'h1', text: lines[0]!.replace(/^#\s+/, '') });
      continue;
    }
    if (lines.every((l) => /^[-・]\s*/.test(l) || l.length === 0)) {
      blocks.push({ kind: 'bullet', text: lines.filter((l) => l.length > 0).join('\n') });
      continue;
    }
    blocks.push({ kind: 'paragraph', text: para });
  }
  return blocks;
}

function toBlocks(text: string): NotePublishBlock[] {
  const blocks: NotePublishBlock[] = [];
  for (const seg of splitTableSegments(text)) {
    if (seg.kind === 'table') {
      blocks.push({ kind: 'table', text: seg.text });
    } else {
      blocks.push(...toTextBlocks(seg.text));
    }
  }
  return blocks;
}

export function buildNoteBlocks(bodyMd: string, paywallLinePos?: number | null): BuildNoteBlocksResult {
  const text = bodyMd ?? '';
  // paywallLinePos は codepoint index (絵文字等のサロゲートペアを 1 文字と数える) のため、
  // 範囲チェックも UTF-16 の `text.length` ではなく codepoints.length で行う(code review 軽微指摘)。
  const codepoints = Array.from(text);
  if (paywallLinePos == null || paywallLinePos <= 0 || paywallLinePos >= codepoints.length) {
    return { freeBlocks: toBlocks(text), paidBlocks: [] };
  }
  const freeText = codepoints.slice(0, paywallLinePos).join('');
  const paidText = codepoints.slice(paywallLinePos).join('');
  return { freeBlocks: toBlocks(freeText), paidBlocks: toBlocks(paidText) };
}
