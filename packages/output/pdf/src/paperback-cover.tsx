/**
 * ペーパーバックのラップカバー（裏表紙 + 背 + 表紙の一枚 PDF）を組む (F-097f)。
 *
 * ローカル専用だった `scripts/paperback/build-wrap-cover.mjs` を**サーバー側でも使える形**に
 * 移植したもの（運営者指示 2026-09-29「基本すべての作業をサーバー側でやってほしい」）。
 * DB / R2 アクセスは呼び出し側の責務にして、この関数は純粋に「値 → PDF バッファ」に徹する。
 *
 * KDP の仕様（実測・`docs/05` §5.3.15）:
 *   - 裁ち落とし (bleed) 3.2mm を四辺に。左右は外側のみ。
 *   - 背幅 = 頁数 × 0.0572mm（白紙）。背文字を入れてよいのは 79 頁超のときだけ。
 *   - 判型は A5 (148×210mm)。
 *   - 印刷トリムから 9.5mm 以内には文字を置けない（セーフゾーン）。Kindle 用の表紙画像は
 *     端まで文字があることがあるので、**表紙画像をセーフゾーン内に収め**、周囲は表紙の
 *     平均色で埋める（色は裁ち落としまで届くが、文字は安全域に入る）。
 *   - 裏表紙の右下 50.8×30.5mm はバーコード領域なので空けておく。
 */
// worker 側 (tsx/esbuild) は classic runtime で JSX を変換するため、React の明示 import が要る
// (`build-pdf.tsx` と同じ。無いと実行時に `React is not defined` になる — 2026-09-29 実測)。
import React from 'react';
import { Document, Image, Page, renderToBuffer, Text, View } from '@react-pdf/renderer';

import { registerFonts } from './register-fonts.js';

/** mm → pt。 */
const MM = 72 / 25.4;
const BLEED_MM = 3.2;
const TRIM_W_MM = 148;
const TRIM_H_MM = 210;
/** 白紙 1 頁あたりの背幅 (mm)。 */
export const SPINE_MM_PER_PAGE = 0.0572;
/** 印刷トリムからのセーフゾーン (mm)。 */
const SAFE_MM = 9.5;
/** 背文字を入れてよい最小頁数。 */
const SPINE_TEXT_MIN_PAGES = 79;

export interface PaperbackCoverInput {
  title: string;
  subtitle?: string | null;
  /** 裏表紙に載せる紹介文 (HTML 可。420 字で文単位に切る)。 */
  description?: string | null;
  /** 著者名 (裏表紙下部)。 */
  author?: string;
  /** 本文の総頁数 (背幅の算出に使う)。 */
  pages: number;
  /** Kindle 用表紙画像 (JPEG/PNG)。 */
  coverImage: Buffer;
  /**
   * 表紙画像をセーフゾーンに収めた PNG と平均色。呼び出し側が sharp で作る
   * (このパッケージを sharp に依存させないため)。
   */
  frontImagePng: Buffer;
  averageColor: { r: number; g: number; b: number };
}

/** 背幅 (mm)。 */
export function spineWidthMm(pages: number): number {
  return Number((pages * SPINE_MM_PER_PAGE).toFixed(3));
}

/** 表紙画像をセーフゾーンに収めるときの画素サイズ (300dpi)。 */
export function safeAreaPixels(): { width: number; height: number } {
  return {
    width: Math.round(((TRIM_W_MM - 2 * SAFE_MM) * 300) / 25.4),
    height: Math.round(((TRIM_H_MM - 2 * SAFE_MM) * 300) / 25.4),
  };
}

/** HTML タグを落として素のテキストにする。 */
export function stripHtml(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

/** 裏表紙の紹介文を 420 字以内・文の途中で切らないように整える。 */
export function blurbFor(description: string | null | undefined, subtitle: string | null | undefined): string {
  let blurb = stripHtml(description).slice(0, 420) || (subtitle ?? '');
  const lastEnd = blurb.lastIndexOf('。');
  if (lastEnd > 120) blurb = blurb.slice(0, lastEnd + 1);
  return blurb;
}

/** 裏表紙・背の地色 (表紙平均色を暗く落としたもの)。 */
export function backgroundColors(avg: { r: number; g: number; b: number }): { back: string; front: string } {
  const darken = (v: number): number => Math.max(18, Math.round(v * 0.32));
  return {
    back: `rgb(${String(darken(avg.r))},${String(darken(avg.g))},${String(darken(avg.b))})`,
    front: `rgb(${String(avg.r)},${String(avg.g)},${String(avg.b)})`,
  };
}

export async function buildPaperbackWrapCover(input: PaperbackCoverInput): Promise<Buffer> {
  registerFonts();

  const spine = spineWidthMm(input.pages);
  const totalW = BLEED_MM + TRIM_W_MM + spine + TRIM_W_MM + BLEED_MM;
  const totalH = BLEED_MM + TRIM_H_MM + BLEED_MM;
  const W = totalW * MM;
  const H = totalH * MM;
  const frontX = (BLEED_MM + TRIM_W_MM + spine) * MM;
  const panelW = (TRIM_W_MM + BLEED_MM) * MM;
  const spineX = (BLEED_MM + TRIM_W_MM) * MM;
  const spineW = spine * MM;

  const safeX = frontX + SAFE_MM * MM;
  const safeY = (BLEED_MM + SAFE_MM) * MM;
  const safeW = (TRIM_W_MM - 2 * SAFE_MM) * MM;
  const safeH = (TRIM_H_MM - 2 * SAFE_MM) * MM;

  const { back: backBg, front: frontBg } = backgroundColors(input.averageColor);
  const blurb = blurbFor(input.description, input.subtitle);
  const spineFont = Math.min(11, Math.max(7, spineW * 0.62));
  const author = input.author ?? '著者';

  const doc = (
    <Document title={`${input.title} (Paperback Cover)`}>
      <Page size={[W, H]} style={{ fontFamily: 'NotoSansJP' }}>
        {/* 裏表紙パネル (左・bleed 込み)。右下のバーコード領域は空けたまま。 */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: panelW,
            height: H,
            backgroundColor: backBg,
            paddingTop: (BLEED_MM + 18) * MM,
            paddingLeft: (BLEED_MM + 14) * MM,
            paddingRight: 14 * MM,
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: 700, marginBottom: 14 }}>{input.title}</Text>
          {input.subtitle ? (
            <Text style={{ color: '#e8e8e8', fontSize: 9, marginBottom: 14 }}>{input.subtitle}</Text>
          ) : null}
          <Text style={{ color: '#f2f2f2', fontSize: 8.5, lineHeight: 1.7 }}>{blurb}</Text>
          <Text
            style={{
              position: 'absolute',
              bottom: (BLEED_MM + 40) * MM,
              left: (BLEED_MM + 14) * MM,
              color: '#dddddd',
              fontSize: 8,
            }}
          >
            {`著: ${author}`}
          </Text>
          <Text
            style={{
              position: 'absolute',
              bottom: (BLEED_MM + 34) * MM,
              left: (BLEED_MM + 14) * MM,
              color: '#bbbbbb',
              fontSize: 7,
            }}
          >
            Kindle版も好評発売中
          </Text>
        </View>

        {/* 背 (中央)。79 頁以下・背幅が細いときは文字を入れない。 */}
        <View style={{ position: 'absolute', left: spineX, top: 0, width: spineW, height: H, backgroundColor: backBg }}>
          {input.pages > SPINE_TEXT_MIN_PAGES && spineW >= 9 ? (
            <View
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: spineW,
                height: H,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: '#ffffff',
                  fontSize: spineFont,
                  fontWeight: 700,
                  transform: 'rotate(90deg)',
                  width: H * 0.86,
                  textAlign: 'center',
                }}
              >
                {input.title.slice(0, 40)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* 表紙 (右)。パネル全面を平均色で塗り、Kindle 表紙はセーフゾーン内に置く。 */}
        <View style={{ position: 'absolute', left: frontX, top: 0, width: panelW, height: H, backgroundColor: frontBg }} />
        <Image src={input.frontImagePng} style={{ position: 'absolute', left: safeX, top: safeY, width: safeW, height: safeH }} />
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
