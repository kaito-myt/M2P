/**
 * [F-ANP-48] 本文中の Markdown 表を画像にして、note の本文へ差し込めるようにする。
 *
 * note のエディタには表を作る機能が無い (2026-09-28 調査)。そのため Markdown の表を
 * そのまま流し込むと `| 頭数帯 | レース数 |` というパイプ記号の羅列が公開されてしまう
 * (運営者報告)。ここで表ブロックを PNG に描き起こし、`imagePath` を添えて publish port に
 * 渡す。画像化に失敗した場合のために、パイプ記号を含まないテキスト版も用意する。
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { createLogger } from '@a2p/contracts/logger';
import {
  parseMarkdownTable,
  renderTableImage,
  schemeForNiche,
  tableToPlainText,
} from '@a2p/output-image';

import type { NotePublishBlock } from './playwright-note-publish-port.js';

const log = createLogger('worker.note-publish.tables');

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface AttachTableImagesArgs {
  articleId: string;
  /** 画像を書き出す一時ディレクトリ。 */
  stageDir: string;
  /** アカウントのニッチ (配色をアカウントで揃えるため)。 */
  niche?: string | null;
}

/**
 * `table` ブロックに画像パスと代替テキストを付与する (入力配列は破壊しない)。
 * 表としてパースできないものは段落に落とす。
 */
export async function attachTableImages(
  blocks: readonly NotePublishBlock[],
  args: AttachTableImagesArgs,
  startIndex = 0,
): Promise<{ blocks: NotePublishBlock[]; rendered: number; nextIndex: number }> {
  const scheme = schemeForNiche(args.niche ?? null);
  const out: NotePublishBlock[] = [];
  let rendered = 0;
  let index = startIndex;

  for (const block of blocks) {
    if (block.kind !== 'table') {
      out.push(block);
      continue;
    }
    const table = parseMarkdownTable(block.text);
    if (!table) {
      // 表として解釈できないなら、せめてパイプ記号を落として段落にする。
      out.push({ kind: 'paragraph', text: block.text.replace(/\|/g, ' ').replace(/\s{2,}/g, ' ').trim() });
      continue;
    }
    const fallbackText = tableToPlainText(table);
    try {
      const png = await renderTableImage(table, { accent: scheme.base });
      const file = path.join(args.stageDir, `${args.articleId}-table-${String(index)}.png`);
      writeFileSync(file, png);
      index += 1;
      rendered += 1;
      out.push({ kind: 'table', text: block.text, imagePath: file, fallbackText });
    } catch (err) {
      log.warn({ err: errMsg(err), articleId: args.articleId }, '表の画像化に失敗 — テキストで代替');
      out.push({ kind: 'table', text: block.text, imagePath: null, fallbackText });
    }
  }

  return { blocks: out, rendered, nextIndex: index };
}
