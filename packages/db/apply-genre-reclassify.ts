/**
 * 一回限り(冪等): `theme_candidates.genre` の誤刻印を是正する。
 *
 * 背景 (2026-10-14): `mapCandidateToRow` が genre 未指定の候補に **一律 'practical'** を
 * 刻んでいた。日次自動生成はジャンル横断で企画させるため常に genre=null を渡しており、
 * 結果として小説・ラノベ・競馬本まで実用書として保存され、writer/editor/judge が
 * 実用書ルーブリック (ですます調・章立て・小見出し) で書き採点していた。
 * 刻印ロジックは `resolveCandidateGenre` に修正済み。本スクリプトは既存行の是正を行う。
 *
 * 安全設計:
 *  - 対象は `genre = 'practical'` の行だけ (= 自動既定で刻まれた可能性がある行)。
 *    運営者が UI で明示的に選んだジャンルは絶対に触らない。
 *  - 判定は決定論的な `classifyGenre` のみ。確信が持てない行は null を返すので
 *    そのまま practical に残る (LLM は使わない = 実行ごとに結果が変わらない)。
 *  - 既定は dry-run。`--apply` を付けたときだけ UPDATE する。
 *
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-genre-reclassify.ts [--apply]
 */
import { classifyGenre, isFiction } from '@a2p/contracts/genres';

import { PrismaClient } from './generated/index.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.themeCandidate.findMany({
      // rejected 候補は書籍にならず genre が下流で使われないため触らない
      // (販促企画書が誤って候補として入っている等のゴミ行も混ざっており、誤判定の温床)。
      where: { genre: 'practical', status: { in: ['accepted', 'pending'] } },
      select: {
        id: true,
        title: true,
        subtitle: true,
        hook: true,
        target_reader: true,
        status: true,
      },
      orderBy: { created_at: 'asc' },
    });
    console.log(`genre='practical' かつ accepted/pending の候補: ${rows.length}件`);

    const changes: Array<{ id: string; title: string; to: string; status: string }> = [];
    for (const r of rows) {
      // hook はフィクション判定専用 (ジャンル語照合に混ぜると精度が落ちる)。
      const g = classifyGenre({ title: r.title, subtitle: r.subtitle, context: r.hook });
      if (!g || g === 'practical') continue;
      changes.push({ id: r.id, title: r.title, to: g, status: r.status });
    }

    console.log(`\n=== 是正対象 ${changes.length}件 ===`);
    for (const c of changes) {
      const mark = isFiction(c.to) ? '★小説' : '    ';
      console.log(`${mark} ${c.to.padEnd(16)} ${c.status.padEnd(9)} ${c.title}`);
    }
    const fiction = changes.filter((c) => isFiction(c.to));
    console.log(
      `\nうちフィクション ${fiction.length}件 (実用書の文体・章立てで執筆されている疑いがあるため要再生成)`,
    );

    if (!APPLY) {
      console.log('\n(dry-run。実行するには --apply を付ける)');
      return;
    }
    for (const c of changes) {
      await prisma.themeCandidate.update({ where: { id: c.id }, data: { genre: c.to } });
    }
    console.log(`\n適用完了: ${changes.length}件 を更新しました`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
