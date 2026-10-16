/**
 * S-3DP-06 設定の純ロジック — 月間出品上限 (R-1) と禁止語リスト (R-2) の
 * 入力正規化・検証。Server Action と UI の両方から使うのでここに置く。
 */

import { TDP_MONTHLY_LIMIT_HARD_MAX } from '@a2p/contracts/tdp/settings';

// 天井の定義は contracts の 1 箇所だけ (DB の CHECK と同値にするため)。ここは再エクスポートのみ。
export { TDP_MONTHLY_LIMIT_HARD_MAX };

export const MONTHLY_LIMIT_MIN = 0;

/** 禁止語の最大件数。1 語あたりの最大長も持つ (貼り付け事故で文章 1 本が 1 語になるのを防ぐ)。 */
export const DENYLIST_MAX_TERMS = 500;
export const DENYLIST_MAX_TERM_LENGTH = 80;

/**
 * textarea の内容 (1 行 1 語) を禁止語配列へ。
 *
 * - 前後空白を落とす / 空行を落とす
 * - 重複を落とす (比較は NFKC + 小文字化 + 空白除去 = `derivative-guard` の正規化と同じ。
 *   「ＡＢＣ」と「abc」を 2 語として持つと、リストの件数が運用判断に使えなくなる)
 * - **保存するのは原文** — UI に出したときに運営者が自分の書いた語を見つけられる必要がある
 * - 長すぎる語は落とす (誤貼り付け対策)
 */
export function parseDenylist(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const term = line.trim();
    if (term.length === 0) continue;
    if (term.length > DENYLIST_MAX_TERM_LENGTH) continue;
    const key = normalizeTerm(term);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= DENYLIST_MAX_TERMS) break;
  }
  return out;
}

/** 禁止語配列を textarea 表示用の文字列へ。 */
export function formatDenylist(terms: ReadonlyArray<string>): string {
  return terms.join('\n');
}

/** `derivative-guard.ts` の `normalize()` と同一規則 (NFKC + 小文字化 + 空白除去)。 */
function normalizeTerm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/**
 * 月間出品上限の検証。範囲外は**丸めずに失敗させる** — 黙って天井に丸めると
 * 「8 のつもりが 12 件出ていた」が起きうる。R-1 で守りたいのは正反対の事故。
 */
export function validateMonthlyLimit(
  raw: unknown,
): { ok: true; value: number } | { ok: false; refused: number | null } {
  // `Number(null)` / `Number('')` / `Number([])` は 0 になる。0 は「出品停止」という
  // 意味のある設定なので、**空や null を 0 として受けてはいけない** (意図しない出品停止になる)。
  // 受け付けるのは数値そのものか、中身のある数値文字列だけ。
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.trim().length > 0) {
    n = Number(raw);
  } else {
    return { ok: false, refused: null };
  }
  // refused は拒否文面に「何を拒否したか」を出すための値。数として読めないものは null。
  if (!Number.isFinite(n)) return { ok: false, refused: null };
  if (!Number.isInteger(n)) return { ok: false, refused: n };
  if (n < MONTHLY_LIMIT_MIN || n > TDP_MONTHLY_LIMIT_HARD_MAX) return { ok: false, refused: n };
  return { ok: true, value: n };
}
