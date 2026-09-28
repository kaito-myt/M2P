import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  isTableSeparator,
  parseMarkdownTable,
  renderTableImage,
  splitTableSegments,
  tableImageAlt,
  tableToPlainText,
} from '../src/render-table-image.js';

const LF = String.fromCharCode(10);

const TABLE_MD = [
  '| 頭数帯 | レース数（n） | 的中率 | 単勝回収率 |',
  '|---|---:|---:|---:|',
  '| 7〜9頭 | 1,842 | 61.4% | 89.7% |',
  '| 10〜12頭 | 2,915 | 54.8% | 92.3% |',
].join(LF);

describe('parseMarkdownTable (F-ANP-48)', () => {
  it('ヘッダ・行・寄せを読み取る', () => {
    const t = parseMarkdownTable(TABLE_MD);
    expect(t).not.toBeNull();
    expect(t!.header).toEqual(['頭数帯', 'レース数（n）', '的中率', '単勝回収率']);
    expect(t!.rows).toHaveLength(2);
    expect(t!.rows[0]).toEqual(['7〜9頭', '1,842', '61.4%', '89.7%']);
    expect(t!.align[0]).toBe('left');
    expect(t!.align[1]).toBe('right');
  });

  it('寄せ指定が無くても中身が数値の列は右寄せにする', () => {
    const md = ['| 項目 | 件数 |', '|---|---|', '| A | 12 |', '| B | 340 |'].join(LF);
    const t = parseMarkdownTable(md);
    expect(t!.align[0]).toBe('left');
    expect(t!.align[1]).toBe('right');
  });

  it('列数がずれた行も列数に揃える', () => {
    const md = ['| a | b | c |', '|---|---|---|', '| 1 | 2 |', '| 1 | 2 | 3 | 4 |'].join(LF);
    const t = parseMarkdownTable(md);
    expect(t!.rows[0]).toEqual(['1', '2', '']);
    expect(t!.rows[1]).toEqual(['1', '2', '3']);
  });

  it('セル内の Markdown 装飾は落とす', () => {
    const md = ['| 名前 | 値 |', '|---|---|', '| **太字** | `12%` |'].join(LF);
    expect(parseMarkdownTable(md)!.rows[0]).toEqual(['太字', '12%']);
  });

  it('表でないものは null', () => {
    expect(parseMarkdownTable('ただの段落です。')).toBeNull();
    expect(parseMarkdownTable(['| a | b |', '本文'].join(LF))).toBeNull();
    // 区切り行だけで本文行が無い
    expect(parseMarkdownTable(['| a | b |', '|---|---|'].join(LF))).toBeNull();
  });

  it('isTableSeparator', () => {
    expect(isTableSeparator('|---|---|')).toBe(true);
    expect(isTableSeparator('| :--- | ---: |')).toBe(true);
    expect(isTableSeparator('---')).toBe(false);
    expect(isTableSeparator('| a | b |')).toBe(false);
  });
});

describe('splitTableSegments', () => {
  it('前後の本文と表を分ける', () => {
    const body = ['# 見出し', '', '本文です。', '', TABLE_MD, '', 'あとがき。'].join(LF);
    const segs = splitTableSegments(body);
    expect(segs.map((s) => s.kind)).toEqual(['text', 'table', 'text']);
    expect(segs[0]!.text).toContain('本文です。');
    expect(segs[2]!.text).toBe('あとがき。');
  });

  it('空行が無くても表を切り出せる', () => {
    const body = ['直前の文', TABLE_MD, '直後の文'].join(LF);
    const segs = splitTableSegments(body);
    expect(segs.map((s) => s.kind)).toEqual(['text', 'table', 'text']);
    expect(segs[1]!.text.split(LF)).toHaveLength(4);
  });

  it('表が無ければ 1 つの text', () => {
    const segs = splitTableSegments(['a', '', 'b'].join(LF));
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe('text');
  });
});

describe('tableToPlainText', () => {
  it('パイプ記号を一切残さない (画像化に失敗したときの代替)', () => {
    const text = tableToPlainText(parseMarkdownTable(TABLE_MD)!);
    expect(text).not.toContain('|');
    expect(text).not.toContain('---');
    expect(text).toContain('7〜9頭：');
    expect(text).toContain('的中率 61.4%');
  });
});

describe('renderTableImage', () => {
  it('表らしい大きさの PNG を返す', async () => {
    const png = await renderTableImage(parseMarkdownTable(TABLE_MD)!, { accent: '#0e1a33' });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeGreaterThanOrEqual(700);
    expect(meta.width).toBeLessThanOrEqual(1280);
    expect(meta.height).toBeGreaterThan(100);
  });

  it('列が多く長文でも最大幅を超えない', async () => {
    const md = [
      '| ' + ['項目', '説明', '根拠', '判断', '備考'].join(' | ') + ' |',
      '|---|---|---|---|---|',
      '| ' + Array.from({ length: 5 }, () => 'あ'.repeat(30)).join(' | ') + ' |',
    ].join(LF);
    const png = await renderTableImage(parseMarkdownTable(md)!);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBeLessThanOrEqual(1280);
  });

  it('alt はヘッダを含み 120 字以内', () => {
    const alt = tableImageAlt(parseMarkdownTable(TABLE_MD)!);
    expect(alt).toContain('頭数帯');
    expect(alt.length).toBeLessThanOrEqual(120);
  });
});
