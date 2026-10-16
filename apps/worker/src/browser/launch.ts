/**
 * Playwright ブラウザ起動の唯一の入口 (F-098)。
 *
 * **なぜ要るか** — worker の graphile 並列度は `WORKER_BOOK_CONCURRENCY` (既定 5) で、
 * ブラウザを使うタスク (kdp.submit / paperback.draft / paperback.submit /
 * pipeline.note.publish / *.engage / sales.fetch …) が同時に走ると Chromium が
 * 複数本立ち上がる。Railway のコンテナはそれに耐えられず、
 *
 *   `pthread_create: Resource temporarily unavailable (11)`
 *   `spawn .../chrome-headless-shell EAGAIN`
 *
 * で **起動そのものが失敗する**。2026-10-02 以降これが常態化し、
 * `paperback.draft` / `paperback.submit` / `kdp.submit` が attempts=25 まで
 * 無言で焼き切れて (graphile は fetch 時に attempts を増やすので `last_error` は null)
 * サーバー側の出版が 2 週間まるごと止まっていた。ANP の `pipeline.note.publish` も
 * 同じ理由で落ちていた。
 *
 * **対策** — 起動を 1 点に集約し、プロセス内セマフォで同時起動数を絞る (既定 1 本)。
 * 併せて EAGAIN 系は一過性なので短い指数バックオフで再試行する。
 * スロットは `browser.close()` で返す — 呼び出し側は従来どおり `try/finally` で
 * close すればよく、close し忘れても `SLOT_MAX_MS` で強制返却する (デッドロック防止)。
 *
 * 仕様根拠: docs/05-program-design.md §5.3.17 / docs/02 F-098
 */
import { createLogger } from '@a2p/contracts/logger';

/** playwright は値として import しない (type-only)。 */
type PwBrowser = import('playwright').Browser;

const log = createLogger('worker.browser.launch');

/** 全ブラウザ起動で共有する UA。 */
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** コンテナ (Railway) 上の Chromium 起動引数。 */
export const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

/** 同時に起動してよい Chromium の本数。1 本で直列化するのが既定。 */
export function resolveBrowserConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WORKER_BROWSER_CONCURRENCY;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** スロットの最大保持時間。close 漏れで永久に詰まるのを防ぐ保険。 */
export const SLOT_MAX_MS = 45 * 60 * 1000;
/** スロット待ちの上限。超えたら retryable なエラーにして graphile に返す。 */
export const SLOT_WAIT_MAX_MS = 20 * 60 * 1000;
/** EAGAIN 系の再試行回数と待ち時間。 */
const LAUNCH_RETRIES = 3;
const LAUNCH_BACKOFF_MS = [3_000, 10_000, 25_000];

/** EAGAIN / pthread_create など「資源が一時的に足りない」系か。 */
export function isResourceExhaustion(message: string): boolean {
  return (
    message.includes('EAGAIN') ||
    message.includes('Resource temporarily unavailable') ||
    message.includes('pthread_create') ||
    message.includes('Out of memory') ||
    message.includes('ENOMEM')
  );
}

export class BrowserSlotTimeoutError extends Error {
  constructor(waitedMs: number) {
    super(`browser slot not available after ${Math.round(waitedMs / 1000)}s — another browser task is still running`);
    this.name = 'BrowserSlotTimeoutError';
  }
}

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** プロセス内セマフォ。テストから状態を覗けるよう module scope に置く。 */
const state = {
  inUse: 0,
  waiters: [] as Waiter[],
};

/** テスト用。 */
export function __resetBrowserSlots(): void {
  for (const w of state.waiters) clearTimeout(w.timer);
  state.waiters = [];
  state.inUse = 0;
}

/** テスト用。 */
export function __browserSlotStats(): { inUse: number; waiting: number } {
  return { inUse: state.inUse, waiting: state.waiters.length };
}

async function acquireSlot(limit: number, waitMaxMs: number): Promise<void> {
  if (state.inUse < limit) {
    state.inUse++;
    return;
  }
  const startedAt = Date.now();
  log.info({ inUse: state.inUse, waiting: state.waiters.length, limit }, 'browser slot busy — waiting');
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const i = state.waiters.indexOf(waiter);
        if (i >= 0) state.waiters.splice(i, 1);
        reject(new BrowserSlotTimeoutError(Date.now() - startedAt));
      }, waitMaxMs),
    };
    state.waiters.push(waiter);
  });
  log.info({ waitedMs: Date.now() - startedAt }, 'browser slot acquired after wait');
}

function releaseSlot(): void {
  const next = state.waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    // inUse は据え置き (そのまま次の待ち手に引き継ぐ)。
    next.resolve();
    return;
  }
  state.inUse = Math.max(0, state.inUse - 1);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `chromium.launch` のオプション。playwright を値として import しないため緩く受ける。 */
export interface LaunchBrowserOptions {
  headless?: boolean;
  args?: string[];
  proxy?: { server: string; username?: string; password?: string };
  timeout?: number;
  /** 呼び出し元の識別子。ログに出すだけ。 */
  label?: string;
}

/**
 * Chromium を 1 本起動する。**worker 内でブラウザを起動する唯一の経路**。
 *
 * - 同時起動数を `WORKER_BROWSER_CONCURRENCY` (既定 1) に制限する
 * - EAGAIN / pthread_create 系は 3 回まで指数バックオフで再試行する
 * - 返ってきた browser の `close()` がスロットを返す (多重 close しても 1 回だけ返す)
 */
export async function launchBrowser(
  options: LaunchBrowserOptions = {},
  deps: {
    launch?: (opts: Record<string, unknown>) => Promise<PwBrowser>;
    env?: NodeJS.ProcessEnv;
    slotWaitMaxMs?: number;
    slotMaxMs?: number;
    backoffMs?: number[];
  } = {},
): Promise<PwBrowser> {
  const env = deps.env ?? process.env;
  const limit = resolveBrowserConcurrency(env);
  const waitMaxMs = deps.slotWaitMaxMs ?? SLOT_WAIT_MAX_MS;
  const slotMaxMs = deps.slotMaxMs ?? SLOT_MAX_MS;
  const backoff = deps.backoffMs ?? LAUNCH_BACKOFF_MS;

  const launch =
    deps.launch ??
    (async (opts: Record<string, unknown>) => {
      const { chromium } = await import('playwright');
      return await chromium.launch(opts as never);
    });

  await acquireSlot(limit, waitMaxMs);

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    clearTimeout(guard);
    releaseSlot();
  };
  const guard = setTimeout(() => {
    log.warn({ label: options.label, slotMaxMs }, 'browser slot held too long — force releasing');
    release();
  }, slotMaxMs);
  if (typeof guard.unref === 'function') guard.unref();

  const launchOptions: Record<string, unknown> = {
    headless: options.headless ?? true,
    args: options.args ?? LAUNCH_ARGS,
    ...(options.proxy ? { proxy: options.proxy } : {}),
    ...(options.timeout ? { timeout: options.timeout } : {}),
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= LAUNCH_RETRIES; attempt++) {
    try {
      const browser = await launch(launchOptions);
      const originalClose = browser.close.bind(browser);
      browser.close = async (): Promise<void> => {
        try {
          await originalClose();
        } finally {
          release();
        }
      };
      return browser;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < LAUNCH_RETRIES && isResourceExhaustion(msg)) {
        const waitMs = backoff[Math.min(attempt, backoff.length - 1)] ?? 10_000;
        log.warn(
          { label: options.label, attempt: attempt + 1, waitMs },
          'Chromium 起動が資源不足で失敗 — 再試行する',
        );
        await sleep(waitMs);
        continue;
      }
      release();
      throw err;
    }
  }
  release();
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
