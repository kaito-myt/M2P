import { describe, it, expect } from 'vitest';
import { buildPdf, type BuildPdfBook, type BuildPdfChapter, buildBookDocument } from '../src/index.js';

const sampleBook: BuildPdfBook = {
  title: 'テスト書籍タイトル',
  subtitle: 'サブタイトルの例',
};

const sampleChapters: BuildPdfChapter[] = [
  {
    index: 1,
    heading: '第1章 はじめに',
    body_md: [
      'これは第1章の本文です。AIを活用した出版の世界へようこそ。',
      '',
      '## セクション1.1',
      '',
      'ここではAI出版の基本について説明します。**太字テキスト**や*イタリック*も含みます。',
      '',
      '- リスト項目1',
      '- リスト項目2',
      '- リスト項目3',
      '',
      '> 引用テキストの例です。',
      '',
      '```',
      'コードブロックの例',
      '```',
    ].join('\n'),
  },
  {
    index: 2,
    heading: '第2章 実践編',
    body_md: [
      '第2章では実践的な内容を扱います。',
      '',
      '## セクション2.1',
      '',
      'ステップバイステップで進めましょう。',
      '',
      '### サブセクション2.1.1',
      '',
      'さらに詳しい内容です。`インラインコード`もサポートしています。',
    ].join('\n'),
  },
  {
    index: 3,
    heading: '第3章 まとめ',
    body_md: [
      'これは最終章のまとめです。',
      '',
      '全体を振り返り、学んだことを整理しましょう。',
      '',
      '---',
      '',
      '本書は AI によって生成されました。',
    ].join('\n'),
  },
];

describe('buildPdf', () => {
  it('generates a valid PDF buffer with %PDF- header', async () => {
    const buffer = await buildPdf(sampleBook, sampleChapters);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  }, 60_000);

  it('generates a multi-page PDF with chapter title pages', async () => {
    const buffer = await buildPdf(sampleBook, sampleChapters);
    const text = buffer.toString('latin1');

    // Each chapter produces at least 2 pages (title page + body page)
    // Count /Type /Page occurrences to verify multiple pages exist
    const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pageCount).toBeGreaterThanOrEqual(sampleChapters.length * 2);

    // Verify document has font references (CJK text is glyph-encoded)
    expect(text).toContain('/Font');
    expect(text).toContain('/Type /Font');
  }, 60_000);

  it('embeds book title in PDF metadata', async () => {
    const buffer = await buildPdf(sampleBook, sampleChapters);
    const text = buffer.toString('latin1');

    // @react-pdf/renderer stores title in the Info dictionary
    expect(text).toContain('/Title');
    expect(text).toContain('/Author');
  }, 60_000);

  it('works without subtitle', async () => {
    const bookNoSub: BuildPdfBook = { title: 'タイトルのみ' };
    const buffer = await buildPdf(bookNoSub, [sampleChapters[0]!]);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  }, 60_000);

  it('sorts chapters by index (single chapter produces consistent output)', async () => {
    const reversed = [...sampleChapters].reverse();
    const buffer = await buildPdf(sampleBook, reversed);

    // Verify it generates without error and produces a valid PDF
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // Verify same number of pages regardless of input order
    const bufferSorted = await buildPdf(sampleBook, sampleChapters);
    const text1 = buffer.toString('latin1');
    const text2 = bufferSorted.toString('latin1');
    const pageCount1 = (text1.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const pageCount2 = (text2.match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pageCount1).toBe(pageCount2);
  }, 60_000);

  it('generates correct A5 page dimensions', async () => {
    const buffer = await buildPdf(sampleBook, [sampleChapters[0]!]);
    const text = buffer.toString('latin1');

    // A5 dimensions in points: 419.53 x 595.28
    expect(text).toContain('419.5');
    expect(text).toContain('595.28');
  }, 60_000);
});

describe('buildPdf performance benchmark', () => {
  it('generates 50,000-char 8-chapter PDF within 30 seconds', async () => {
    const CHAR_TARGET = 50_000;
    const CHAPTER_COUNT = 8;
    const charsPerChapter = Math.ceil(CHAR_TARGET / CHAPTER_COUNT);

    const benchChapters: BuildPdfChapter[] = Array.from(
      { length: CHAPTER_COUNT },
      (_, i) => ({
        index: i + 1,
        heading: `第${i + 1}章 テスト章タイトル`,
        body_md: generateBenchmarkBody(charsPerChapter),
      }),
    );

    const benchBook: BuildPdfBook = {
      title: '性能ベンチマーク用テスト書籍',
      subtitle: '50,000文字 8章構成',
    };

    const start = performance.now();
    const buffer = await buildPdf(benchBook, benchChapters);
    const elapsed = performance.now() - start;
    const elapsedSec = elapsed / 1000;

    console.log(`[PDF Benchmark] Elapsed: ${elapsedSec.toFixed(2)}s`);
    console.log(`[PDF Benchmark] PDF size: ${(buffer.length / 1024).toFixed(0)} KB`);
    console.log(
      `[PDF Benchmark] Total chars: ${benchChapters.reduce((s, c) => s + c.body_md.length, 0)}`,
    );

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    if (elapsedSec > 30) {
      console.warn(
        `[PDF Benchmark] EXCEEDED 30s threshold (${elapsedSec.toFixed(2)}s). ` +
          `Alert(kind='pdf_perf_warning') should be raised by pipeline.`,
      );
      console.warn(
        `[PDF Benchmark] Simulated Alert INSERT: ` +
          JSON.stringify({
            kind: 'pdf_perf_warning',
            severity: 'warning',
            payload_json: {
              elapsed_seconds: elapsedSec,
              char_count: CHAR_TARGET,
              chapter_count: CHAPTER_COUNT,
              pdf_bytes: buffer.length,
            },
          }),
      );
    }

    expect(elapsedSec).toBeLessThan(30);
  }, 120_000);
});

function generateBenchmarkBody(targetChars: number): string {
  const paragraph =
    'AI技術の進歩により、自動出版の可能性が大きく広がっています。' +
    '本章では、その基本的な概念と実践的なアプローチについて詳しく解説します。' +
    'デジタルトランスフォーメーションの波は出版業界にも押し寄せており、' +
    '従来の手法では考えられなかったスピードと品質での出版が可能になりました。\n\n';

  const section =
    '## セクション見出し\n\n' +
    paragraph +
    '効率的なワークフローを構築するためには、適切なツールの選定が不可欠です。' +
    '市場調査から原稿作成、校閲、表紙デザイン、そして最終的な出力まで、' +
    '一連のプロセスを自動化することで、高品質な書籍を短期間で制作できます。\n\n' +
    '- ポイント1: 市場ニーズの正確な把握\n' +
    '- ポイント2: 読者ターゲットの明確化\n' +
    '- ポイント3: 競合分析に基づく差別化\n\n' +
    '> 品質管理は最も重要なステップの一つです。自動化されたプロセスであっても、' +
    '最終的な品質チェックは欠かせません。\n\n';

  let body = '';
  while (body.length < targetChars) {
    body += section;
  }
  return body.slice(0, targetChars);
}

describe('ペーパーバック用の左右余白 (F-097j/k)', () => {
  // KDP は 151〜300 頁の本に 0.5"(12.700mm) 以上の内側マージンを要求する。
  // 既定の 15mm では余裕が 2.3mm しかなく、章扉のような**大きな中央寄せ文字**の
  // ページで「内側マージンが不十分です」を出された (2026-10-01 実測、指摘ページ=章扉)。
  // ペーパーバックは 20mm で組み直すが、1 ページでも渡し忘れるとそのページだけ
  // 15mm のまま残り、いつまでも承認できない。全ページを機械的に検証する。
  /**
   * ページを描く自前コンポーネント (名前が Page/Pages で終わるもの) を
   * **名前で**集める。`sidePad` が付いているものだけを集めると、渡し忘れた
   * コンポーネントが素通りして検証にならないため。
   */
  function collectPageComponents(
    node: unknown,
    out: Array<{ name: string; sidePad: unknown }> = [],
  ): Array<{ name: string; sidePad: unknown }> {
    if (node == null || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      for (const child of node) collectPageComponents(child, out);
      return out;
    }
    const el = node as { type?: unknown; props?: Record<string, unknown> };
    const name = typeof el.type === 'function' ? ((el.type as { name?: string }).name ?? '') : '';
    if (/Pages?$/.test(name) && el.props) {
      out.push({ name, sidePad: el.props.sidePad });
    }
    if (el.props) collectPageComponents(el.props.children, out);
    return out;
  }

  const chapters = [
    { index: 1, heading: 'はじめに', body_md: 'ほんぶん。'.repeat(40) },
    { index: 2, heading: '第1章 テスト', body_md: 'ほんぶん。'.repeat(40) },
  ];

  it('sideMarginMm を渡すと全ページコンポーネントに行き渡る', () => {
    const doc = buildBookDocument({ title: 'タイトル', subtitle: 'サブ' }, chapters, {
      sideMarginMm: 20,
    });
    const nodes = collectPageComponents(doc);
    // 扉 / 目次 / 章扉 / 本文 がそろっていること (集計漏れで素通りしないための下限)
    expect(nodes.map((n) => n.name)).toContain('TitlePage');
    expect(nodes.length).toBeGreaterThanOrEqual(4);
    const expected = (20 * 72) / 25.4;
    for (const n of nodes) {
      const pad = n.sidePad as { paddingLeft?: number; paddingRight?: number } | undefined;
      expect(pad, `${n.name} に sidePad が渡っていない`).toBeTruthy();
      expect(pad!.paddingLeft).toBeCloseTo(expected, 2);
      expect(pad!.paddingRight).toBeCloseTo(expected, 2);
    }
  });

  it('sideMarginMm を渡さなければ既定 (15mm) のまま', () => {
    const doc = buildBookDocument({ title: 'タイトル', subtitle: null }, chapters, {});
    const nodes = collectPageComponents(doc);
    expect(nodes.length).toBeGreaterThanOrEqual(4);
    for (const n of nodes) expect(n.sidePad).toBeUndefined();
  });
});
