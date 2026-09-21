import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // workspace パッケージは Next.js でトランスパイルが必要
  transpilePackages: ['@a2p/auth', '@a2p/contracts', '@a2p/crypto', '@a2p/db', '@a2p/storage', '@a2p/ui'],
  // graphile-worker は内部で動的 require (migrations の SQL ファイル読込) / cosmiconfig による
  // preset 解決を行うため webpack にバンドルさせず Node の require 解決へ委ねる (apps/web と同じ)。
  // これが無いと Server Action からの `enqueueJob` (makeWorkerUtils) が実行時に失敗し、
  // 内部 Job だけ queued で残って graphile に投入されない (2026-09-21 に本番で発生、docs/11 §7)。
  // prisma/pg 系も同様。
  serverExternalPackages: ['graphile-worker', 'pg', 'pg-native'],
  // `packages/*` は NodeNext 規約で `from './foo.js'` の拡張子付き import を使うため
  // webpack で `.js → .ts(x)` に解決させる（apps/web と同じ）。
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
