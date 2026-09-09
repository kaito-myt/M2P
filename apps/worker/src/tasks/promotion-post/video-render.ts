/**
 * F-060 — TikTok スライド動画レンダラ。
 *
 * VideoScript の各シーンについて:
 *   1. gpt-image-1 で縦型(1024x1536)背景画像を生成（文字なし）
 *   2. Noto Sans JP でテロップ(caption)を焼き込み（composeCoverTypography 流用）
 *   3. OpenAI TTS でナレーション音声(mp3)を合成
 *   4. ffmpeg で「画像＋音声」を 1080x1920 の 1 クリップに（音声尺で自動）
 * 全クリップを concat して 9:16 mp4 を返す。
 *
 * child_process(ffmpeg) と一時ファイルを使う。ffmpeg 実行は DI 可能（テスト差し替え）。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  generateImage as defaultGenerateImage,
  withImageLogging,
  synthesizeSpeech as defaultSynthesizeSpeech,
  type GenerateImageFn,
  type WithImageLoggingDeps,
} from '@a2p/agents';
import { composeCoverTypography, notoSansJpBoldPath, sanitizeTelopText } from '@a2p/output-image';
import type { VideoScene } from '@a2p/contracts/agents/tiktok-video';
import { createLogger, type Logger } from '@a2p/contracts/logger';

const execFileAsync = promisify(execFile);

const VIDEO_W = 1080;
const VIDEO_H = 1920;

export type RunFfmpegFn = (args: string[]) => Promise<void>;

export interface RenderVideoDeps {
  logger?: Logger;
  generateImage?: GenerateImageFn;
  withImageLoggingDeps?: WithImageLoggingDeps;
  synthesizeSpeech?: typeof defaultSynthesizeSpeech;
  /** テロップ焼き込み（既定は composeCoverTypography）。 */
  composeTelop?: (image: Buffer, caption: string) => Promise<Buffer>;
  /** ffmpeg 実行（既定は execFile('ffmpeg', args)）。 */
  runFfmpeg?: RunFfmpegFn;
  /** TTS コスト記録（既定は token_usage へ INSERT）。 */
  logTtsCost?: (charCount: number, model: string) => Promise<void>;
}

async function defaultRunFfmpeg(args: string[]): Promise<void> {
  await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** BGM のミックス音量(ナレーションを主役にするため小さめ)。 */
const BGM_VOLUME = 0.12;

/**
 * 背景音楽トラックを用意する。
 * - `PROMO_BGM_URL` があればそれを DL（運営者が用意したロイヤリティフリー曲）。
 * - 無ければ ffmpeg でその場合成する権利クリーンなアンビエント(Cメジャーのドローン)。
 * 生成/取得に失敗したら null（呼び出し側は BGM なしで続行）。
 * `PROMO_BGM_ENABLED='0'` で明示的に無効化できる。
 */
async function prepareBgm(dir: string, runFfmpeg: RunFfmpegFn, log: Logger): Promise<string | null> {
  if (process.env.PROMO_BGM_ENABLED === '0') return null;
  const url = process.env.PROMO_BGM_URL;
  const outPath = join(dir, 'bgm-src');
  try {
    if (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`bgm download ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 1000) throw new Error('bgm too small');
      const p = `${outPath}.audio`;
      await writeFile(p, buf);
      return p;
    }
    // 権利クリーンな合成アンビエント: C(261.63)/E(329.63)/G(392) の三和音ドローン +
    // ゆるいトレモロ + ローパス + エコー + フェードイン。60 秒(ループ前提)。
    const p = `${outPath}.wav`;
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'sine=frequency=261.63:duration=60',
      '-f', 'lavfi', '-i', 'sine=frequency=329.63:duration=60',
      '-f', 'lavfi', '-i', 'sine=frequency=392.00:duration=60',
      '-filter_complex',
      '[0][1][2]amix=inputs=3,volume=3,tremolo=f=0.15:d=0.5,lowpass=f=1200,aecho=0.8:0.6:60:0.35,afade=t=in:d=2',
      '-ar', '44100', '-ac', '2', p,
    ]);
    return p;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'BGM 準備失敗 — BGM なしで続行');
    return null;
  }
}

/**
 * concat 済み動画(ナレーション音声つき)に BGM を小音量でミックスする。
 * BGM をループ(-stream_loop)して動画尺に合わせ、amix(duration=first)でナレーション尺に切る。
 */
function mixBgmArgs(videoPath: string, bgmPath: string, outPath: string): string[] {
  return [
    '-i', videoPath,
    '-stream_loop', '-1', '-i', bgmPath,
    '-filter_complex',
    `[1:a]volume=${BGM_VOLUME}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[a]`,
    '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', outPath,
  ];
}

async function defaultComposeTelop(image: Buffer, caption: string): Promise<Buffer> {
  // テロップは上部に配置する。9:16 縦動画は下部 ~25% を TikTok/IG の投稿説明文・UI
  // (いいね/コメント/シェアボタン等) が覆うため、下部に焼くと説明文とかぶる。上部セーフゾーンへ。
  return composeCoverTypography(image, { title: caption }, { placement: 'top' });
}

async function defaultLogTtsCost(charCount: number, model: string): Promise<void> {
  try {
    const { prisma } = await import('@a2p/db');
    // gpt-4o-mini-tts の概算: $0.60 / 1M chars, fx 155 → 1文字≈0.0000930円。ModelCatalog 未整備のため簡易。
    const costJpy = Math.round(charCount * 0.6e-6 * 155 * 100) / 100;
    await prisma.tokenUsage.create({
      data: {
        book_id: null,
        theme_session_id: null,
        job_id: null,
        provider: 'openai',
        model,
        role: 'tts_audio',
        input_tokens: charCount,
        output_tokens: 0,
        cached_input_tokens: 0,
        image_count: 0,
        unit_price_snapshot: { tts_usd_per_mchar: 0.6, fx_rate_usd_jpy: 155 },
        cost_jpy: costJpy,
      },
    });
  } catch {
    /* コスト記録失敗はレンダリングを止めない */
  }
}

/** 1080x1920 にカバー配置し、setsar=1・yuv420p で統一エンコード。 */
function sceneClipArgs(imagePath: string, audioPath: string, outPath: string): string[] {
  return [
    '-loop', '1', '-i', imagePath,
    '-i', audioPath,
    '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', '30',
    '-vf', `scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=increase,crop=${VIDEO_W}:${VIDEO_H},setsar=1`,
    // ナレーションを 1.12倍でブリスクに（テンポUP・視聴維持）。atempo はピッチ保持。
    '-filter:a', 'atempo=1.12',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-shortest', outPath,
  ];
}

/** [F-084] 実写級フック(Veo動画)クリップの ffmpeg 引数。動画を9:16にクロップ＋テロップ焼込＋TTS。 */
function veoHookClipArgs(videoPath: string, audioPath: string, captionFile: string, fontPath: string, outPath: string): string[] {
  // fontfile/textfile の ':' 等は drawtext 構文と衝突するため \\ でエスケープ（Linux 実行前提）。
  const esc = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  // テロップは上部(y=h*0.12)へ。下部 ~25% は投稿説明文/UIが覆うため、そこを避ける(下部だと説明文とかぶる)。
  const drawtext =
    `drawtext=fontfile='${esc(fontPath)}':textfile='${esc(captionFile)}':fontcolor=white:fontsize=58:` +
    `borderw=7:bordercolor=black@0.92:x=(w-text_w)/2:y=h*0.12:line_spacing=14`;
  return [
    '-i', videoPath,
    '-i', audioPath,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
    '-vf', `scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=increase,crop=${VIDEO_W}:${VIDEO_H},setsar=1,${drawtext}`,
    '-filter:a', 'atempo=1.12',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-shortest', outPath,
  ];
}

/** drawtext テロップの行頭に来てはいけない文字 (禁則)。 */
const CAP_NO_START = new Set(
  Array.from('、。，．・！？：；」』）】〕｝…ー―～〜%）ゃゅょっ'),
);

/**
 * テロップを全角約13字で折り返す（drawtext は自動改行しないため）。
 * フォントが描けない文字(絵文字/①/★等)は事前にサニタイズして文字化けを防ぎ、
 * 行頭禁止文字は前行にぶら下げて「変な位置の改行」を避ける。
 */
export function wrapCaption(caption: string, perLine = 13, maxLines = 3): string {
  const raw = sanitizeTelopText(caption).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  const lines: string[] = [];
  let cur = '';
  for (const ch of Array.from(raw)) {
    if (Array.from(cur).length >= perLine && !CAP_NO_START.has(ch)) {
      lines.push(cur);
      cur = '';
      if (lines.length >= maxLines) break;
    }
    cur += ch;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines).join('\n');
}

export interface RenderVideoResult {
  video: Buffer;
  sceneCount: number;
}

export interface RenderVideoOptions {
  /** [F-084] 冒頭フックに使う Veo 動画クリップ(mp4)。あれば scene[0] をこの実写級動画で作る。 */
  hookClip?: Buffer;
}

/**
 * VideoScript のシーン列から 9:16 mp4 を生成して Buffer で返す。
 */
export async function renderSlideVideo(
  scenes: VideoScene[],
  deps: RenderVideoDeps = {},
  opts: RenderVideoOptions = {},
): Promise<RenderVideoResult> {
  const log = deps.logger ?? createLogger('worker.promotion.video-render');
  const baseGen: GenerateImageFn = deps.generateImage ?? defaultGenerateImage;
  const genImage = withImageLogging(baseGen, { role: 'promo_image' }, deps.withImageLoggingDeps);
  const tts = deps.synthesizeSpeech ?? defaultSynthesizeSpeech;
  const composeTelop = deps.composeTelop ?? defaultComposeTelop;
  const runFfmpeg = deps.runFfmpeg ?? defaultRunFfmpeg;
  const logTts = deps.logTtsCost ?? defaultLogTtsCost;

  if (scenes.length === 0) {
    throw new Error('renderSlideVideo: scenes is empty');
  }

  const dir = await mkdtemp(join(tmpdir(), 'a2p-video-'));
  try {
    const clipPaths: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]!;

      // [F-084] 冒頭フック(scene 0)に Veo 実写級動画があれば、画像生成の代わりにそれを使う。
      if (i === 0 && opts.hookClip) {
        const veoPath = join(dir, 'veo-0.mp4');
        await writeFile(veoPath, opts.hookClip);
        const speech0 = await tts({ input: scene.narration });
        const audio0 = join(dir, 'scene-0.mp3');
        await writeFile(audio0, speech0.audio);
        await logTts(speech0.charCount, speech0.model);
        const capFile = join(dir, 'caption-0.txt');
        await writeFile(capFile, wrapCaption(scene.caption), 'utf-8');
        const clip0 = join(dir, 'clip-0.mp4');
        try {
          await runFfmpeg(veoHookClipArgs(veoPath, audio0, capFile, notoSansJpBoldPath(), clip0));
          clipPaths.push(clip0);
          log.info({ scene: 0 }, 'veo hook clip composed');
          continue;
        } catch (err) {
          // Veo フック合成失敗 → 通常の画像スライドにフォールバック。
          log.warn({ err: err instanceof Error ? err.message : String(err) }, 'veo hook compose failed — fallback to image slide');
        }
      }

      // 1. 背景画像（縦型・文字なし）
      const img = await genImage({
        prompt: `${scene.image_prompt} 縦型構図。重要: 画像内に文字・ロゴ・数字を一切描かない。`,
        width: 1024,
        height: 1536,
        quality: 'medium',
        outputFormat: 'jpeg',
        outputCompression: 90,
      });
      const rawImage = img.images[0];
      if (!rawImage) throw new Error(`renderSlideVideo: scene ${i} image empty`);

      // 2. テロップ焼き込み
      const withTelop = await composeTelop(rawImage, scene.caption);
      const imagePath = join(dir, `scene-${i}.jpg`);
      await writeFile(imagePath, withTelop);

      // 3. ナレーション音声
      const speech = await tts({ input: scene.narration });
      const audioPath = join(dir, `scene-${i}.mp3`);
      await writeFile(audioPath, speech.audio);
      await logTts(speech.charCount, speech.model);

      // 4. シーンクリップ
      const clipPath = join(dir, `clip-${i}.mp4`);
      await runFfmpeg(sceneClipArgs(imagePath, audioPath, clipPath));
      clipPaths.push(clipPath);
    }

    // 5. concat（同一エンコードなので -c copy）
    const listPath = join(dir, 'concat.txt');
    await writeFile(listPath, clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
    const concatPath = join(dir, 'concat.mp4');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', concatPath]);

    // 6. BGM を小音量でミックス（ナレーションの下に敷く）。BGM 準備失敗時は concat をそのまま使う。
    let outPath = concatPath;
    const bgmPath = await prepareBgm(dir, runFfmpeg, log);
    if (bgmPath) {
      const mixed = join(dir, 'final.mp4');
      try {
        await runFfmpeg(mixBgmArgs(concatPath, bgmPath, mixed));
        outPath = mixed;
        log.info('BGM mixed under narration');
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, 'BGM ミックス失敗 — BGM なしで出力');
      }
    }

    const video = await readFile(outPath);
    log.info({ sceneCount: scenes.length, bytes: video.byteLength, bgm: bgmPath ? true : false }, 'slide video rendered');
    return { video, sceneCount: scenes.length };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
