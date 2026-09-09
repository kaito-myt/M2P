/** BOOTH入稿の「売れ筋・主力」候補を抽出。売上(あれば)→ 完成度 → 新しさ で並べる。 */
import { createRequire } from 'module';
import path from 'path';
const SP = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SP), '../..');
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();

// 売上テーブルの有無を確認
const tbls = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map(r => r.table_name);
const salesTables = tbls.filter(t => /sale|royalt|revenue|order/i.test(t));
console.log('売上系テーブル:', salesTables.join(', ') || '(なし)');

// booksの列を確認
const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='books'`)).rows.map(r => r.column_name);
console.log('books列(status/adult/booth系):', cols.filter(x => /status|adult|booth|kobo|title|theme/.test(x)).join(', '));

// 完成・非アダルト・BOOTH未入稿の本を列挙
const q = await c.query(`
  SELECT b.id, b.title, b.status, b.booth_publish_status, tc.genre,
    (SELECT price_jpy FROM kdp_metadata WHERE book_id=b.id ORDER BY created_at DESC LIMIT 1) price,
    b.created_at
  FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id
  WHERE b.status IN ('done','published','exported','completed')
  ORDER BY b.created_at DESC`);
console.log('\n完成本総数:', q.rows.length);
const byStatus = {};
for (const r of q.rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log('status内訳:', JSON.stringify(byStatus));
const booth = {};
for (const r of q.rows) booth[r.booth_publish_status || 'null'] = (booth[r.booth_publish_status || 'null'] || 0) + 1;
console.log('booth_publish_status内訳:', JSON.stringify(booth));
const genres = {};
for (const r of q.rows) genres[r.genre || 'null'] = (genres[r.genre || 'null'] || 0) + 1;
console.log('ジャンル内訳:', JSON.stringify(genres));

await c.end();
