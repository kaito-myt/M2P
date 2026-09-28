/**
 * [F-ANP-48] `fixTablesOne` を**ローカルから**実行して動作を確かめる検証用スクリプト。
 *
 *   bash scripts/paperback/pb-env.sh node node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/note-fix-tables-local.ts <note_article_id> [--real]
 *
 * 既定はドライラン（差し替えるところまでで「更新する」を押さない）。note は公開中の本文を
 * 「更新する」まで変えないので、ドライランでは公開記事は変わらない。
 * Railway へデプロイし直さずに DOM 操作の当たりを確認するために使う。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { buildNoteBlocks } from '../src/tasks/note-publish/build-blocks.js';
import { attachTableImages, countMarkdownJunk } from '../src/tasks/note-publish/table-images.js';
import { createPlaywrightNotePublishPort } from '../src/tasks/note-publish/playwright-note-publish-port.js';

const require_ = createRequire(path.join('C:/DEV/M2P', 'package.json'));
const { Client } = require_(path.join('C:/DEV/M2P', 'node_modules/.pnpm/pg@8.21.0/node_modules/pg')) as {
  Client: new (opts: unknown) => {
    connect: () => Promise<void>;
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    end: () => Promise<void>;
  };
};

function decrypt(b64: string, keyHex: string): string {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

async function main(): Promise<void> {
  const articleId = process.argv[2];
  const real = process.argv.includes('--real');
  if (!articleId) {
    console.error('usage: note-fix-tables-local.ts <note_article_id> [--real]');
    process.exit(1);
  }

  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(
    `select a.id, a.title, a.body_md, a.paid, a.paywall_line_pos, a.note_url,
            acc.niche, acc.session_state_enc
       from note_articles a join note_accounts acc on acc.id = a.note_account_id
      where a.id = $1`,
    [articleId],
  );
  await c.end();
  const row = rows[0];
  if (!row) throw new Error('記事が見つかりません');

  const sessionState = decrypt(String(row.session_state_enc), String(process.env.KDP_CRED_KEY));
  const stageDir = mkdtempSync(path.join(tmpdir(), 'note-fixtables-local-'));

  const built = buildNoteBlocks(String(row.body_md ?? ''), row.paywall_line_pos as number | null);
  const free = await attachTableImages(built.freeBlocks, {
    articleId,
    stageDir,
    niche: row.niche as string | null,
  });
  const paid = await attachTableImages(
    built.paidBlocks,
    { articleId, stageDir, niche: row.niche as string | null },
    free.nextIndex,
  );
  const tableImages = [...free.blocks, ...paid.blocks]
    .filter((b) => b.kind === 'table' && b.imagePath)
    .map((b) => b.imagePath!);

  console.log('title:', row.title);
  console.log('tables:', tableImages.length, 'stageDir:', stageDir, 'dryRun:', !real);

  const port = createPlaywrightNotePublishPort();
  const result = await port.fixTablesOne({
    articleId,
    noteUrl: String(row.note_url),
    tableImages,
    paid: Boolean(row.paid),
    freeBlockCount: free.blocks.length,
    sessionState,
    dryRun: !real,
    forceUpdate: tableImages.length > 0 || countMarkdownJunk(String(row.body_md ?? '')) > 0,
    stageDir,
  });
  console.log('result:', JSON.stringify(result, null, 1));
}

main().catch((e: unknown) => {
  console.error('fatal:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
