/**
 * 既存本文から「有料ラインをどこに引くか」を決める純関数 (F-ANP-47)。
 *
 * 運営者要望 (2026-09-25)「有料化機能作って」— judge の格下げバグ (F-ANP-45) で無料公開されて
 * しまった記事を、後から有料に切り替えるために使う。執筆時と違って本文に有料マーカーが
 * 残っていないので、アカウントの `free_ratio` (無料で見せる割合) を基準に段落の境目で切る。
 *
 * note の有料エリアは**段落の境目**にしか置けないため、文字数だけで切らず必ず段落境界に丸める。
 */

export interface PaywallSplit {
  /** 本文の codepoint オフセット (`note_articles.paywall_line_pos` に入る値)。 */
  pos: number;
  /** 無料側に入る段落数 = note エディタで有料エリアを挿入する位置 (0-based の段落 index)。 */
  freeBlockCount: number;
  /** 無料側の文字数 (ログ・UI 表示用)。 */
  freeChars: number;
  /** 本文全体の文字数。 */
  totalChars: number;
}

/** 本文を段落 (空行区切り) に分ける。`build-blocks.ts` の toBlocks と同じ規則。 */
function paragraphs(bodyMd: string): string[] {
  return bodyMd
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * `free_ratio` の位置に最も近い段落境界で本文を分割する。
 *
 * - 無料側は最低 1 段落、有料側も最低 1 段落を必ず残す (どちらかが空だと note 側で成立しない)。
 * - 見出し (`#` 始まり) の直後で切ると有料側が見出しから始まって自然なので、候補が同点なら
 *   見出しの直前を優先する。
 */
export function computePaywallSplit(bodyMd: string, freeRatio: number): PaywallSplit | null {
  const text = bodyMd ?? '';
  const blocks = paragraphs(text);
  const totalChars = Array.from(text).length;
  if (blocks.length < 2 || totalChars === 0) return null;

  const ratio = Number.isFinite(freeRatio) ? Math.min(0.9, Math.max(0.1, freeRatio)) : 0.3;
  const target = totalChars * ratio;

  // 各段落の「直前で切ったときの無料側文字数」を求める (元テキスト上の位置で数える)。
  let best: { index: number; pos: number; diff: number } | null = null;
  let cursor = 0;
  const codepoints = Array.from(text);
  for (let i = 1; i < blocks.length; i += 1) {
    // i 番目の段落の開始位置を元テキストから探す (直前までを消費しながら前方一致で探索)。
    const marker = blocks[i]!;
    const idx = text.indexOf(marker, cursor);
    if (idx < 0) continue;
    cursor = idx + marker.length;
    const pos = Array.from(text.slice(0, idx)).length;
    if (pos <= 0 || pos >= codepoints.length) continue;
    const headingBonus = marker.startsWith('#') ? 0.5 : 0; // 見出し直前を同点時に優先
    const diff = Math.abs(pos - target) - headingBonus;
    if (!best || diff < best.diff) best = { index: i, pos, diff };
  }
  if (!best) return null;

  return {
    pos: best.pos,
    freeBlockCount: best.index,
    freeChars: best.pos,
    totalChars,
  };
}
