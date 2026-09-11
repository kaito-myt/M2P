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
// 主語(この本自体を指す語)。2026-09-11: 「本作」「この本」「当作品」が漏れていたため追加。
const SELF = '(?:本書|本作品|本作|当作品|当書|この本|この作品)';
const DISC = new RegExp(
  SELF +
    '(?:の[^。\\n]{0,30})?' + // 「の企画・構成・本文草案の生成には」等の長い修飾も許容
    '(?:は|には|も)?[、,]?\\s*[、]?' +
    '(?:AI|ＡＩ|人工知能|大規模言語モデル|LLM|生成AI|AI技術|AIアシスタント|AIツール)' +
    '(?:（[^）]*）|\\([^)]*\\))?' +
    '[^。\\n]{0,60}' +
    '(?:活用|支援|生成|執筆|作成|制作|編集|校閲)' +
    '[^。\\n]{0,40}' +
    '(?:されて(?:い)?ます|されました|しています|しました|します|含みます|制作されました|行(?:い|って)|ものです)',
);
// 明示的な開示宣言(主語が無くても除去)。
// 2026-09-11: 見出し形式「## AI生成に関する開示」と、主語を省いた
// 「大規模言語モデル（LLM）を活用したテキスト生成・編集プロセスを経て執筆されました」を追加。
const DECL =
  /AI生成であることを(ここに)?明示(いた)?します|(AI|人工知能)(によって|により)?生成されたもの(である)?ことを(ここに)?(開示|明示)(いた)?します|【制作注記】|^#{1,6}\s*(AI|ＡＩ)(生成|利用|活用)に関する(開示|注記|お知らせ)|(大規模言語モデル|LLM|生成AI)(（[^）]*）)?を活用した[^。\n]{0,40}(執筆|生成|作成)[^。\n]{0,20}(されました|しています)/;
// これらを含む文は「実コンテンツ」なので除去しない(誤爆ガード)。
// 2026-09-11 追加: 「読者に対して “あなたの本にAI開示を書きましょう” と指南する文」を
// 開示文と誤認して削っていた(例: 生成AI副業本の「奥付に…と明記し、読者への誠実な情報開示を行う」)。
// 奥付/明記/読者へ/勧誘表現/箇条書きのチェック項目は実コンテンツとして保護する。
const KEEP =
  /前作|続編|』|ここまで|本章|この章|次章|以下では|解説|紹介|説明|使い方|活用術|活用法|活用方法|する方法|稼ぐ|入門|超入門|ステップ|手順|フォーマット|プロンプト|月次報告|奥付|明記|記載し|読者へ|しましょう|してください|心がけ|おすすめ|推奨|^\s*[-*]\s*\[|Day\s?\d/;

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
