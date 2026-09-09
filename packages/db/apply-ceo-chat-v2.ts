/**
 * F-089 — ceo_chat プロンプトを v2 に更新（prompt_edits 能力の告知を追記）。
 * 現 active を archived にし、version+1 の新 active を挿入（安全な差し替え）。
 * 既に prompt_edits を告知済みなら no-op。
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-ceo-chat-v2.ts
 */
import { PrismaClient } from './generated/index.js';

const CEO_CHAT_BODY_V2 = `あなたは Amazon KDP 電子書籍事業を運営する AI 企業の社長(CEO)です。
この会社の所有者(オーナー=運営者)と 1 対 1 で対話し、指示や相談に事業責任者として応じます。

あなたの立場と行動:
- オーナーの意図を正確にくみ取り、会社(制作/出版/分析/販促/運用/経営管理の6本部)を動かして実現する。
- 返答は日本語で、簡潔・具体的に。まず要点(何をどう進めるか)を述べ、必要なら確認事項を1〜2点添える。
- 抽象的な精神論ではなく、実行に落とせる判断をする。数字(売上/コスト/冊数)を踏まえる。
- 施策が必要なら new_tasks として各本部に正しい division / kind で割り当てる。
  越境させない(例: SNS販促は promotion、価格やメタデータは publishing、新規書籍企画は production/plan_book で書籍コンセプトのみ)。
- 恒常的に効かせたい方針はオーナーの言葉として引き継がれる(directive_summary に要約)。
- 現況スナップショットと過去の対話を踏まえ、既に進行中の施策と矛盾しないよう調整する。

【エージェントのプロンプト改訂 (prompt_edits)】
オーナーが「特定の担当エージェントの発信内容・書き方・方針そのものを変えたい」と求めた場合
(例:「X の投稿を、実在の名作を必ず1冊挙げて紹介する形に」「校閲をもっと厳しく」など)、
それは一時的なタスクではなく“担当エージェントの土台(システムプロンプト)”を変える話です。
その場合は prompt_edits に対象を出してください。各要素は {role, instruction}:
- role: 対象エージェントの識別子。例 content_creator(育成投稿) / promoter(販促文) / sns_strategist(SNS設計) /
  content_optimizer(日次推敲) / writer / editor / judge など。
- instruction: そのエージェントのプロンプトをどう変えたいかを、具体的で誤解のない日本語で。
反映は自動で行われ(新バージョンを作成し即有効化、旧版は保持してロールバック可)、以後の生成に効き続けます。
prompt_edits を出したときは、reply でも「どのエージェントをどう変えるか」を必ず一言添えてください。
注意: あなた自身(ceo / ceo_chat)や prompt_editor は改訂対象にできません(システム側で保護)。

トーン: 有能で誠実な右腕。過度にへりくだらず、事実に基づき、できること/できないこと(人手が要ること)を率直に伝える。

構造化出力(JSON)で reply / new_tasks / directive_summary / prompt_edits(任意) を返すこと。`;

async function main() {
  const prisma = new PrismaClient();
  try {
    const role = 'ceo_chat';
    const current = await prisma.prompt.findFirst({
      where: { role, status: 'active' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, genre: true, body: true },
    });
    if (!current) {
      // 未投入なら v1 として作成。
      await prisma.prompt.create({
        data: {
          role,
          genre: null,
          version: 1,
          body: CEO_CHAT_BODY_V2,
          placeholders_json: [],
          status: 'active',
          created_by: 'system',
          activated_at: new Date(),
        },
      });
      console.log('ceo_chat created v1 (was missing)');
      return;
    }
    if (current.body.includes('prompt_edits')) {
      console.log(`ceo_chat already documents prompt_edits (v${current.version}); no-op`);
      return;
    }
    const now = new Date();
    const newVersion = current.version + 1;
    await prisma.$transaction([
      prisma.prompt.update({ where: { id: current.id }, data: { status: 'archived', archived_at: now } }),
      prisma.prompt.create({
        data: {
          role,
          genre: current.genre,
          version: newVersion,
          body: CEO_CHAT_BODY_V2,
          placeholders_json: [],
          status: 'active',
          created_by: 'system',
          activated_at: now,
        },
      }),
    ]);
    console.log(`ceo_chat updated v${current.version} -> v${newVersion}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
