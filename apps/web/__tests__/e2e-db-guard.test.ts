/**
 * E2E の DB クリーンアップガードのテスト。
 *
 * `tests/e2e/fixtures/db.ts` の `cleanupTransientData` は book / account /
 * job / token_usage を条件なしで全削除する。`playwright.config.ts` は
 * `.env.local` を dotenv で読み込むので、`DATABASE_URL` が本番を指していると
 * `pnpm exec playwright test` 一発で事業データが消える。
 * ローカル以外では実行しないことを固定する。
 */
import { describe, it, expect } from 'vitest';

import { __isLocalDatabase } from '../../../tests/e2e/fixtures/db';

describe('E2E の DB ガード', () => {
  it('ローカルの DB は許可する', () => {
    expect(__isLocalDatabase('postgresql://u:p@localhost:5433/a2p')).toBe(true);
    expect(__isLocalDatabase('postgresql://u:p@127.0.0.1:5432/a2p')).toBe(true);
    expect(__isLocalDatabase('postgresql://u:p@host.docker.internal:5432/a2p')).toBe(true);
  });

  it('リモート (本番) の DB は拒否する', () => {
    expect(__isLocalDatabase('postgresql://u:p@containers-us-west-1.railway.app:7432/railway')).toBe(false);
    expect(__isLocalDatabase('postgresql://u:p@postgres.railway.internal:5432/railway')).toBe(false);
  });

  it('未設定・壊れた URL は拒否する (安全側に倒す)', () => {
    expect(__isLocalDatabase(undefined)).toBe(false);
    expect(__isLocalDatabase('')).toBe(false);
    expect(__isLocalDatabase('not a url')).toBe(false);
  });
});
