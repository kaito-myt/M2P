/**
 * vitest globalSetup。Docker 経路のとき、テストファイルごとにコンテナを起動しないよう 1 回だけ起動し、
 * TDP_TEST_DATABASE_URL を各ワーカーへ渡す。teardown で必ずコンテナを停止する (Ryuk には頼らない)。
 * TDP_REQUIRE_PG=1 で不達なら全体を失敗させる。
 */
import { pgAvailability, resolvedBaseUrl, stopTestContainer } from './pg.js';

export default async function setup(): Promise<() => Promise<void>> {
  const a = await pgAvailability();
  if (a.ok && a.source === 'testcontainers') {
    const url = await resolvedBaseUrl();
    if (url) process.env.TDP_TEST_DATABASE_URL = url;
  }
  return stopTestContainer;
}
