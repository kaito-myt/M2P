/**
 * SNS チャンネルのペルソナ画像（アイコン/カバー/IGカルーセル固定テンプレ枚）を、
 * 人物描写ルール(顔出し禁止・首から下のみ・フェミニンでセクシー路線, `PERSONA_VISUAL_RULES`)
 * を適用した新プロンプトで再生成し、R2 の同じキーへ上書き保存する（運営者要望 2026-09）。
 *
 * 既存オブジェクトは `<key>.bak-<ts>` に退避してから上書きする(regen-book-pdfs.mjs と同じ安全策)。
 * `--dry-run` はプロンプトを表示するだけで API 呼び出し/アップロードをしない(コストゼロ確認用)。
 *
 * 実行 (DB/R2 の env は pb-env.sh 経由):
 *   bash scripts/paperback/pb-env.sh corepack pnpm exec tsx scripts/regen-channel-visuals.mjs --dry-run
 *   OPENAI_API_KEY=sk-... bash scripts/paperback/pb-env.sh corepack pnpm exec tsx scripts/regen-channel-visuals.mjs
 *
 * オプション:
 *   --channel=instagram   対象チャンネル1つに絞る(省略時は strategy_json 有り全チャンネル)
 *   --only=avatar,banner,template  再生成対象を絞る(省略時は全部)
 *   --force                既に生成済みの IG カルーセル固定テンプレ枚も強制的に作り直す
 *   --dry-run              プロンプトのみ表示。API 呼び出し/アップロード/DB更新をしない
 *
 * 注意: 本スクリプトは「用意」のみが目的で、実行(実際の API 呼び出し)は運営者が判断して行うこと。
 */
import { createRequire } from 'module';
import path from 'path';
import { readFile } from 'fs/promises';

import {
  generateStrategyImages,
  withPersonaVisualRules,
  generateImage as rawGenerateImage,
  withImageLogging,
} from '../packages/agents/src/index.ts';
import { buildCarouselTemplatePrompt } from '../apps/worker/src/tasks/promotion-post/carousel.ts';
import { channelAvatar, channelBanner, channelCarouselTemplate } from '../packages/storage/src/keys.ts';
import { uploadBuffer, downloadBuffer, getSignedDownloadUrl } from '../packages/storage/src/operations.ts';

const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '..');
const req = createRequire(path.join(REPO, 'package.json'));
const { Client } = req(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

// @a2p/db (Prisma) は DATABASE_URL を要求する。pb-env.sh は DBURL しか export しないため補完する。
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.DBURL || '';

const args = process.argv.slice(2);
const CHANNEL = (args.find((a) => a.startsWith('--channel=')) || '').split('=')[1] || null;
const ONLY = new Set(
  ((args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'avatar,banner,template').split(','),
);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const CAROUSEL_TEMPLATE_KEY_FIELD = 'carousel_template_key';

async function resolveOpenAiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const txt = await readFile(path.join(REPO, '.env.local'), 'utf8');
    const m = txt.match(/^OPENAI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
  } catch {
    /* .env.local が無ければ無視 */
  }
  throw new Error(
    'OPENAI_API_KEY が未設定です。`export OPENAI_API_KEY=sk-...` するか .env.local に設定してください。',
  );
}

/**
 * 既存オブジェクトがあれば `<key>.bak-<ts>` に退避する(無ければ何もしない)。
 * GET 失敗(未存在含む)は握りつぶし、退避なしで上書きへ進む(一回性メンテナンススクリプトのため
 * バックアップ失敗で生成自体を止めない判断)。
 */
async function backupIfExists(key, ts) {
  const existing = await downloadBuffer(key).catch(() => null);
  if (!existing) return false;
  await uploadBuffer(`${key}.bak-${ts}`, existing, 'application/octet-stream');
  return true;
}

async function main() {
  const apiKey = DRY_RUN ? null : await resolveOpenAiKey();
  // getApiKey('openai') の DB 参照(API_CRED_KEY 復号)を経由せず、env のキーを直接使う
  // (backfill-blog-covers.ts と同じ判断: 一回性スクリプトは DB 復号に依存しない)。
  // token_usage への計上(CLAUDE.md ルール#5)は withImageLogging に委ねる(DATABASE_URL は上で補完済み)。
  const withApiKey = apiKey
    ? (genArgs, innerDeps) => rawGenerateImage(genArgs, { ...innerDeps, getApiKey: async () => apiKey })
    : null;
  const strategyImageFn = withApiKey
    ? withImageLogging(withApiKey, { role: 'sns_strategist', themeSessionId: 'regen-channel-visuals' })
    : null;
  const templateImageFn = withApiKey
    ? withImageLogging(withApiKey, { role: 'promo_image', themeSessionId: 'regen-channel-visuals:template' })
    : null;

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const where = CHANNEL ? 'WHERE channel = $1' : '';
  const params = CHANNEL ? [CHANNEL] : [];
  const rows = (
    await c.query(
      `SELECT channel, strategy_json, config_json FROM promotion_channel_settings ${where} ORDER BY channel`,
      params,
    )
  ).rows;

  console.log(`対象チャンネル: ${rows.length}件 (only=${[...ONLY].join('/')}, force=${FORCE}, dry-run=${DRY_RUN})`);
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);

  const failures = [];
  async function attempt(label, fn) {
    for (let i = 0; i < 2; i++) {
      try {
        return await fn();
      } catch (e) {
        const msg = String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 160);
        console.log(`[${label}] 失敗 (${i + 1}/2): ${msg}`);
      }
    }
    failures.push(label);
    return null;
  }

  for (const row of rows) {
    const channel = row.channel;
    const strategy = row.strategy_json || {};
    const config = row.config_json || {};
    console.log(`\n=== ${channel} ===`);

    // --- avatar / banner ---
    if ((ONLY.has('avatar') || ONLY.has('banner')) && strategy.avatar_prompt && strategy.banner_prompt) {
      const avatarPrompt = withPersonaVisualRules(strategy.avatar_prompt);
      const bannerPrompt = withPersonaVisualRules(strategy.banner_prompt);
      if (DRY_RUN) {
        console.log(`[avatar prompt] ${avatarPrompt}`);
        console.log(`[banner prompt] ${bannerPrompt}`);
      } else {
        const images = await attempt(`${channel}:avatar/banner`, () =>
          generateStrategyImages(
            { avatar_prompt: strategy.avatar_prompt, banner_prompt: strategy.banner_prompt },
            { generateImage: strategyImageFn },
          ),
        );
        if (images && ONLY.has('avatar')) {
          const key = channelAvatar(channel);
          const backed = await backupIfExists(key, ts);
          await uploadBuffer(key, images.avatar, 'image/png');
          console.log(`[avatar] 更新 ${key}${backed ? ' (旧版を .bak- に退避)' : ''}`);
        }
        if (images && ONLY.has('banner')) {
          const key = channelBanner(channel);
          const backed = await backupIfExists(key, ts);
          await uploadBuffer(key, images.banner, 'image/jpeg');
          console.log(`[banner] 更新 ${key}${backed ? ' (旧版を .bak- に退避)' : ''}`);
        }
      }
    } else if (ONLY.has('avatar') || ONLY.has('banner')) {
      console.log('[avatar/banner] strategy_json が未生成のためスキップ (先に「アカウント戦略」を生成してください)');
    }

    // --- IG カルーセル固定テンプレ枚 ---
    if (ONLY.has('template')) {
      const existingKey = config[CAROUSEL_TEMPLATE_KEY_FIELD];
      if (existingKey && !FORCE) {
        console.log(`[template] 既に生成済み (${existingKey}) — 再生成するには --force を付与`);
      } else {
        const prompt = buildCarouselTemplatePrompt();
        if (DRY_RUN) {
          console.log(`[template prompt] ${prompt}`);
        } else {
          const result = await attempt(`${channel}:template`, () =>
            templateImageFn({
              prompt,
              width: 1024,
              height: 1024,
              quality: 'high',
              outputFormat: 'jpeg',
              outputCompression: 90,
            }),
          );
          const image = result ? result.images[0] : null;
          if (!image) {
            console.log('[template] 生成失敗 (画像が空で返った)');
          } else {
            const key = channelCarouselTemplate(channel);
            const backed = await backupIfExists(key, ts);
            await uploadBuffer(key, image, 'image/jpeg');
            await c.query(
              `UPDATE promotion_channel_settings SET config_json = COALESCE(config_json, '{}'::jsonb) || $2::jsonb WHERE channel = $1`,
              [channel, JSON.stringify({ [CAROUSEL_TEMPLATE_KEY_FIELD]: key })],
            );
            console.log(`[template] 更新 ${key}${backed ? ' (旧版を .bak- に退避)' : ''}`);
          }
        }
      }
    }
  }

  if (failures.length > 0) console.log(`\n!!! 失敗した項目 (再実行してください): ${failures.join(', ')}`);
  if (!DRY_RUN) {
    console.log('\n--- 確認用 署名URL (24h) ---');
    for (const row of rows) {
      const channel = row.channel;
      for (const key of [channelAvatar(channel), channelBanner(channel), channelCarouselTemplate(channel)]) {
        const url = await downloadBuffer(key)
          .then((buf) => (buf ? getSignedDownloadUrl(key, 24 * 3600) : null))
          .catch(() => null);
        if (url) console.log(`${key} -> ${url}`);
      }
    }
    console.log('\navatar/banner は各SNSのプロフィールへ運営者が手動で適用してください。');
  }

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
