/**
 * docs/11-anp-design.md §3.2 F-ANP-14 — note Eyecatch (アイキャッチ画像生成)。
 * A2P Thumbnail Designer (`thumbnail/image.ts`) の画像生成基盤 (`generateImage` +
 * `withImageLogging` + R2 upload) を流用する。
 *
 * 【F-ANP-55 (2026-10-14): 文字ごと画像モデルに描かせる 1 パス方式へ】
 * 運営者指摘「画像に文字を重ねてるでしょ。そうじゃなくて Image2 使って画像と文字の入った
 * サムネを一発で作れっていってるんだけど」。
 *
 * 旧方式は「絵は AI・文字は実フォント」の 2 段 (gpt-image-1 が日本語を崩す前提の設計)。
 * しかし **A2P の表紙は既に 1 パス方式へ移行済み**で (`thumbnail/image.ts`:
 * 「旧: 文字なし生成→フラット実フォント合成→refine の3段は品質が劣るため廃止」)、
 * gpt-image-2 は日本語タイポグラフィをデザインに統合して描ける。
 * アイキャッチだけが旧方式に取り残されていたので揃える。
 *
 * 1 パスにすると何が良くなるか:
 *  - 文字が**絵の一部としてデザインされる** (袋文字・マーカー・箔・バッジ・斜め組み)。
 *    自前合成は「絵の上に長方形のパネルを貼る」しかできず、売れているサムネの作りに届かない。
 *  - 版面・配色・書体をジャンルごとにプロンプトで指示でき、絵と文字が互いに合う。
 *
 * 1 パスの risk と対策:
 *  - 日本語が崩れる → プロンプトで「一字一句そのまま」を最優先に明記し、
 *    `verifyNoteEyecatchText` (ビジョン検査) で崩れを検知して 1 回だけ作り直す。
 *  - 比率 → gpt-image-2 は任意解像度 (16 の倍数) に対応するので note 比率で直接生成する。
 *    旧方式は 1536x1024 を 1280x670 に cover-crop していたが、1 パスでは**文字が切れる**ので不可。
 *
 * 【画像モデルは割当で切替】: role='anp.eyecatch' の model_assignments で provider/model
 * を決める (既定 openai/gpt-image-2、Nano Banana 2 = google/gemini-3.1-flash-image)。
 *
 * Flow:
 *  1. ニッチからジャンル・画風・版面・配色を決め、**文字を含む**プロンプトを構築
 *  2. `generateImage` (via `withImageLogging`, role='anp.eyecatch') で 1280x672 を生成
 *  3. 文字が崩れていないかビジョン検査 → 崩れていれば 1 回だけ再生成
 *  4. R2 に upload (`note/{note_article_id}/eyecatch.jpg`)
 */
import { classifyNicheGenre, type NoteGenreProfile } from '@a2p/contracts/note-genre';
import { noteArticleEyecatch } from '@a2p/storage/keys';
import {
  composeNoteEyecatch,
  defaultEyecatchAlt,
  pickNoteEyecatchLayout,
  schemeForNiche,
  NOTE_EYECATCH_HEIGHT,
  NOTE_EYECATCH_WIDTH,
  type NoteEyecatchLayout,
  type NoteEyecatchScheme,
} from '@a2p/output-image';

import { EYECATCH_BANNED_MOTIFS, pickEyecatchStyle, type EyecatchStyle } from './eyecatch-style.js';
import { verifyNoteEyecatchText, type VerifyNoteEyecatchTextDeps } from './eyecatch-text-check.js';

import {
  generateImage as defaultGenerateImage,
  type GenerateImageFn,
  type ImageGenDeps,
} from '../tools/image-gen.js';
import {
  withImageLogging,
  type ImageLoggingContext,
  type WithImageLoggingDeps,
} from '../lib/with-image-logging.js';
import { generateImageGoogle } from '../tools/image-gen-google.js';
import {
  loadModelAssignment as defaultLoadModelAssignment,
  type LoadModelAssignmentDeps,
} from '../lib/load-model-assignment.js';

/**
 * 生成サイズ。gpt-image-2 は任意解像度に対応するが **幅・高さともに 16 の倍数**が条件。
 * note 推奨の 1280x670 は 670 が 16 の倍数でないので 672 にする (比率 1.905 ≒ 1.91)。
 * 文字を焼き込むので**後からの crop は禁物** — 最初から note 比率で生成する。
 */
const IMAGE_WIDTH = NOTE_EYECATCH_WIDTH;
const IMAGE_HEIGHT = 672;

export interface GenerateNoteEyecatchInput {
  noteArticleId: string;
  jobId?: string;
  title: string;
  hook: string;
  niche: string;
  /** 画像に焼き込むキャッチコピー (anp.seo の出力)。無ければ文字を載せない。 */
  eyecatchCopy?: string | null;
  /** キャッチの下に入れる補足 1 行。 */
  eyecatchSub?: string | null;
  /** F-ANP-14b: 直近の記事で使った画風キー (連続で同じ見た目にならないよう避ける)。 */
  recentStyleKeys?: readonly string[];
  /** F-ANP-14b: 記事の方針・トンマナ (アカウント設定) の抜粋。画のトーンに反映する。 */
  editorialPolicy?: string | null;
  /**
   * F-ANP-56: アカウント固有の画作り指示 (週次リサーチ `anp.research` の成果)。
   * 指定時は**ジャンル既定の `genre.art` より優先**される。
   * ジャンル表は「副業系か競馬系か」の 2 分類しか持てないので、アカウントごとの
   * 勝ち筋 (何が今伸びているか) はリサーチで上書きする。
   */
  accountArtDirection?: string | null;
  /**
   * F-ANP-56: 週次リサーチが決めた「コピーの見せ方」の規則。
   * 字数や言い回しだけでなく**装飾の可否** (袋文字・多重縁取り・グラデーション) を
   * 含むため、コピーを書く `anp.seo` だけでなく**画像プロンプトにも渡す必要がある**。
   * 2026-10-14 実測: 「装飾文字・縁取り3重は使わない」とリサーチが決めたのに、
   * この経路が無く金色の多重縁取りが生成されていた。
   */
  accountCopyRules?: readonly string[];
}

export interface GenerateNoteEyecatchResult {
  r2Key: string;
  promptUsed: string;
  /** 採用した画風キー (次回の重複回避に使う)。 */
  styleKey: string;
  /** 採用した版面キー (下帯 / 左パネル / 色ボックス / 全面)。 */
  layoutKey: string;
  /** 判定したジャンル (競馬系 / 副業系 / 汎用)。 */
  genreKey: string;
  /** 画像に文字が入っているか (コピー未設定の記事は false)。 */
  textInImage: boolean;
  /**
   * 文字の入れ方。
   * 'image' = 画像モデルが描いた (既定) / 'composite' = 自前フォント合成 / 'none' = 文字なし。
   */
  textMode: 'image' | 'composite' | 'none';
  /** ビジョン検査で文字崩れを検知して作り直した回数 (0 または 1)。 */
  textRetries: number;
  /** 画像の alt テキスト (note の画像説明・SEO 用)。 */
  alt: string;
}

export interface UploadBufferFn {
  (key: string, buffer: Buffer, contentType: string): Promise<unknown>;
}

export interface GenerateNoteEyecatchDeps {
  generateImage?: GenerateImageFn;
  imageGenDeps?: ImageGenDeps;
  withImageLoggingDeps?: WithImageLoggingDeps;
  uploadBuffer?: UploadBufferFn;
  /** role='anp.eyecatch' の画像モデル割当を解決する (テスト差し替え可)。 */
  loadModelAssignment?: typeof defaultLoadModelAssignment;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  /**
   * **旧方式**の自前フォント合成。既定では使わない (1 パス生成の結果をそのまま採用)。
   * 明示注入したときだけ旧経路に倒せる (テスト / 画像モデルが日本語を崩す機種への退避用)。
   */
  composeEyecatch?: typeof composeNoteEyecatch;
  /** 文字崩れのビジョン検査 (既定 `verifyNoteEyecatchText`)。null 相当にしたい場合は無効化フラグを使う。 */
  verifyText?: typeof verifyNoteEyecatchText;
  verifyTextDeps?: VerifyNoteEyecatchTextDeps;
  /** 文字崩れ検査を回さない (既定 false)。コストを抑えたい一括再生成などで使う。 */
  skipTextCheck?: boolean;
}

/**
 * 1 パス生成用のプロンプト。**絵と文字をまとめて 1 枚に組ませる**。
 *
 * 並び順には意味がある: 文字の正確さ > ジャンルの作法 > 版面 > 絵。
 * 画像モデルは後ろの指示を忘れがちなので、**失敗が致命的なものを先に書く**。
 */
export function buildPrompt(
  input: GenerateNoteEyecatchInput,
  style: EyecatchStyle,
  layout: NoteEyecatchLayout,
  genre: NoteGenreProfile = classifyNicheGenre(input.niche),
  scheme: NoteEyecatchScheme = schemeForNiche(input.niche),
): string {
  const policy = (input.editorialPolicy ?? '').trim().slice(0, 300);
  const copy = (input.eyecatchCopy ?? '').trim();
  const sub = (input.eyecatchSub ?? '').trim();
  const hasText = copy.length > 0;
  // F-ANP-56: アカウント固有の指示 (週次リサーチ) があればジャンル既定を置き換える。
  const accountArt = (input.accountArtDirection ?? '').trim();
  const art = accountArt || genre.art;
  const copyRules = (input.accountCopyRules ?? []).map((r) => r.trim()).filter((r) => r.length > 0);

  // 2026-10-14 実測の教訓: アカウント指示を「ジャンルの作法」の位置に置くだけでは効かない。
  // 後続の【文字と帯の色】が「ここは厳密に守る」、【絵の画風】が具体的な既定値を出すため、
  // モデルは**後に書かれた強い既定**に従ってしまった
  // (リサーチが「実写風・曇天・低彩度・芝の深緑」と決めたのに、黒地×金の装飾文字が出た)。
  // アカウント指示があるときは、既定側を「指定が無い項目だけ」に格下げする。
  const colorHeader = accountArt
    ? '【文字と帯の色 (既定。上のアカウント指定に書かれていない項目だけ適用する)】'
    : '【文字と帯の色 (アカウント共通。ここは厳密に守る)】';
  const styleHeader = accountArt
    ? '【絵の画風 (既定。上のアカウント指定に書かれていない項目だけ適用する)】'
    : '【絵の画風】';

  return [
    'Web メディア (note) の記事アイキャッチを 1 枚作成してください。',
    '横長 (1.91:1)。タイムラインでは幅 300px 程度に縮むので、**遠目で一瞬で読めること**が最優先。',
    '',
    `【記事のテーマ】${input.niche}`,
    `【タイトル】「${input.title}」`,
    `【フック】${input.hook}`,
    policy ? `【媒体のトーン】${policy}` : '',
    '',
    // ---- 1. 文字 (ここを外すと全部無駄になるので最初に書く) ----
    ...(hasText
      ? [
          '【画像に入れる文字 — これ以外の文字は一切描かない】',
          `・メインコピー (主役)：「${copy}」`,
          sub ? `・サブコピー (小さく添える)：「${sub}」` : '・サブコピーは無し。',
          '',
          '【文字の描き方 (最重要。ここが崩れたら失敗)】',
          '- 上の日本語を **一字一句そのまま**描く。翻訳・英訳・ローマ字化・言い換え・省略・'
            + '文字の追加・語順の入れ替えは一切しない。',
          '- 漢字・ひらがな・カタカナ・数字を**正確な字形**で描く。'
            + '存在しない漢字、崩れた字、潰れた画、重なった字は失敗。',
          '- 数字と英字は**半角**。句読点・記号も原文どおり。',
          '- **メインコピーが画面の主役**。サブコピーはメインの 1/3 以下の大きさにし、'
            + 'メインの邪魔をしない位置に置く。',
          '- 文字は**画面の端から十分内側** (安全余白) に収め、切れさせない。'
            + '文字列は**まっすぐ水平**に組む (波打たせない・歪ませない)。',
          '- 改行するなら**意味の切れ目**で折る (語の途中で折らない)。',
          `- ${genre.typography}`,
          ...(copyRules.length > 0
            ? [
                '- **このアカウントの文字の作法 (週次リサーチ。上の一般則と矛盾したらこちらを優先)**:',
                ...copyRules.map((r) => `  - ${r}`),
              ]
            : []),
          '- 上記のメイン/サブ以外の文字・英単語・数字・ロゴ・透かし・署名・'
            + 'キャプション・URL・ページ番号は描かない。',
          '',
        ]
      : [
          '【文字は描かない】',
          '- この記事はキャッチコピーが未設定なので、画像内に文字・数字・記号・ロゴを一切描かない。',
          '- ABSOLUTELY NO text, letters, numbers, captions, watermarks or logos anywhere.',
          '',
        ]),
    // ---- 2. 画作り ----
    // アカウント指定があるときは「最優先」と明示し、以降の既定より上に置く。
    ...(accountArt
      ? [
          '【このアカウントの画作り (週次リサーチ。**これが最優先**。以降の既定と矛盾したらこちらに従う)】',
          accountArt,
          '',
        ]
      : [`【${genre.label}の作法 (絵と文字の両方に効かせる)】`, art, '']),
    // ---- 3. 版面 ----
    '【版面 (絵と文字の配置)】',
    `- ${layout.textPlacement}`,
    '',
    // ---- 4. 色 (アカウント統一 = 「あの人のサムネ」と認識させる) ----
    colorHeader,
    `- 地・帯・ボックスの色: ${scheme.base}`,
    `- 文字の色: ${scheme.main}`,
    `- 差し色 (マーカー・下線・バッジ): ${scheme.accent}`,
    `- 文字の縁取り (袋文字) の色: ${scheme.outline}`,
    '- 文字と背景の明暗差を強く取り、小さく表示されても読めるようにする。',
    '',
    // ---- 5. 絵 ----
    styleHeader,
    `- 画材・質感: ${style.medium}`,
    `- 構図: ${style.composition}`,
    `- 絵の配色: ${style.palette}`,
    '',
    '【絵の中身の作り方】',
    '- **描くモノは 1 個だけ**。2 個目を足したくなっても足さない。',
    '  (2 個以上描くと焦点が散り、小さく表示されたときに何の記事か分からなくなる)',
    '- その 1 個は、**この記事にしか出てこない具体的なモノ**にする。',
    '  タイトルとフックから名詞を 1 つ選び、それを大きく描く (抽象的な概念の比喩に逃げない)。',
    '- 題材が思いつかなくても、書類・グラフ・PC・事務用品に逃げない (下の禁止リスト)。',
    '  その記事の現場にある道具・場所・モノを探す。',
    '- 背景は単純な面にする (奥行きの小物を並べない)。',
    '',
    '【禁止 (これらが写ると失敗)】',
    ...EYECATCH_BANNED_MOTIFS.map((m) => `- ${m}`),
    '',
    '健全な内容。実在の商標・人物・作品を描かない。',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** role='anp.eyecatch' の画像モデル割当。未設定/失敗時は OpenAI gpt-image-* に倒す。 */
async function resolveImageModel(
  deps: GenerateNoteEyecatchDeps,
): Promise<{ provider: string; model: string | null }> {
  const load = deps.loadModelAssignment ?? defaultLoadModelAssignment;
  try {
    const a = await load('anp.eyecatch', null, deps.loadAssignmentDeps);
    return { provider: a.provider, model: a.model };
  } catch {
    // 割当が無い環境 (テスト/初期状態) では既定の OpenAI パスを使う。
    return { provider: 'openai', model: null };
  }
}

export async function generateNoteEyecatch(
  input: GenerateNoteEyecatchInput,
  deps: GenerateNoteEyecatchDeps = {},
): Promise<GenerateNoteEyecatchResult> {
  const assignment = deps.generateImage
    ? { provider: 'openai', model: null }
    : await resolveImageModel(deps);
  const useGoogle = assignment.provider === 'google';

  const rawGenerateImage: GenerateImageFn =
    deps.generateImage ??
    (useGoogle
      ? (args) => generateImageGoogle(args, assignment.model ? { model: assignment.model } : {})
      : defaultGenerateImage);

  const ctx: ImageLoggingContext = { role: 'anp.eyecatch' };
  if (input.jobId !== undefined) ctx.jobId = input.jobId;
  if (!deps.generateImage) {
    ctx.provider = assignment.provider;
    if (assignment.model) ctx.model = assignment.model;
  }

  const loggedGenerateImage = withImageLogging(
    (args, innerDeps) => rawGenerateImage(args, innerDeps ?? deps.imageGenDeps),
    ctx,
    deps.withImageLoggingDeps,
  );

  // F-ANP-54: ニッチからジャンルを判定し、画風・版面・画作りの方向をまとめて切り替える。
  const genre = classifyNicheGenre(input.niche);
  const style = pickEyecatchStyle(input.noteArticleId, input.recentStyleKeys ?? [], input.niche);
  const layout = pickNoteEyecatchLayout(input.noteArticleId, input.niche);
  const scheme = schemeForNiche(input.niche);
  const promptUsed = buildPrompt(input, style, layout, genre, scheme);

  // Google (Nano Banana) は 16:9 が最も note のアイキャッチ比率に近い。
  const width = useGoogle ? NOTE_EYECATCH_WIDTH : IMAGE_WIDTH;
  const height = useGoogle ? NOTE_EYECATCH_HEIGHT : IMAGE_HEIGHT;

  const copy = (input.eyecatchCopy ?? '').trim();
  const sub = (input.eyecatchSub ?? '').trim();

  const generateOnce = async (): Promise<Buffer> => {
    const result = await loggedGenerateImage({
      prompt: promptUsed,
      width,
      height,
      outputFormat: 'jpeg',
      outputCompression: 90,
      // 日本語の字形は quality に素直に効く。medium 以下だと潰れる。
      ...(useGoogle ? {} : { quality: 'high' as const }),
    });
    const image = result.images[0];
    if (!image) throw new Error('anp.eyecatch: generateImage returned no image');
    return image;
  };

  let image = await generateOnce();
  let textRetries = 0;

  // 文字が崩れていないかを 1 回だけ検査し、崩れていれば作り直す。
  // (画像生成の方が検査より高いので、再生成は 1 回まで。2 回目も崩れたらそのまま出す
  //  — 文字が無いサムネより、多少崩れても文字があるサムネの方がクリックされる。)
  const verify = deps.verifyText ?? verifyNoteEyecatchText;
  if (copy.length > 0 && !deps.skipTextCheck) {
    try {
      const check = await verify(
        {
          image,
          copy,
          sub: sub.length > 0 ? sub : null,
          ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        },
        deps.verifyTextDeps,
      );
      if (!check.ok) {
        image = await generateOnce();
        textRetries = 1;
      }
    } catch {
      // 検査は best-effort。失敗しても生成済みの画像をそのまま使う (出版を止めない)。
    }
  }

  // 旧方式 (自前フォント合成) は明示注入時のみ。
  let textMode: 'image' | 'composite' | 'none' = copy.length > 0 ? 'image' : 'none';
  if (copy.length > 0 && deps.composeEyecatch) {
    image = await deps.composeEyecatch(
      image,
      { copy, sub: sub.length > 0 ? sub : null, badge: input.niche },
      { scheme, layout },
    );
    textMode = 'composite';
  }

  const upload = deps.uploadBuffer ?? (await defaultUploadBuffer());
  const r2Key = noteArticleEyecatch(input.noteArticleId);
  await upload(r2Key, image, 'image/jpeg');

  return {
    r2Key,
    promptUsed,
    styleKey: style.key,
    layoutKey: layout.key,
    genreKey: genre.key,
    textInImage: copy.length > 0,
    textMode,
    textRetries,
    alt: defaultEyecatchAlt(input.title, input.niche),
  };
}

async function defaultUploadBuffer(): Promise<UploadBufferFn> {
  const mod = await import('@a2p/storage/operations');
  return mod.uploadBuffer as unknown as UploadBufferFn;
}
