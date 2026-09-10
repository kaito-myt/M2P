/**
 * 既刊の本文 PDF を現行レンダラで再生成し、R2 の同じキーへ差し替える。
 *   bash scripts/paperback/pb-env.sh corepack pnpm exec tsx scripts/regen-book-pdfs.mjs [--limit=N] [--book-id=ID] [--dry-run]
 *
 * 背景: 2026-09-10 に `packages/output/pdf` の日本語行分割不良(行が版面をはみ出す/行末に
 * 不正なハイフン)を修正した。既刊の PDF は修正前に生成されているため、本スクリプトで
 * 作り直す。KDP/BW への再入稿は別工程(ここでは成果物の差し替えのみ)。
 *
 * 安全策: 既存オブジェクトを消さず、まず `<key>.bak-<ts>` に退避してから上書きする。
 */
import { createRequire } from 'module';
import path from 'path';
import { buildPdf } from '../packages/output/pdf/src/index.ts';

const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '..');
const req = createRequire(path.join(REPO, 'package.json'));
const { Client } = req(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const reqS3 = createRequire(path.join(REPO, 'packages/storage/package.json'));
const { S3Client, GetObjectCommand, PutObjectCommand } = reqS3('@aws-sdk/client-s3');
const crypto = req('crypto');

const args = process.argv.slice(2);
const LIMIT = parseInt((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || '9999', 10);
const ONLY = (args.find((a) => a.startsWith('--book-id=')) || '').split('=')[1] || null;
const DRY = args.includes('--dry-run');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();

const where = ONLY ? 'and b.id = $1' : '';
const params = ONLY ? [ONLY] : [];
const rows = (
  await c.query(
    `SELECT a.id AS artifact_id, a.r2_key, a.byte_size, b.id, b.title, b.subtitle, tc.genre
     FROM artifacts a
     JOIN books b ON b.id = a.book_id
     LEFT JOIN theme_candidates tc ON tc.id = b.theme_id
     WHERE a.kind = 'pdf' ${where}
     ORDER BY a.created_at DESC`,
    params,
  )
).rows;

console.log(`対象 ${rows.length} 冊 (limit=${LIMIT}${DRY ? ' / DRY-RUN' : ''})`);
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);

let ok = 0, skip = 0, ng = 0;
for (const r of rows.slice(0, LIMIT)) {
  const label = (r.title || '').slice(0, 28);
  try {
    const ch = await c.query(
      `SELECT index, heading, body_md FROM chapters WHERE book_id=$1 ORDER BY index`, [r.id]);
    if (!ch.rows.length) { console.log(`skip(章なし) ${label}`); skip++; continue; }

    const isNovel = /novel|fiction|romance|fantasy|mystery|horror|light_novel/.test(r.genre || '');
    const buf = await buildPdf({ title: r.title, subtitle: r.subtitle }, ch.rows, { isNovel });
    const checksum = crypto.createHash('sha256').update(buf).digest('hex');

    if (DRY) {
      console.log(`DRY ${label} — ${Math.round(buf.length / 1024)}KB (旧 ${Math.round(r.byte_size / 1024)}KB)`);
      ok++; continue;
    }

    // 既存を退避してから上書き
    const old = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: r.r2_key })).catch(() => null);
    if (old) {
      const oldBuf = Buffer.concat(await old.Body.toArray());
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: `${r.r2_key}.bak-${ts}`, Body: oldBuf, ContentType: 'application/pdf',
      }));
    }
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: r.r2_key, Body: buf, ContentType: 'application/pdf',
    }));
    await c.query(`UPDATE artifacts SET byte_size=$2, checksum=$3 WHERE id=$1`,
      [r.artifact_id, buf.length, checksum]);

    console.log(`✔ ${label} — ${Math.round(r.byte_size / 1024)}KB → ${Math.round(buf.length / 1024)}KB`);
    ok++;
  } catch (e) {
    console.log(`✗ ${label} — ${String(e.message).slice(0, 90)}`);
    ng++;
  }
}
console.log(`\nDONE ok=${ok} skip=${skip} ng=${ng}${DRY ? ' (DRY-RUN — 書き込みなし)' : ''}`);
await c.end();
process.exit(ng ? 1 : 0);
