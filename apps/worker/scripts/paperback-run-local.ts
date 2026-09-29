/**
 * ペーパーバックの下書き作成／出版を**ローカルから**回す暫定ランナー (F-097i)。
 *
 *   bash scripts/paperback/pb-env.sh bash <tsx-wrapper> \
 *     apps/worker/scripts/paperback-run-local.ts submit [--limit=5]
 *   bash scripts/paperback/pb-env.sh bash <tsx-wrapper> \
 *     apps/worker/scripts/paperback-run-local.ts draft [--limit=3]
 *
 * **本来はサーバー側 (Railway) で回す**もので、これは Railway のデプロイが
 * 「Deploys have been paused temporarily」で止まっている間だけの逃げ道
 * (2026-09-30)。実行しているコードは worker と同一 (同じ task 関数をそのまま呼ぶ)。
 * Railway が復旧したら cron 側で同じ処理が続く。
 *
 * 必要な env は `pb-env.sh` が用意するもの (DBURL / R2_* / AMAZON_* / KDP_CRED_KEY) に加えて
 * `DATABASE_URL` (Prisma 用)。tsx ラッパで渡すこと。
 */
import { runPaperbackDraft } from '../src/tasks/paperback-draft.js';
import { runPaperbackSubmit } from '../src/tasks/paperback-submit.js';
import { createPlaywrightPaperbackDraftPort } from '../src/tasks/paperback-draft/playwright-paperback-draft-port.js';

interface Row {
  id: string;
  title: string;
}

async function pickBooks(mode: 'draft' | 'submit', limit: number): Promise<Row[]> {
  const { prisma } = await import('@a2p/db');
  if (mode === 'submit') {
    return prisma.book.findMany({
      where: { pb_publish_status: 'drafted', pb_title_id: { not: null } },
      select: { id: true, title: true },
      orderBy: { pb_drafted_at: 'asc' },
      take: limit,
    });
  }
  return prisma.book.findMany({
    where: {
      pb_publish_status: 'unlisted',
      pb_title_id: null,
      asin: { not: null },
      publish_status: 'published',
    },
    select: { id: true, title: true },
    orderBy: { published_at: 'desc' },
    take: limit,
  });
}

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? 'submit') as 'draft' | 'submit';
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 3;
  if (mode !== 'draft' && mode !== 'submit') {
    console.error('usage: paperback-run-local.ts <draft|submit> [--limit=N]');
    process.exit(1);
  }

  const books = await pickBooks(mode, limit);
  console.log(`${mode}: ${String(books.length)} 冊を処理します`);

  for (const b of books) {
    const label = `${b.id} ${b.title.slice(0, 28)}`;
    console.log(`\n=== ${mode.toUpperCase()} ${label}`);
    try {
      if (mode === 'submit') {
        const r = await runPaperbackSubmit({ book_id: b.id });
        console.log('  ->', JSON.stringify(r));
      } else {
        const r = await runPaperbackDraft(
          { book_id: b.id },
          { port: createPlaywrightPaperbackDraftPort() },
        );
        console.log('  ->', JSON.stringify(r));
      }
    } catch (err) {
      console.log('  -> EXCEPTION', err instanceof Error ? err.message : String(err));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error('fatal:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
