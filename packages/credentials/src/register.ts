/**
 * @a2p/credentials — 各プロセス起動時の登録。
 *
 * `@a2p/storage` は DB に依存しないので、R2 設定を DB から読むプロバイダをここで差し込む
 * (`setR2ConfigProvider`)。呼び出し箇所:
 *   - apps/worker `src/index.ts` main()
 *   - apps/web / apps/anp / apps/portal `instrumentation.ts` (nodejs runtime のみ)
 * 何度呼んでも冪等。
 */
import { setR2ConfigProvider } from '@a2p/storage/client';

import { SERVICE_PROVIDERS } from './spec.js';
import { resolveR2Credentials, resolveServiceCredentials } from './store.js';

let installed = false;

export function installServiceCredentialProviders(): void {
  if (installed) return;
  installed = true;
  setR2ConfigProvider(async () => {
    const c = await resolveR2Credentials();
    // DB 未登録 (null) なら storage 側が env にフォールバックする。
    return c ? { accountId: c.accountId, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, bucket: c.bucket } : null;
  });
}

/**
 * 全サービスの資格情報を一度解決してキャッシュを温める (同期参照 `peek*` のため)。
 * `refreshMs` を渡すと以後その間隔で再解決し続ける (unref 済みタイマー。worker の常駐プロセス向け)。
 * 個々の失敗 (復号エラー等) はログに任せて握りつぶし、起動を止めない。
 */
export async function primeServiceCredentials(opts: { refreshMs?: number; onError?: (provider: string, err: unknown) => void } = {}): Promise<void> {
  const tick = async () => {
    for (const p of SERVICE_PROVIDERS) {
      try {
        await resolveServiceCredentials(p);
      } catch (err) {
        opts.onError?.(p, err);
      }
    }
  };
  await tick();
  if (opts.refreshMs && opts.refreshMs > 0) {
    const t = setInterval(() => void tick(), opts.refreshMs);
    t.unref?.();
  }
}

/** テスト用: 登録状態を戻す。 */
export function _resetServiceCredentialProviders(): void {
  installed = false;
  setR2ConfigProvider(null);
}
