import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';

import {
  classifyWatchdogState,
  startDbWatchdog,
  DEFAULT_FAILURES_BEFORE_EXIT,
} from '../src/lib/db-watchdog.js';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe('classifyWatchdogState', () => {
  it('連続失敗が 0 なら ok', () => {
    expect(classifyWatchdogState(0, 5)).toBe('ok');
  });

  it('しきい値未満は failing、到達したら exit', () => {
    expect(classifyWatchdogState(1, 5)).toBe('failing');
    expect(classifyWatchdogState(4, 5)).toBe('failing');
    expect(classifyWatchdogState(5, 5)).toBe('exit');
    expect(classifyWatchdogState(9, 5)).toBe('exit');
  });
});

/**
 * [F-ANP-50] DB 到達不能はタスクが全滅するのに public.jobs に何も残らない「無音の停止」。
 * 連続失敗でプロセスを落として Railway に再起動させる。
 */
describe('startDbWatchdog', () => {
  it('ping が通っている間は何もしない', async () => {
    const exit = vi.fn();
    const w = startDbWatchdog({
      ping: async () => 1,
      exit,
      intervalMs: 1_000_000,
      logger: makeLogger(),
    });
    await w.tick();
    await w.tick();
    expect(exit).not.toHaveBeenCalled();
    w.stop();
  });

  it('連続失敗がしきい値に達したら通知して exit(1)', async () => {
    const exit = vi.fn();
    const notify = vi.fn(async () => true);
    const w = startDbWatchdog({
      ping: async () => {
        throw new Error("Can't reach database server at `postgres.railway.internal:5432`");
      },
      exit,
      notify,
      failuresBeforeExit: 3,
      intervalMs: 60_000,
      logger: makeLogger(),
    });

    await w.tick();
    await w.tick();
    expect(exit).not.toHaveBeenCalled();

    await w.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0]![0])).toContain('A2P-Worker');
    expect(exit).toHaveBeenCalledWith(1);
    w.stop();
  });

  it('途中で回復したら失敗カウントをリセットする', async () => {
    const exit = vi.fn();
    let healthy = false;
    const w = startDbWatchdog({
      ping: async () => {
        if (!healthy) throw new Error('down');
        return 1;
      },
      exit,
      failuresBeforeExit: 3,
      intervalMs: 60_000,
      logger: makeLogger(),
    });

    await w.tick();
    await w.tick();
    healthy = true;
    await w.tick(); // 回復 → カウントリセット
    healthy = false;
    await w.tick();
    await w.tick();
    expect(exit).not.toHaveBeenCalled(); // リセット後はまだ 2 回
    await w.tick();
    expect(exit).toHaveBeenCalledWith(1);
    w.stop();
  });

  it('stop したあとは判定しない', async () => {
    const exit = vi.fn();
    const w = startDbWatchdog({
      ping: async () => {
        throw new Error('down');
      },
      exit,
      failuresBeforeExit: 1,
      intervalMs: 60_000,
      logger: makeLogger(),
    });
    w.stop();
    await w.tick();
    expect(exit).not.toHaveBeenCalled();
  });

  it('exit は 1 度だけ呼ぶ (再起動中に重ねて呼ばない)', async () => {
    const exit = vi.fn();
    const w = startDbWatchdog({
      ping: async () => {
        throw new Error('down');
      },
      exit,
      failuresBeforeExit: 1,
      intervalMs: 60_000,
      logger: makeLogger(),
    });
    await w.tick();
    await w.tick();
    await w.tick();
    expect(exit).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('既定のしきい値は 5 回', () => {
    expect(DEFAULT_FAILURES_BEFORE_EXIT).toBe(5);
  });
});
