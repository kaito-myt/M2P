/**
 * 認証コアロジック — 実装は @a2p/auth に集約（プラットフォーム共有 / SSO）。
 *
 * 旧来この場所に実装があったが、ポータル(apps/portal)と同一ロジックで同一 `users` 表を
 * 照合するため packages/auth へ移設した。既存の import パス互換のため再エクスポートする。
 */
export {
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
  verifyCredentialsAndUpdateCounters,
  authorizeWithPrisma,
  type VerifyCredentialsResult,
  type VerifyCredentialsInput,
  type AuthDeps,
} from '@a2p/auth';
