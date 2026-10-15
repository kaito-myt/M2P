/**
 * 3DP のロゴ / マーク / ファビコンを、既存の画像生成経路
 * (`packages/agents/src/tools/image-gen.ts` の `generateImage`、モデルは `IMAGE_MODEL`
 *  = 既定 gpt-image-2 / env `OPENAI_IMAGE_MODEL` で上書き可) で生成する (運営者指示 2026-10-15)。
 *
 * **デザインの制約**: A2P (`apps/portal/public/tools/a2p.png`) と ANP (`anp.png`) と
 * 同じ家族に見えること。実測した共通項:
 *   - 純白背景・フラットなベクター調
 *   - 濃紺 (#13294b 前後) のインク + シアン/ティール (#22c3d6 前後) のアクセント 1 色
 *   - 太いジオメトリックサンセリフのワードマーク。A2P は 3 文字のうち中央 (2) だけがシアン
 *   - ワードマークの下に字間を広げた小さな英語タグライン
 * 3DP はこれに倣い「3」をシアン、「DP」を濃紺にして A2P と明示的に韻を踏ませる。
 *
 * **コスト記録 (CLAUDE.md Hard Rule #5)**: 画像生成は必ず `withImageLogging` を通す。
 * role は `tdp.logo` — `defaultToolForRole()` が `tdp.*` を `3dp` に帰属させるので
 * `token_usage.tool='3dp'` で 1 行残り、ポータルのツール別コストに乗る。
 *
 * 実行 (DB/鍵は Railway から。秘密情報はファイルに書かない):
 *   bash scripts/3dp/tdp-env.sh apps/worker/node_modules/.bin/tsx scripts/3dp/gen-logo.mjs --dry-run
 *   bash scripts/3dp/tdp-env.sh apps/worker/node_modules/.bin/tsx scripts/3dp/gen-logo.mjs
 *
 * オプション:
 *   --dry-run      プロンプトを表示するだけ (API 呼び出し・ファイル書き込みをしない = コスト 0)
 *   --only=word,mark  生成対象を絞る (既定: 両方)
 *   --out=DIR      出力先ディレクトリ (既定: scripts/3dp/out)
 *
 * 出力 (このスクリプトは**候補を out/ に置くだけ**。採用は目で見てから手で配る):
 *   out/3dp-word.png   ワードマーク (横長)
 *   out/3dp-mark.png   正方形マーク (ファビコン元)
 */
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import {
  generateImage as rawGenerateImage,
  withImageLogging,
} from '../../packages/agents/src/index.ts';

const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');

// @a2p/db (Prisma) は DATABASE_URL を要求する。tdp-env.sh は DBURL も export する。
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.DBURL || '';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = new Set(
  ((args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'word,mark').split(','),
);
const OUT_DIR =
  (args.find((a) => a.startsWith('--out=')) || '').split('=')[1] ||
  path.join(REPO, 'scripts', '3dp', 'out');

/** A2P / ANP と共有するブランド指定。ここを両ロゴから読み取った値に固定する。 */
const BRAND = [
  'Flat vector logo on a pure white background. No photo, no 3D render, no gradient mesh, no shadow, no texture, no frame, no border.',
  'Palette: exactly two colors — a deep navy (#13294B) as the main ink and a bright cyan-teal (#22C3D6) as the single accent. No other hue.',
  'Geometry: clean, precise, perfectly straight edges; the look of a professional SaaS brand mark drawn in Illustrator.',
].join(' ');

function buildWordmarkPrompt() {
  return [
    'Design a horizontal logo lockup for a software product called "3DP".',
    BRAND,
    'Layout, left to right: (1) a compact isometric cube icon, (2) the wordmark "3DP", and centered beneath the wordmark a small tagline.',
    'The isometric cube: a simple hollow/outlined box drawn in true isometric projection with three visible faces. Two faces are deep navy; the top face is the cyan accent. It reads instantly as "a 3D object". Keep it geometric and minimal — no wireframe noise, no grid lines, no extra cubes.',
    'The wordmark: the three characters 3, D, P in a heavy geometric sans-serif (very bold, tight tracking, flat color, no outline, no bevel).',
    'CRITICAL coloring of the wordmark: the digit "3" is the cyan accent (#22C3D6); the letters "D" and "P" are deep navy (#13294B). Exactly this, nothing else colored.',
    'The tagline, set in a medium-weight sans-serif, deep navy, noticeably smaller than the wordmark, with generous letter-spacing, reading EXACTLY: 3D Products Publisher',
    'Render the text with perfect, standard Latin letterforms. Do not misspell, do not add, drop, duplicate or reorder any character. Only the strings "3DP" and "3D Products Publisher" appear in the image — no other words, no slogans, no watermark, no URL, no registered/trademark symbol.',
    'Generous white margin on all four sides. The whole lockup is horizontally and vertically centered.',
  ].join('\n');
}

function buildMarkPrompt() {
  return [
    'Design a square app icon / brand mark for a software product called "3DP".',
    BRAND,
    'The mark is a single compact isometric cube: a simple box in true isometric projection with three visible faces. The two side faces are deep navy (#13294B), the top face is the cyan accent (#22C3D6). Crisp straight edges, thick confident shapes, perfectly symmetrical about the vertical axis.',
    'No text, no letters, no digits, no numbers anywhere in the image.',
    'The cube is centered with comfortable white margin on all four sides, so the mark still reads clearly at 32x32 pixels.',
    'No frame, no rounded-square badge behind it, no background color — the background is plain white.',
  ].join('\n');
}

async function main() {
  const jobs = [];
  if (ONLY.has('word')) {
    jobs.push({
      name: '3dp-word.png',
      prompt: buildWordmarkPrompt(),
      // gpt-image-1 の landscape。横長ロックアップはこの比率が一番素直に出る。
      width: 1536,
      height: 1024,
    });
  }
  if (ONLY.has('mark')) {
    jobs.push({ name: '3dp-mark.png', prompt: buildMarkPrompt(), width: 1024, height: 1024 });
  }

  if (DRY_RUN) {
    for (const j of jobs) {
      console.log(`\n===== ${j.name} (${j.width}x${j.height}) =====\n${j.prompt}`);
    }
    console.log('\n--dry-run のため API 呼び出し・書き込みはしていません (コスト 0)。');
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });

  for (const j of jobs) {
    // CLAUDE.md Hard Rule #5 — 画像生成は必ず token_usage に記録する。
    // role='tdp.logo' → cost-attribution が tool='3dp' に帰属させる。
    const generate = withImageLogging(rawGenerateImage, {
      role: 'tdp.logo',
      themeSessionId: 'tdp-brand-logo',
    });
    const result = await generate({
      prompt: j.prompt,
      width: j.width,
      height: j.height,
      count: 1,
      quality: 'high',
      outputFormat: 'png',
    });
    const image = result.images[0];
    if (!image || image.byteLength === 0) {
      console.error(`[${j.name}] 画像が空で返りました`);
      continue;
    }
    const dest = path.join(OUT_DIR, j.name);
    await writeFile(dest, image);
    console.log(`[${j.name}] ${dest} (${image.byteLength} bytes, cost ¥${result.costJpy})`);
  }

  console.log('\n生成物は out/ に置きました。目で確認してから配置してください。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
