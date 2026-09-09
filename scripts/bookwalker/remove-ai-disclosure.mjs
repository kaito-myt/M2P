/**
 * 本文中の「AI生成/AI活用を開示する定型文」だけを文単位で除去する。[F-094 却下理由①対応]
 * 実コンテンツ(AIの解説・使い方・小説のプロット・他作品タイトル参照)は残す。
 *   dry-run: bash scripts/paperback/pb-env.sh node scripts/bookwalker/remove-ai-disclosure.mjs
 *   適用   : ... remove-ai-disclosure.mjs --apply
 */
import { createRequire } from 'module'; import path from 'path';
const REPO = 'C:/DEV/M2P';
const { Client } = createRequire(path.join(REPO, 'package.json'))(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const APPLY = process.argv.includes('--apply');

// 「この本自体がAIで作られた」という開示文のシグネチャ。
const DISC = /(本書|本作品)(の(一部|本文|コンテンツ|企画|制作|各章|文章))?(は|には|の制作には)?[、,]?\s*[、]?(AI|人工知能|大規模言語モデル|生成AI|AI技術)(（[^）]*）|\([^)]*\))?[^。\n]{0,45}(活用|支援|生成|執筆|作成|制作|編集|校閲)[^。\n]{0,30}(されて(い)?ます|されました|しています|しました|します|含みます|作成しました|作成しています|制作されました|行(い|って)|活用しています|ものです)/;
// 明示的な開示宣言(本書/本作品が無くても除去)。
const DECL = /AI生成であることを(ここに)?明示(いた)?します|(AI|人工知能)(によって|により)?生成されたもの(である)?ことを(ここに)?(開示|明示)(いた)?します|【制作注記】/;
// これらを含む文は「実コンテンツ」なので除去しない(誤爆ガード)。
const KEEP = /前作|続編|』|ここまで|本章|この章|次章|以下では|解説|紹介|説明|使い方|活用術|活用法|活用方法|する方法|稼ぐ|入門|超入門|ステップ|手順|フォーマット|プロンプト|月次報告/;

function scrub(md) {
  const removed = [];
  // 文分割(。！？と改行を区切りに、区切り文字は保持)
  const lines = md.split(/\r?\n/).map((line) => {
    if (!/(AI|人工知能|大規模言語モデル|生成AI)/.test(line)) return line;
    // 行を文に分割
    const parts = line.split(/(?<=[。！？])/);
    const kept = parts.filter((s) => {
      const t = s.trim();
      if (!t) return true;
      const isDisc = (DISC.test(t) || DECL.test(t)) && !KEEP.test(t);
      if (isDisc) { removed.push(t); return false; }
      return true;
    });
    let out = kept.join('');
    // 開示文だけの行だった場合、装飾(* ※ 【】 引用符)の残骸を掃除
    out = out.replace(/^[\s*※>「『]+$/,'').replace(/^\*\s*$/,'');
    return out;
  });
  // 除去で空になった行の連続を1つに畳む
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  return { text, removed };
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = await c.query(`SELECT ch.id, ch.book_id, ch.index idx, b.title, ch.body_md
  FROM chapters ch JOIN books b ON b.id=ch.book_id
  WHERE ch.body_md ~ 'AI|人工知能|大規模言語モデル|生成AI' ORDER BY b.title, ch.index`);
let chapters = 0, sentences = 0; const books = new Set();
for (const r of q.rows) {
  const { text, removed } = scrub(r.body_md);
  if (removed.length === 0 || text === r.body_md) continue;
  chapters++; sentences += removed.length; books.add(r.title);
  console.log(`\n■ ${r.title.slice(0, 26)} idx${r.idx} (${removed.length}文除去)`);
  for (const s of removed) console.log(`   − ${s.slice(0, 120)}`);
  if (APPLY) {
    await c.query('UPDATE chapters SET body_md=$1, updated_at=now() WHERE id=$2', [text, r.id]);
  }
}
console.log(`\n=== ${APPLY ? '適用完了' : 'DRY-RUN'}: ${books.size}冊 / ${chapters}章 / ${sentences}文 を除去${APPLY ? '' : '予定'} ===`);
await c.end();
