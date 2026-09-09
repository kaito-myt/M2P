/**
 * 書籍生成ロールのモデル割当を「実用書=GPT系 / 小説=Claude Opus系」に最適化する
 * (2026-08-24, ユーザー指示)。冪等: 既存 active 行は provider/model を更新、無ければ作成。
 *
 * 方針:
 *  - writer  : 実用書(null既定)=gpt-5 / 小説7ジャンル=claude-opus-5 (文体・描写)
 *  - editor  : 実用書(null既定)=claude-sonnet-5 (校正はClaudeが元文体を残す) / 小説=claude-opus-5 (リライト)
 *  - judge   : gpt-5 (論理整合・重複・章間つながりのレビューはGPTが強い)
 *  - marketer: claude-sonnet-5 (市場分析。web_search が Anthropic 専用のため GPT 不可)
 *  genre 別行は loadModelAssignment が null 既定より優先するため、小説だけ Claude に切り替わる。
 *
 * 実行: DATABASE_URL=... pnpm --filter @a2p/db exec tsx apply-model-routing-books.ts
 */
import { PrismaClient } from './generated/index.js';

const prisma = new PrismaClient();

interface Target {
  role: string;
  genre: string | null;
  provider: string;
  model: string;
}

// packages/contracts/src/genres.ts の FICTION_GENRES と一致させること。
const FICTION = [
  'novel',
  'light_novel',
  'mystery',
  'sf_fantasy',
  'romance_fiction',
  'historical_novel',
  'horror',
];

const TARGETS: Target[] = [
  { role: 'writer', genre: null, provider: 'openai', model: 'gpt-5' },
  { role: 'editor', genre: null, provider: 'anthropic', model: 'claude-sonnet-5' },
  { role: 'judge', genre: null, provider: 'openai', model: 'gpt-5' },
  { role: 'marketer', genre: null, provider: 'anthropic', model: 'claude-sonnet-5' },
  ...FICTION.flatMap((g): Target[] => [
    { role: 'writer', genre: g, provider: 'anthropic', model: 'claude-opus-5' },
    { role: 'editor', genre: g, provider: 'anthropic', model: 'claude-opus-5' },
  ]),
];

async function main() {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const t of TARGETS) {
    const existing = await prisma.modelAssignment.findFirst({
      where: { role: t.role, genre: t.genre, status: 'active' },
    });
    if (existing) {
      if (existing.provider !== t.provider || existing.model !== t.model) {
        await prisma.modelAssignment.update({
          where: { id: existing.id },
          data: { provider: t.provider, model: t.model, activated_at: new Date() },
        });
        updated++;
        console.log(`UPDATED ${t.role}/${t.genre ?? 'null'} -> ${t.provider}/${t.model}`);
      } else {
        unchanged++;
      }
    } else {
      await prisma.modelAssignment.create({
        data: {
          role: t.role,
          genre: t.genre,
          provider: t.provider,
          model: t.model,
          status: 'active',
          created_by: 'system',
          activated_at: new Date(),
        },
      });
      created++;
      console.log(`CREATED ${t.role}/${t.genre ?? 'null'} -> ${t.provider}/${t.model}`);
    }
  }
  console.log(`\nDone. created=${created} updated=${updated} unchanged=${unchanged}`);
}

main()
  .catch((e) => {
    console.error('ERR', e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
