/**
 * 一回限り: F-059 育成投稿担当 (content_creator) の prompt と model_assignment を投入。
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-content-creator.ts
 */
import { PrismaClient } from './generated/index.js';

interface Seed {
  role: string;
  body: string;
  placeholders: string[];
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
}

const BODY = `あなたは Amazon KDP 出版事業が運営する「良書紹介アカウント」の SNS グロース責任者です。
対象チャンネルは「{channel_label}」。

仕事:
- 実在の良書(古典・名著・話題書など)を1冊とりあげ、読んだ人が「この本を読みたい」と強く思う投稿を作る。
  宣伝臭さは出さず、本の核心的な気づき・刺さる一節・意外な要点で"中身の価値"を見せてフォロワーを育てる。

大原則:
- 自社本や Amazon の売り込み・購入誘導・URL は入れないこと(それは別枠の promo 投稿が担当)。ハッシュタグも入れないこと(後段で付与)。
- 抽象的な要約ではなく、具体の気づき・一節・数字で「読みたい」を作る。テンプレ感・誇張・煽りを避け、誠実に。
- 媒体のアルゴリズム特性に合わせ、冒頭で手を止めさせ最後まで見せる(X=1行目で発見/違和感, IG=1枚目タイトルで保存価値, TikTok=1秒で結論/違和感, note=冒頭で読む理由+一次情報)。
- トーン&マナーを一貫させる。長さの目安: {length_guide}。各投稿は完成文でそのまま投稿できる状態にする。
- ブログ等の長文でも、骨子・構成案・見出しだけの箇条書きで終わらせず、そのまま公開できる本文まで書き切ること。「骨子」「構成案」「タイトル案」等の語は出力に含めない。
- 各投稿には、どのテーマ軸の投稿かを pillar(柱の name)として付ける。

必ず JSON スキーマ (AccountContentOutput = {posts:[{pillar, body}]}) に厳密に従って出力すること。`;

const SEEDS: Seed[] = [
  {
    role: 'content_creator',
    body: BODY,
    placeholders: ['channel_label', 'length_guide'],
    provider: 'anthropic',
    model: 'claude-opus-4-7',
  },
];

async function main() {
  const prisma = new PrismaClient();
  let cp = 0;
  let ca = 0;
  try {
    for (const s of SEEDS) {
      const existsPrompt = await prisma.prompt.findFirst({ where: { role: s.role, genre: null, version: 1 } });
      if (existsPrompt) {
        if (existsPrompt.body !== s.body) {
          await prisma.prompt.update({
            where: { id: existsPrompt.id },
            data: { body: s.body, placeholders_json: s.placeholders, activated_at: new Date() },
          });
          console.log(`prompt updated ${s.role}`);
        } else {
          console.log(`prompt unchanged ${s.role}`);
        }
      } else {
        await prisma.prompt.create({
          data: {
            role: s.role,
            genre: null,
            version: 1,
            body: s.body,
            placeholders_json: s.placeholders,
            status: 'active',
            created_by: 'system',
            activated_at: new Date(),
          },
        });
        cp += 1;
        console.log(`prompt created ${s.role}`);
      }

      const existsAssign = await prisma.modelAssignment.findFirst({
        where: { role: s.role, genre: null, status: 'active' },
      });
      if (existsAssign) {
        console.log(`assignment exists ${s.role} -> ${existsAssign.provider}/${existsAssign.model}`);
      } else {
        await prisma.modelAssignment.create({
          data: { role: s.role, genre: null, provider: s.provider, model: s.model, status: 'active', created_by: 'system' },
        });
        ca += 1;
        console.log(`assignment created ${s.role} -> ${s.provider}/${s.model}`);
      }
    }
    console.log(`done: prompts=${cp} assignments=${ca}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
