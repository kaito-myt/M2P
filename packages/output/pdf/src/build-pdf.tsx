import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  renderToBuffer,
  StyleSheet,
} from '@react-pdf/renderer';
import { markdownToReactPdfElements } from './md-to-react-pdf.js';
import { registerFonts, FONT_FAMILY } from './register-fonts.js';

const A5_WIDTH_PT = 419.53; // 148mm
const A5_HEIGHT_PT = 595.28; // 210mm

const styles = StyleSheet.create({
  page: {
    width: A5_WIDTH_PT,
    height: A5_HEIGHT_PT,
    paddingTop: 56.69, // 20mm
    paddingBottom: 56.69,
    paddingLeft: 42.52, // 15mm
    paddingRight: 42.52,
    fontFamily: FONT_FAMILY,
    fontSize: 10,
  },
  chapterTitlePage: {
    width: A5_WIDTH_PT,
    height: A5_HEIGHT_PT,
    paddingTop: 56.69,
    paddingBottom: 56.69,
    paddingLeft: 42.52,
    paddingRight: 42.52,
    fontFamily: FONT_FAMILY,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chapterTitleText: {
    fontFamily: FONT_FAMILY,
    fontSize: 24,
    fontWeight: 700,
    textAlign: 'center',
  },
  bookTitleText: {
    fontFamily: FONT_FAMILY,
    fontSize: 26,
    fontWeight: 700,
    textAlign: 'center',
    marginBottom: 16,
  },
  bookSubtitleText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    textAlign: 'center',
    color: '#444',
  },
  tocTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 24,
  },
  tocRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tocHeading: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    flex: 1,
    paddingRight: 8,
  },
  bodyContainer: {
    flex: 1,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 9,
    fontFamily: FONT_FAMILY,
    color: '#666',
  },
});

export interface BuildPdfBook {
  title: string;
  subtitle?: string | null;
}

export interface BuildPdfChapter {
  index: number;
  heading: string;
  body_md: string;
}

/** 左右余白の上書きスタイル(pt)。undefined なら既定の 15mm。 */
type SidePad = { paddingLeft: number; paddingRight: number } | undefined;

function TitlePage({
  title,
  subtitle,
  sidePad,
}: {
  title: string;
  subtitle?: string | null;
  sidePad?: SidePad;
}): React.ReactElement {
  return (
    <Page size={[A5_WIDTH_PT, A5_HEIGHT_PT]} style={[styles.chapterTitlePage, sidePad ?? {}]}>
      <Text style={styles.bookTitleText}>{title}</Text>
      {subtitle ? <Text style={styles.bookSubtitleText}>{subtitle}</Text> : null}
    </Page>
  );
}

function TocPage({
  chapters,
  sidePad,
}: {
  chapters: BuildPdfChapter[];
  sidePad?: SidePad;
}): React.ReactElement {
  return (
    <Page size={[A5_WIDTH_PT, A5_HEIGHT_PT]} style={[styles.page, sidePad ?? {}]}>
      <Text style={styles.tocTitle}>目次</Text>
      {chapters.map((ch) => (
        <View key={`toc-${ch.index}`} style={styles.tocRow}>
          <Text style={styles.tocHeading}>{ch.heading}</Text>
        </View>
      ))}
      <Text style={styles.pageNumber} render={({ pageNumber }) => `${pageNumber}`} />
    </Page>
  );
}

function ChapterTitlePage({
  heading,
  sidePad,
}: {
  heading: string;
  sidePad?: SidePad;
}): React.ReactElement {
  return (
    <Page size={[A5_WIDTH_PT, A5_HEIGHT_PT]} style={[styles.chapterTitlePage, sidePad ?? {}]}>
      <Text style={styles.chapterTitleText}>{heading}</Text>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber }) => `${pageNumber}`}
      />
    </Page>
  );
}

function ChapterBodyPages({
  bodyMd,
  sidePad,
}: {
  bodyMd: string;
  sidePad?: SidePad;
}): React.ReactElement {
  const bodyElements = markdownToReactPdfElements(bodyMd);

  return (
    <Page size={[A5_WIDTH_PT, A5_HEIGHT_PT]} style={[styles.page, sidePad ?? {}]} wrap>
      <View style={styles.bodyContainer}>{bodyElements}</View>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber }) => `${pageNumber}`}
        fixed
      />
    </Page>
  );
}

export interface BuildPdfOptions {
  /** 小説(genre=novel)なら目次を付けず本文から始める。実用書系は はじめに→目次→本文。 */
  isNovel?: boolean;
  /**
   * 左右余白(mm)。既定 15mm(電子用/印刷〜300頁兼用)。
   * ペーパーバック印刷でノド最小余白が 15mm を超える本(301頁以上=15.9mm, 501頁以上=19.1mm)は
   * この値を引き上げて印刷用に再生成する(docs/05 §5.3.15b)。
   */
  sideMarginMm?: number;
}

export async function buildPdf(
  book: BuildPdfBook,
  chapters: BuildPdfChapter[],
  opts: BuildPdfOptions = {},
): Promise<Buffer> {
  registerFonts();

  const sidePad: SidePad =
    opts.sideMarginMm != null
      ? {
          paddingLeft: (opts.sideMarginMm * 72) / 25.4,
          paddingRight: (opts.sideMarginMm * 72) / 25.4,
        }
      : undefined;

  const sorted = [...chapters].sort((a, b) => a.index - b.index);
  const introIdx = sorted.findIndex((c) => /はじめに/.test(c.heading));

  const chapterFragment = (ch: BuildPdfChapter) => (
    <React.Fragment key={`ch-${ch.index}`}>
      <ChapterTitlePage heading={ch.heading} sidePad={sidePad} />
      <ChapterBodyPages bodyMd={ch.body_md} sidePad={sidePad} />
    </React.Fragment>
  );

  // 構成をジャンルで分岐。小説=目次なし本文から / 実用書=はじめに→目次→本文。
  let content: React.ReactNode;
  if (opts.isNovel) {
    content = sorted.map(chapterFragment);
  } else if (introIdx >= 0) {
    const rest = sorted.filter((_, i) => i !== introIdx);
    content = (
      <>
        {chapterFragment(sorted[introIdx]!)}
        <TocPage chapters={sorted} sidePad={sidePad} />
        {rest.map(chapterFragment)}
      </>
    );
  } else {
    content = (
      <>
        <TocPage chapters={sorted} sidePad={sidePad} />
        {sorted.map(chapterFragment)}
      </>
    );
  }

  const doc = (
    <Document
      title={book.title}
      author="宮田海斗"
      subject={book.subtitle ?? undefined}
    >
      <TitlePage title={book.title} subtitle={book.subtitle} />
      {content}
    </Document>
  );

  const buffer = await renderToBuffer(doc);
  return Buffer.from(buffer);
}
