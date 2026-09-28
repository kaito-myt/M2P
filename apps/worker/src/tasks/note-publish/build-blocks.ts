/**
 * `NoteArticle.body_md` (Markdown 相当) を note エディタ流し込み用ブロック列に分解する純関数。
 * docs/11-anp-design.md §2.1 の実 DOM 調査に基づき、`#`/`##` は見出し、`-`/`・` 始まりは
 * 箇条書き、それ以外は段落として扱う。`paywallLinePos` (codepoint index, body_md 内のオフセット)
 * が指定されていれば free/paid の 2 系列に分割する。
 *
 * [F-ANP-48] **Markdown の記法をそのまま打ち込まない**。note のエディタは Markdown を解釈しない
 * ので、`|表|`・`**太字**`・```` ```コード``` ````・`---`・`[文字](URL)` を素で打つと記号が
 * そのまま公開記事に出る (2026-09-28 運営者報告「表がこんな感じで表示されてる」)。ここで
 *   - 表      → `table` ブロック (呼出側が画像化して挿入)
 *   - コード  → `code` ブロック (+メニューの「コード」)
 *   - 区切り線 → `hr` ブロック (+メニューの「区切り線」)
 *   - 太字    → `runs` (typeBlock が Ctrl+B で本物の太字にする)
 *   - リンク  → 「文字」＋ URL を別行に (note は単独行の URL を自動でリンク/埋め込みにする)
 * に変換する。
 */
import { splitTableSegments } from '@a2p/output-image';

import type { InlineRun, NotePublishBlock } from './playwright-note-publish-port.js';

export interface BuildNoteBlocksResult {
  freeBlocks: NotePublishBlock[];
  paidBlocks: NotePublishBlock[];
}

/** 区切り線だけの行か (`---` / `***` / `___`)。 */
function isHorizontalRule(line: string): boolean {
  return /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

/**
 * インライン記法を note 向けに開く。
 * - `[文字](URL)` → `文字` の後ろに改行して URL を単独行に置く (note が自動でリンクにする)。
 * - `` `コード` `` → バッククォートを外す。
 */
export function normalizeInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => `${label}\n${url}`)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/**
 * `**太字**` で分割する。`typeBlock` が bold=true の run だけ Ctrl+B で囲んで打つ。
 * 対応が取れていない `**` はただの文字として残さず落とす (記号が公開記事に出ないように)。
 */
export function splitInlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false });
    runs.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false });
  const cleaned = runs
    .map((r) => (r.bold ? r : { ...r, text: r.text.replace(/\*\*/g, '').replace(/(?<!\*)\*(?!\*)/g, '') }))
    .filter((r) => r.text.length > 0);
  return cleaned.length > 0 ? cleaned : [{ text: text.replace(/\*/g, ''), bold: false }];
}

/** 段落テキストからブロックを作る (太字の run を添える)。 */
function paragraphBlock(kind: 'paragraph' | 'bullet' | 'h1' | 'h2', text: string): NotePublishBlock {
  const normalized = normalizeInline(text);
  const runs = splitInlineRuns(normalized);
  const plain = runs.map((r) => r.text).join('');
  return runs.some((r) => r.bold) ? { kind, text: plain, runs } : { kind, text: plain };
}

/** ```` ``` ```` で囲まれたコードブロックを切り出す。 */
export function splitFencedSegments(text: string): Array<{ kind: 'text' | 'code'; text: string }> {
  const lines = text.split('\n');
  const out: Array<{ kind: 'text' | 'code'; text: string }> = [];
  let buf: string[] = [];
  const flush = (): void => {
    const joined = buf.join('\n').trim();
    if (joined.length > 0) out.push({ kind: 'text', text: joined });
    buf = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i]!)) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*```/.test(lines[j]!)) {
        body.push(lines[j]!);
        j += 1;
      }
      flush();
      const code = body.join('\n').trim();
      if (code.length > 0) out.push({ kind: 'code', text: code });
      i = j;
      continue;
    }
    buf.push(lines[i]!);
  }
  flush();
  return out;
}

/** 表・コードを含まないテキストを見出し/箇条書き/区切り線/段落に分解する。 */
function toTextBlocks(text: string): NotePublishBlock[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const blocks: NotePublishBlock[] = [];
  for (const para of paragraphs) {
    const lines = para
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // 区切り線だけの塊。
    if (lines.every(isHorizontalRule)) {
      blocks.push({ kind: 'hr', text: '' });
      continue;
    }
    if (/^##\s+/.test(lines[0]!)) {
      blocks.push(paragraphBlock('h2', lines[0]!.replace(/^#{2,6}\s+/, '')));
      continue;
    }
    if (/^#\s+/.test(lines[0]!)) {
      blocks.push(paragraphBlock('h1', lines[0]!.replace(/^#\s+/, '')));
      continue;
    }
    // 区切り線が混ざっている場合は落としてから判定する。
    const body = lines.filter((l) => !isHorizontalRule(l));
    if (body.length === 0) {
      blocks.push({ kind: 'hr', text: '' });
      continue;
    }
    if (body.every((l) => /^[-・]\s*/.test(l))) {
      blocks.push(paragraphBlock('bullet', body.join('\n')));
      continue;
    }
    blocks.push(paragraphBlock('paragraph', body.join('\n')));
  }
  return blocks;
}

function toBlocks(text: string): NotePublishBlock[] {
  const blocks: NotePublishBlock[] = [];
  for (const seg of splitTableSegments(text)) {
    if (seg.kind === 'table') {
      blocks.push({ kind: 'table', text: seg.text });
      continue;
    }
    for (const fenced of splitFencedSegments(seg.text)) {
      if (fenced.kind === 'code') blocks.push({ kind: 'code', text: fenced.text });
      else blocks.push(...toTextBlocks(fenced.text));
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
