/**
 * ペーパーバック用ラップカバー(裏表紙+背+表紙の一枚PDF)生成。
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/build-wrap-cover.mjs <bookId> [<bookId>...]
 * 前提: scripts/paperback/plan.json (pb-plan.cjs の出力) に該当 book の pages/cover_key がある。
 * 仕様(KDP): bleed 3.2mm 四辺(左右は外側のみ)、背幅=頁数×0.0572mm(白紙)、背文字は79頁超のみ。
 * 裏表紙右下 50.8×30.5mm はバーコード領域として空ける。
 * 出力: scripts/paperback/out/<bookId>-pb-cover.pdf
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const reqPdf = createRequire(path.join(REPO, 'packages/output/pdf/package.json'));
const reqImg = createRequire(path.join(REPO, 'packages/output/image/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));

const React = reqPdf('react');
const { Document, Page, Text, View, Image, Font, renderToBuffer } = reqPdf('@react-pdf/renderer');
const sharp = reqImg('sharp');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const { S3Client, GetObjectCommand } = reqRoot(path.join(REPO, 'node_modules/.pnpm/@aws-sdk+client-s3@3.1051.0/node_modules/@aws-sdk/client-s3'));

const h = React.createElement;
const MM = 72 / 25.4; // mm→pt
const BLEED = 3.2, TRIM_W = 148, TRIM_H = 210; // A5
const SPINE_PER_PAGE = 0.0572; // 白紙
const FONT = 'NotoSansJP';
Font.register({
  family: FONT,
  fonts: [
    { src: path.join(REPO, 'apps/worker/fonts/NotoSansJP-Regular.ttf'), fontWeight: 400 },
    { src: path.join(REPO, 'apps/worker/fonts/NotoSansJP-Bold.ttf'), fontWeight: 700 },
  ],
});
// 日本語の禁則処理: 文字単位で折り返し許可
Font.registerHyphenationCallback((w) => (w.length > 1 ? [...w].flatMap((ch) => [ch, '']) : [w]));

const OUT_DIR = path.join(REPO, 'scripts/paperback/out');
fs.mkdirSync(OUT_DIR, { recursive: true });
const plan = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/paperback/plan.json'), 'utf8'));

function stripHtml(s) { return (s || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim(); }

async function bodyToBuffer(body) { const cs = []; for await (const c of body) cs.push(c); return Buffer.concat(cs); }

async function buildOne(c, s3, bookId) {
  const p = plan.find((x) => x.book_id === bookId);
  if (!p || !p.pages || !p.cover_key) { console.log(`SKIP ${bookId}: plan情報不足`); return null; }
  const meta = await c.query(
    `SELECT b.title, b.subtitle,
       (SELECT km.description FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) description
     FROM books b WHERE b.id=$1`, [bookId]);
  const { title, subtitle, description } = meta.rows[0];

  const spine = +(p.pages * SPINE_PER_PAGE).toFixed(3);
  const totalW = BLEED + TRIM_W + spine + TRIM_W + BLEED;
  const totalH = BLEED + TRIM_H + BLEED;
  const W = totalW * MM, H = totalH * MM;
  const frontX = (BLEED + TRIM_W + spine) * MM;
  const panelW = (TRIM_W + BLEED) * MM; // 前後パネルは外側bleed込み
  const spineX = (BLEED + TRIM_W) * MM;
  const spineW = spine * MM;

  // 表紙画像: R2から取得。KDP印刷は裁ち落としから 9.5mm 以内に文字を置けない(セーフゾーン)。
  // Kindle表紙は文字が端まで来ることがあるため、**表紙全体をセーフゾーン内に収め**、
  // 周囲(裁ち落とし+9.5mm余白)は表紙の平均色で埋める(端まで色は届くが文字は安全域に入る)。
  const res = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: p.cover_key }));
  const raw = await bodyToBuffer(res.Body);
  const stats = await sharp(raw).stats();
  const [r, g, b] = stats.channels.map((ch) => Math.round(ch.mean));
  const backBg = (() => { const d = (v) => Math.max(18, Math.round(v * 0.32)); return `rgb(${d(r)},${d(g)},${d(b)})`; })();
  // 前面地色 = 表紙平均色(周囲の余白がKindle表紙と馴染むよう非暗色)
  const frontBg = `rgb(${r},${g},${b})`;
  // セーフゾーン: 判型内側 9.5mm。前面パネル内でのセーフ矩形(pt)
  const SAFE = 9.5;
  const safeX = frontX + SAFE * MM;                 // 綴じ側トリムから内側
  const safeY = (BLEED + SAFE) * MM;                // 上トリムから内側
  const safeW = (TRIM_W - 2 * SAFE) * MM;           // 129mm
  const safeH = (TRIM_H - 2 * SAFE) * MM;           // 191mm
  // 表紙をセーフ矩形に収める(全内容保持=contain, 余白は平均色)
  const safePxW = Math.round((TRIM_W - 2 * SAFE) * 300 / 25.4);
  const safePxH = Math.round((TRIM_H - 2 * SAFE) * 300 / 25.4);
  const frontPng = await sharp(raw)
    .resize(safePxW, safePxH, { fit: 'contain', kernel: 'lanczos3', background: { r, g, b } })
    .png().toBuffer();

  // 説明文は最大420字、文の途中で切らない(最後の「。」まで)
  let blurb = stripHtml(description).slice(0, 420) || (subtitle || '');
  const lastEnd = blurb.lastIndexOf('。');
  if (lastEnd > 120) blurb = blurb.slice(0, lastEnd + 1);
  const spineFont = Math.min(11, Math.max(7, spineW * 0.62));

  const doc = h(Document, { title: `${title} (Paperback Cover)` },
    h(Page, { size: [W, H], style: { fontFamily: FONT } },
      // 裏表紙パネル(左, bleed込み)
      h(View, { style: { position: 'absolute', left: 0, top: 0, width: panelW, height: H, backgroundColor: backBg, paddingTop: (BLEED + 18) * MM, paddingLeft: (BLEED + 14) * MM, paddingRight: 14 * MM } },
        h(Text, { style: { color: '#ffffff', fontSize: 13, fontWeight: 700, marginBottom: 14 } }, title),
        subtitle ? h(Text, { style: { color: '#e8e8e8', fontSize: 9, marginBottom: 14 } }, subtitle) : null,
        h(Text, { style: { color: '#f2f2f2', fontSize: 8.5, lineHeight: 1.7 } }, blurb),
        h(Text, { style: { position: 'absolute', bottom: (BLEED + 40) * MM, left: (BLEED + 14) * MM, color: '#dddddd', fontSize: 8 } }, '著: 宮田海斗'),
        h(Text, { style: { position: 'absolute', bottom: (BLEED + 34) * MM, left: (BLEED + 14) * MM, color: '#bbbbbb', fontSize: 7 } }, 'Kindle版も好評発売中'),
        // バーコード領域(右下 50.8×30.5mm)は空白のまま
      ),
      // 背(中央)
      h(View, { style: { position: 'absolute', left: spineX, top: 0, width: spineW, height: H, backgroundColor: backBg } },
        p.pages > 79 && spineW >= 9
          ? h(View, { style: { position: 'absolute', left: 0, top: 0, width: spineW, height: H, alignItems: 'center', justifyContent: 'center' } },
              h(Text, { style: { color: '#ffffff', fontSize: spineFont, fontWeight: 700, transform: `rotate(90deg)`, width: H * 0.86, textAlign: 'center' } }, title.slice(0, 40)))
          : null),
      // 表紙(右): パネル全面を平均色で塗り(裁ち落としまで色を届かせる)、Kindle表紙は
      // セーフゾーン内(9.5mm内側)に配置。これで表紙内の文字が印刷トリムで切れない。
      h(View, { style: { position: 'absolute', left: frontX, top: 0, width: panelW, height: H, backgroundColor: frontBg } }),
      h(Image, { src: frontPng, style: { position: 'absolute', left: safeX, top: safeY, width: safeW, height: safeH } }),
    ));

  const buf = await renderToBuffer(doc);
  const out = path.join(OUT_DIR, `${bookId}-pb-cover.pdf`);
  fs.writeFileSync(out, buf);
  console.log(`✔ ${title.slice(0, 28)} pages=${p.pages} spine=${spine}mm -> ${path.basename(out)} (${Math.round(buf.length / 1024)}KB)`);
  return out;
}

const ids = process.argv.slice(2);
if (!ids.length) { console.log('usage: build-wrap-cover.mjs <bookId> [...]'); process.exit(1); }
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
for (const id of ids) { try { await buildOne(c, s3, id); } catch (e) { console.log(`ERR ${id}: ${e.message.slice(0, 120)}`); } }
await c.end();
process.exit(0);
