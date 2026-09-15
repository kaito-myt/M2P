/**
 * docs/11-anp-design.md §3.2 F-ANP-14 — note Eyecatch (アイキャッチ画像生成)。
 * A2P Thumbnail Designer (`thumbnail/image.ts`) の画像生成基盤 (`generateImage` +
 * `withImageLogging` + R2 upload) を流用する。
 *
 * 【日本語タイトルは描かせない】: A2P の知見 (thumbnail/image.ts 冒頭コメント) の通り
 * gpt-image 系は日本語タイポグラフィを崩しやすい。note のアイキャッチは note 側 UI が
 * タイトルを別途表示するため、Phase 1 では**文字を含まないテーマに沿った挿絵**のみを
 * 生成する (A2P のような実フォント合成レイヤーは持たない)。
 *
 * Flow:
 *  1. テーマ/フックからプロンプトを構築 (文字を描かない指示を明記)
 *  2. `generateImage` (via `withImageLogging`, role='anp.eyecatch') で 1280x670 相当を生成
 *     (gpt-image がサポートするサイズに正規化: 1536x1024 → 後段で 1280x670 相当として扱う)
 *  3. R2 に upload (`note/{note_article_id}/eyecatch.jpg`)
 *  4. Return { r2Key, promptUsed }
 */
import { noteArticleEyecatch } from '@a2p/storage/keys';

import {
  generateImage as defaultGenerateImage,
  type GenerateImageFn,
  type ImageGenDeps,
} from '../tools/image-gen.js';
import {
  withImageLogging,
  type ImageLoggingContext,
  type WithImageLoggingDeps,
} from '../lib/with-image-logging.js';

/** note 推奨のアイキャッチ比率 (docs/11 §3.2)。gpt-image は 1536x1024 (3:2 相当) を採用。 */
const IMAGE_WIDTH = 1536;
const IMAGE_HEIGHT = 1024;

export interface GenerateNoteEyecatchInput {
  noteArticleId: string;
  jobId?: string;
  title: string;
  hook: string;
  niche: string;
}

export interface GenerateNoteEyecatchResult {
  r2Key: string;
  promptUsed: string;
}

export interface UploadBufferFn {
  (key: string, buffer: Buffer, contentType: string): Promise<unknown>;
}

export interface GenerateNoteEyecatchDeps {
  generateImage?: GenerateImageFn;
  imageGenDeps?: ImageGenDeps;
  withImageLoggingDeps?: WithImageLoggingDeps;
  uploadBuffer?: UploadBufferFn;
}

function buildPrompt(input: GenerateNoteEyecatchInput): string {
  return [
    'note (Web メディア) の記事アイキャッチ画像を1枚作成してください。横長・高解像度。',
    `・記事テーマ: ${input.niche}`,
    `・タイトル: 「${input.title}」`,
    `・フック: ${input.hook}`,
    '',
    '要件:',
    '- タイトルの内容を象徴する、洗練された現代的なイラスト/写真調の1枚。小さなサムネイル表示でも一瞬で内容が伝わる。',
    '- **文字・ロゴ・透かし・キャプション・数字は一切描かない** (画像内にテキストを含めない)。',
    '- 安っぽい AI 感を避け、意図的な構図・上質な配色。過度な彩度/グラデーションの濁りは避ける。健全な内容。',
  ].join('\n');
}

export async function generateNoteEyecatch(
  input: GenerateNoteEyecatchInput,
  deps: GenerateNoteEyecatchDeps = {},
): Promise<GenerateNoteEyecatchResult> {
  const rawGenerateImage = deps.generateImage ?? defaultGenerateImage;
  const ctx: ImageLoggingContext = { role: 'anp.eyecatch' };
  if (input.jobId !== undefined) ctx.jobId = input.jobId;

  const loggedGenerateImage = withImageLogging(
    (args, innerDeps) => rawGenerateImage(args, innerDeps ?? deps.imageGenDeps),
    ctx,
    deps.withImageLoggingDeps,
  );

  const promptUsed = buildPrompt(input);
  const result = await loggedGenerateImage({
    prompt: promptUsed,
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    outputFormat: 'jpeg',
    outputCompression: 90,
  });

  const image = result.images[0];
  if (!image) {
    throw new Error('anp.eyecatch: generateImage returned no image');
  }

  const upload = deps.uploadBuffer ?? (await defaultUploadBuffer());
  const r2Key = noteArticleEyecatch(input.noteArticleId);
  await upload(r2Key, image, 'image/jpeg');

  return { r2Key, promptUsed };
}

async function defaultUploadBuffer(): Promise<UploadBufferFn> {
  const mod = await import('@a2p/storage/operations');
  return mod.uploadBuffer as unknown as UploadBufferFn;
}
