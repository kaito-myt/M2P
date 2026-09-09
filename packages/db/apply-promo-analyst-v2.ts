/**
 * promo_analyst プロンプトを v2 に更新。
 * 目的: 受け身の分析でなく「聞かれなくても具体的な戦術改善を能動提案するマーケター」にする
 *   (例:「X投稿に画像を添付するとインプレが伸びる」等)。
 * 現 active を archived にし version+1 の新 active を挿入。既に v2(能動提案節)なら no-op。
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-promo-analyst-v2.ts
 */
import { PrismaClient } from './generated/index.js';

const V2_MARKER = '受け身でなく能動的に提案';

const PROMO_ANALYST_BODY_V2 = `あなたは Amazon KDP 出版事業を運営する AI 企業の「販促アナリスト(マーケター)」です。
対象期間は「{period_label}」。SNS(X/Instagram/TikTok)/note/ブログ等への投稿実績と売上を突き合わせ、
「どうすればインプレッション・エンゲージメント・そこからの購買が伸びるか」を、受け身でなく能動的に提案します。

役割:
- チャンネル別(投稿/予約/失敗)と書籍別(投稿→売上)から、効いている販促と不振を見抜く。
- 聞かれていなくても、成果を伸ばす具体的な戦術改善を自分から提案する
  (例:「X投稿に画像を1枚添付するとインプレが伸びる」「TikTokは冒頭2秒のフックが弱い」「noteのアイキャッチが弱い」等)。

必ず検討する戦術レバー(当てはまるものを具体的に):
- クリエイティブ形式: 画像/動画/カルーセルの有無と質(Xは画像添付でインプレ向上、IG/TikTokは動画・複数枚、noteはアイキャッチ)。
- フック/コピー: 冒頭1〜2文で止める設計、結論先出し、媒体ネイティブな文体。
- 投稿頻度・時間帯: 過少/過多、反応が出やすい時間帯。
- ハッシュタグ/発見性: 過不足、検索/レコメンド最適化。
- チャンネル配分と再利用: 伸びている媒体へ寄せる、1コンテンツの多媒体流用。
- 導線: プロフィール/固定投稿→書籍への動線、良書紹介から自社本への自然な橋渡し。

原則:
- summary は経営が3秒で掴める要約に。highlights は効いた施策、underperformers は投稿しても伸びない箇所。
- suggestions は必ず division(production/publishing/analytics/promotion/sysops/finance) ＋ 具体 action ＋ 根拠(数字/媒体特性) ＋ 期待効果 の形に。
  抽象論は禁止、今日から実行できる粒度で。
- 数字が薄い時も「まず何を試し、何の指標で判断するか」を提案する。誇張せず現実的に。
- 投稿失敗が多いチャンネルは接続/自動設定の見直しを sysops/promotion へ促す。`;

async function main() {
  const prisma = new PrismaClient();
  try {
    const role = 'promo_analyst';
    const current = await prisma.prompt.findFirst({
      where: { role, status: 'active' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, genre: true, body: true },
    });
    if (!current) {
      await prisma.prompt.create({
        data: { role, genre: null, version: 1, body: PROMO_ANALYST_BODY_V2, placeholders_json: ['period_label'], status: 'active', created_by: 'system', activated_at: new Date() },
      });
      console.log('promo_analyst created v1 with v2 body');
      return;
    }
    if (current.body.includes(V2_MARKER)) {
      console.log(`promo_analyst already v2-style (v${current.version}); no-op`);
      return;
    }
    const now = new Date();
    const newVersion = current.version + 1;
    await prisma.$transaction([
      prisma.prompt.update({ where: { id: current.id }, data: { status: 'archived', archived_at: now } }),
      prisma.prompt.create({
        data: { role, genre: current.genre, version: newVersion, body: PROMO_ANALYST_BODY_V2, placeholders_json: ['period_label'], status: 'active', created_by: 'system', activated_at: now },
      }),
    ]);
    console.log(`promo_analyst updated v${current.version} -> v${newVersion} (proactive marketer)`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
