/**
 * F-ANP-57 — note アイキャッチの「どの記事にどの画風を使ったか」を引く共通処理。
 *
 * 画風キー (`EyecatchStyle.key`) は `pipeline.note.eyecatch` の
 * `jobs.result_json.style_key` にしか無い (`note_articles` に列が無い)。
 * 記事 ID の集合から引く処理が 2 箇所に必要なので 1 本にまとめる:
 *   - `pipeline.note.eyecatch` — 直近の画風を避ける (F-ANP-14b)
 *   - `note.account.research` — 画風別の実績を週次リサーチへ渡す (F-ANP-57)
 *
 * 【ここが本題: Prisma の Json フィルタに `in` は無い】
 * 元のコードは `payload_json: { path: ['note_article_id'], in: ids }` と書いていた。
 * PostgreSQL の Json フィルタがサポートするのは equals / path / string_contains /
 * array_contains / 比較演算子で、**`in` は無い**。Prisma は未知の引数を実行時に
 * `PrismaClientValidationError` で弾く。
 *
 * 2026-10-16 本番実測:
 * ```
 * IN filter REJECTED: PrismaClientValidationError
 * OR/equals filter OK
 * ```
 * 呼び出し側が `.catch(() => [])` でこの例外を飲んでいたため、**F-ANP-14b
 * 「直近 3 件と同じ画風を避ける」は実装以来一度も動いていなかった** (常に空配列が
 * 返り、画風は記事 ID のハッシュだけで決まっていた)。型チェックも通っていた —
 * 呼び出し側が prisma を `as unknown as` で緩い型に落としていたため。
 *
 * 同じ事故を繰り返さないため、
 *   - フィルタの組み立てを 1 関数に閉じて単体テストで形を固定する
 *   - 失敗を飲むときは必ず WARN を出す (無言で機能が消えるのを防ぐ)
 */
import { createLogger, type Logger } from '@a2p/contracts/logger';

const log = createLogger('worker.lib.eyecatch-style-history');

export const PIPELINE_NOTE_EYECATCH_KIND = 'pipeline.note.eyecatch';

/** Json 列の `note_article_id` が与えた ID のいずれかに一致する where 片。 */
export interface ArticleIdJsonFilter {
  OR: Array<{ payload_json: { path: string[]; equals: string } }>;
}

/**
 * `payload_json.note_article_id IN (...)` に相当する where 片を作る。
 *
 * Prisma の Json フィルタに `in` が無いので **equals の OR に展開する**。
 * 記事数は呼び出し側で 20〜30 件に制限されているので OR の展開で十分。
 */
export function buildArticleIdJsonFilter(articleIds: readonly string[]): ArticleIdJsonFilter {
  return {
    OR: articleIds.map((id) => ({
      payload_json: { path: ['note_article_id'], equals: id },
    })),
  };
}

/** 必要最小限の prisma 形 (テストで差し替えられるようにする)。 */
export interface EyecatchStyleHistoryPrisma {
  job: {
    findMany: (args: unknown) => Promise<Array<{ payload_json: unknown; result_json: unknown }>>;
  };
}

/**
 * 記事 ID → その記事に使った画風キー。
 *
 * **`style_key` が入っている最新の 1 件**を採る。F-ANP-14b 以前の古い eyecatch ジョブは
 * `result_json.style_key` を持たないので、素直に最新を採ると作り直した記事だけ null になる
 * (2026-10-16 時点の本番: style_key 無しのジョブが 343 件ある)。
 *
 * 失敗しても throw しない — 画風が引けないだけで出版やリサーチを止めない。
 * ただし **必ず WARN を出す** (これを黙って飲んでいたのが元の不具合)。
 */
export async function fetchEyecatchStyleByArticle(
  prisma: EyecatchStyleHistoryPrisma,
  articleIds: readonly string[],
  logger: Logger = log,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (articleIds.length === 0) return out;
  let jobs: Array<{ payload_json: unknown; result_json: unknown }>;
  try {
    jobs = await prisma.job.findMany({
      where: {
        kind: PIPELINE_NOTE_EYECATCH_KIND,
        status: 'done',
        ...buildArticleIdJsonFilter(articleIds),
      },
      orderBy: { created_at: 'desc' },
      select: { payload_json: true, result_json: true },
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), articles: articleIds.length },
      'アイキャッチの画風履歴を引けなかった — 画風の重複回避と実績集計が効かなくなる',
    );
    return out;
  }
  for (const j of jobs) {
    const aid = (j.payload_json as { note_article_id?: unknown } | null)?.note_article_id;
    const key = (j.result_json as { style_key?: unknown } | null)?.style_key;
    if (typeof aid !== 'string' || typeof key !== 'string' || key.length === 0) continue;
    if (!out.has(aid)) out.set(aid, key);
  }
  return out;
}
