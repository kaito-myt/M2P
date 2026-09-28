/**
 * note 記事本文 (Markdown 相当) を段落/見出し/箇条書きのブロック列に整形する純関数。
 * `apps/worker/src/tasks/note-publish/build-blocks.ts` (note 公開時のブロック分解) と同じ
 * 入力形式 (`#`/`##`/`###` 見出し、`- `/`・` 箇条書き、空行区切りの段落) を、
 * 記事詳細ページ (`/articles/[id]`) 表示用の軽量な構造化データに変換する
 * (新規 npm 依存 = markdown パーサを増やさないための自前実装)。
 */

export type NoteMarkdownBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'list'; items: string[] }
  // [F-ANP-48] Markdown の表。note 側には表機能が無いので公開時は画像にするが、
  // ANP の記事詳細では普通の <table> として見せる (パイプ記号のまま見せない)。
  | { type: 'table'; header: string[]; rows: string[][]; align: Array<'left' | 'right'> }
  // [F-ANP-48] 区切り線 (`---`) / コードブロック (``` で囲まれた部分)。
  | { type: 'rule' }
  | { type: 'code'; text: string }
  | { type: 'paragraph'; text: string; runs: InlineRun[] };

/** [F-ANP-48] `**太字**` の分割 (note 公開時も Ctrl+B で本物の太字にする)。 */
export interface InlineRun {
  text: string;
  bold: boolean;
}

/**
 * インライン記法を表示用に開く (note 公開時の `normalizeInline` と同じ考え方)。
 * `[文字](URL)` は「文字 (URL)」、`` `x` `` はバッククォートを外す。
 */
function normalizeInlineText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/** `**太字**` で分割する (対応の取れていない `*` は落とす)。 */
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
    .map((r) => (r.bold ? r : { ...r, text: r.text.replace(/\*/g, '') }))
    .filter((r) => r.text.length > 0);
  return cleaned.length > 0 ? cleaned : [{ text: text.replace(/\*/g, ''), bold: false }];
}

/** 区切り線だけの行か。 */
function isRuleLine(line: string): boolean {
  return /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

/** `| a | b |` 行をセル配列へ (先頭/末尾のパイプは任意)。 */
function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) =>
    c
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      .trim(),
  );
}

function isTableRowLine(line: string): boolean {
  const t = line.trim();
  return /^\|.*\|$/.test(t) && (t.match(/\|/g) ?? []).length >= 3;
}

function isTableSeparatorLine(line: string): boolean {
  const t = line.trim();
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(t) && t.includes('-') && t.includes('|');
}

function isNumericCellValue(v: string): boolean {
  return v.length > 0 && /^[\d.,%¥$+\-−～〜–—/:\s]+$/.test(v);
}

// `apps/worker/src/tasks/note-publish/build-blocks.ts` と同じ判定 (`-`/`・` の後の空白は任意)。
function isBulletLine(line: string): boolean {
  return /^[-・]\s*/.test(line.trim());
}

function stripBullet(line: string): string {
  return line.trim().replace(/^[-・]\s*/, '');
}

/** body_md を見出し/箇条書き/段落のブロック列に分解する。 */
export function parseNoteMarkdown(bodyMd: string): NoteMarkdownBlock[] {
  const lines = bodyMd.replace(/\r\n/g, '\n').split('\n');
  const blocks: NoteMarkdownBlock[] = [];
  let paragraphBuf: string[] = [];
  let listBuf: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuf.length > 0) {
      const raw = paragraphBuf.join('\n').trim();
      if (raw) {
        const runs = splitInlineRuns(normalizeInlineText(raw));
        blocks.push({ type: 'paragraph', text: runs.map((r) => r.text).join(''), runs });
      }
      paragraphBuf = [];
    }
  };
  const flushList = () => {
    if (listBuf.length > 0) {
      blocks.push({ type: 'list', items: listBuf.map((v) => normalizeInlineText(v).replace(/\*\*/g, '')) });
      listBuf = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    // コードブロック。
    if (/^\s*```/.test(trimmed)) {
      flushParagraph();
      flushList();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*```/.test(lines[j]!)) {
        body.push(lines[j]!);
        j += 1;
      }
      const code = body.join(String.fromCharCode(10)).trim();
      if (code.length > 0) blocks.push({ type: 'code', text: code });
      i = j;
      continue;
    }

    // 区切り線。
    if (isRuleLine(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'rule' });
      continue;
    }

    const h3 = /^###\s+(.*)$/.exec(trimmed);
    const h2 = /^##\s+(.*)$/.exec(trimmed);
    const h1 = /^#\s+(.*)$/.exec(trimmed);
    if (h3 || h2 || h1) {
      flushParagraph();
      flushList();
      const text = normalizeInlineText((h3?.[1] ?? h2?.[1] ?? h1?.[1] ?? '').trim()).replace(/\*\*/g, '');
      blocks.push({ type: 'heading', level: h3 ? 3 : 2, text });
      continue;
    }

    // 表 (ヘッダ行 + 区切り行 + 本文行)。
    if (isTableRowLine(trimmed) && isTableSeparatorLine(lines[i + 1] ?? '')) {
      flushParagraph();
      flushList();
      const header = splitTableRow(trimmed);
      const sep = splitTableRow(lines[i + 1]!);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRowLine(lines[j]!) && !isTableSeparatorLine(lines[j]!)) {
        const cells = splitTableRow(lines[j]!);
        while (cells.length < header.length) cells.push('');
        rows.push(cells.slice(0, header.length));
        j += 1;
      }
      if (rows.length > 0) {
        const align = header.map((_, c) => {
          if ((sep[c] ?? '').trim().endsWith(':')) return 'right' as const;
          const body = rows.map((r) => r[c] ?? '').filter((v) => v.length > 0);
          return body.length > 0 && body.every(isNumericCellValue) ? ('right' as const) : ('left' as const);
        });
        blocks.push({ type: 'table', header, rows, align });
        i = j - 1;
        continue;
      }
    }

    if (isBulletLine(trimmed)) {
      flushParagraph();
      listBuf.push(stripBullet(trimmed));
      continue;
    }

    flushList();
    paragraphBuf.push(line);
  }
  flushParagraph();
  flushList();

  return blocks;
}
