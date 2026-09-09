/**
 * ペーパーバック化プラン算出 (READ-ONLY):
 * 対象 = KDPに出品済み(published/submitted+asin) or 出版待ち(done)の本のうち pdf artifact を持つもの。
 * 各本の final.pdf を R2 から取得しページ数を数え、背幅(白紙 0.0572mm/頁)・余白適合・KDP頁数レンジを判定し
 * scripts/paperback/plan.json に出力する。
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-plan.cjs [--limit=N]
 */
const path = require('path');
const fs = require('fs');
const { Client } = require(path.resolve(__dirname, '../../node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const { PDFDocument } = require(path.resolve(__dirname, '../../node_modules/pdf-lib'));
const { S3Client, GetObjectCommand } = require(path.resolve(__dirname, '../../node_modules/.pnpm/@aws-sdk+client-s3@3.1051.0/node_modules/@aws-sdk/client-s3'));

const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0) || Infinity;
const OUT = path.resolve(__dirname, 'plan.json');

// KDP 白黒・白紙: 24〜828頁。背幅 = 頁数 × 0.0572mm。背文字は 79頁超。
const SPINE_MM_PER_PAGE = 0.0572;
// ノド(内側)余白の最小: 〜150頁=9.6mm / 151〜300=12.7mm / 301〜500=15.9mm。現行PDFは左右 15mm。
function gutterRequiredMm(pages) {
  if (pages <= 150) return 9.6;
  if (pages <= 300) return 12.7;
  if (pages <= 500) return 15.9;
  if (pages <= 700) return 19.1;
  return 22.3;
}

async function bodyToBuffer(body) {
  const chunks = [];
  for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks);
}

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('SET statement_timeout=30000');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  const bucket = process.env.R2_BUCKET_NAME;

  const q = await c.query(`
    SELECT b.id, b.title, b.publish_status, b.asin, a.r2_key pdf_key, a.byte_size,
      (SELECT cv.r2_key FROM covers cv WHERE cv.book_id=b.id AND cv.status='adopted' ORDER BY cv.created_at DESC LIMIT 1) cover_key,
      (SELECT km.description FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY km.created_at DESC LIMIT 1) description
    FROM books b
    JOIN artifacts a ON a.book_id=b.id AND a.kind='pdf'
    WHERE (b.publish_status IN ('published','submitted') OR b.status='done')
      AND b.status NOT IN ('retracted','failed','culled')
    ORDER BY (b.publish_status='published') DESC, b.created_at`);
  console.log('対象:', q.rows.length, '冊');

  const plan = [];
  let i = 0;
  for (const b of q.rows) {
    if (i++ >= LIMIT) break;
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: b.pdf_key }));
      const buf = await bodyToBuffer(res.Body);
      const doc = await PDFDocument.load(buf, { updateMetadata: false });
      const pages = doc.getPageCount();
      const spineMm = +(pages * SPINE_MM_PER_PAGE).toFixed(2);
      const gutterOk = 15 >= gutterRequiredMm(pages); // 現行PDFの左右余白15mm
      const rangeOk = pages >= 24 && pages <= 828;
      const spineTextOk = pages > 79;
      plan.push({
        book_id: b.id, title: b.title, publish_status: b.publish_status, asin: b.asin,
        pdf_key: b.pdf_key, cover_key: b.cover_key, has_description: !!b.description,
        pages, spine_mm: spineMm, gutter_ok: gutterOk, range_ok: rangeOk, spine_text_ok: spineTextOk,
        ready: gutterOk && rangeOk && !!b.cover_key,
      });
      console.log(`${String(pages).padStart(4)}p spine=${String(spineMm).padStart(6)}mm ${gutterOk ? 'ok ' : 'NG(余白)'} ${rangeOk ? '' : 'NG(頁数範囲)'} ${b.cover_key ? '' : 'NG(表紙)'} ${b.title.slice(0, 30)}`);
    } catch (e) {
      console.log(`ERR ${b.title.slice(0, 30)}: ${e.message.slice(0, 60)}`);
      plan.push({ book_id: b.id, title: b.title, error: e.message.slice(0, 100), ready: false });
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
  const ready = plan.filter(p => p.ready).length;
  console.log(`\nplan.json 出力: ${plan.length}冊 (ready=${ready}, 余白NG=${plan.filter(p => p.gutter_ok === false).length}, 頁数NG=${plan.filter(p => p.range_ok === false).length})`);
  await c.end();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
