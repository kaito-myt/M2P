/**
 * 本文承認の一括実行ロジック (2026-10-14)。
 *
 * **なぜ core に切り出すか**: `apps/web` の慣行に合わせる (Server Action は認証と
 * `revalidatePath` だけを持ち、判断はここでテスト可能にする)。
 *
 * **なぜ一括が要るか**: F-100 の修復で小説 11 冊を校閲し直したところ全冊が
 * `content_review` に入り、1 冊ずつしか進められなかった。
 *
 * 承認そのものは**既存の 1 冊分の処理をそのまま呼ぶ** — 一括用の別経路を作ると
 * サムネ生成/再審査の分岐や監査ログが二重管理になるため。
 */
import { z } from 'zod';

export const ApproveContentBulkSchema = z.object({
  book_ids: z.array(z.string().min(1)).min(1).max(50),
});

export interface BulkApproveResult {
  approved: string[];
  failed: Array<{ book_id: string; error: string }>;
}

export interface BulkApproveDeps {
  /** 1 冊分の承認。成功なら ok:true。 */
  approveOne: (bookId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 既定のエラー文 (approveOne が理由を返さなかったとき)。 */
  fallbackError: string;
}

/**
 * 1 冊ずつ順に承認する。**1 冊の失敗で全体を止めない。**
 *
 * 他のタブで先に承認された本が混ざると `content_review` から外れていて conflict に
 * なるが、残りは進めたい。並列にしないのは、承認がジョブ投入を伴うため
 * (同時に走らせると graphile への投入が重なって順序が読めなくなる)。
 */
export async function approveBookContentBulkCore(
  bookIds: readonly string[],
  deps: BulkApproveDeps,
): Promise<BulkApproveResult> {
  const approved: string[] = [];
  const failed: Array<{ book_id: string; error: string }> = [];
  for (const book_id of bookIds) {
    try {
      const res = await deps.approveOne(book_id);
      if (res.ok) approved.push(book_id);
      else failed.push({ book_id, error: res.error ?? deps.fallbackError });
    } catch (err) {
      // 例外も「その 1 冊の失敗」として扱い、残りを続ける。
      failed.push({ book_id, error: err instanceof Error ? err.message : deps.fallbackError });
    }
  }
  return { approved, failed };
}
