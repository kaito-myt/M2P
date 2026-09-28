/**
 * 公開中の note 記事に Markdown の記号が残っていないかを公開 API で突き合わせる (F-ANP-48)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/verify-note-body.cjs
 *
 * note の公開 API `GET https://note.com/api/v3/notes/<noteId>` は認証不要で
 * `data.body`(HTML) を返す。無料部分だけだが、表のパイプ記号やアスタリスクが
 * 残っているかの確認には十分。
 */
const path = require('path');
const { createRequire } = require('module');
const ROOT = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'),
);

const argv = process.argv.slice(2);
const arg = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const ACCOUNT = arg('account');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const params = [];
  let where = "a.status='published' AND a.note_url IS NOT NULL";
  if (ACCOUNT) {
    params.push(ACCOUNT);
    where += ` AND a.note_account_id = $${params.length}`;
  }
  const { rows } = await c.query(
    `SELECT a.id, left(a.title, 30) AS title, a.paid, a.note_url, acc.display_name
       FROM note_articles a JOIN note_accounts acc ON acc.id = a.note_account_id
      WHERE ${where}
      ORDER BY a.published_at DESC NULLS LAST`,
    params,
  );
  await c.end();

  let ok = 0;
  let ng = 0;
  for (const r of rows) {
    const noteId = (r.note_url.match(/\/n\/(n[0-9a-z]+)/i) ?? [])[1];
    if (!noteId) continue;
    let data;
    try {
      const res = await fetch(`https://note.com/api/v3/notes/${noteId}`, {
        headers: { accept: 'application/json' },
      });
      data = (await res.json())?.data;
    } catch (e) {
      console.log(`? ${r.title}  (API 失敗: ${e.message})`);
      continue;
    }
    if (!data) {
      console.log(`? ${r.title}  (データ無し)`);
      continue;
    }
    // HTML タグを落としてから記号を探す (本文テキストに残っているかだけを見る)。
    const text = String(data.body ?? '')
      .replace(/<[^>]*>/g, '\n')
      .replace(/&nbsp;/g, ' ');
    const pipes = (text.match(/^\s*\|.*\|\s*$/gm) || []).length;
    const stars = (text.match(/\*\*/g) || []).length;
    const ticks = (text.match(/`/g) || []).length;
    const rules = (text.match(/^\s*-{3,}\s*$/gm) || []).length;
    const links = (text.match(/\[[^\]]+\]\([^)]*\)/g) || []).length;
    const bad = pipes + stars + ticks + rules + links;
    const imgs = (String(data.body ?? '').match(/<img /g) || []).length;
    if (bad === 0) {
      ok += 1;
      console.log(`OK ${r.paid ? '有料' : '無料'} 画像${imgs} ${r.title}`);
    } else {
      ng += 1;
      console.log(
        `NG ${r.paid ? '有料' : '無料'} 表${pipes} **${stars} \`${ticks} ---${rules} link${links} 画像${imgs} ${r.title}  ${r.note_url}`,
      );
    }
    await sleep(400);
  }
  console.log(`\n公開本文の確認: OK ${ok} / NG ${ng}`);
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
