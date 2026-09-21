/**
 * Next.js instrumentation — サーバー起動時に一度だけ走る。
 *
 * M2P ポータルの「API 管理」(docs/10 §10.4b) で保存した R2 接続情報を `@a2p/storage` が DB 優先で使えるよう、
 * プロバイダを登録する (DB 未登録なら env にフォールバック)。edge ランタイムでは何もしない。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { installServiceCredentialProviders } = await import('@a2p/credentials/register');
  installServiceCredentialProviders();
}
