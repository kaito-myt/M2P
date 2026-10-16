/**
 * DB 関連 E2E ヘルパ (T-02-14)
 *
 * - cleanupTransientData: User / AppSettings / Prompt / ModelAssignment は維持し、
 *   Book / Project / Job 等のテスト由来データのみ truncate する
 * - ensureSeededAuthUser: ログインで使うシードユーザーが存在しなければ
 *   .env.local の AUTH_USERNAME / AUTH_PASSWORD_HASH から upsert
 * - resetAuthLockout: 連続失敗ロック中の User をリセット (ロックアウト spec の cleanup 用)
 */
import { prisma } from '@a2p/db';

/**
 * 接続先がローカルの開発用 DB かどうか。
 *
 * **なぜ要るか** — 下の `cleanupTransientData` は `book` / `account` /
 * `job` / `token_usage` を**条件なしで全削除**する。書いた当時 (SP-02) は
 * 「Book / Account は seed されていない = 常に空」だったが、今は本番に
 * 書籍 151 冊・売上・コスト履歴が入っており、`books` を消すと cascade で
 * 表紙・成果物・`sales_records` まで連れて行く。
 *
 * `playwright.config.ts` は `.env.local` を dotenv で読み込んで
 * `process.env` に流し込むので、**`DATABASE_URL` が本番を指していれば
 * `pnpm exec playwright test` 一発で事業データが消える**。
 * 明示的に許可しない限りリモート DB では実行させない。
 */
function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'host.docker.internal';
  } catch {
    return false;
  }
}

/** ガードを外す明示オプトイン (CI の使い捨て DB 用)。 */
const ALLOW_REMOTE = process.env.E2E_ALLOW_REMOTE_DB === '1';

/**
 * E2E 開始前の DB クリーンアップ。
 *
 * 「テストが消してよい」具体表に絞る (User / AppSettings / Prompt /
 *  ModelAssignment / ModelCatalog は seed 由来なので保持)。
 *
 * 各テーブルは onDelete: Cascade が schema 側で定義されているため、
 * 親テーブル (Account / Book) を消せば子も自動削除される。
 *
 * **接続先がローカルでなければ実行せずに throw する** (上の `isLocalDatabase` 参照)。
 * 使い捨て DB を使う CI では `E2E_ALLOW_REMOTE_DB=1` で明示的に外す。
 */
export async function cleanupTransientData(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!isLocalDatabase(url) && !ALLOW_REMOTE) {
    let where = '(DATABASE_URL 未設定)';
    try {
      if (url) where = new URL(url).hostname;
    } catch {
      where = '(解析できない DATABASE_URL)';
    }
    throw new Error(
      `E2E の DB クリーンアップを中止しました。接続先が ${where} でローカルではありません。` +
        'このクリーンアップは book / account / job / token_usage を全削除し、cascade で ' +
        '表紙・成果物・売上まで消します。使い捨ての DB で実行する場合のみ ' +
        'E2E_ALLOW_REMOTE_DB=1 を明示してください。',
    );
  }
  // 順序: 子モデル → 親モデル (cascade 設定漏れの保険)
  // 参照しない場合は no-op で OK
  await prisma.$transaction([
    prisma.tokenUsage.deleteMany({}),
    prisma.job.deleteMany({}),
    prisma.book.deleteMany({}),
    prisma.themeCandidate.deleteMany({}),
    prisma.publishingPlan.deleteMany({}),
    prisma.account.deleteMany({}),
  ]);
}

/** テスト用。ガード判定だけを取り出す。 */
export const __isLocalDatabase = isLocalDatabase;

/**
 * ログイン用シードユーザーが居なければ作る。既に居れば password_hash を
 * 設定値に揃えつつ failed_count / locked_until をリセットする (前回テストの副作用清掃)。
 *
 * パスワードハッシュは E2E_AUTH_PASSWORD_HASH を優先する。これは E2E ログインで
 * 平文 E2E_AUTH_PASSWORD を投入するため、その平文に対応する hash でシードする必要が
 * あるため。本番の AUTH_PASSWORD_HASH は運営者の実パスワード由来で E2E_AUTH_PASSWORD
 * とは一致しないことがあるので、E2E_AUTH_PASSWORD_HASH があればそちらを使う
 * (フォールバックは従来どおり AUTH_PASSWORD_HASH)。
 */
export async function ensureSeededAuthUser(): Promise<void> {
  const username = process.env.AUTH_USERNAME;
  const passwordHash =
    process.env.E2E_AUTH_PASSWORD_HASH ?? process.env.AUTH_PASSWORD_HASH;
  if (!username || !passwordHash) {
    throw new Error(
      '[e2e/db] AUTH_USERNAME / (E2E_AUTH_PASSWORD_HASH|AUTH_PASSWORD_HASH) が env に設定されていません',
    );
  }
  await prisma.user.upsert({
    where: { username },
    create: { username, password_hash: passwordHash },
    update: { failed_count: 0, locked_until: null, password_hash: passwordHash },
  });
}

/**
 * 指定ユーザーのロックアウト状態をリセットする。
 * ロックアウト spec 終了後に他テストへ影響を残さないため使う。
 */
export async function resetAuthLockout(username: string): Promise<void> {
  await prisma.user.updateMany({
    where: { username },
    data: { failed_count: 0, locked_until: null },
  });
}
