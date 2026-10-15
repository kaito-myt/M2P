import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { normalizeKdpRows, parseKdpReportWorkbook } from '../src/index.js';

/**
 * 診断出力の構造テスト。シート内容は実物ではなく合成 (実 4 シート構成の列は未確認。docs/09 §10.4)。
 */
function wb(sheets: Array<{ name: string; aoa: unknown[][] }>): Buffer {
  const b = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(s.aoa), s.name);
  return XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseKdpReportWorkbook: シート診断', () => {
  const buf = wb([
    {
      name: '電子書籍のロイヤリティ',
      aoa: [
        ['販売期間', '9月 2026'],
        ['タイトル', 'ASIN', 'マーケットプレイス', '実質注文数', 'ロイヤリティ', '通貨'],
        ['A', 'B0AAAAAAAA', 'Amazon.co.jp', 1, 300, 'JPY'],
        ['A', 'B0AAAAAAAA', 'Amazon.co.jp', 1, 200, 'JPY'],
      ],
    },
    {
      name: '既読 KENPC',
      aoa: [
        ['販売期間', '9月 2026'],
        ['タイトル', 'ASIN', 'マーケットプレイス', '既読 KENP (Kindle Edition Normalized Pages)'],
        ['A', 'B0AAAAAAAA', 'Amazon.co.jp', 500],
      ],
    },
    { name: '総収益', aoa: [['何か', '値'], ['x', 1]] },
  ]);

  it('シートごとの分類・列マップ・集計と、ヘッダ未検出シートを返す', () => {
    const res = parseKdpReportWorkbook(buf);
    const by = Object.fromEntries(res.sheetDiagnostics.map((d) => [d.name, d]));
    expect(by['電子書籍のロイヤリティ']).toMatchObject({ role: 'paid', rowsEmitted: 2, sums: { units: 2, royalty: 500 } });
    expect(by['既読 KENPC']).toMatchObject({ role: 'kenp', rowsEmitted: 1, sums: { kenp: 500 } });
    expect(by['既読 KENPC']!.columns.royalty).toBeUndefined(); // 金額列なし
    expect(by['総収益']).toMatchObject({ role: 'noheader' });
    expect(res.rows.every((r) => r.sheet)).toBe(true);
  });

  it('kenpDiagnostics: サマリ無し / 金額無しを区別できる', () => {
    const res = parseKdpReportWorkbook(buf);
    const norm = normalizeKdpRows(res.rows, { targetMonth: '2026-09', monthlySummaries: res.monthlySummaries });
    expect(norm.kenpDiagnostics).toMatchObject({
      kenpRoyaltyInDetail: false,
      summaryFound: false,
      pool: null,
      paidTotalJpy: 500,
      totalPages: 500,
    });
  });

  it('サマリがあり pool<=0 の場合は summaryFound=true, pool=0', () => {
    const res = parseKdpReportWorkbook(buf);
    const norm = normalizeKdpRows(res.rows, {
      targetMonth: '2026-09',
      monthlySummaries: [{ month: '2026-09', kenp_read: 500, royalty_jpy: 500 }],
    });
    expect(norm.kenpDiagnostics).toMatchObject({ summaryFound: true, summaryRoyaltyJpy: 500, pool: 0 });
  });
});
