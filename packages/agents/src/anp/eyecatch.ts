/**
 * docs/11-anp-design.md §3.2 F-ANP-14 — note Eyecatch (アイキャッチ画像生成)。
 * A2P Thumbnail Designer (`thumbnail/image.ts`) の画像生成基盤 (`generateImage` +
 * `withImageLogging` + R2 upload) を流用する。
 *
 * 【日本語は画像 AI に描かせない】: A2P の表紙と同じく「絵は AI・文字は実フォント」。
 * 画像モデルには文字なしの絵だけを描かせ、キャッチコピーは `composeNoteEyecatch`
 * (Noto Sans JP アウトライン合成) で焼き込む (F-ANP-41)。運営者指摘
 * 「タイトルとアイキャッチが読者の目を引くようなものではない」への対応で、
 * タイムラインの小さなサムネイルでも記事の中身が一目で伝わるようにする。
 *
 * 【画像モデルは割当で切替】: role='anp.eyecatch' の model_assignments で provider/model
 * を決める (既定 openai/gpt-image-2、Nano Banana 2 = google/gemini-3.1-flash-image)。
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
  accentForNiche,
  composeNoteEyecatch,
  defaultEyecatchAlt,
  NOTE_EYECATCH_HEIGHT,
  NOTE_EYECATCH_WIDTH,
} from '@a2p/output-image';

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
import { generateImageGoogle } from '../tools/image-gen-google.js';
import {
  loadModelAssignment as defaultLoadModelAssignment,
  type LoadModelAssignmentDeps,
} from '../lib/load-model-assignment.js';

/** note 推奨のアイキャッチ比率 (docs/11 §3.2)。gpt-image は 1536x1024 (3:2 相当) を採用。 */
const IMAGE_WIDTH = 1536;
const IMAGE_HEIGHT = 1024;

export interface GenerateNoteEyecatchInput {
  noteArticleId: string;
  jobId?: string;
  title: string;
  hook: string;
  niche: string;
  /** F-ANP-41: 画像に焼き込むキャッチコピー (anp.seo の出力)。無ければ文字を載せない。 */
  eyecatchCopy?: string | null;
  /** F-ANP-41: キャッチの下に入れる補足 1 行。 */
  eyecatchSub?: string | null;
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
  /** 文字を焼き込んだか (anp.seo のコピーが無い記事は false)。 */
  composedText: boolean;
  /** 画像の alt テキスト (note の画像説明・SEO 用)。 */
  alt: string;
}

export interface UploadBufferFn {
  (key: string, buffer: Buffer, contentType: string): Promise<unknown>;
}

export interface GenerateNoteEyecatchDeps {
  generateImage?: GenerateImageFn;
  imageGenDeps?: ImageGenDeps;
  withImageLoggingDeps?: WithImageLoggingDeps;
  uploadBuffer?: UploadBufferFn;
  /** role='anp.eyecatch' の画像モデル割当を解決する (テスト差し替え可)。 */
  loadModelAssignment?: typeof defaultLoadModelAssignment;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  /** 文字合成 (テストで差し替え可)。 */
  composeEyecatch?: typeof composeNoteEyecatch;
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
    '- 主題は画面の上 2/3 に大きく置く。**下 1/3 はキャッチコピーを載せるので、',
    '  細かい描き込みを避けて色数を抑えた落ち着いた面にする** (背景色・影・床・空など)。',
    '- コントラストを強く、色は大胆に。小さく表示されても遠目で目を引くこと。',
    '- 人物は原則描かない。必要な場合も顔は写さず、手元や後ろ姿など部分的に留める。',
    '',
    '【禁止 (これらが写ると失敗)】',
    ...EYECATCH_BANNED_MOTIFS.map((m) => `- ${m}`),
    '',
    '',
    '【文字は絶対に描かない】',
    '- 画像内に文字・数字・記号・ロゴ・手書きメモの文字列を一切描かないこと。',
    '  (キャッチコピーは後工程で本物のフォントを重ねる。絵の中の文字は必ず邪魔になる)',
    '- ノートや看板を描く場合も、文字の代わりに線・図形・グラフの形だけにする。',
    '- ABSOLUTELY NO text, letters, numbers, captions, watermarks or logos anywhere in the image.',
    '',
    '健全な内容。実在の商標・人物・作品を描かない。',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** role='anp.eyecatch' の画像モデル割当。未設定/失敗時は OpenAI gpt-image-* に倒す。 */
async function resolveImageModel(
  deps: GenerateNoteEyecatchDeps,
): Promise<{ provider: string; model: string | null }> {
  const load = deps.loadModelAssignment ?? defaultLoadModelAssignment;
  try {
    const a = await load('anp.eyecatch', null, deps.loadAssignmentDeps);
    return { provider: a.provider, model: a.model };
  } catch {
    // 割当が無い環境 (テスト/初期状態) では既定の OpenAI パスを使う。
    return { provider: 'openai', model: null };
  }
}

export async function generateNoteEyecatch(
  input: GenerateNoteEyecatchInput,
  deps: GenerateNoteEyecatchDeps = {},
): Promise<GenerateNoteEyecatchResult> {
  const assignment = deps.generateImage ? { provider: 'openai', model: null } : await resolveImageModel(deps);
  const useGoogle = assignment.provider === 'google';

  const rawGenerateImage: GenerateImageFn =
    deps.generateImage ??
    (useGoogle
      ? (args) =>
          generateImageGoogle(args, assignment.model ? { model: assignment.model } : {})
      : defaultGenerateImage);

  const ctx: ImageLoggingContext = { role: 'anp.eyecatch' };
  if (input.jobId !== undefined) ctx.jobId = input.jobId;
  if (!deps.generateImage) {
    ctx.provider = assignment.provider;
    if (assignment.model) ctx.model = assignment.model;
  }

  const loggedGenerateImage = withImageLogging(
    (args, innerDeps) => rawGenerateImage(args, innerDeps ?? deps.imageGenDeps),
    ctx,
    deps.withImageLoggingDeps,
  );

  const style = pickEyecatchStyle(input.noteArticleId, input.recentStyleKeys ?? []);
  const promptUsed = buildPrompt(input, style);
  // Google (Nano Banana) は 16:9 が最も note のアイキャッチ比率に近い。OpenAI は 1536x1024。
  const width = useGoogle ? NOTE_EYECATCH_WIDTH : IMAGE_WIDTH;
  const height = useGoogle ? NOTE_EYECATCH_HEIGHT : IMAGE_HEIGHT;
  const result = await loggedGenerateImage({
    prompt: promptUsed,
    width,
    height,
    outputFormat: 'jpeg',
    outputCompression: 90,
  });

  const image = result.images[0];
  if (!image) {
    throw new Error('anp.eyecatch: generateImage returned no image');
  }

  // F-ANP-41: キャッチコピーがあれば実フォントで焼き込む (画像 AI には描かせない)。
  const copy = (input.eyecatchCopy ?? '').trim();
  const compose = deps.composeEyecatch ?? composeNoteEyecatch;
  let finalImage = image;
  let composedText = false;
  if (copy.length > 0) {
    finalImage = await compose(
      image,
      {
        copy,
        sub: input.eyecatchSub ?? null,
        badge: input.niche,
      },
      { accent: accentForNiche(input.niche) },
    );
    composedText = true;
  }

  const upload = deps.uploadBuffer ?? (await defaultUploadBuffer());
  const r2Key = noteArticleEyecatch(input.noteArticleId);
  await upload(r2Key, finalImage, 'image/jpeg');

  return {
    r2Key,
    promptUsed,
    styleKey: style.key,
    composedText,
    alt: defaultEyecatchAlt(input.title, input.niche),
  };
}

async function defaultUploadBuffer(): Promise<UploadBufferFn> {
  const mod = await import('@a2p/storage/operations');
  return mod.uploadBuffer as unknown as UploadBufferFn;
}
