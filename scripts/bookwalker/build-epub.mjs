/**
 * 章Markdown → EPUB3 生成 (BookWalker入稿用・リフロー型)。
 *   bash scripts/paperback/pb-env.sh node scripts/bookwalker/build-epub.mjs <bookId>
 * DBから book(title/subtitle/著者)+chapters を取得し、R2の採用表紙をカバーに使い
 * scripts/bookwalker/out/<bookId>.epub を出力する。
 * 構成: mimetype(無圧縮) / META-INF/container.xml / OEBPS/{content.opf,nav.xhtml,style.css,cover.jpg,text/ch-*.xhtml}
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const JSZip = reqRoot('jszip');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const { S3Client, GetObjectCommand } = reqRoot(path.join(REPO, 'node_modules/.pnpm/@aws-sdk+client-s3@3.1051.0/node_modules/@aws-sdk/client-s3'));
const reqPdf = createRequire(path.join(REPO, 'packages/output/pdf/package.json'));
const { marked } = reqPdf('marked');

const bookId = process.argv[2];
const TRIAL = process.argv.includes('--trial'); // 試し読み用: 冒頭2章(はじめに+第1章)のみ
if (!bookId) { console.log('usage: build-epub.mjs <bookId> [--trial]'); process.exit(1); }
const OUT_DIR = path.join(REPO, 'scripts/bookwalker/out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Markdown → XHTML本文: 全void要素を自己終了(epubcheck FATAL回避)。
// markdownのタスクリスト`- [ ]`が生成する<input>未終了でBW検証400になる(2026-09-04実害)。
const VOID_RE = /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*)>/gi;
function mdToXhtml(md) {
  const html = marked.parse(md, { async: false });
  return html.replace(VOID_RE, (_m, tag, attrs) => `<${tag}${attrs.replace(/\/\s*$/, '')}/>`);
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const bq = await c.query(
  `SELECT b.title, b.subtitle, tc.genre,
     (SELECT cv.r2_key FROM covers cv WHERE cv.book_id=b.id AND cv.status='adopted' ORDER BY cv.created_at DESC LIMIT 1) cover_key,
     (SELECT km.description FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) description
   FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id WHERE b.id=$1`, [bookId]);
if (!bq.rows.length) { console.log('book not found'); process.exit(1); }
const { title, subtitle, genre, cover_key, description } = bq.rows[0];
const chAll = await c.query(`SELECT index, heading, body_md FROM chapters WHERE book_id=$1 ORDER BY index`, [bookId]);
await c.end();
if (!chAll.rows.length) { console.log('no chapters'); process.exit(1); }
// 試し読み: 冒頭2章まで(全体の1〜2割)
const ch = { rows: TRIAL ? chAll.rows.slice(0, 2) : chAll.rows };

// 表紙
let coverBuf = null;
if (cover_key) {
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const res = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: cover_key }));
  const cs = []; for await (const x of res.Body) cs.push(x);
  coverBuf = Buffer.concat(cs);
}

const uuid = crypto.randomUUID();
const AUTHOR = '宮田海斗';
const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
 <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

const css = `body{font-family:serif;line-height:1.9;margin:0.5em 1em;}
h1{font-size:1.5em;margin:2em 0 1.5em;}h2{font-size:1.2em;margin:1.6em 0 0.8em;}h3{font-size:1.05em;margin:1.2em 0 0.6em;}
p{margin:0 0 0.9em;text-align:justify;}blockquote{margin:1em 1.5em;color:#444;}li{margin-bottom:0.3em;}`;
zip.file('OEBPS/style.css', css);
if (coverBuf) zip.file('OEBPS/cover.jpg', coverBuf);

const xhtmlDoc = (t, body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head><meta charset="UTF-8"/><title>${esc(t)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>${body}</body></html>`;

// 表題紙
zip.file('OEBPS/text/titlepage.xhtml', xhtmlDoc(title,
  `<h1 style="margin-top:35%;text-align:center;">${esc(title)}</h1>` +
  (subtitle ? `<p style="text-align:center;color:#555;">${esc(subtitle)}</p>` : '') +
  `<p style="text-align:center;margin-top:3em;">${esc(AUTHOR)}</p>`));

const chapters = ch.rows;
for (const chp of chapters) {
  zip.file(`OEBPS/text/ch-${chp.index}.xhtml`, xhtmlDoc(chp.heading, `<h1>${esc(chp.heading)}</h1>\n` + mdToXhtml(chp.body_md)));
}

// nav (目次)
const navLis = chapters.map((chp) => `<li><a href="text/ch-${chp.index}.xhtml">${esc(chp.heading)}</a></li>`).join('\n');
zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head><meta charset="UTF-8"/><title>目次</title></head>
<body><nav epub:type="toc" id="toc"><h1>目次</h1><ol>
<li><a href="text/titlepage.xhtml">${esc(title)}</a></li>
${navLis}
</ol></nav></body></html>`);

// OPF
const manifestItems = [
  coverBuf ? '<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>' : '',
  '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
  '<item id="css" href="style.css" media-type="text/css"/>',
  '<item id="titlepage" href="text/titlepage.xhtml" media-type="application/xhtml+xml"/>',
  ...chapters.map((chp) => `<item id="ch${chp.index}" href="text/ch-${chp.index}.xhtml" media-type="application/xhtml+xml"/>`),
].filter(Boolean).join('\n  ');
const spineItems = ['<itemref idref="titlepage"/>', ...chapters.map((chp) => `<itemref idref="ch${chp.index}"/>`)].join('\n  ');
zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ja">
 <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="uid">urn:uuid:${uuid}</dc:identifier>
  <dc:title>${esc(title)}${subtitle ? ' ' + esc(subtitle) : ''}</dc:title>
  <dc:creator>${esc(AUTHOR)}</dc:creator>
  <dc:language>ja</dc:language>
  ${description ? `<dc:description>${esc(String(description).replace(/<[^>]+>/g, '').slice(0, 500))}</dc:description>` : ''}
  <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z/, 'Z')}</meta>
 </metadata>
 <manifest>
  ${manifestItems}
 </manifest>
 <spine>
  ${spineItems}
 </spine>
</package>`);

const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
const out = path.join(OUT_DIR, TRIAL ? `${bookId}-trial.epub` : `${bookId}.epub`);
fs.writeFileSync(out, buf);
console.log(`✔ ${title.slice(0, 30)} — ${chapters.length}章${TRIAL ? '(試し読み)' : ''} genre=${genre} cover=${coverBuf ? 'あり' : 'なし'} -> ${path.basename(out)} (${Math.round(buf.length / 1024)}KB)`);
process.exit(0);
