/**
 * [F-ANP-55] アイキャッチ 1 パス生成の目視検証用プローブ。
 *
 * 本番の記事データ (ニッチ・タイトル・フック・アイキャッチのコピー) を使って
 * `generateNoteEyecatch` を走らせ、**R2 も DB も触らず**ローカルに画像を保存する。
 * 「画像モデルに日本語を描かせる」判断は目で見ないと検証できないので、
 * 本番へ入れる前にこれで確認する。
 *
 * 使い方:
 *   bash scripts/anp/anp-env.sh apps/worker/node_modules/.bin/tsx \
 *     scripts/anp/probe-eyecatch-onepass.mjs --out=<dir> [--limit=2] [--niche=競馬] [--check]
 *
 *   --check を付けると文字崩れのビジョン検査も走らせる (prompts に
 *   role='anp.eyecatch_text_check' の active 行が必要)。
 *
 * 注意: 画像生成は実課金。token_usage には本番と同じく記録される (jobId は渡さない)。
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/DEV/M2P';
const args = process.argv.slice(2);
const argOf = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const OUT = argOf('out', path.join(ROOT, 'tmp-eyecatch'));
const LIMIT = Number(argOf('limit', '2'));
const NICHE = argOf('niche');
const WITH_CHECK = args.includes('--check');

if (!process.env.DATABASE_URL && process.env.DBURL) process.env.DATABASE_URL = process.env.DBURL;

const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

async function main() {
  const agents = pathToFileURL(path.join(ROOT, 'packages', 'agents', 'src', 'anp') + path.sep);
  const { generateNoteEyecatch, buildPrompt } = await import(new URL('eyecatch.ts', agents).href);

  await fs.mkdir(OUT, { recursive: true });
  const pg = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const { rows } = await pg.query(
    `SELECT a.id, a.title, a.eyecatch_copy, a.eyecatch_sub, a.note_account_id,
            acc.niche, acc.editorial_policy, t.hook
       FROM note_articles a
       JOIN note_accounts acc ON acc.id = a.note_account_id
       LEFT JOIN note_themes t ON t.id = a.theme_id
      WHERE a.eyecatch_copy IS NOT NULL AND a.eyecatch_copy <> ''
        ${NICHE ? `AND acc.niche LIKE '%${NICHE.replace(/'/g, '')}%'` : ''}
      ORDER BY a.updated_at DESC
      LIMIT ${Number.isFinite(LIMIT) ? LIMIT : 2}`,
  );
  console.log(`[probe] 対象 ${rows.length} 件 → ${OUT}`);

  for (const r of rows) {
    const input = {
      noteArticleId: r.id,
      title: r.title,
      hook: r.hook ?? '',
      niche: r.niche,
      eyecatchCopy: r.eyecatch_copy,
      eyecatchSub: r.eyecatch_sub,
      editorialPolicy: r.editorial_policy,
    };
    console.log(`\n--- ${r.id} [${r.niche}]`);
    console.log(`  コピー: ${r.eyecatch_copy} / 補足: ${r.eyecatch_sub ?? '-'}`);

    const files = [];
    const t0 = Date.now();
    try {
      const result = await generateNoteEyecatch(input, {
        skipTextCheck: !WITH_CHECK,
        // R2 には上げず、ローカルに落として目で見る。
        uploadBuffer: async (key, buffer) => {
          const file = path.join(OUT, `${r.niche.slice(0, 6)}-${r.id.slice(0, 8)}.jpg`);
          await fs.writeFile(file, buffer);
          files.push(file);
          return { key };
        },
      });
      console.log(
        `  → style=${result.styleKey} layout=${result.layoutKey} genre=${result.genreKey}`
        + ` mode=${result.textMode} retries=${result.textRetries} ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      console.log(`  → ${files.join(', ')}`);
      await fs.writeFile(
        path.join(OUT, `${r.id.slice(0, 8)}-prompt.txt`),
        result.promptUsed,
        'utf8',
      );
    } catch (e) {
      console.error(`  !! ${e?.message ?? e}`);
      if (e?.cause) console.error(`     cause: ${e.cause?.message ?? e.cause}`);
    }
  }

  await pg.end();
  // buildPrompt が未使用だと lint が鳴るので触っておく (プロンプト単体の確認に使える)。
  void buildPrompt;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
