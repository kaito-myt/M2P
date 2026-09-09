/** 採用表紙(R2)をBookWalker要件(縦1600px・JPG)へ変換し scripts/bookwalker/out/<bookId>-cover.jpg 出力 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const reqImg = createRequire(path.join(REPO, 'packages/output/image/package.json'));
const sharp = reqImg('sharp');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const { S3Client, GetObjectCommand } = reqRoot(path.join(REPO, 'node_modules/.pnpm/@aws-sdk+client-s3@3.1051.0/node_modules/@aws-sdk/client-s3'));
const OUT = path.join(REPO, 'scripts/bookwalker/out'); fs.mkdirSync(OUT, { recursive: true });
const bookId = process.argv[2];
if (!bookId) { console.log('usage: bw-cover-jpg.mjs <bookId>'); process.exit(1); }
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT r2_key FROM covers WHERE book_id=$1 AND status='adopted' ORDER BY created_at DESC LIMIT 1", [bookId]);
await c.end();
if (!r.rows.length) { console.log('adopted cover なし'); process.exit(1); }
const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const res = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: r.rows[0].r2_key }));
const cs = []; for await (const x of res.Body) cs.push(x);
const out = path.join(OUT, `${bookId}-cover.jpg`);
await sharp(Buffer.concat(cs)).resize({ height: 1600, withoutEnlargement: false, kernel: 'lanczos3' }).jpeg({ quality: 90 }).toFile(out);
const meta = await sharp(out).metadata();
console.log(`✔ ${path.basename(out)} ${meta.width}x${meta.height} ${Math.round(fs.statSync(out).size / 1024)}KB`);
process.exit(0);
