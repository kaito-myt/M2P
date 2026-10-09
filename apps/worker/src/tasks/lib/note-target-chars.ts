/**
 * note 記事の目標文字数を決める純関数 (docs/11-anp-design.md §3.2 F-ANP-12)。
 *
 * もとは `pipeline.note.writer.*` に 4,000 字が直書きされていて、無料記事と有料記事で同じ
 * 目標を使っていた。2026-10-09 の実測で次の 2 点が分かったので分けた。
 *
 *  1. **有料記事がアカウント方針の下限を割っていた。** 「手堅く勝つ馬券術」の記事方針は
 *     「無料記事 2,500〜4,000 字、有料記事 4,000〜7,000 字」と定めているのに、有料記事の
 *     実測平均は 3,659 字だった。さらに無料比率 30% なので、購入者が読める分はおよそ
 *     2,560 字しかなく、¥500〜980 に対して薄い。judge の減点理由
 *     「有料部分が無料部分の繰り返しで新情報がない」「無料部分だけでは1つも試せない」は
 *     どちらも**絶対量の不足**から来ていた (無料部分 = 3,659 字 × 30% ≒ 1,100 字では
 *     方針が要求する「無料部分で考え方と根拠を完結させる」が物理的に書けない)。
 *  2. **無料記事を長くしても品質スコアは上がらない。** 判定済み 398 件で本文長と
 *     score_total に相関はなかった (2,370 字台 77.1 点 / 4,031〜4,379 字 70.6 点)。
 *     よって無料記事の目標は据え置き、有料記事だけを方針の範囲内で引き上げる。
 */

/** 無料記事の目標字数。方針帯 (2,500〜4,000 字) の上端。 */
export const DEFAULT_TARGET_CHARS_FREE = 4000;
/** 有料記事の目標字数。方針帯 (4,000〜7,000 字) の中央。 */
export const DEFAULT_TARGET_CHARS_PAID = 6000;

/** `NoteWriterInput.target_chars` / `NoteOutlineInput.target_chars` の許容域 (contracts と同じ)。 */
const MIN_ALLOWED = 500;
const MAX_ALLOWED = 20000;

function readPositiveInt(source: unknown, key: string): number | null {
  if (!source || typeof source !== 'object' || !(key in source)) return null;
  const v = (source as Record<string, unknown>)[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  if (n < MIN_ALLOWED || n > MAX_ALLOWED) return null;
  return n;
}

/**
 * アカウントの `monetization_policy_json` に目標字数の上書きがあればそれを使い、
 * 無ければ課金種別ごとの既定を返す。
 *
 * 上書きキー: `target_chars_free` / `target_chars_paid` (どちらも任意、500〜20000)。
 * アカウントごとに記事方針の字数帯が違うので、コードを触らずに DB 側で調整できるようにする。
 */
export function resolveTargetChars(monetizationPolicyJson: unknown, paid: boolean): number {
  const key = paid ? 'target_chars_paid' : 'target_chars_free';
  const override = readPositiveInt(monetizationPolicyJson, key);
  if (override !== null) return override;
  return paid ? DEFAULT_TARGET_CHARS_PAID : DEFAULT_TARGET_CHARS_FREE;
}
