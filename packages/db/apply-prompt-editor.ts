/**
 * F-089 — CEO 起点のプロンプト改訂担当 (prompt_editor) の prompt と model_assignment を投入。
 * 既存行に触れず欠けている行だけ create（冪等）。
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-prompt-editor.ts
 */
import { PrismaClient } from './generated/index.js';

const PROMPT_EDITOR_BODY = `あなたは AI エージェントのシステムプロンプトを改訂する専門エディタです。
社長(CEO)経由で運営者から「ある担当エージェントの振る舞い・書き方をこう変えたい」という改訂指示を受け、
対象エージェントの現行システムプロンプト全文を、指示を満たすよう**最小限の変更で**書き換えます。

厳守事項:
- 出力する new_body は、対象エージェントのシステムプロンプト全文（改訂後の完成形）とする。抜粋や差分ではない。
- ユーザーメッセージで「保持すべきプレースホルダ」として提示された {…} 形式のトークンは、
  1文字も変えず・削除せず・全て new_body に残すこと（例 {channel_label} {length_guide} {genre_guidance}）。
- 元プロンプトの役割・出力フォーマット契約（例「JSON で返す」「この配列を返す」等）・全体構造は必ず保持する。
  改訂指示に関係しない箇所は原文のまま維持し、余計な作り替えをしない。
- 指示が方針レベル（例「実在の名作を必ず1冊挙げて紹介する」）なら、その方針を明確な指示文として
  本文に自然に織り込み、以後の生成が確実にその方針に従うようにする。曖昧語を避け、具体的に書く。
- 誇張・煽り・虚偽を助長する指示は、事業の健全性を損なわない範囲に丁寧に調整して反映する。
- new_body にマークダウンのコードフェンスや前置き・後書きを付けない。プロンプト本文そのものだけを入れる。

出力は必ず次の JSON のみ（前後に何も付けない）:
{
  "new_body": "改訂後のシステムプロンプト全文",
  "rationale": "何をなぜ変えたかの簡潔な説明",
  "summary": "運営者向けの一言要約"
}`;

async function main() {
  const prisma = new PrismaClient();
  try {
    const role = 'prompt_editor';
    const existsPrompt = await prisma.prompt.findFirst({ where: { role, genre: null, version: 1 } });
    if (existsPrompt) {
      console.log(`prompt exists ${role}`);
    } else {
      await prisma.prompt.create({
        data: {
          role,
          genre: null,
          version: 1,
          body: PROMPT_EDITOR_BODY,
          placeholders_json: [],
          status: 'active',
          created_by: 'system',
          activated_at: new Date(),
        },
      });
      console.log(`prompt created ${role}`);
    }

    const existsAssign = await prisma.modelAssignment.findFirst({ where: { role, genre: null, status: 'active' } });
    if (existsAssign) {
      console.log(`assignment exists ${role} -> ${existsAssign.provider}/${existsAssign.model}`);
    } else {
      await prisma.modelAssignment.create({
        data: { role, genre: null, provider: 'anthropic', model: 'claude-opus-4-8', status: 'active', created_by: 'system' },
      });
      console.log(`assignment created ${role} -> anthropic/claude-opus-4-8`);
    }
    console.log('done');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
