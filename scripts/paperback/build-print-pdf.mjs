/**
 * 301頁以上の本の印刷用本文PDF再生成(ノド余白拡大)。
 *   bash scripts/paperback/pb-env.sh pnpm exec tsx scripts/paperback/build-print-pdf.mjs <bookId> [marginMm=16]
 * DBから章を取得し @a2p/output-pdf buildPdf(sideMarginMm) で再生成 → scripts/paperback/out/<id>-pb-interior.pdf
 * 小説(ジャンル novel/fiction系)は isNovel=true(目次なし)。
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { buildPdf } from '../../packages/output/pdf/src/index.ts';

const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'package.json'));
const { Client } = req(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const { PDFDocument } = req(path.join(REPO, 'node_modules/pdf-lib'));

const bookId = process.argv[2];
const marginMm = Number(process.argv[3] || 16);
if (!bookId) { console.log('usage: build-print-pdf.mjs <bookId> [marginMm]'); process.exit(1); }

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const bq = await c.query(
  `SELECT b.title, b.subtitle, tc.genre FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id WHERE b.id=$1`, [bookId]);
if (!bq.rows.length) { console.log('book not found'); process.exit(1); }
const { title, subtitle, genre } = bq.rows[0];
const ch = await c.query(`SELECT index, heading, body_md FROM chapters WHERE book_id=$1 ORDER BY index`, [bookId]);
await c.end();
const isNovel = /novel|fiction|romance|fantasy|mystery|horror|light_novel/.test(genre || '');
console.log(`${title} — ${ch.rows.length}章 genre=${genre} isNovel=${isNovel} margin=${marginMm}mm`);
const buf = await buildPdf({ title, subtitle }, ch.rows, { isNovel, sideMarginMm: marginMm });
const outDir = path.join(REPO, 'scripts/paperback/out');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${bookId}-pb-interior.pdf`);
fs.writeFileSync(out, buf);
const doc = await PDFDocument.load(buf, { updateMetadata: false });
const pages = doc.getPageCount();
console.log(`✔ ${path.basename(out)} pages=${pages} (${Math.round(buf.length / 1024)}KB) spine=${(pages * 0.0572).toFixed(2)}mm gutter要件=${pages <= 300 ? '12.7' : pages <= 500 ? '15.9' : '19.1'}mm`);
process.exit(0);
