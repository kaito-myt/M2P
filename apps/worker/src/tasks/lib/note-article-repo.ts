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
}

export interface NoteArticleRepo {
  update: (args: { where: { id: string }; data: NoteArticleUpdateData }) => Promise<unknown>;
}
