/**
 * 既存本文から「有料ラインをどこに引くか」を決める純関数 (F-ANP-47)。
 *
 * 運営者要望 (2026-09-25)「有料化機能作って」— judge の格下げバグ (F-ANP-45) で無料公開されて
 * しまった記事を、後から有料に切り替えるために使う。執筆時と違って本文に有料マーカーが
 * 残っていないので、アカウントの `free_ratio` (無料で見せる割合) を基準に段落の境目で切る。
 *
 * **見出しを最優先で境界にする**。理由は 2 つ:
 *   1. 読者体験: 有料エリアが見出しから始まると「続きはここから」が自然に見える。
 *   2. 実装上の都合: note エディタ側のブロック構造は Markdown の段落と 1:1 対応しない
 *      (2026-09-25 実測。複数段落が 1 つの `<p>` に束ねられていることがある)。見出しなら
 *      テキスト一致で確実に同じ場所を指せるので、`anchorText` で位置決めできる。
 */

export interface PaywallSplit {
  /** 本文の codepoint オフセット (`note_articles.paywall_line_pos` に入る値)。 */
  pos: number;
  /** 無料側に入るブロック数 (フォールバック用の目安 index)。 */
  freeBlockCount: number;
  /** 無料側の文字数 (ログ・UI 表示用)。 */
  freeChars: number;
  /** 本文全体の文字数。 */
  totalChars: number;
  /** 有料側の先頭ブロックの文字列。note エディタ上でこのテキストを探して位置を決める。 */
  anchorText: string;
  /** アンカーが見出しか (見出しならエディタ上の H2/H3/H4 と突き合わせられる)。 */
  anchorIsHeading: boolean;
}

/** 本文を段落 (空行区切り) に分ける。`build-blocks.ts` の toBlocks と同じ規則。 */
function paragraphs(bodyMd: string): string[] {
  return bodyMd
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** 見出し記号・箇条書き記号を落として、エディタ上の表示テキストに寄せる。 */
export function toAnchorText(block: string): string {
  const firstLine = block.split('\n')[0] ?? '';
  return firstLine
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*・]\s*/, '')
    .trim()
    .slice(0, 40);
}

/**
 * `free_ratio` の位置に最も近いブロック境界で本文を分割する。
 *
 * - 見出しが 2 つ以上あるときは**見出しの直前だけ**を候補にする (上記の理由)。
 * - 無料側は最低 1 ブロック、有料側も最低 1 ブロックを必ず残す。
 */
export function computePaywallSplit(bodyMd: string, freeRatio: number): PaywallSplit | null {
  const text = bodyMd ?? '';
  const blocks = paragraphs(text);
  const totalChars = Array.from(text).length;
  if (blocks.length < 2 || totalChars === 0) return null;

  const ratio = Number.isFinite(freeRatio) ? Math.min(0.9, Math.max(0.1, freeRatio)) : 0.3;
  const target = totalChars * ratio;

  // 各ブロックの「直前で切ったときの無料側文字数」を求める (元テキスト上の位置で数える)。
  const candidates: Array<{ index: number; pos: number; heading: boolean; block: string }> = [];
  let cursor = 0;
  const totalCodepoints = Array.from(text).length;
  for (let i = 1; i < blocks.length; i += 1) {
    const marker = blocks[i]!;
    const idx = text.indexOf(marker, cursor);
    if (idx < 0) continue;
    cursor = idx + marker.length;
    const pos = Array.from(text.slice(0, idx)).length;
    if (pos <= 0 || pos >= totalCodepoints) continue;
    candidates.push({ index: i, pos, heading: marker.startsWith('#'), block: marker });
  }
  if (candidates.length === 0) return null;

  const headings = candidates.filter((c) => c.heading);
  const pool = headings.length >= 1 ? headings : candidates;

  let best = pool[0]!;
  for (const c of pool) {
    if (Math.abs(c.pos - target) < Math.abs(best.pos - target)) best = c;
  }

  return {
    pos: best.pos,
    freeBlockCount: best.index,
    freeChars: best.pos,
    totalChars,
    anchorText: toAnchorText(best.block),
    anchorIsHeading: best.heading,
  };
}
