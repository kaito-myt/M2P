/**
 * [F-ANP-48] Markdown 記法の流し込みが note 上で意図どおりになるかを**下書きで**確かめる。
 *
 *   DATABASE_URL=<DBURL> bash scripts/paperback/pb-env.sh node node_modules/tsx/dist/cli.mjs \
 *     apps/worker/scripts/note-publish-syntax-check.ts <note_account_id>
 *
 * 表・太字・コードブロック・区切り線・リンク・箇条書き・見出しを全部入れた本文で
 * `publishOne` を **dry_run** 実行する（新規下書きを 1 本作って「下書き保存」で止まる）。
 * 公開はしない。出来上がった下書きの DOM を読んで、記号が残っていないかを報告する。
 * 検証用の下書きは note 上に残るので、運営者が適宜削除する。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { buildNoteBlocks } from '../src/tasks/note-publish/build-blocks.js';
import { attachTableImages } from '../src/tasks/note-publish/table-images.js';
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

const LF = String.fromCharCode(10);
const BODY = [
  '## 記法チェック用の見出し',
  'ここは**太字**を含む段落です。`インラインコード` とリンク [詳しくはこちら](https://note.com/baken_jutsu) も入れます。',
  '- 箇条書きの1つ目',
  '- 箇条書きの2つ目',
  '## 表のチェック',
  '次の表が画像になっていれば成功です。',
  ['| 区分 | 件数 | 割合 |', '|---|---:|---:|', '| A | 1,234 | 61.4% |', '| B | 567 | 38.6% |'].join(LF),
  '## コードのチェック',
  ['```', 'const a = 1;', 'console.log(a);', '```'].join(LF),
  '---',
  '最後の段落です。ここまで記号が出ていなければ OK。',
].join(LF + LF);

async function main(): Promise<void> {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error('usage: note-publish-syntax-check.ts <note_account_id>');
    process.exit(1);
  }

  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query('select id, display_name, niche, session_state_enc from note_accounts where id = $1', [
    accountId,
  ]);
  await c.end();
  const acc = rows[0];
  if (!acc?.session_state_enc) throw new Error('アカウント/セッションが見つかりません');

  const sessionState = decrypt(String(acc.session_state_enc), String(process.env.KDP_CRED_KEY));
  const stageDir = mkdtempSync(path.join(tmpdir(), 'note-syntax-'));
  const built = buildNoteBlocks(BODY, null);
  const staged = await attachTableImages(built.freeBlocks, {
    articleId: 'syntax-check',
    stageDir,
    niche: acc.niche as string | null,
  });
  console.log(
    'blocks:',
    staged.blocks.map((b) => b.kind).join(','),
  );

  const port = createPlaywrightNotePublishPort();
  const result = await port.publishOne({
    article: {
      id: 'syntax-check',
      title: `【検証用・削除可】Markdown 記法チェック ${new Date().toISOString().slice(0, 16)}`,
      freeBlocks: staged.blocks,
      paidBlocks: [],
      paid: false,
      priceJpy: null,
      allowPaid: false,
      hashtags: [],
    },
    sessionState,
    dryRun: true,
    stageDir,
  });
  console.log('result:', JSON.stringify(result, null, 1));
}

main().catch((e: unknown) => {
  console.error('fatal:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
