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

import { EYECATCH_BANNED_MOTIFS, pickEyecatchStyle, type EyecatchStyle } from './eyecatch-style.js';

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
  /** F-ANP-14b: 直近の記事で使った画風キー (連続で同じ見た目にならないよう避ける)。 */
  recentStyleKeys?: readonly string[];
  /** F-ANP-14b: 記事の方針・トンマナ (アカウント設定) の抜粋。画のトーンに反映する。 */
  editorialPolicy?: string | null;
}

export interface GenerateNoteEyecatchResult {
  r2Key: string;
  promptUsed: string;
  /** 採用した画風キー (次回の重複回避に使う)。 */
  styleKey: string;
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

/**
 * F-ANP-14b: 記事ごとに画風を振り、AI っぽいモチーフを名指しで禁止したプロンプトを組み立てる。
 * (旧プロンプトは汎用的すぎて gpt-image が毎回「光る脳 + ノート PC の人物」に収束していた。)
 */
export function buildPrompt(input: GenerateNoteEyecatchInput, style: EyecatchStyle): string {
  const policy = (input.editorialPolicy ?? '').trim().slice(0, 300);
  return [
    'Web メディア (note) の記事アイキャッチを 1 枚作成してください。横長・高解像度。',
    '',
    `【記事のテーマ】${input.niche}`,
    `【タイトル】「${input.title}」`,
    `【フック】${input.hook}`,
    policy ? `【媒体のトーン】${policy}` : '',
    '',
    '【画風 (必ず守る)】',
    `- 画材・質感: ${style.medium}`,
    `- 構図: ${style.composition}`,
    `- 配色: ${style.palette}`,
    '',
    '【内容の作り方】',
    '- タイトルの中身を「具体的なモノ・場面」に翻訳して描く (抽象的な概念の比喩に逃げない)。',
    '- 要素は最大 3 つまで。小さなサムネイルでも何の記事か一目で分かる大きさにする。',
    '- 人物は原則描かない。必要な場合も顔は写さず、手元や後ろ姿など部分的に留める。',
    '',
    '【禁止 (これらが写ると失敗)】',
    ...EYECATCH_BANNED_MOTIFS.map((m) => `- ${m}`),
    '',
    '健全な内容。実在の商標・人物・作品を描かない。',
  ]
    .filter((line) => line !== '')
    .join('\n');
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

  const style = pickEyecatchStyle(input.noteArticleId, input.recentStyleKeys ?? []);
  const promptUsed = buildPrompt(input, style);
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

  return { r2Key, promptUsed, styleKey: style.key };
}

async function defaultUploadBuffer(): Promise<UploadBufferFn> {
  const mod = await import('@a2p/storage/operations');
  return mod.uploadBuffer as unknown as UploadBufferFn;
}
