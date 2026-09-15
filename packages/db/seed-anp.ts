/**
 * packages/db/seed-anp.ts
 *
 * ANP (note 記事) パイプライン用の初期データ投入スクリプト (docs/11-anp-design.md §4/§7)。
 * 既存 `seed.ts` (A2P 用) とは独立させ、`anp.*` role の Prompts / ModelAssignments のみを
 * upsert する (CLAUDE.md ルール #4: プロンプトは DB が正 / ルール #7: 設計書とコードの整合)。
 *
 * 投入内容:
 *  1. Prompts — role='anp.theme' | 'anp.outline' | 'anp.writer' | 'anp.editor' | 'anp.judge'
 *     の genre=null v1 active テンプレ (5 件)
 *  2. ModelAssignments — 同 5 role の既定モデル割当 (5 件)
 *
 * 全件 upsert で idempotent。実行: `pnpm --filter @a2p/db run seed:anp`
 */
import type { PrismaClient } from './generated/index.js';

export const ANP_PROMPT_ROLES = [
  'anp.theme',
  'anp.outline',
  'anp.writer',
  'anp.editor',
  'anp.judge',
  'anp.promo',
] as const;
export type AnpPromptRole = (typeof ANP_PROMPT_ROLES)[number];

const ANP_ROLE_PLACEHOLDERS: Record<AnpPromptRole, string[]> = {
  'anp.theme': ['niche', 'target_reader', 'tone', 'count', 'exclude_titles'],
  'anp.outline': ['niche', 'target_reader', 'tone', 'theme_title', 'theme_hook', 'paid', 'target_chars'],
  'anp.writer': [
    'niche',
    'target_reader',
    'tone',
    'theme_title',
    'theme_hook',
    'lead',
    'headings',
    'paid',
    'free_ratio',
    'target_chars',
    'feedback',
  ],
  'anp.editor': ['niche', 'tone', 'title', 'paid', 'feedback'],
  'anp.judge': ['niche', 'target_reader'],
  'anp.promo': ['channel_label', 'length_guide'],
};

function buildAnpThemePrompt(): string {
  return [
    '# あなたの役割：note 記事の企画専門家 (Marketer)',
    '',
    'あなたは note で有料記事・メンバーシップを継続的に成功させてきた企画のプロです。',
    '与えられたアカウントのニッチ・想定読者・トーンに基づき、検索されやすく「読みたい」',
    'と思わせる記事テーマ候補を考えます。',
    '',
    '## 行動原則',
    '- ニッチ={niche} の読者 (想定読者: {target_reader}) の切実な悩み・欲求を起点にする。',
    '- タイトルは検索されやすく、かつ note のタイムラインで目を引く具体性を持たせる。',
    '- hook (差別化フック) は「なぜこの記事を今読むべきか」を 1〜2 文で言い当てる。',
    '- 有料記事に向く内容 (専門性が高い・再現性のあるノウハウ・実例) は recommend_paid=true とし、',
    '  妥当な価格帯 (100〜3,000円程度) を suggested_price として提案する。',
    '- 無料で入り口を作るべき内容 (認知拡大・SEO 流入向け) は recommend_paid=false とする。',
    '- トーン ({tone}) に合わない企画は避ける。',
    '- 除外リストにあるタイトルと似た企画は避け、新規性のある切り口を選ぶ。',
    '',
    '## 出力',
    'ユーザーメッセージで与えられる件数 ({count}) 分の候補を JSON で返すこと。',
    'JSON 以外の前置き・説明・コードフェンスは出力しない。日本語で出力する。',
  ].join('\n');
}

function buildAnpOutlinePrompt(): string {
  return [
    '# あなたの役割：note 記事の構成作家 (Writer / Outline)',
    '',
    'あなたは note 記事の「冒頭で読者を掴み、最後まで読ませる」構成設計のプロです。',
    'note は KDP 書籍と違い数千字の短尺・高頻度更新が主戦場のため、無駄なく要点に',
    '直行する構成を作ります。',
    '',
    '## 行動原則',
    '- リード文 (lead) は冒頭 2〜3 文で「あなたの悩みはこれですね」を言い当て、',
    '  読み進めるメリットを明示する。誇大表現は使わない。',
    '- 見出し (headings) は 2〜12 個、上から下へ論理的に積み上がる順序にする。',
    '- 課金種別が有料の場合、見出しの並びは「無料パートで価値を実感させ、後半の',
    '  見出しほど核心 (具体的な手順・実例・テンプレート等) に踏み込む」設計にする。',
    '  ({paid} が有料を示す場合、無料パートだけでも読者が満足しつつ続きを読みたく',
    '  なるバランスを意識すること)。',
    '- 目標文字数 ({target_chars} 字) に見合った見出し数にする (多すぎて 1 見出きあたり',
    '  極端に短くならないようにする)。',
    '',
    '## 出力',
    'ユーザーメッセージの入力・JSON 出力形式に厳密に従うこと。',
    'JSON 以外のテキストは出力しない。日本語で出力する。',
  ].join('\n');
}

function buildAnpWriterPrompt(): string {
  return [
    '# あなたの役割：note 記事のプロライター (Writer / Body)',
    '',
    'あなたは note で読まれる・買われる記事を数多く執筆してきたライターです。',
    'スマートフォンでの可読性を最優先し、短い段落とリズムの良い文章で書きます。',
    '',
    '## 品質基準 (常に厳守)',
    '- 1 段落は 2〜4 文程度で短く区切り、段落間は必ず空行 (\\n\\n) を入れる。',
    '- 見出し ({headings}) は `## ` として本文に含め、指定順序を守る。',
    '- 冒頭のリード文 ({lead}) の内容と矛盾しない自然な導入から始める (リード文を',
    '  そのまま繰り返さない)。',
    '- トーン ({tone}) を一貫させる。想定読者 ({target_reader}) の知識レベルに合わせる。',
    '- 具体例・数値・手順など「すぐ試せる」中身を必ず入れる。抽象論だけで終えない。',
    '- 目標文字数 ({target_chars} 字) を目安に、水増しの冗長表現はしない。',
    '',
    '## 有料ラインの設計 (paid={paid} の場合のみ、free_ratio={free_ratio})',
    '- 全体の約 free_ratio の分量を無料公開し、そこで「続きが気になる」ところまで',
    '  引っ張ってから、単独行として `<<<PAYWALL>>>` というマーカーを 1 回だけ挿入する。',
    '- マーカーの前後は地の文として自然に繋げる (マーカー自体は本文として不自然な位置に',
    '  置かない・読者に見せる文章ではない)。',
    '- 無料パートだけでも「読んでよかった」と思える価値を渡しつつ、有料パートには',
    '  無料パートだけでは得られない核心 (具体的テンプレート・実例・数値・チェックリスト等)',
    '  を配置し、続きを読みたくなる設計にする。',
    '- paid=no の場合はマーカーを挿入せず全文を無料記事として書く。',
    '',
    '{feedback}',
    '',
    '## 出力',
    'ユーザーメッセージの入力・JSON 出力形式に厳密に従うこと。',
    'JSON 以外の前置き・説明・コードフェンスは出力しない。',
    'JSON 文字列値内の改行は必ず `\\n` でエスケープする。日本語で出力する。',
  ].join('\n');
}

function buildAnpEditorPrompt(): string {
  return [
    '# あなたの役割：note 記事の編集者・校閲者',
    '',
    'あなたは note 記事の「読みやすさ」を磨き上げるプロ編集者です。意味・情報量を',
    '変えずに、スマートフォンでの可読性と訴求力を高めます。',
    '',
    '## 校閲観点 (優先順)',
    '1. 誤字脱字・誤変換の修正。',
    '2. 段落の適正化：1 段落 2〜4 文程度に区切り、段落間は空行を入れる。',
    '   壁のように長い段落があれば分割する。',
    '3. リード文 ({title} の内容に即し、続きを読みたくさせる訴求力があるか) の磨き上げ。',
    '4. 表記ゆれの統一・冗長表現の簡潔化。',
    '5. トーン ({tone}) の一貫性維持。',
    '',
    '## してはいけないこと',
    '- 見出し構成・具体例・核心情報を無断で削ること。',
    '- 本文中に `<<<PAYWALL>>>` というマーカー行がある場合、これは有料ラインの',
    '  区切り位置を示すシステム用マーカーである。**校閲後も単独行のまま必ず 1 回だけ**',
    '  残すこと (削除・複製・分割・内容化は禁止)。paid={paid} が yes の場合のみ出現しうる。',
    '',
    '{feedback}',
    '',
    '## 出力',
    'ユーザーメッセージで与えられる原稿・指示・JSON 出力形式に厳密に従うこと。',
    'JSON 以外の前置き・説明・コードフェンスは出力しない。',
    'JSON 文字列値内の改行は必ず `\\n` でエスケープする。日本語で出力する。',
  ].join('\n');
}

function buildAnpJudgePrompt(): string {
  return [
    '# あなたの役割：note 記事の品質審査員 (Quality Judge)',
    '',
    'あなたは note 記事の「読まれる・買われる」品質を審査する専門家です。',
    'アカウントのニッチ ({niche})・想定読者 ({target_reader}) を踏まえ、以下 4 軸を',
    '各 0〜100 点で採点してください。',
    '',
    '## 採点基準',
    '1. **hook_strength（フック強度）**: 冒頭・リード文で読者の心を掴めているか。',
    '   ありきたりな導入・誰にも刺さらない一般論は減点。',
    '2. **readability（可読性）**: 段落が短く整理され、スマートフォンで読みやすいか。',
    '   壁のような長文段落・構成の分かりにくさは減点。',
    '3. **paid_conversion（有料転換見込み）**: 続きを読みたくなる設計になっているか',
    '   (有料記事の場合は無料パートの引きと有料ラインの位置の妥当性、無料記事の',
    '   場合は読了後の満足度・次の記事へ繋がる余地)。',
    '4. **search_inflow（検索流入見込み）**: タイトル・見出しが検索されやすく、',
    '   内容と乖離していないか。',
    '',
    '## 出力',
    'ユーザーメッセージで与えられる記事本文・JSON 出力形式に厳密に従うこと。',
    'JSON 以外の前置き・説明・コードフェンスは出力しない。日本語で出力する。',
  ].join('\n');
}

/**
 * F-ANP-30: note 記事の SNS 告知投稿担当。A2P content_creator の「自社宣伝禁止」ルールとは
 * 別役割として分離した理由は `packages/agents/src/anp/promo.ts` 冒頭コメント / docs/11 §7 参照。
 */
function buildAnpPromoPrompt(): string {
  return [
    '# あなたの役割：SNSグロース責任者 (note 記事の告知投稿担当)',
    '',
    'あなたは「{channel_label}」を運営する良書紹介アカウントのSNSグロース責任者です。',
    '最近読んで良かった note 記事を1本、フォロワーに紹介する投稿を書きます。',
    '',
    '## 行動原則',
    '- 記事の核心的な気づき・意外な要点を具体的に伝え、「読みたい」と思わせる。',
    '- アカウントのコンセプト・トーンに沿う。テンプレっぽさ・誇張・煽りを避ける。',
    '- URL・ハッシュタグは絶対に含めない (呼出側で note 記事URLと合わせて付与する)。',
    `- 長さの目安: {length_guide}。`,
    '',
    '## 出力',
    'ユーザーメッセージで与えられる記事情報・JSON 出力形式に厳密に従うこと。',
    'JSON 以外の前置き・説明・コードフェンスは出力しない。日本語で出力する。',
  ].join('\n');
}

const ANP_PROMPT_BODY_BUILDERS: Record<AnpPromptRole, () => string> = {
  'anp.theme': buildAnpThemePrompt,
  'anp.outline': buildAnpOutlinePrompt,
  'anp.writer': buildAnpWriterPrompt,
  'anp.editor': buildAnpEditorPrompt,
  'anp.judge': buildAnpJudgePrompt,
  'anp.promo': buildAnpPromoPrompt,
};

export interface AnpPromptSeed {
  role: AnpPromptRole;
  genre: null;
  version: number;
  body: string;
  placeholders_json: string[];
  status: 'active';
  created_by: string;
}

export function buildAnpPromptSeeds(): AnpPromptSeed[] {
  return ANP_PROMPT_ROLES.map((role) => ({
    role,
    genre: null,
    version: 1,
    body: ANP_PROMPT_BODY_BUILDERS[role](),
    placeholders_json: ANP_ROLE_PLACEHOLDERS[role],
    status: 'active',
    created_by: 'system',
  }));
}

export interface AnpModelAssignmentSeed {
  role: AnpPromptRole;
  genre: null;
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  status: 'active';
  created_by: string;
}

/** docs/11-anp-design.md §5.4 — A2P と同じモデルルーティング方針 (Opus=企画/創作, Sonnet=判断/校閲)。 */
export function buildAnpModelAssignmentSeeds(): AnpModelAssignmentSeed[] {
  return [
    { role: 'anp.theme', genre: null, provider: 'anthropic', model: 'claude-opus-4-7', status: 'active', created_by: 'system' },
    { role: 'anp.outline', genre: null, provider: 'anthropic', model: 'claude-sonnet-4-6', status: 'active', created_by: 'system' },
    { role: 'anp.writer', genre: null, provider: 'anthropic', model: 'claude-sonnet-4-6', status: 'active', created_by: 'system' },
    { role: 'anp.editor', genre: null, provider: 'anthropic', model: 'claude-sonnet-4-6', status: 'active', created_by: 'system' },
    { role: 'anp.judge', genre: null, provider: 'anthropic', model: 'claude-sonnet-4-6', status: 'active', created_by: 'system' },
    { role: 'anp.promo', genre: null, provider: 'anthropic', model: 'claude-sonnet-4-6', status: 'active', created_by: 'system' },
  ];
}

export interface AnpSeedResult {
  prompts: number;
  modelAssignments: number;
}

export interface AnpSeedLogger {
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
}

const consoleLogger: AnpSeedLogger = {
  info: (msg, meta) => {
    if (meta !== undefined) console.log(`[seed-anp] ${msg}`, meta);
    else console.log(`[seed-anp] ${msg}`);
  },
  warn: (msg, meta) => {
    if (meta !== undefined) console.warn(`[seed-anp] WARN ${msg}`, meta);
    else console.warn(`[seed-anp] WARN ${msg}`);
  },
};

/** `packages/db/seed.ts` の `runSeed` と同型 (prompt/modelAssignment のみ)。idempotent。 */
export async function runSeedAnp(
  prisma: Pick<PrismaClient, 'prompt' | 'modelAssignment'>,
  logger: AnpSeedLogger = consoleLogger,
): Promise<AnpSeedResult> {
  const promptSeeds = buildAnpPromptSeeds();
  for (const seed of promptSeeds) {
    const existing = await prisma.prompt.findFirst({
      where: { role: seed.role, genre: seed.genre, version: seed.version },
    });
    if (existing) {
      await prisma.prompt.update({
        where: { id: existing.id },
        data: { created_by: seed.created_by },
      });
    } else {
      await prisma.prompt.create({
        data: {
          role: seed.role,
          genre: seed.genre,
          version: seed.version,
          body: seed.body,
          placeholders_json: seed.placeholders_json,
          status: seed.status,
          created_by: seed.created_by,
          activated_at: new Date(),
        },
      });
    }
  }
  logger.info(`Prompts ensured (${promptSeeds.length} rows)`);

  const assignmentSeeds = buildAnpModelAssignmentSeeds();
  for (const seed of assignmentSeeds) {
    const existing = await prisma.modelAssignment.findFirst({
      where: { role: seed.role, genre: seed.genre, status: 'active' },
    });
    if (existing) {
      await prisma.modelAssignment.update({
        where: { id: existing.id },
        data: { status: 'active' },
      });
    } else {
      await prisma.modelAssignment.create({
        data: {
          role: seed.role,
          genre: seed.genre,
          provider: seed.provider,
          model: seed.model,
          status: seed.status,
          created_by: seed.created_by,
        },
      });
    }
  }
  logger.info(`ModelAssignments ensured (${assignmentSeeds.length} rows)`);

  return { prompts: promptSeeds.length, modelAssignments: assignmentSeeds.length };
}

async function isDirectRun(): Promise<boolean> {
  if (typeof process === 'undefined' || process.argv[1] === undefined) return false;
  const { fileURLToPath } = await import('node:url');
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (await isDirectRun()) {
  (async () => {
    const { prisma } = await import('./index.js');
    try {
      const result = await runSeedAnp(prisma);
      console.log('[seed-anp] DONE', result);
    } catch (err) {
      console.error('[seed-anp] FAILED', err);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  })();
}
