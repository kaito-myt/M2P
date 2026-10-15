import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { normalizeKdpRows, parseKdpReportWorkbook } from '../src/index.js';

/**
 * 実レポートの 2 構成を固定する (docs/09 §10.4 / §10.6)。
 *  - 4 シート構成 (電子書籍 / 既読 KENPC / ペーパーバック / 総収益): 2026-10 本番ログの sheetDiagnostics を再現した合成データ。
 *    「総収益」だけを正とし、他シートは重複なので集計しない。
 *  - 従来の 2 シート構成: scripts/.kdp-captures の実物 (6・7 月分。無ければ skip) + 合成。
 */
const EBOOK_HEAD = ['タイトル', '著者', 'ASIN', 'マーケットプレイス', '注文数', '払い戻し数', '実質注文数', 'ロイヤリティの種類', 'コンテンツ区分', '通貨', '', '', '', '', 'ロイヤリティ'];
const TOTAL_HEAD = ['タイトル', '著者', 'ASIN', 'マーケットプレイス', '注文数', '払い戻し数', '実質販売件数または既読 KENP', 'ロイヤリティの種類', '支払いプラン', '通貨', '', '', '', '', '収益'];
const KENPC_HEAD = ['タイトル', '著者', 'ASIN', 'マーケットプレイス', '既読 KENP (Kindle Edition Normalized Pages)', '', ''];

const asin = (i: number) => `B0S${String(i).padStart(7, '0')}`;
const MP = 'Amazon.co.jp';

interface Paid {
  units: number;
  royalty: number;
}

function fourSheet(month: string, paid: Paid[], pages: number[], kenpRate: number | null): { buf: Buffer; kenpRevenue: number } {
  const b = XLSX.utils.book_new();
  const meta = ['販売期間', month];
  const paidRows = paid.map((p, i) => ['t', 'a', asin(i), MP, p.units, 0, p.units, '70%', '標準', 'JPY', '', '', '', '', p.royalty]);
  const kenpRows = pages.map((p, i) => ['t', 'a', asin(i), MP, p]);
  let kenpRevenue = 0;
  const totalKenp = pages.map((p, i) => {
    const rev = kenpRate === null ? '' : Math.round(p * kenpRate);
    if (kenpRate !== null) kenpRevenue += Math.round(p * kenpRate);
    return ['t', 'a', asin(i), MP, 0, 0, p, 'Kindle Unlimited', 'KENP', 'JPY', '', '', '', '', rev];
  });
  const add = (name: string, aoa: unknown[][]) => XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(aoa), name);
  add('電子書籍のロイヤリティ', [meta, EBOOK_HEAD, ...paidRows]);
  add('既読 KENPC', [meta, KENPC_HEAD, ...kenpRows]);
  add('ペーパーバックのロイヤリティ', [meta, EBOOK_HEAD]);
  add('総収益', [meta, TOTAL_HEAD, ...paidRows, ...totalKenp]);
  return { buf: XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }) as Buffer, kenpRevenue };
}

describe('4 シート構成 (統合シート「総収益」を正とする)', () => {
  // 2026-09 本番ログの再現: 電子書籍 7 行 (部数 18 / ¥1,230)・KENP 35 冊 5,045 頁
  const paid: Paid[] = [
    { units: 3, royalty: 300 }, { units: 3, royalty: 200 }, { units: 3, royalty: 200 },
    { units: 3, royalty: 200 }, { units: 2, royalty: 150 }, { units: 2, royalty: 100 }, { units: 2, royalty: 80 },
  ];
  const pages = [...Array<number>(34).fill(144), 149]; // 合計 5,045

  it('2026-09: 部数 18 / ページ 5,045 / 有料 ¥1,230 + KENP 収益。二重計上しない', () => {
    expect(paid.reduce((t, p) => t + p.units, 0)).toBe(18);
    expect(paid.reduce((t, p) => t + p.royalty, 0)).toBe(1230);
    expect(pages.reduce((t, p) => t + p, 0)).toBe(5045);
    const { buf, kenpRevenue } = fourSheet('9月 2026', paid, pages, 0.54);
    const parsed = parseKdpReportWorkbook(buf);
    expect(parsed.layout).toBe('unified');
    const sup = Object.fromEntries(parsed.sheetDiagnostics.map((d) => [d.name, d.superseded === true]));
    expect(sup['電子書籍のロイヤリティ']).toBe(true);
    expect(sup['既読 KENPC']).toBe(true);
    expect(sup['総収益']).toBe(false);
    const norm = normalizeKdpRows(parsed.rows, { targetMonth: '2026-09', monthlySummaries: parsed.monthlySummaries });
    expect(norm.totals.units_sold).toBe(18);
    expect(norm.totals.kenp_read).toBe(5045);
    expect(norm.totals.royalty_jpy).toBe(1230 + kenpRevenue);
    expect(kenpRevenue).toBeGreaterThan(2600);
    // 確定月: KENP 金額が明細にある → 推計しない
    expect(norm.estimatedKenpRoyaltyJpy).toBe(0);
    expect(norm.rows.reduce((t, r) => t + r.kenp_royalty_jpy, 0)).toBe(kenpRevenue);
    const unified = parsed.sheetDiagnostics.find((d) => d.name === '総収益')!;
    expect(unified.typeValues).toEqual({ '70%': 7, 'Kindle Unlimited': 35 });
    expect(unified.columns.royalty).toBe(14);
  });

  it('2026-10 (当月): 注文 7 / KENPC 2,770 / KENP 金額空 → 確定月レートで ¥3,211', () => {
    const paid10: Paid[] = [
      { units: 2, royalty: 400 }, { units: 2, royalty: 400 }, { units: 1, royalty: 300 },
      { units: 1, royalty: 300 }, { units: 1, royalty: 308 },
    ];
    const pages10 = [873, 456, 272, ...Array<number>(20).fill(55), 69];
    const { buf } = fourSheet('10月 2026', paid10, pages10, null);
    const parsed = parseKdpReportWorkbook(buf);
    const norm = normalizeKdpRows(parsed.rows, {
      targetMonth: '2026-10',
      kenpRate: { month: '2026-09', jpyPerPage: 0.5426 },
    });
    expect(norm.totals.units_sold).toBe(7); // 二重計上の旧実装は 14
    expect(norm.totals.kenp_read).toBe(2770);
    expect(norm.totals.royalty_jpy).toBe(1708 + 1503);
    expect(norm.estimatedKenpRoyaltyJpy).toBe(1503);
  });

  it('有料行の部数をページ数として読まない (実質販売件数または既読 KENP 列の切替)', () => {
    const { buf } = fourSheet('9月 2026', [{ units: 5, royalty: 500 }], [], null);
    const parsed = parseKdpReportWorkbook(buf);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ units_sold: 5, kenp_read: 0, royalty_kind: 'paid', royalty: 500 });
  });
});

describe('従来の 2 シート構成 (回帰)', () => {
  it('合成: 電子書籍 + 既読 KENPC(金額列あり) を全シート集計する (layout=legacy)', () => {
    const b = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      b,
      XLSX.utils.aoa_to_sheet([['販売期間', '6月 2026'], EBOOK_HEAD, ['t', 'a', asin(1), MP, 1, 0, 1, '70%', '標準', 'JPY', '', '', '', '', 279]]),
      '電子書籍のロイヤリティ',
    );
    XLSX.utils.book_append_sheet(
      b,
      XLSX.utils.aoa_to_sheet([['販売期間', '6月 2026'], [...KENPC_HEAD.slice(0, 5), 'ロイヤリティ', '通貨'], ['t', 'a', asin(1), MP, 145, 54.01, 'JPY']]),
      '既読 KENPC',
    );
    const parsed = parseKdpReportWorkbook(XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(parsed.layout).toBe('legacy');
    const norm = normalizeKdpRows(parsed.rows, { targetMonth: '2026-06' });
    expect(norm.totals).toEqual({ royalty_jpy: 333, units_sold: 1, kenp_read: 145 });
  });

  const dir = path.resolve(__dirname, '../../../scripts/.kdp-captures');
  const find = (m: string): string | undefined =>
    fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.includes(`${m}-01`) && f.endsWith('.xlsx')) : undefined;
  const june = find('2026-06');
  const july = find('2026-07');

  it.skipIf(!june)('実物 2026-06 (過去月): legacy・KENP 金額列あり → 確定 KENP 収益が取れる', () => {
    const parsed = parseKdpReportWorkbook(fs.readFileSync(path.join(dir, june!)));
    expect(parsed.layout).toBe('legacy');
    const norm = normalizeKdpRows(parsed.rows, { targetMonth: '2026-06' });
    expect(norm.rows.reduce((t, r) => t + r.kenp_royalty_jpy, 0)).toBeGreaterThan(0);
    expect(norm.totals.kenp_read).toBeGreaterThan(0);
  });

  it.skipIf(!july)('実物 2026-07 (当月): legacy・KENP 金額なし → 従来どおり読める', () => {
    const parsed = parseKdpReportWorkbook(fs.readFileSync(path.join(dir, july!)));
    expect(parsed.layout).toBe('legacy');
    const norm = normalizeKdpRows(parsed.rows, { targetMonth: '2026-07' });
    expect(norm.totals.units_sold).toBe(1);
    expect(norm.totals.royalty_jpy).toBe(279);
    expect(norm.totals.kenp_read).toBeGreaterThan(0);
  });
});
