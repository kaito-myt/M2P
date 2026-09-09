/**
 * @a2p/auth — プラットフォーム共有の認証基盤（SSO 対応）。
 *
 * - `buildAuthConfig`  : Auth.js v5 共通 config ファクトリ（cookie 共有で SSO）
 * - `authorizeWithPrisma` / `verifyCredentialsAndUpdateCounters` : 認証コアロジック
 */
export { buildAuthConfig, type BuildAuthConfigOptions } from './config.js';
export {
  authorizeWithPrisma,
  verifyCredentialsAndUpdateCounters,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
  type VerifyCredentialsResult,
  type VerifyCredentialsInput,
  type AuthDeps,
} from './auth-service.js';
