/**
 * [F-ANP-53 / F-ANP-54] 未公開記事のタイトル・アイキャッチを新しい作法で作り直す。
 *
 * 2026-10-13 に「タイトルの型が 96/100 で同じ」「サムネの下半分が濁っていた」「ジャンルで
 * 勝ち筋が正反対なのに作法が 1 つしかなかった」の 3 点を直したので、**まだ note に出していない
 * 記事**を新しい作法で作り直す。公開済みの記事は note 側の画像を差し替えられない
 * (エディタ操作が要る) ので対象外。
 *
 * 本番と同じ経路を通す:
 *   - タイトル/リード/見出し/ハッシュタグ/アイキャッチのコピー = `runNoteSeoStep` (worker の実装)
 *   - アイキャッチ画像 = `generateNoteEyecatch` (role='anp.eyecatch' のモデル割当を解決)
 * どちらも `token_usage` に記録される (CLAUDE.md ハードルール 5)。
 *
 * 使い方:
 *   bash scripts/paperback/pb-env.sh apps/worker/node_modules/.bin/tsx \
 *     scripts/anp/regen-title-eyecatch.mjs [--limit=6] [--niche=競馬] [--dry] [--titles-only] [--image-only]
 *   環境変数: DBURL / R2_* / OPENAI_API_KEY (pb-env.sh が供給)
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
const LIMIT = Number(argOf('limit', '6'));
const NICHE = argOf('niche');
const ONLY_ID = argOf('article');
const DRY = args.includes('--dry');
const TITLES_ONLY = args.includes('--titles-only');
const IMAGE_ONLY = args.includes('--image-only');

if (!process.env.DATABASE_URL && process.env.DBURL) process.env.DATABASE_URL = process.env.DBURL;

const req = createRequire(path.join(ROOT, 'packages', 'storage') + path.sep);
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);
const { S3Client, PutObjectCommand } = req('@aws-sdk/client-s3');

async function load() {
  const agents = pathToFileURL(path.join(ROOT, 'packages', 'agents', 'src', 'anp') + path.sep);
  const worker = pathToFileURL(path.join(ROOT, 'apps', 'worker', 'src', 'tasks', 'lib') + path.sep);
  return {
    eyecatch: await import(new URL('eyecatch.ts', agents).href),
    seoStep: await import(new URL('note-seo-step.ts', worker).href),
    db: await import(pathToFileURL(path.join(ROOT, 'packages', 'db', 'index.ts')).href),
  };
}

async function main() {
  const { eyecatch, seoStep, db } = await load();
  const pg = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  const where = ONLY_ID
    ? `a.id = '${ONLY_ID.replace(/'/g, '')}'`
    : [
        "a.publish_status = 'draft'",
        "a.status IN ('ready','needs_human_review')",
        'a.body_md IS NOT NULL',
        NICHE ? `acc.niche LIKE '%${NICHE.replace(/'/g, '')}%'` : '',
      ]
        .filter(Boolean)
        .join(' AND ');

  const { rows } = await pg.query(
    `SELECT a.id, a.title, a.eyecatch_r2_key, a.note_account_id,
            acc.niche, acc.tone, acc.target_reader, acc.editorial_policy, t.hook
       FROM note_articles a
       JOIN note_accounts acc ON acc.id = a.note_account_id
       LEFT JOIN note_themes t ON t.id = a.theme_id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT ${Number.isFinite(LIMIT) ? LIMIT : 6}`,
  );
  console.log(`[regen] 対象 ${rows.length} 件${DRY ? ' (dry-run)' : ''}`);

  const usedStyles = [];
  for (const r of rows) {
    console.log(`\n--- ${r.id} [${r.niche}]`);
    console.log(`  旧タイトル: ${r.title}`);
    if (DRY) continue;

    let title = r.title;
    let copy = null;
    let sub = null;

    if (!IMAGE_ONLY) {
      const seo = await seoStep.runNoteSeoStep(
        db.prisma,
        {
          noteArticleId: r.id,
          jobId: null, // 実在しない job_id を渡すと token_usage の FK で落ちてコストが記録されない
          noteAccountId: r.note_account_id,
          currentTitle: r.title,
          hook: r.hook ?? null,
          account: {
            niche: r.niche,
            tone: r.tone,
            target_reader: r.target_reader,
            editorial_policy: r.editorial_policy,
          },
        },
        { logger: { warn: (o, m) => console.log('  warn:', m, o?.err?.message ?? '') } },
      );
      if (!seo.applied) {
        console.log('  SEO が走らなかった — スキップ');
        continue;
      }
      title = seo.title;
      copy = seo.eyecatchCopy;
      sub = seo.eyecatchSub;
      console.log(`  新タイトル: ${title}`);
      console.log(`  コピー    : ${copy} / ${sub ?? '-'}`);
    } else {
      const cur = await pg.query(
        'SELECT title, eyecatch_copy, eyecatch_sub FROM note_articles WHERE id=$1',
        [r.id],
      );
      title = cur.rows[0].title;
      copy = cur.rows[0].eyecatch_copy;
      sub = cur.rows[0].eyecatch_sub;
    }

    if (TITLES_ONLY) continue;

    let saved = null;
    const res = await eyecatch.generateNoteEyecatch(
      {
        noteArticleId: r.id,
        title,
        hook: r.hook ?? title,
        niche: r.niche,
        eyecatchCopy: copy,
        eyecatchSub: sub,
        editorialPolicy: r.editorial_policy,
        recentStyleKeys: usedStyles.slice(-3),
      },
      {
        uploadBuffer: async (key, buf, contentType) => {
          const target = r.eyecatch_r2_key || key;
          await s3.send(
            new PutObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: target,
              Body: buf,
              ContentType: contentType,
            }),
          );
          saved = { key: target, size: buf.length };
          return null;
        },
      },
    );
    usedStyles.push(res.styleKey);
    if (!saved) {
      console.log('  画像が返らなかった — スキップ');
      continue;
    }
    if (!r.eyecatch_r2_key) {
      await pg.query('UPDATE note_articles SET eyecatch_r2_key=$2 WHERE id=$1', [r.id, saved.key]);
    }
    await pg.query('UPDATE note_articles SET eyecatch_alt=$2 WHERE id=$1', [r.id, res.alt]);
    console.log(
      `  画像      : ${res.genreKey}/${res.styleKey}/${res.layoutKey} (${saved.size} bytes) -> ${saved.key}`,
    );
  }
  await pg.end();
  await db.prisma.$disconnect().catch(() => {});
}

main().catch((e) => {
  console.error('[regen] fatal:', e.message);
  process.exit(1);
});
