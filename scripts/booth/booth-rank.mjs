/** 売上で本をランク付けし、BOOTH主力候補を選ぶ。アダルト(戦場/オナニスト)は除外。 */
import { createRequire } from 'module';
import path from 'path';
const SP = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SP), '../..');
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();

const srCols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='sales_records'`)).rows.map(r => r.column_name);
console.log('sales_records列:', srCols.join(', '));

// 売上集計 (book単位)。列名は柔軟に。
const hasUnits = srCols.includes('units_sold') || srCols.includes('units');
const unitCol = srCols.includes('units_sold') ? 'units_sold' : (srCols.includes('units') ? 'units' : (srCols.includes('quantity') ? 'quantity' : null));
const revCol = srCols.includes('royalty_jpy') ? 'royalty_jpy' : (srCols.includes('revenue_jpy') ? 'revenue_jpy' : (srCols.includes('royalty') ? 'royalty' : null));
const bookRef = srCols.includes('book_id') ? 'book_id' : (srCols.includes('asin') ? 'asin' : null);
console.log(`集計列: units=${unitCol} rev=${revCol} bookRef=${bookRef}`);

let rows;
if (bookRef === 'book_id') {
  rows = (await c.query(`
    SELECT b.id, b.title, tc.genre,
      COALESCE(SUM(sr.${unitCol || '0'}),0)::int units,
      COALESCE(SUM(sr.${revCol || '0'}),0)::numeric rev
    FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id
    LEFT JOIN sales_records sr ON sr.book_id=b.id
    WHERE b.status='done'
    GROUP BY b.id, b.title, tc.genre
    ORDER BY units DESC, rev DESC, b.created_at DESC`)).rows;
} else {
  rows = (await c.query(`SELECT b.id, b.title, tc.genre FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id WHERE b.status='done' ORDER BY b.created_at DESC`)).rows;
}

const ADULT = /戦場|オナニスト|射精|自慰|セックス|性行為|18禁|R18/;
const eligible = rows.filter(r => !ADULT.test(r.title));
const excluded = rows.filter(r => ADULT.test(r.title));
console.log(`\n完成${rows.length}冊 / アダルト除外${excluded.length}冊 / 対象${eligible.length}冊`);
if (excluded.length) console.log('除外:', excluded.map(r => r.title.slice(0, 20)).join(' / '));

console.log('\n=== 売上ランキング上位20 ===');
eligible.slice(0, 20).forEach((r, i) => {
  console.log(`${String(i + 1).padStart(2)}. units=${r.units ?? '-'} rev=${r.rev ?? '-'} [${r.genre}] ${r.title.slice(0, 34)}  ${r.id}`);
});

const withSales = eligible.filter(r => (r.units || 0) > 0 || (Number(r.rev) || 0) > 0);
console.log(`\n売上実績あり: ${withSales.length}冊`);
await c.end();
