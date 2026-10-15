/**
 * 品質判定 (`pipeline.note.judge`) の採点結果を「なぜ落ちたか」として読み出す。
 *
 * ## なぜ要るか (2026-10-15)
 * `needs_human_review` の記事は 24 本あり、全部 **65〜68 点**で公開下限 (70) に 1〜5 点
 * 足りないだけだった。ところが画面にはスコアの数字しか出ておらず、運営者が承認するにも
 * 差し戻すにも「どの軸がなぜ落ちたか」が分からなかった。judge はその内訳を
 * `Job.result_json` に残しているので、ここから取り出して一覧と再実行の両方に使う。
 *
 * 併せて、運営者が手動で差し戻すときにも **この実際の指摘をエージェントへ渡す**。
 * 以前は「運営者による手動差し戻し: 内容を見直してください。」という中身の無い 1 行だけを
 * 渡していたため、差し戻しても同じ点数で戻ってきていた。
 *
 * 設計: docs/11-anp-design.md §7 (F-ANP-44 / F-ANP-57)。
 */
import { NOTE_JUDGE_PASS_THRESHOLD } from '@a2p/contracts/agents/anp';
import { prisma } from '@a2p/db';

export const PIPELINE_NOTE_JUDGE_TASK_NAME = 'pipeline.note.judge';

/** judge の 4 軸。`packages/agents/src/anp/judge.ts` の出力キーと一致させる。 */
export const JUDGE_AXIS_LABELS: Record<string, string> = {
  hook_strength: 'フック強度',
  readability: '可読性',
  paid_conversion: '有料転換見込み',
  search_inflow: '検索流入見込み',
};

export interface JudgeAxis {
  key: string;
  label: string;
  score: number | null;
  comment: string | null;
}

export interface JudgeFeedback {
  score_total: number | null;
  /** 合格ライン未満の軸だけ (落ちた理由として示す価値があるもの)。 */
  weakAxes: JudgeAxis[];
  /** 全軸 (内訳表示用)。 */
  allAxes: JudgeAxis[];
  overall: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** `Job.result_json` を判定内訳に変換する。judge 以外の結果や欠損には null を返す。 */
export function parseJudgeResult(resultJson: unknown): JudgeFeedback | null {
  const result = asRecord(resultJson);
  const breakdown = asRecord(result.score_breakdown);
  const comments = asRecord(result.judge_comments);
  const scoreTotal = asNumber(result.score_total);
  if (scoreTotal === null && Object.keys(breakdown).length === 0) return null;

  const allAxes: JudgeAxis[] = Object.entries(JUDGE_AXIS_LABELS).map(([key, label]) => ({
    key,
    label,
    score: asNumber(breakdown[key]),
    comment: asText(comments[key]),
  }));

  return {
    score_total: scoreTotal,
    allAxes,
    weakAxes: allAxes.filter((a) => a.score !== null && a.score < NOTE_JUDGE_PASS_THRESHOLD),
    overall: asText(comments.overall),
  };
}

/**
 * エージェント (`anp.outline` / `anp.editor`) に渡す指摘行。
 * worker 側 `pipeline-note-judge.ts` の `toFeedbackItems` と同じ形にそろえる
 * (エージェントのプロンプトが片方の形式しか想定しない事故を避けるため)。
 */
export function toFeedbackItems(fb: JudgeFeedback | null): string[] {
  if (!fb) return [];
  const items: string[] = [];
  if (fb.score_total !== null) items.push(`品質スコア: ${fb.score_total}/100`);
  for (const axis of fb.weakAxes) {
    items.push(`${axis.label} (${axis.score}/100)${axis.comment ? `: ${axis.comment}` : ''}`.slice(0, 2000));
  }
  if (fb.overall) items.push(`総評: ${fb.overall}`.slice(0, 2000));
  return items;
}

/**
 * 記事 1 本の最新 judge 結果。無ければ null。
 *
 * 直近の judge Job が queued/running で `result_json` が空のこともあるので、
 * 新しい順に数件見て**採点が入っている最初のもの**を採る (1 件だけ見ると空振りする)。
 */
export async function loadJudgeFeedback(articleId: string): Promise<JudgeFeedback | null> {
  const jobs = await prisma.job.findMany({
    where: {
      kind: PIPELINE_NOTE_JUDGE_TASK_NAME,
      payload_json: { path: ['note_article_id'], equals: articleId },
    },
    orderBy: { created_at: 'desc' },
    take: 5,
    select: { result_json: true },
  });
  for (const job of jobs) {
    const parsed = parseJudgeResult(job.result_json);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * 複数記事の最新 judge 結果をまとめて引く (一覧用。記事数ぶん往復しない)。
 *
 * `jobs` に `note_article_id` 列は無く payload_json の中にしか無いので、
 * Prisma の JSON フィルタでは `in` が使えない。`DISTINCT ON` の生 SQL で 1 往復にする。
 */
export async function loadJudgeFeedbackMany(
  articleIds: readonly string[],
): Promise<Map<string, JudgeFeedback>> {
  const out = new Map<string, JudgeFeedback>();
  if (articleIds.length === 0) return out;

  const rows = await prisma.$queryRaw<Array<{ note_article_id: string; result_json: unknown }>>`
    SELECT DISTINCT ON (payload_json->>'note_article_id')
           payload_json->>'note_article_id' AS note_article_id,
           result_json
      FROM jobs
     WHERE kind = ${PIPELINE_NOTE_JUDGE_TASK_NAME}
       AND result_json IS NOT NULL
       AND payload_json->>'note_article_id' = ANY(${[...articleIds]}::text[])
     ORDER BY payload_json->>'note_article_id', created_at DESC
  `;

  for (const row of rows) {
    const parsed = parseJudgeResult(row.result_json);
    if (parsed) out.set(row.note_article_id, parsed);
  }
  return out;
}
