/**
 * 一回限り (冪等): 運営者要望「投稿にSNSのキャラクター性が出るように」を本番 DB へ適用する。
 *
 * 1. `content_creator` / `promoter` / `anp.promo` の active プロンプト(genre=null)に、
 *    「## キャラクター性」節を追記した新版を作る(現行 active を archived にし version+1 で active 作成)。
 *    本文は **DB の現行 active をベースに追記**する(自律プロンプト改訂/CEOチャット等で本文が
 *    git 上のテンプレから既に更新されている可能性があるため、既存の調整を壊さないよう全文置換はしない)。
 *    マーカー文字列(CHAR_SECTION_MARKER)が既に本文に含まれていれば適用済みとして skip する。
 * 2. `promotion_channel_settings.strategy_json` に `character_sheet` が無いチャンネルへ、
 *    既定ペルソナ「ことは」のキャラクターシートを補完する(既にあれば上書きしない)。
 *
 *   DATABASE_URL=<target> pnpm --filter @a2p/db exec tsx apply-character-sheet.ts
 */
import { PrismaClient } from './generated/index.js';

const CHAR_SECTION_MARKER = '## キャラクター性(最重要, 2026-09-18 追加)';

/**
 * 既定ペルソナ「ことは」のキャラクターシート。
 * 単一の真実源は `packages/contracts/src/agents/sns-strategist.ts` の
 * `DEFAULT_PERSONA_CHARACTER_SHEET`。packages/db は @a2p/contracts に依存させない方針のため、
 * ここに複製する(変更時は両方を同期すること)。
 */
const DEFAULT_PERSONA_CHARACTER_SHEET =
  '【人物】名前は「ことは」、20代後半。都内のIT企業で働く会社員で、駅から徒歩10分のワンルームに' +
  '一人暮らし。通勤電車の中と寝る前の30分が読書タイムで、Kindle Unlimitedを使って毎日欠かさず1冊は' +
  '本を読む生活を3年続けている。平日は定時退社を死守し、土日は朝ゆっくり起きて近所のカフェで1冊読み' +
  '切るのが何よりの楽しみ。同僚に「今日も読んでるの」と言われるのが密かな自慢。\n' +
  '【一人称】わたし\n' +
  '【口癖・語尾】「〜なんだよね」「正直に言うと」「これは刺さった」「地味だけど効く」' +
  '「気づいたら〇時間経ってた」の5つを、状況に合わせて自然に使う。\n' +
  '【好きなもの】静かな喫茶店の窓際席、朝いちばんのコーヒー、付箋だらけになった文庫本、寝る前に' +
  'ページをめくる時間、本屋を何も買わずに1時間ぶらつくこと。\n' +
  '【苦手なもの】根性論だけで押し切る自己啓発本、満員電車、話が長いだけの自慢話、締め切り前日の自分。\n' +
  '【価値観】背伸びしない。派手な成功譚より、自分の生活が少しだけ楽になる小さな学びを選ぶ。話題性や' +
  '再生数より「続けられるかどうか」を何より大事にする。良い本は誰かに教えたくなる、その気持ちに' +
  '素直でいたい。\n' +
  '【弱み】三日坊主で、ダイエットも筋トレも英会話も3日で終わった実績多数。朝が弱く、二度寝の常習犯。' +
  '貯金も長続きしない。唯一、本を読む習慣だけは続いている。\n' +
  '【NG】説教くさい言い方はしない。専門用語を並べない。顔出しはしない。誇張や煽りで「買わせよう」としない。';

interface PromptCharacterSpec {
  role: string;
  /** 本文に追記する「## キャラクター性」節(先頭に改行2つを足して連結する)。 */
  appendBlock: string;
}

const PROMPT_SPECS: PromptCharacterSpec[] = [
  {
    role: 'content_creator',
    appendBlock: `${CHAR_SECTION_MARKER}
このアカウントは「ことは」という一人の人物が運営している体で投稿する。ユーザーメッセージの
「【キャラクター設定】」で渡す人柄(口癖・一人称・日常・価値観・弱み)を必ず活かし、フォロワーが
「ことはさんが書いている」と感じる一貫した人柄を毎投稿に出すこと。
- 毎投稿に、口癖・日常の一コマ・率直な感情・自分の失敗談のいずれか最低1つを自然に入れる。
- ただし主役は本の紹介・価値提供。自分語りは投稿全体の2〜3割までに留める。
- 【キャラクター設定】に無い言動(説教くさい言い方・専門用語の羅列・顔出し等)はしない。`,
  },
  {
    role: 'promoter',
    appendBlock: `${CHAR_SECTION_MARKER}
promo_copy(x_posts / note_article / blog_outline)は「ことは」という一人の人物が発信している体で書く。
ユーザーメッセージの「【キャラクター設定】」で渡す人柄(口癖・一人称・日常・価値観・弱み)を自然に
反映し、読者が「いつもの、ことはさんだ」と感じる一貫性を持たせること。
- 各投稿に、口癖・日常の一コマ・率直な感情のいずれか最低1つを短く添える。
- ただし主役は本の魅力と購入導線。自分語りは全体の2〜3割まで(x_posts は一言添える程度でよい)。
- 上記「事実の扱い」の禁止事項(価格/URL/セール/未確定実績)を自分語り部分でも破らない。`,
  },
  {
    role: 'anp.promo',
    appendBlock: `${CHAR_SECTION_MARKER}
この投稿は「ことは」という一人の人物が発信している体で書く。ユーザーメッセージの
「【キャラクター設定】」の人柄(口癖・一人称・日常・価値観・弱み)を短く自然に反映し、
「いつものことはさんだ」と感じさせること。ただし主役は記事の魅力。自分語りは全体の2〜3割まで。`,
  },
];

async function applyPromptCharacterSection(prisma: PrismaClient, spec: PromptCharacterSpec): Promise<void> {
  const current = await prisma.prompt.findFirst({
    where: { role: spec.role, genre: null, status: 'active' },
    orderBy: { version: 'desc' },
  });
  if (!current) {
    console.warn(`skip ${spec.role}: no active prompt found (genre=null)`);
    return;
  }
  if (current.body.includes(CHAR_SECTION_MARKER)) {
    console.log(`${spec.role} already has character section (v${current.version}) — skip`);
    return;
  }

  const latest = await prisma.prompt.findFirst({
    where: { role: spec.role, genre: null },
    orderBy: { version: 'desc' },
  });
  const nextVersion = (latest?.version ?? current.version) + 1;
  const newBody = `${current.body}\n\n${spec.appendBlock}`;

  await prisma.prompt.updateMany({
    where: { role: spec.role, genre: null, status: 'active' },
    data: { status: 'archived', archived_at: new Date() },
  });
  const created = await prisma.prompt.create({
    data: {
      role: spec.role,
      genre: null,
      version: nextVersion,
      body: newBody,
      placeholders_json: current.placeholders_json ?? [],
      status: 'active',
      created_by: 'system',
      activated_at: new Date(),
    },
  });
  console.log(`${spec.role}: archived v${current.version}, created v${created.version} (active)`);
}

async function backfillStrategyCharacterSheet(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.promotionChannelSetting.findMany({
    select: { id: true, channel: true, strategy_json: true },
  });
  let updated = 0;
  for (const row of rows) {
    if (!row.strategy_json || typeof row.strategy_json !== 'object' || Array.isArray(row.strategy_json)) continue;
    const strategy = row.strategy_json as Record<string, unknown>;
    const existing = typeof strategy.character_sheet === 'string' ? strategy.character_sheet.trim() : '';
    if (existing.length > 0) {
      console.log(`${row.channel}: character_sheet already set — skip`);
      continue;
    }
    await prisma.promotionChannelSetting.update({
      where: { id: row.id },
      data: { strategy_json: { ...strategy, character_sheet: DEFAULT_PERSONA_CHARACTER_SHEET } },
    });
    updated += 1;
    console.log(`${row.channel}: character_sheet backfilled (既定ペルソナ「ことは」)`);
  }
  console.log(`strategy_json backfill done: updated=${updated}/${rows.length}`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const spec of PROMPT_SPECS) {
      await applyPromptCharacterSection(prisma, spec);
    }
    await backfillStrategyCharacterSheet(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
