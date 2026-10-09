/**
 * docs/11-anp-design.md §7 — note 本文の**数値の自己整合**だけを見る校正工程
 * (role='anp.numcheck', 2026-10-09)。
 *
 * なぜ独立した工程なのか:
 *   judge は本文の表を実際に再計算して不一致を指摘してくる。実測の差し戻し例は
 *   「下位区分の合計が147件で記載の148件と不一致」「無料部分の『準備20分』と
 *   有料部分の表の『準備25分』が食い違う」など。writer のプロンプトに
 *   「整合させて」と書くだけでは消えなかった (2026-10-09 実走で確認)。
 *   `anp.editor` は「見出し構成・段落の意味内容は保持し、文体・読みやすさのみ磨く」
 *   のが契約なので、数字を直すのは editor の役割ではない。よって工程を分けた。
 *
 * 安全側の設計 — **この工程に本文を書き換えさせすぎない**:
 *   - 見出し (`#` 行) の集合が変わったら採用しない。
 *   - 本文長が入力比 ±15% を超えたら採用しない (書き直しではなく訂正であること)。
 *   - 有料記事はマーカーを再挿入して渡し、返ってこなければ採用しない (editor と同じ)。
 *   採用しなかった場合は**入力の本文をそのまま返し**、理由を `unresolved` に残す。
 *   数字の不整合は judge が拾って差し戻すので、ここで失敗しても検出網は残る。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteNumCheckInputSchema,
  NoteNumCheckOutputSchema,
  type NoteNumCheckInput,
  type NoteNumCheckOutput,
} from '@a2p/contracts/agents/anp';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import {
  fillPlaceholders,
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type { LoggingContext, WithTokenLoggingDeps } from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';
import { extractJson } from './lib/extract-json.js';
import { PAYWALL_MARKER, splitPaywallMarker } from './writer.js';
import { insertMarker } from './editor.js';
import { editorialPolicyLines } from './account-context.js';

/** 本文全体を打ち直すので writer / editor と同じ余裕を取る (1 字 ≒ 1.5 トークン)。 */
const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
const MAX_PARSE_RETRIES = 2;

/** 訂正として許す本文長の変化幅。これを超えたら「書き直し」とみなして採用しない。 */
export const MAX_LENGTH_DRIFT = 0.15;

export interface CheckNoteNumbersResult extends NoteNumCheckOutput {
  /** 有料記事で校正後のマーカー位置を再抽出できた場合のみ。 */
  paywall_line_pos?: number;
  /** LLM の出力を採用したか (false = 入力本文をそのまま返した)。 */
  applied: boolean;
}

export interface CheckNoteNumbersDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
}

function hasBodyMd(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  return typeof (parsed as Record<string, unknown>).body_md === 'string';
}

/** 見出し行 (`#`〜`######`) を順序つきで取り出す。マーカー行は無視する。 */
export function headingsOf(bodyMd: string): string[] {
  return bodyMd
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s/.test(line) && !line.includes(PAYWALL_MARKER))
    .map((line) => line.replace(/^#{1,6}\s*/, '').trim());
}

/**
 * 訂正として受け入れられる出力かを判定する。
 * 見出しが変わっている / 長さが大きく動いているものは「訂正」ではなく「書き直し」。
 */
export function isAcceptableCorrection(
  before: string,
  after: string,
): { ok: true } | { ok: false; reason: string } {
  const hBefore = headingsOf(before);
  const hAfter = headingsOf(after);
  if (hBefore.length !== hAfter.length || hBefore.some((h, i) => h !== hAfter[i])) {
    return { ok: false, reason: `見出しが変わった (${hBefore.length} → ${hAfter.length} 本)` };
  }
  const lenBefore = [...before].length;
  const lenAfter = [...after].length;
  if (lenBefore === 0) return { ok: false, reason: '入力が空' };
  const drift = Math.abs(lenAfter - lenBefore) / lenBefore;
  if (drift > MAX_LENGTH_DRIFT) {
    return {
      ok: false,
      reason: `本文長が ${Math.round(drift * 100)}% 動いた (${lenBefore} → ${lenAfter} 字)`,
    };
  }
  return { ok: true };
}

export async function checkNoteNumbers(
  input: NoteNumCheckInput,
  deps: CheckNoteNumbersDeps = {},
): Promise<CheckNoteNumbersResult> {
  const parsedInput = NoteNumCheckInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.numcheck', null, deps.promptLoaderDeps);
  const bodyWithMarker = insertMarker(
    parsedInput.body_md,
    parsedInput.paid,
    parsedInput.paywall_line_pos,
  );
  const hasMarker = bodyWithMarker.includes(PAYWALL_MARKER);

  const systemPrompt = fillPlaceholders(prompt.template, {
    niche: parsedInput.account.niche,
    title: parsedInput.title,
    paid: parsedInput.paid ? 'yes' : 'no',
  });

  const ctx: LoggingContext = { role: 'anp.numcheck' };
  if (parsedInput.job_id !== undefined) ctx.jobId = parsedInput.job_id;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.numcheck', null, ctx, factoryDeps);

  const lines = [
    `記事タイトル: ${parsedInput.title}`,
    `課金種別: ${parsedInput.paid ? '有料 (無料部分 + 有料部分)' : '無料'}`,
    `本文 (Markdown):\n${bodyWithMarker}`,
    ...editorialPolicyLines(parsedInput.account),
  ];
  if (hasMarker) {
    lines.push(
      `本文中の ${PAYWALL_MARKER} は有料ラインの区切りです。単独行のまま必ず1回だけ残してください` +
        ' (太字記法などの装飾を付けないこと)。',
      '**無料部分と有料部分で同じ項目の数字が違っていないか**を特に確かめてください' +
        ' (読者は両方を読むので、食い違いはそのまま見えます)。',
    );
  }
  lines.push(
    '',
    '上記の本文について、**数字の整合だけ**を確かめて直してください。',
    '',
    '【確かめること】',
    '1. 表の内訳を実際に足して、本文や表に書かれた合計・総数と一致するか。',
    '2. 率 (%・回収率・複勝率など) が「件数 ÷ 母数」の計算と合うか。四捨五入の範囲を超えてずれていないか。',
    '3. 同じ項目の数字が記事内の別の場所で違う値になっていないか (本文 ↔ 表、無料部分 ↔ 有料部分)。',
    '4. 合計時間・合計金額・件数の足し算が合うか。',
    '5. n の定義 (レース数か頭数か、件数か人数か) が途中で入れ替わっていないか。',
    '',
    '【直し方 — ここを外さないこと】',
    '- **数字と、その数字に直接かかる文だけ**を直す。見出し・構成・段落の数は変えない。',
    '- どちらが正しいか決められる場合は、根拠のある側に合わせて他方を直す。',
    '- 決められない場合は、**その数字を使った主張を落として書ける範囲に狭める**',
    '  (勝手に「それらしい数字」を作ってはいけない)。落とした場合は unresolved に書く。',
    '- 言い回しを良くする・短くする・情報を足すといった校閲はしない (別の工程の仕事)。',
    '- 直すところが無ければ、本文をそのまま返して fixes を空配列にする。',
    '',
    '出力形式: JSON で以下を返してください。',
    '{',
    '  "body_md": string,            // 直した本文 (直すところが無ければ入力と同一)',
    '  "fixes": string[],            // 直した内容。例: "表の内訳 147 件に合わせ、合計を 148 → 147 に修正"',
    '  "unresolved": string[]        // 決められず主張を落としたもの。無ければ空配列',
    '}',
    'JSON 以外のテキストは出力しないこと。JSON 文字列値内の改行は必ず \\n でエスケープすること。',
  );
  const userMessage = lines.join('\n');

  /** LLM 出力を採用できなかったときに返す「素通し」結果。 */
  const passThrough = (reason: string): CheckNoteNumbersResult => {
    const result: CheckNoteNumbersResult = {
      body_md: parsedInput.body_md,
      fixes: [],
      unresolved: [`数値チェックを適用できなかった: ${reason}`],
      applied: false,
    };
    if (parsedInput.paid && parsedInput.paywall_line_pos !== undefined) {
      result.paywall_line_pos = parsedInput.paywall_line_pos;
    }
    return result;
  };

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete({
      role: 'anp.numcheck',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      enablePromptCaching: true,
    });

    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.numcheck.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }

    const parsedJson = extractJson(rawText, hasBodyMd);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.numcheck.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }

    const validated = NoteNumCheckOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.numcheck.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }

    const { body, paywallLinePos } = splitPaywallMarker(validated.data.body_md, parsedInput.paid);
    if (hasMarker && paywallLinePos === undefined) {
      lastError = new AgentError('anp.numcheck.invalid_output: paywall marker missing', {
        details: { attempt },
      });
      continue;
    }

    // 「訂正」の範囲を超えた出力は捨てる。judge が数字の不整合を拾う網は残っているので、
    // ここで素通しさせる方が、構成を壊された本文を採用するより安全。
    const check = isAcceptableCorrection(parsedInput.body_md, body);
    if (!check.ok) {
      if (attempt < MAX_PARSE_RETRIES) {
        lastError = new AgentError('anp.numcheck.invalid_output: rewrote too much', {
          details: { reason: check.reason, attempt },
        });
        continue;
      }
      return passThrough(check.reason);
    }

    const result: CheckNoteNumbersResult = {
      body_md: body,
      fixes: validated.data.fixes,
      unresolved: validated.data.unresolved,
      applied: true,
    };
    if (paywallLinePos !== undefined) result.paywall_line_pos = paywallLinePos;
    return result;
  }

  // 再試行を使い切った場合も本文は落とさない (判定は judge に委ねる)。
  return passThrough(lastError?.message ?? 'unknown failure');
}
