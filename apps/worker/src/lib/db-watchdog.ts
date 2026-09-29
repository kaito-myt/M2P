/**
 * DB 死活監視ウォッチドッグ (F-ANP-50 / reference: 2026-08-30〜09-01 と 2026-09-28 の worker 停止)。
 *
 * 【なぜ必要か】Railway の worker が `postgres.railway.internal` に到達できなくなると、
 * graphile-worker の全タスクが `Can't reach database server` で失敗し続ける。この状態は
 *   - `public.jobs` には何も記録されない（DB に書けないので当然）
 *   - UI 上は「ジョブが増えも減りもしない」だけ
 * という**無音の停止**になり、2026-08-30 のときは丸 2 日、2026-09-28 のときは 1 日以上
 * 気づけなかった。復旧手段は毎回「Railway で worker を再デプロイ（= プロセス再起動）」だけ。
 *
 * そこで本ウォッチドッグが定期的に `select 1` を撃ち、**連続で失敗したらプロセスを落とす**。
 * Railway はコンテナが落ちると自動で再起動するので、数日の停止が数分の停止に縮む。
 * 落ちる前に LINE へ通知して、運営者が状況を把握できるようにする。
 */
import type { Logger } from '@a2p/contracts/logger';
import { createLogger } from '@a2p/contracts/logger';

/** 既定の ping 間隔 (ms)。 */
export const DEFAULT_PING_INTERVAL_MS = 60_000;
/** 既定の連続失敗許容回数 (これを超えたらプロセスを落とす)。 */
export const DEFAULT_FAILURES_BEFORE_EXIT = 5;

export interface DbWatchdogOptions {
  /** DB へ到達できるか確かめる。失敗時は reject すること。 */
  ping: () => Promise<unknown>;
  intervalMs?: number;
  failuresBeforeExit?: number;
  /** 落ちる直前の通知 (best-effort。失敗しても無視する)。 */
  notify?: (text: string) => Promise<unknown>;
  /** プロセス終了 (テスト差し替え用)。 */
  exit?: (code: number) => void;
  logger?: Logger;
}

export interface DbWatchdogHandle {
  stop: () => void;
  /** テスト用: 1 回分の判定を即座に走らせる。 */
  tick: () => Promise<void>;
}

/**
 * 連続失敗の判定を行う純関数部分。
 * @returns 'ok' | 'failing' | 'exit'
 */
export function classifyWatchdogState(
  consecutiveFailures: number,
  failuresBeforeExit: number,
): 'ok' | 'failing' | 'exit' {
  if (consecutiveFailures <= 0) return 'ok';
  return consecutiveFailures >= failuresBeforeExit ? 'exit' : 'failing';
}

export function startDbWatchdog(options: DbWatchdogOptions): DbWatchdogHandle {
  const log = options.logger ?? createLogger('worker.db-watchdog');
  const intervalMs = options.intervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const failuresBeforeExit = options.failuresBeforeExit ?? DEFAULT_FAILURES_BEFORE_EXIT;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let failures = 0;
  let stopped = false;
  let exiting = false;

  const tick = async (): Promise<void> => {
    if (stopped || exiting) return;
    try {
      await options.ping();
      if (failures > 0) {
        log.info({ afterFailures: failures }, 'DB 接続が回復しました');
      }
      failures = 0;
    } catch (err) {
      failures += 1;
      const state = classifyWatchdogState(failures, failuresBeforeExit);
      log.warn(
        { err: err instanceof Error ? err.message : String(err), failures, failuresBeforeExit, state },
        'DB へ到達できません (worker のタスクは全て失敗している状態)',
      );
      if (state !== 'exit') return;

      exiting = true;
      const minutes = Math.round((failures * intervalMs) / 60_000);
      const message =
        `🛑 A2P-Worker: DB (postgres.railway.internal) に約 ${String(minutes)} 分到達できないため、` +
        'worker プロセスを再起動します。復旧しない場合は Railway で A2P-Worker を再デプロイしてください。';
      log.error({ failures, intervalMs }, 'DB 到達不能が続いたため worker を終了します (Railway が再起動する)');
      if (options.notify) {
        await options.notify(message).catch(() => undefined);
      }
      exit(1);
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  // ウォッチドッグがプロセスを生かし続けないようにする。
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}
