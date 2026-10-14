/**
 * F-ANP-55 — note アイキャッチの文字崩れ検査 (role='anp.eyecatch_text_check')。
 * docs/11-anp-design.md §3.2
 *
 * なぜ必要か: アイキャッチを**画像モデルに文字ごと描かせる 1 パス方式**に変えたので
 * (`eyecatch.ts` 冒頭)、日本語の字形が崩れる可能性が構造的に残る。自前フォント合成なら
 * 文字は 100% 正確だったが、代わりに「絵の上に長方形のパネルを貼る」以上のデザインができなかった。
 * そこで **1 パスで作り、崩れたものだけ作り直す**。
 *
 * A2P の表紙には同じ仕組み (`thumbnail/text-check.ts`, role='cover_text_check') が既にある。
 * そちらを流用しなかった理由:
 *   - `CoverTextCheckInput.bookId` が必須で、`token_usage.book_id` は **books への FK**。
 *     note 記事 ID を渡すと FK 違反でコスト記録が落ちる (CLAUDE.md ハードルール 5 違反)。
 *   - プロンプトが「KDP の表紙」前提で、観点 (タイトル/副題/著者名) が note と合わない。
 *
 * エラー方針: **ベストエフォート**。プロンプト未投入・API 失敗はそのまま throw し、
 * 呼び出し側 (`generateNoteEyecatch`) が catch して「検査せず採用」に倒す。
 * 検査できないことを理由に出版を止めない。
 */
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteEyecatchTextCheckOutputSchema,
  type NoteEyecatchTextCheckOutput,
} from '@a2p/contracts/agents/anp';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import {
  fillPlaceholders,
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type { LoggingContext, WithTokenLoggingDeps } from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';

const ROLE = 'anp.eyecatch_text_check';
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export interface VerifyNoteEyecatchTextInput {
  /** 検査対象の画像 (JPEG)。 */
  image: Buffer;
  /** 画像に描かれているはずのメインコピー (verbatim 期待値)。 */
  copy: string;
  /** 画像に描かれているはずのサブコピー。 */
  sub?: string | null;
  /** graphile-worker の Job.id (token_usage のトレース用)。 */
  jobId?: string;
}

export interface VerifyNoteEyecatchTextDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
}

function buildUserMessage(input: VerifyNoteEyecatchTextInput): string {
  const sub = (input.sub ?? '').trim();
  const lines = [
    'この画像は note 記事のアイキャッチ (サムネイル) です。',
    '画像に描かれている文字を注意深く読み取り、**字形が崩れていないか**を検証してください。',
    '',
    '【この画像に描かれているべき文字】',
    `- メインコピー: 「${input.copy}」`,
  ];
  if (sub.length > 0) lines.push(`- サブコピー: 「${sub}」`);
  lines.push(
    '',
    '検証観点:',
    ' - copy_legible: メインコピーがはっきり判読できるか (小さく表示しても読めるか)',
    ' - copy_matches: 読み取れたメインコピーが上記の期待値と**一字一句**一致するか',
    '   (助詞の違い・送り仮名の違い・語順の入れ替えも不一致として扱う)',
    ' - garbled_text_detected: 崩れた/歪んだ/存在しない漢字・かな、潰れた画、重なった字、',
    '   不自然な合字や欠損、英字やローマ字への置き換えがあるか',
    ' - extra_text_detected: 期待していない余分な文字 (英単語・ロゴ・署名・URL・意味不明な文字列) があるか',
    '',
    'transcribed_text には画像から実際に読み取れた全テキストを、見えたとおりに記入してください。',
    '(読めない字は □ で表してください。勝手に補完しないこと。)',
    'issues には問題点を日本語で簡潔に列挙してください (無ければ空配列)。',
    'ok は「メインコピーが判読でき、期待値と一致し、崩れ文字も余分文字も無い」場合のみ true。',
  );
  return lines.join('\n');
}

/**
 * アイキャッチに描かれた日本語が崩れていないか検証する。
 *
 * @throws ProviderError LLM API 失敗 (透過)
 * @throws ConfigError   active プロンプト不在 / モデル割当不在 / API キー不在
 */
export async function verifyNoteEyecatchText(
  input: VerifyNoteEyecatchTextInput,
  deps: VerifyNoteEyecatchTextDeps = {},
): Promise<NoteEyecatchTextCheckOutput> {
  const copy = input.copy.trim();
  if (copy.length === 0) {
    throw new Error('verifyNoteEyecatchText: copy is required');
  }

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt(ROLE, null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {
    copy,
    sub: (input.sub ?? '').trim(),
  });

  const ctx: LoggingContext = { role: ROLE };
  if (input.jobId !== undefined) ctx.jobId = input.jobId;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient(ROLE, null, ctx, factoryDeps);

  const completion = await client.complete<NoteEyecatchTextCheckOutput>({
    role: ROLE,
    genre: null,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: buildUserMessage(input),
        images: [{ data: input.image.toString('base64'), mimeType: 'image/jpeg' }],
      },
    ],
    responseSchema: NoteEyecatchTextCheckOutputSchema,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  return NoteEyecatchTextCheckOutputSchema.parse(completion.text);
}
