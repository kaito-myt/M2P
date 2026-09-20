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
  | { type: 'paragraph'; text: string };

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
      const text = paragraphBuf.join('\n').trim();
      if (text) blocks.push({ type: 'paragraph', text });
      paragraphBuf = [];
    }
  };
  const flushList = () => {
    if (listBuf.length > 0) {
      blocks.push({ type: 'list', items: [...listBuf] });
      listBuf = [];
    }
  };

  for (const raw of lines) {
    const line = raw;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const h3 = /^###\s+(.*)$/.exec(trimmed);
    const h2 = /^##\s+(.*)$/.exec(trimmed);
    const h1 = /^#\s+(.*)$/.exec(trimmed);
    if (h3 || h2 || h1) {
      flushParagraph();
      flushList();
      const text = (h3?.[1] ?? h2?.[1] ?? h1?.[1] ?? '').trim();
      blocks.push({ type: 'heading', level: h3 ? 3 : 2, text });
      continue;
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
