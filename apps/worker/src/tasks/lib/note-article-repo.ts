/**
 * `pipeline.note.*` タスク群が共有する `NoteArticle` Prisma 部分 I/F。
 * 各タスクが更新するフィールドの和集合を 1 箇所にまとめ、`noteArticle.update` の
 * data 型をタスク間で使い回せるようにする (widen して個々の呼出側は必要な部分だけ渡す)。
 */
export interface NoteArticleUpdateData {
  lead?: string;
  body_md?: string;
  paywall_line_pos?: number | null;
  eyecatch_r2_key?: string;
  quality_score?: number | null;
  status?: string;
  cost_jpy_total?: { increment: number };
  /** F-ANP-16 (docs/11 申し送り8): judge 判定完了時に必ず false へ強制する。 */
  paid?: boolean;
  /** F-ANP-16: paid=false 確定時は「有料化の提案価格」の意味を持つ (推奨無ければ null)。 */
  price_jpy?: number | null;
}

export interface NoteArticleRepo {
  update: (args: { where: { id: string }; data: NoteArticleUpdateData }) => Promise<unknown>;
}
