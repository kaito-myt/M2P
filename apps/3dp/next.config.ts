import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // workspace パッケージは Next.js でトランスパイルが必要 (apps/anp と同じ)。
  transpilePackages: ['@a2p/auth', '@a2p/contracts', '@a2p/credentials', '@a2p/crypto', '@a2p/db', '@a2p/storage', '@a2p/ui'],
  // prisma/pg 系は webpack にバンドルさせず Node の require 解決へ委ねる (apps/portal と同じ)。
  // Inc-2 でジョブ投入 (graphile-worker) を足すときは apps/anp と同様に 'graphile-worker' を
  // ここへ追加すること — 無いと Server Action からの enqueue が実行時に失敗する (docs/11 §7 の実害)。
  serverExternalPackages: ['pg', 'pg-native'],
  // `packages/*` は NodeNext 規約で `from './foo.js'` の拡張子付き import を使うため
  // webpack で `.js → .ts(x)` に解決させる (apps/web / apps/anp と同じ)。
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },
};

export default nextConfig;
