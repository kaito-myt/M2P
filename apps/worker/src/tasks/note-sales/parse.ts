/**
 * note ダッシュボード (docs/11-anp-design.md §2.2) の DOM から抽出した生テキストを構造化する
 * 純関数群 (F-ANP-40)。Playwright に依存しないためユニットテスト可能。
 */

/** "3,814" / "-" / "1,234円" / "" 等の note 表記を整数に変換する。空・"-"・NaN は 0。 */
export function parseNoteStatNumber(raw: string | null | undefined): number {
  if (typeof raw !== 'string') return 0;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return 0;
  const cleaned = trimmed.replace(/[,円¥]/g, '').trim();
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

export interface NoteDashboardArticleStat {
  noteUrl: string;
  impressions: number;
  views: number;
  likes: number;
  comments: number;
  revenueJpy: number;
}

/**
 * `https://note.com/dashboard?period=ALL` の記事別テーブル 1 行を構造化する。
 * `href` は行内の記事リンク (`<a href="https://note.com/<handle>/n/<noteId>">`)、
 * `cells` はその行の `<td>` textContent 配列 (docs/11 §2.2 実測: [タイトル+ステータス+日付,
 * インプレッション, ページビュー, スキ, コメント, 売上] の 6 列)。形式が崩れていれば null。
 */
export function parseDashboardRow(href: string | null | undefined, cells: string[]): NoteDashboardArticleStat | null {
  if (!href || !/note\.com\/[^/]+\/n\/[a-z0-9]+/i.test(href)) return null;
  if (!Array.isArray(cells) || cells.length < 6) return null;
  return {
    noteUrl: href,
    impressions: parseNoteStatNumber(cells[1]),
    views: parseNoteStatNumber(cells[2]),
    likes: parseNoteStatNumber(cells[3]),
    comments: parseNoteStatNumber(cells[4]),
    revenueJpy: parseNoteStatNumber(cells[5]),
  };
}

/** `<a href="/<handle>/followers">{N}フォロワー</a>` のテキストからフォロワー数を抽出する。 */
export function parseFollowerCount(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null;
  const m = text.match(/([\d,]+)\s*フォロワー/);
  if (!m) return null;
  return parseNoteStatNumber(m[1]);
}

export interface NoteMembershipRow {
  /** 入会 (期間中の新規加入数)。 */
  joined: number;
  /** 退会 (期間中の解約数)。 */
  left: number;
  /** 売上 (円)。 */
  revenueJpy: number;
}

/**
 * メンバーシップタブのテーブル行 (タイトル, 記事数, 入会, 退会, 売上) を構造化する。
 * 「メンバーシップはありません」等の空状態は呼出側で rows.length===0 として扱う。
 */
export function parseMembershipRow(cells: string[]): NoteMembershipRow | null {
  if (!Array.isArray(cells) || cells.length < 5) return null;
  return {
    joined: parseNoteStatNumber(cells[2]),
    left: parseNoteStatNumber(cells[3]),
    revenueJpy: parseNoteStatNumber(cells[4]),
  };
}

/** 複数のメンバーシップ行 (マガジン別) をアカウント単位に集約する。 */
export function aggregateMembership(rows: NoteMembershipRow[]): { subscribers: number; mrrJpy: number } {
  const subscribers = rows.reduce((acc, r) => acc + Math.max(0, r.joined - r.left), 0);
  const mrrJpy = rows.reduce((acc, r) => acc + r.revenueJpy, 0);
  return { subscribers, mrrJpy };
}
