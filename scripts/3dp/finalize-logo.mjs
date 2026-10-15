/**
 * `gen-logo.mjs` が出した生成物 (scripts/3dp/out/) を、実際に使う形へ整えて配置する。
 *
 * gpt-image-1 の出力はそのままだと
 *   ・背景が純白ではない (わずかにグレー寄りの画素が混ざる)
 *   ・余白の量が毎回違う
 * ので、**決定論的な後処理**で揃える: 白を閾値付きでトリム → 一定比率の余白を付け直す
 * → 純白に合成 → 用途ごとのサイズへ縮小。ここを手でやると家族の中で浮く。
 *
 * 実行 (API も DB も使わないので env ランチャー不要):
 *   apps/worker/node_modules/.bin/tsx scripts/3dp/finalize-logo.mjs
 *
 * 配置先:
 *   apps/portal/public/tools/3dp.png   ポータルのツールタイル (a2p.png / anp.png と同列)
 *   apps/3dp/public/3dp-logo.png       3DP ヘッダー / ログイン画面のワードマーク
 *   apps/3dp/public/3dp-mark.png       狭幅ヘッダー用の正方形マーク
 *   apps/3dp/app/icon.png              ファビコン
 *
 * **罠**: ファビコンは `app/icon.png` に置く。`public/icon.png` は `app/icon.png` を
 * 影で上書きしてしまう (このリポジトリで実害があった — 栞の favicon)。public には置かない。
 */
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const require = createRequire(path.join(REPO, 'apps', 'worker', 'package.json'));
const sharp = require('sharp');

const OUT_DIR = path.join(REPO, 'scripts', '3dp', 'out');
const WORD_SRC = path.join(OUT_DIR, '3dp-word.png');
const MARK_SRC = path.join(OUT_DIR, '3dp-mark.png');

/**
 * 白地をトリムして、短辺比の余白を付け直し、純白に合成する。
 * `threshold` は「白とみなす差」。小さすぎると生成ノイズを拾って切れないので 12 にしてある。
 */
async function trimAndPad(src, { padRatio }) {
  const trimmed = await sharp(src)
    .trim({ background: '#ffffff', threshold: 12 })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const pad = Math.round(Math.min(width, height) * padRatio);
  return sharp(trimmed.data)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
}

/**
 * フラットな 2 色ロゴなのでパレット PNG に量子化して軽くする
 * (1200px 幅で 380KB → 50KB 前後。a2p.png 86KB / anp.png 180KB と同程度に収まる)。
 */
function encode(pipeline) {
  return pipeline.png({ palette: true, colors: 64, compressionLevel: 9 }).toBuffer();
}

async function write(dest, buffer) {
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buffer);
  const meta = await sharp(buffer).metadata();
  console.log(`${path.relative(REPO, dest)}  ${meta.width}x${meta.height}  ${buffer.byteLength} bytes`);
}

async function main() {
  // --- ワードマーク (横長) ---
  // ポータルのタイルは a2p.png (600x200) / anp.png (1200x437) と同じ横長ワードマーク。
  const wordPadded = await trimAndPad(WORD_SRC, { padRatio: 0.06 });
  const word1200 = await encode(sharp(wordPadded).resize({ width: 1200, withoutEnlargement: true }));
  await write(path.join(REPO, 'apps', 'portal', 'public', 'tools', '3dp.png'), word1200);
  await write(path.join(REPO, 'apps', '3dp', 'public', '3dp-logo.png'), word1200);

  // --- 正方形マーク ---
  // 32x32 でも潰れないよう、マークはトリム後の余白を薄め (8%) にして面積を稼ぐ。
  const markPadded = await trimAndPad(MARK_SRC, { padRatio: 0.08 });
  const mark512 = await encode(
    sharp(markPadded).resize({ width: 512, height: 512, fit: 'contain', background: '#ffffff' }),
  );
  await write(path.join(REPO, 'apps', '3dp', 'public', '3dp-mark.png'), mark512);

  // --- ファビコン (app/icon.png。public には置かない) ---
  const icon256 = await encode(
    sharp(markPadded).resize({ width: 256, height: 256, fit: 'contain', background: '#ffffff' }),
  );
  await write(path.join(REPO, 'apps', '3dp', 'app', 'icon.png'), icon256);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
