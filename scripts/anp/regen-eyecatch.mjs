/**
 * 既存 note 記事のアイキャッチを新しい画風 (F-ANP-14b) で再生成して R2 を上書きする。
 *
 * 運営者指摘 (2026-09-24)「サムネがすべて一緒 / AI 感が強すぎる」で画風レシピを入れ替えたが、
 * 生成済みの画像は R2 に残ったままなので、このスクリプトで作り直す。
 * note に公開済みの記事は **note 側の画像は差し替わらない** (note のエディタ操作が必要) ので、
 * ここで作った画像を運営者が note の記事編集画面で貼り替えるか、下書き段階の記事に適用する。
 *
 * 使い方 (ローカル):
 *   bash scripts/paperback/pb-env.sh apps/worker/node_modules/.bin/tsx scripts/anp/regen-eyecatch.mjs --account=note-acc-1 [--limit=10] [--dry]
 *   bash scripts/paperback/pb-env.sh apps/worker/node_modules/.bin/tsx scripts/anp/regen-eyecatch.mjs --article=<id>
 *   (TS を直接 import するため node ではなく tsx で実行する)
 *   環境変数: DBURL / R2_* / OPENAI_API_KEY (pb-env.sh が供給。OPENAI_API_KEY は Railway から export しておく)
 *   DATABASE_URL は DBURL から自動で補う (withImageLogging が token_usage へ 1 行入れるため必須 — CLAUDE.md 規則 5)
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/DEV/M2P';
const args = process.argv.slice(2);
const argOf = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ACCOUNT = argOf('account');
const ARTICLE = argOf('article');
const LIMIT = Number(argOf('limit', '20'));
const DRY = args.includes('--dry');
// 画像生成は必ず token_usage に記録する (withImageLogging は既定 prisma を使うので DATABASE_URL が必要)。
if (!process.env.DATABASE_URL && process.env.DBURL) process.env.DATABASE_URL = process.env.DBURL;

const req = createRequire(path.join(ROOT, 'packages', 'storage') + path.sep);
const { Client } = createRequire(path.join(ROOT, 'package.json'))(path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const { S3Client, PutObjectCommand } = req('@aws-sdk/client-s3');

async function loadAgents() {
  const base = pathToFileURL(path.join(ROOT, 'packages', 'agents', 'src', 'anp') + path.sep);
  const style = await import(new URL('eyecatch-style.ts', base).href);
  const eyecatch = await import(new URL('eyecatch.ts', base).href);
  return { style, eyecatch };
}

async function main() {
  if (!ACCOUNT && !ARTICLE) {
    console.error('--account=<note_account_id> か --article=<note_article_id> を指定してください');
    process.exit(1);
  }
  const { style, eyecatch } = await loadAgents();
  const db = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    forcePathStyle: true,
  });

  const where = ARTICLE ? 'a.id = $1' : 'a.note_account_id = $1';
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.eyecatch_r2_key, a.eyecatch_copy, a.eyecatch_sub, acc.niche, acc.editorial_policy, t.hook
       FROM note_articles a
       JOIN note_accounts acc ON acc.id = a.note_account_id
       LEFT JOIN note_themes t ON t.id = a.theme_id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT ${Number.isFinite(LIMIT) ? LIMIT : 20}`,
    [ARTICLE || ACCOUNT],
  );
  console.log(`[regen-eyecatch] 対象 ${rows.length} 件${DRY ? ' (dry-run)' : ''}`);

  const used = [];
  for (const r of rows) {
    const chosen = style.pickEyecatchStyle(r.id, used.slice(-3));
    used.push(chosen.key);
    console.log(`- ${r.id} style=${chosen.key} copy=${r.eyecatch_copy ?? '(なし)'} ${r.title.slice(0, 26)}`);
    if (DRY) continue;

    // F-ANP-41: 本番と同じ経路 (画像モデル割当 + キャッチコピーの実フォント合成) を通す。
    let saved = null;
    const res = await eyecatch.generateNoteEyecatch(
      {
        noteArticleId: r.id,
        title: r.title,
        hook: r.hook ?? r.title,
        niche: r.niche,
        eyecatchCopy: r.eyecatch_copy ?? null,
        eyecatchSub: r.eyecatch_sub ?? null,
        editorialPolicy: r.editorial_policy,
      },
      {
        // generateImage は渡さない: 本番と同じく role='anp.eyecatch' のモデル割当
        // (既定 Nano Banana 2) を解決させ、token_usage も agent 側で記録させる。
        uploadBuffer: async (key, buf, contentType) => {
          const target = r.eyecatch_r2_key || key;
          await s3.send(
            new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: target, Body: buf, ContentType: contentType }),
          );
          saved = { key: target, size: buf.length };
          return null;
        },
      },
    );
    if (!saved) {
      console.log('  画像が返らなかった — スキップ');
      continue;
    }
    if (!r.eyecatch_r2_key) await db.query('UPDATE note_articles SET eyecatch_r2_key=$2 WHERE id=$1', [r.id, saved.key]);
    console.log(`  saved ${saved.key} (${saved.size} bytes, 文字=${String(res.composedText)})`);
  }
  await db.end();
}

main().catch((e) => {
  console.error('[regen-eyecatch] fatal:', e.message);
  process.exit(1);
});
