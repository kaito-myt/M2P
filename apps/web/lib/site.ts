/**
 * 公開サイトのベース URL 解決（canonical / OG / sitemap / robots 用）。
 *
 * - `SITE_URL`       : A2P ドメイン（管理ツール＋既定）。`NEXT_PUBLIC_SITE_URL`。
 * - `STOREFRONT_URL` : 栞ストアフロントの**正規ドメイン**。専用サブドメイン
 *   (`shiori.m2p.tools`) を `NEXT_PUBLIC_STOREFRONT_URL` に設定するとそちらが正規になり、
 *   /blog・/shop の canonical/sitemap がその URL を指す。未設定なら SITE_URL にフォールバック。
 *
 * 運用: サブドメインの DNS が解決可能になってから `NEXT_PUBLIC_STOREFRONT_URL` を設定すること
 * （解決しない URL を canonical にすると Google が索引を落とすため）。
 */
const clean = (u: string): string => u.replace(/\/$/, '');

export const SITE_URL = clean(process.env.NEXT_PUBLIC_SITE_URL || 'https://a2p.m2p.tools');

export const STOREFRONT_URL = clean(process.env.NEXT_PUBLIC_STOREFRONT_URL || SITE_URL);
