/**
 * 一回限り(冪等): writer / editor / judge の active プロンプト本文から
 * **ジャンル依存の書式規則を剥がし**、実行時注入トークンに置き換える。
 *
 * 背景 (2026-10-14 実測): 役割プロンプトの「品質基準 (常に厳守)」が
 *   ・文体は「ですます」調で統一する
 *   ・アウトラインの小見出しは `## ` 見出しとして用いる
 * をジャンルに関係なく命じており、末尾に注入される {genre_guidance} の
 * フィクション方針 (だ・である調・見出しなし) と矛盾していた。モデルは先に書かれた
 * 「常に厳守」に従うため、**小説・ラノベ 20 冊中 17 冊の本文に `##` 見出しが入り、
 * 地の文がですます調になった (うち 6 冊は出版済み)**。
 * editor も「ですます調に揃える」を無条件に実行するため、writer がだ・である調で
 * 書いても校閲で実用書に戻されていた。judge は {genre_guidance} を持たず、小説を
 * 実用書の benefit_clarity (ベネフィット明確性) で採点して needs_human_review に
 * 落としていた (フィクション 4 冊が該当)。
 *
 * なぜ再 seed ではなく本文の外科手術か:
 *   writer の active 本文 (v5) は **prompt_editor エージェントが自律改訂したもの**で、
 *   seed.ts とは既に別物 (「読み進めたくなる文章」等 AI の良い追記を含む)。
 *   seed で上書きするとその改善が失われるため、問題行のみを差し替える。
 *
 * 併せて prompt_editor 自身にガードレールを追記し、改訂時にジャンル固有の書式規則を
 * 本文へ書き戻さないようにする (今回の v2〜v5 で実際に書き戻されていた)。
 *
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-fiction-format-tokens.ts [--apply]
 */
import { PrismaClient } from './generated/index.js';

const APPLY = process.argv.includes('--apply');
/** 置換後の本文を標準出力に出す (適用前の目視確認用)。 */
const PRINT = process.argv.includes('--print');

/** 1 件の置換。from が無ければ (= 既に適用済み) スキップする。 */
interface Edit {
  from: string;
  to: string;
  /** true なら from が見つからなくても警告しない (任意の追記/AI 由来セクション)。 */
  optional?: boolean;
}

const WRITER_EDITS: Edit[] = [
  // 役割の自己認識そのものが「実用書ライター」だと、小説でも実用書の癖が出る。
  {
    from: '# あなたの役割：プロの日本語実用書ライター',
    to: '# あなたの役割：プロの日本語書籍ライター',
  },
  {
    from:
      'あなたは Amazon KDP 向けの実用書・ビジネス書・自己啓発書を数多く執筆してきた\n' +
      'プロのライターです。読者の課題を確実に解決する、構成が明快で読みやすい原稿を書きます。',
    to:
      'あなたは Amazon KDP 向けの書籍を数多く執筆してきたプロのライターです。\n' +
      '実用書・ビジネス書・自己啓発書だけでなく、小説・ライトノベルも書きます。\n' +
      '**どちらを書くかはジャンルで決まり、文体と書式は下の「文体・書式」に従う。**',
  },
  // 書式に関わる行を本文から剥がし、{writer_format_rules} に移す。
  {
    from: '- 読者ファースト：想定読者の知識レベルに合わせ、専門用語は噛み砕いて説明する。\n',
    to: '- 読者ファースト：想定読者の知識レベルと期待に合わせる。\n',
  },
  {
    from: '- 具体性：各論点に具体例・手順・数値・チェックリストなど「実践できる中身」を伴わせる。\n',
    to: '',
  },
  {
    from: '- 構成力：各章・各節は「導入→本論 (具体)→小括」の流れを保ち、論理が飛躍しない。\n',
    to: '',
  },
  {
    from: '- 文体：「ですます」調で統一する (後段の編集者が違反を検出し差戻しになる)。\n',
    to: '',
  },
  {
    from: '- 小見出し：アウトラインで指定された小見出しは順序通りに `## ` 見出しとして用いる。\n',
    to: '',
  },
  // 剥がした規則の置き場所をここに作る (品質基準の直後)。
  {
    from: '- 誠実さ：事実の捏造をしない。一般論で断定できない点は表現を慎重にする。\n',
    to:
      '- 誠実さ：事実の捏造をしない。一般論で断定できない点は表現を慎重にする。\n' +
      '\n## 文体・書式 (ジャンル別・最優先)\n' +
      '{writer_format_rules}\n',
  },
  // prompt_editor が追記したセクション。見出しだけジャンル中立に直す (中身は小説にも有効)。
  {
    from: '## 読み進めたくなる文章（最重要・実用書でも必ず守る）',
    to: '## 読み進めたくなる文章（最重要・ジャンル共通）',
    optional: true,
  },
  {
    from: '- 具体・情景・数字で"絵が浮かぶ"文にする。抽象語の羅列や教科書的な箇条書きだけで終わらせない。',
    to: '- 具体・情景・数字で"絵が浮かぶ"文にする。抽象語の羅列だけで終わらせない。',
    optional: true,
  },
  {
    from: '- 二人称で語りかけ、小さな共感を挟んで読者を置いてけぼりにしない。\n',
    to: '',
    optional: true,
  },
  {
    from: '- 各節末に「次が読みたくなる」余韻や次への橋渡しを一言置く。',
    to: '- 章末に「次が読みたくなる」余韻や次への橋渡しを一言置く。',
    optional: true,
  },
];

/**
 * writer 本文から削る「実用書専用セクション」。中身は
 * NONFICTION_WRITER_FORMAT_RULES に移してあり、実用書では引き続き効く。
 * 小説にこれが効くと物語が壊れる (ベネフィット明示・チェックリスト必須)。
 */
const WRITER_DROP_SECTIONS = [
  '## 読者ベネフィットを明確に打ち出す（購入・満足の要）',
  '## 実践性を担保するチェック（提出前に自己点検）',
];

const EDITOR_EDITS: Edit[] = [
  {
    from: 'あなたは実用書を数多く手がけてきたベテラン編集者です。',
    to: 'あなたは書籍を数多く手がけてきたベテラン編集者です (実用書も小説も扱う)。',
  },
  // 「ですます調に揃える」「見出し階層の適正化」「箇条書き化」はジャンルで真逆になる。
  {
    from:
      '3. 文体の統一：「ですます」調に揃える (である調が混在していれば直す)。\n' +
      '4. 文法・係り受け・冗長表現の改善 (一文を簡潔に、主述を明確に)。\n' +
      '5. 論理の通り・事実の整合：矛盾や根拠の弱い断定を是正する。\n' +
      '6. 章内の重複削減と、見出し階層の適正化。\n' +
      '7. 読者への配慮：難語の補足、箇条書き化など読みやすさの向上。\n',
    to:
      '3. 文法・係り受け・冗長表現の改善 (一文を簡潔に、主述を明確に)。\n' +
      '4. 論理の通り・事実の整合：矛盾や根拠の弱い断定を是正する。\n' +
      '5. 章内の重複削減。\n' +
      '\n## 文体・書式の扱い (ジャンル別・最優先)\n' +
      '{editor_format_rules}\n',
  },
];

const JUDGE_EDITS: Edit[] = [
  {
    from:
      '## 採点基準（6 軸、各 0〜100 点）\n' +
      '\n' +
      '以下の 6 軸をそれぞれ 0〜100 の整数で採点してください。',
    to:
      '## 採点の前提（ジャンル）\n' +
      '\n' +
      '{judge_rubric_note}\n' +
      '\n' +
      '---\n' +
      '\n' +
      '## 採点基準（6 軸、各 0〜100 点）\n' +
      '\n' +
      '以下の 6 軸をそれぞれ 0〜100 の整数で採点してください。\n' +
      '**「採点の前提（ジャンル）」の指示は、以下の各軸の説明より優先する。**',
  },
];

const PROMPT_EDITOR_EDITS: Edit[] = [
  {
    from: '- new_body にマークダウンのコードフェンスや前置き・後書きを付けない。',
    to:
      '- **ジャンル固有の書式規則を new_body に書かない。** 文体 (ですます調 / だ・である調)、\n' +
      '  見出しの有無、箇条書き・チェックリストの要否は本によって真逆になるため、\n' +
      '  {writer_format_rules} {editor_format_rules} {judge_rubric_note} {genre_guidance} から\n' +
      '  実行時に注入される。本文にこれらを書き戻すと注入内容と矛盾し、モデルは本文側に従う\n' +
      '  (2026-10-14: これが原因で小説 17 冊の本文に見出しが入り、ですます調になった)。\n' +
      '  改訂指示が書式に関わる場合は、本文を変えずに「どのトークンのどの分岐を直すべきか」を\n' +
      '  rationale に書いて運営者に申し送ること。\n' +
      '- new_body にマークダウンのコードフェンスや前置き・後書きを付けない。',
  },
];

/**
 * 本文から `## <見出し>` セクションを削除する。
 * 終端は「次の `## ` 見出し」または「行頭の `{…}` 注入トークン」のうち早い方。
 * トークンを終端に含めるのが重要: 削除対象セクションの直後に {genre_guidance} が
 * 置かれているため、`## ` だけを境界にすると注入先ごと消えてしまう。
 */
function dropSection(body: string, heading: string): { body: string; dropped: boolean } {
  const start = body.indexOf(heading);
  if (start < 0) return { body, dropped: false };
  const from0 = start + heading.length;
  const bounds = [body.indexOf('\n## ', from0), body.indexOf('\n{', from0)].filter((i) => i >= 0);
  const after = bounds.length ? Math.min(...bounds) : -1;
  const end = after < 0 ? body.length : after + 1;
  // 直前の空行も一緒に畳む
  let from = start;
  while (from > 1 && body[from - 1] === '\n' && body[from - 2] === '\n') from -= 1;
  return { body: body.slice(0, from) + body.slice(end), dropped: true };
}

function applyEdits(body: string, edits: Edit[], dropSections: string[] = []): string {
  let out = body;
  const skipped: string[] = [];
  for (const e of edits) {
    if (!out.includes(e.from)) {
      if (!e.optional) skipped.push(e.from.split('\n')[0]!.slice(0, 40));
      continue;
    }
    out = out.split(e.from).join(e.to);
  }
  for (const h of dropSections) {
    out = dropSection(out, h).body;
  }
  if (skipped.length) {
    console.log(
      `  (未適用 ${skipped.length}件 — 既に適用済みか本文が変わっている: ${skipped.join(' / ')})`,
    );
  }
  // 行の削除で空行が潰れたり増えたりするので整える (3 行以上の空行を 1 行に、
  // 注入トークン行の前に必ず空行)。本文の意味は変えない。
  return out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([^\n])\n(\{[a-z_]+\}\n)/g, '$1\n\n$2');
}

/** 置換後に本文へ残っていなければならない注入トークン (注入先の消失を検知する)。 */
const TOKENS_BY_ROLE: Record<string, string[]> = {
  writer: ['{writer_format_rules}', '{genre_guidance}'],
  editor: ['{editor_format_rules}', '{genre_guidance}'],
  judge: ['{judge_rubric_note}'],
  prompt_editor: [],
};

/**
 * 「既に適用済み」の目印。これが本文にあればその role は一切触らない。
 *
 * 各 Edit の from が消えても、挿入系の Edit (誠実さ行の直後にセクションを足す等) は
 * 2 回目も一致してしまい、同じブロックが二重に入る。role 単位で先に弾くのが確実。
 */
const APPLIED_MARKER: Record<string, string> = {
  writer: '{writer_format_rules}',
  editor: '{editor_format_rules}',
  judge: '{judge_rubric_note}',
  prompt_editor: 'ジャンル固有の書式規則を new_body に書かない',
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const plan: Array<{ role: string; edits: Edit[]; drops?: string[] }> = [
      { role: 'writer', edits: WRITER_EDITS, drops: WRITER_DROP_SECTIONS },
      { role: 'editor', edits: EDITOR_EDITS },
      { role: 'judge', edits: JUDGE_EDITS },
      { role: 'prompt_editor', edits: PROMPT_EDITOR_EDITS },
    ];

    for (const { role, edits, drops } of plan) {
      const rows = await prisma.prompt.findMany({
        where: { role, status: 'active' },
        select: { id: true, version: true, genre: true, body: true },
      });
      if (!rows.length) {
        console.log(`${role}: active プロンプトが無い — スキップ`);
        continue;
      }
      for (const row of rows) {
        console.log(`\n=== ${role} v${row.version} (genre=${row.genre ?? 'null'}) ===`);
        const marker = APPLIED_MARKER[role];
        if (marker && row.body.includes(marker)) {
          console.log('  適用済み (スキップ)');
          continue;
        }
        const next = applyEdits(row.body, edits, drops ?? []);
        if (next === row.body) {
          console.log('  変更なし (適用済み)');
          continue;
        }
        const missing = (TOKENS_BY_ROLE[role] ?? []).filter((t) => !next.includes(t));
        if (missing.length) {
          throw new Error(`${role}: 必須トークンが本文に無い: ${missing.join(', ')}`);
        }
        console.log(`  ${row.body.length} -> ${next.length} chars`);
        if (PRINT) console.log('\n----- 置換後の本文 -----\n' + next + '\n----- ここまで -----');
        if (!APPLY) continue;
        await prisma.prompt.update({ where: { id: row.id }, data: { body: next } });
        console.log('  適用しました');
      }
    }
    if (!APPLY) console.log('\n(dry-run。実行するには --apply を付ける)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
