/**
 * graphile-worker enqueue helper (apps/anp 版)。`apps/web/lib/graphile-client.ts` と同型
 * (docs/11-anp-design.md §5.3: worker は既存 `apps/worker` を共用する)。
 */
import { makeWorkerUtils, type WorkerUtils, type TaskSpec } from 'graphile-worker';

import { ConfigError } from '@a2p/contracts';

interface GlobalWithUtils {
  __anpWorkerUtils?: Promise<WorkerUtils> | undefined;
}

const g = globalThis as unknown as GlobalWithUtils;

async function getUtils(): Promise<WorkerUtils> {
  if (g.__anpWorkerUtils) return g.__anpWorkerUtils;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.length === 0) {
    throw new ConfigError('DATABASE_URL is not set; cannot enqueue worker jobs', {
      userMessage: 'DATABASE_URL が未設定のためジョブを起動できません',
    });
  }
  const pending = makeWorkerUtils({ connectionString });
  g.__anpWorkerUtils = pending;
  pending.catch(() => {
    g.__anpWorkerUtils = undefined;
  });
  return pending;
}

/** 任意の task をエンキューする。戻り値は graphile-worker の job id を文字列化したもの。 */
export async function enqueueJob(
  taskName: string,
  payload: unknown = {},
  spec: TaskSpec = {},
): Promise<string> {
  const utils = await getUtils();
  const job = await utils.addJob(taskName, payload as Record<string, unknown>, spec);
  return String(job.id);
}
