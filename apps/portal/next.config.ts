import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // workspace パッケージは Next.js でトランスパイルが必要
  transpilePackages: ['@a2p/auth', '@a2p/contracts', '@a2p/credentials', '@a2p/crypto', '@a2p/db', '@a2p/storage', '@a2p/ui'],
  // prisma/pg 系は Node の require 解決へ委ねるため server external にする。
  serverExternalPackages: ['pg', 'pg-native'],
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
