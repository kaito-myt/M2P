import { Font } from '@react-pdf/renderer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FONT_FAMILY = 'NotoSansJP';

const WORKER_FONTS_DIR = resolve(process.cwd(), 'apps/worker/fonts');

const LOCAL_PATHS = {
  regular: resolve(WORKER_FONTS_DIR, 'NotoSansJP-Regular.ttf'),
  bold: resolve(WORKER_FONTS_DIR, 'NotoSansJP-Bold.ttf'),
};

const CDN_BASE =
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-jp@latest';

const CDN_URLS = {
  regular: `${CDN_BASE}/japanese-400-normal.ttf`,
  bold: `${CDN_BASE}/japanese-700-normal.ttf`,
};

let registered = false;

export function registerFonts(): void {
  if (registered) return;

  const useLocal =
    existsSync(LOCAL_PATHS.regular) && existsSync(LOCAL_PATHS.bold);

  const regularSrc = useLocal ? LOCAL_PATHS.regular : CDN_URLS.regular;
  const boldSrc = useLocal ? LOCAL_PATHS.bold : CDN_URLS.bold;

  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: regularSrc, fontWeight: 400, fontStyle: 'normal' },
      { src: regularSrc, fontWeight: 400, fontStyle: 'italic' },
      { src: boldSrc, fontWeight: 700, fontStyle: 'normal' },
      { src: boldSrc, fontWeight: 700, fontStyle: 'italic' },
    ],
  });

  // ハイフネーションを無効化する。
  // react-pdf は既定で英語向けのハイフネーション辞書を使い、日本語の本文でも行末に
  // ハイフン "-" を挿入する。日本語組版として誤りであるだけでなく、挿入されたハイフンが
  // テキストフレームの右端をはみ出すため、KDP 印刷プレビューアーが `GUTTER_ISSUE`
  // (内側マージン不足) を **エラー** として報告し、「承認」ボタンが無効化されて
  // ペーパーバックを出版できなくなる (2026-09-10 特定)。
  // 単語をそのまま返す = 分割しない。CJK の行分割は react-pdf 側が文字単位で行う。
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}

export { FONT_FAMILY };
