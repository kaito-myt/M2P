/**
 * 一回限り (冪等): promoter ロールの DB プロンプトを「blog_outline = 完成ブログ記事」版
 * (v3) に更新する。
 *
 * 背景: 旧 promoter プロンプトは blog_outline を「ブログ告知の骨子」として出力させており、
 * それが blog-publisher-port でそのまま blog_posts.body として公開され、公開ブログ「栞」に
 * 骨子/構成案の未完成記事が量産された。新プロンプトは blog_outline を「そのまま公開できる
 * 完成した良書紹介/告知記事 (1,200字以上)」として出力させる。
 *
 * 方式: 現行の active な promoter プロンプト (genre=null = loadActivePrompt の既定解決先) を
 * archived にし、version+1 の新しい active 行を作る。本文は seed.ts の
 * buildPromoterPromptBody (=単一の真実源) から取得する。marker (本文一致) 判定で冪等。
 *
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-promoter-blog-v2.ts
 */
import { PrismaClient } from './generated/index.js';
import { buildPromptSeeds } from './seed.js';

const ROLE = 'promoter';

async function main() {
  const prisma = new PrismaClient();
  try {
    // seed.ts の promoter/genre=null プロンプト本文が新版 (v3) の真実源。
    const seed = buildPromptSeeds().find((x) => x.role === ROLE && x.genre === null);
    if (!seed) {
      throw new Error('promoter genre=null seed not found in buildPromptSeeds()');
    }
    const NEW_BODY = seed.body;

    // 現行の active な promoter/genre=null プロンプト (loadActivePrompt の解決先)。
    const current = await prisma.prompt.findFirst({
      where: { role: ROLE, genre: null, status: 'active' },
      orderBy: { version: 'desc' },
    });

    // marker 判定 (冪等): 既に新本文が active なら何もしない。
    if (current && current.body === NEW_BODY) {
      console.log(`promoter prompt already up to date (v${current.version}) — no change`);
      return;
    }

    // version+1 を決める (既存の全 version の最大 +1)。
    const latest = await prisma.prompt.findFirst({
      where: { role: ROLE, genre: null },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    // 現行 active を全て archived にする (念のため複数 active があっても畳む)。
    const archived = await prisma.prompt.updateMany({
      where: { role: ROLE, genre: null, status: 'active' },
      data: { status: 'archived' },
    });

    const created = await prisma.prompt.create({
      data: {
        role: ROLE,
        genre: null,
        version: nextVersion,
        body: NEW_BODY,
        placeholders_json: seed.placeholders_json,
        status: 'active',
        created_by: 'system',
        activated_at: new Date(),
      },
    });

    console.log(
      `promoter prompt updated: archived ${archived.count} active row(s), created v${created.version} (active)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
