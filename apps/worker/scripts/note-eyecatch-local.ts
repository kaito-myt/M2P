/**
 * [F-ANP-49] アイキャッチ生成を**ローカルから**1 本だけ試すスクリプト（見た目の確認用）。
 *
 *   bash scripts/paperback/pb-env.sh node node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/note-eyecatch-local.ts <note_article_id> [--out=<path>]
 *
 * 記事の `eyecatch_copy` / `eyecatch_sub`（anp.seo の出力）を使って実際に画像を生成し、
 * R2 に保存する（= 通常の `pipeline.note.eyecatch` と同じ副作用）。`--out` を渡すと
 * ローカルにも保存する。**公開はしない**。
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { generateNoteEyecatch } from '@a2p/agents/anp/eyecatch';

const require_ = createRequire(path.join('C:/DEV/M2P', 'package.json'));
const { Client } = require_(path.join('C:/DEV/M2P', 'node_modules/.pnpm/pg@8.21.0/node_modules/pg')) as {
  Client: new (opts: unknown) => {
    connect: () => Promise<void>;
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    end: () => Promise<void>;
  };
};

async function main(): Promise<void> {
  const articleId = process.argv[2];
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  if (!articleId) {
    console.error('usage: note-eyecatch-local.ts <note_article_id> [--out=<path>]');
    process.exit(1);
  }

  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(
    `select a.id, a.title, a.lead, a.eyecatch_copy, a.eyecatch_sub, t.hook, acc.niche, acc.editorial_policy
       from note_articles a
       join note_accounts acc on acc.id = a.note_account_id
       left join note_themes t on t.id = a.theme_id
      where a.id = $1`,
    [articleId],
  );
  await c.end();
  const row = rows[0];
  if (!row) throw new Error('記事が見つかりません');

  // anp.seo の出力は `seo_json` ではなく **専用カラム** に入る (note-seo-step.ts)。
  const copyArg = process.argv.find((a) => a.startsWith('--copy='));
  const subArg = process.argv.find((a) => a.startsWith('--sub='));
  const copy = copyArg ? copyArg.slice('--copy='.length) : ((row.eyecatch_copy as string | null) ?? null);
  const sub = subArg ? subArg.slice('--sub='.length) : ((row.eyecatch_sub as string | null) ?? null);
  console.log('title:', row.title);
  console.log('copy :', copy, '/ sub:', sub);

  const result = await generateNoteEyecatch({
    noteArticleId: String(row.id),
    title: String(row.title),
    hook: String(row.hook ?? row.lead ?? ''),
    niche: String(row.niche),
    eyecatchCopy: copy,
    eyecatchSub: sub,
    editorialPolicy: (row.editorial_policy as string | null) ?? null,
  });
  console.log('r2Key:', result.r2Key, 'styleKey:', result.styleKey, 'composedText:', result.composedText);

  if (outArg) {
    const { downloadBuffer } = await import('@a2p/storage');
    const buf = await downloadBuffer(result.r2Key);
    if (buf) {
      writeFileSync(outArg.slice('--out='.length), buf);
      console.log('saved:', outArg.slice('--out='.length));
    }
  }
}

main().catch((e: unknown) => {
  console.error('fatal:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
