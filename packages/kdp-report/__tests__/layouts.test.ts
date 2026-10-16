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

describe('統合シート: 実測の種類値「該当なし」と部数内訳の診断', () => {
  it('KENP 行の種類=該当なし・収益=0 を KENP 行として読み、unitsBreakdown に 注文/払い戻し/採用値 を残す', () => {
    const b = XLSX.utils.book_new();
    const meta = ['販売期間', '10月 2026'];
    const row = (a: number, orders: number, refunds: number, net: number, type: string, rev: number) =>
      ['t', 'a', asin(a), MP, orders, refunds, net, type, 'x', 'JPY', '', '', '', '', rev];
    XLSX.utils.book_append_sheet(
      b,
      XLSX.utils.aoa_to_sheet([
        meta,
        TOTAL_HEAD.map((h) => (h === '払い戻し数' ? '払い戻し数' : h)),
        row(1, 4, 1, 3, '70%', 900), // 注文 4 / 払い戻し 1 / 実質 3
        row(2, 3, 1, 2, '35%', 400),
        row(3, 0, 0, 459, '該当なし', 0),
      ]),
      '総収益',
    );
    const parsed = parseKdpReportWorkbook(XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    const d = parsed.sheetDiagnostics.find((x) => x.name === '総収益')!;
    expect(d.typeValues).toEqual({ '70%': 1, '35%': 1, 該当なし: 1 });
    expect(d.unitsBreakdown).toEqual({ orders: 7, refunds: 2, net: 5, ordersAll: 7, paidRows: 2 });
    const norm = normalizeKdpRows(parsed.rows, { targetMonth: '2026-10' });
    expect(norm.totals).toMatchObject({ units_sold: 5, kenp_read: 459, royalty_jpy: 1300 });
  });
});

/**
 * ペーパーバックのロイヤリティが丸ごと欠落していた回帰テスト (docs/09 §10.9)。
 *
 * 2026-09 実績: KDP ダッシュボード上は
 *   電子書籍 ¥1,230 / ペーパーバック ¥1,942 / ハードカバー ¥0 / KENP ¥1,649 = 合計 ¥4,821
 * なのに、我々の取込は ¥1,230 + KENP だけでペーパーバックが ¥0 だった。
 *
 * 原因は 2 つとも「ペーパーバックのロイヤリティ」シートの ID 列にあった:
 *   1. このシートは ISBN(左) と ASIN(右) の **両方**を持つのに、先に出る ISBN を採っていた
 *   2. ISBN は 13 桁なので `looksLikeBookId` の 10 桁判定に落ち、**全行がフッタ扱いで捨てられた**
 * さらに統合シート (総収益) があると**シートごと**除外していたため、仮に 1・2 を直しても消えた。
 */
const PB_HEAD = [
  'タイトル', '著者', 'ISBN', 'マーケットプレイス', '注文数', '払い戻し数', 'ロイヤリティの種類',
  '平均希望小売価格 (税別)', '平均販売価格 (税別)', '平均製造コスト', 'ロイヤリティ', '通貨', 'ASIN',
];
const pbIsbn = (i: number) => `979${String(i).padStart(10, '0')}`;
const pbAsin = (i: number) => `B0P${String(i).padStart(7, '0')}`;

describe('ペーパーバックのロイヤリティ', () => {
  function withPaperback(month: string, pb: Array<{ units: number; royalty: number }>): Buffer {
    const b = XLSX.utils.book_new();
    const meta = ['販売期間', month];
    const paidRows = [['t', 'a', asin(0), MP, 3, 0, 3, '70%', '標準', 'JPY', '', '', '', '', 1230]];
    const kenpRows = [['t', 'a', asin(0), MP, 0, 0, 5042, 'Kindle Unlimited', 'KENP', 'JPY', '', '', '', '', 1649]];
    const pbRows = pb.map((p, i) => [
      't', 'a', pbIsbn(i), MP, p.units, 0, '60%', 1480, 1480, 500, p.royalty, 'JPY', pbAsin(i),
    ]);
    const add = (name: string, aoa: unknown[][]) =>
      XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(aoa), name);
    add('電子書籍のロイヤリティ', [meta, EBOOK_HEAD, ...paidRows]);
    add('既読 KENPC', [meta, KENPC_HEAD, ['t', 'a', asin(0), MP, 5042]]);
    add('ペーパーバックのロイヤリティ', [meta, PB_HEAD, ...pbRows]);
    add('総収益', [meta, TOTAL_HEAD, ...paidRows, ...kenpRows]);
    return XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  const pb = [
    { units: 2, royalty: 800 },
    { units: 2, royalty: 742 },
    { units: 1, royalty: 400 },
  ]; // 合計 5 部 / ¥1,942

  it('ISBN ではなく ASIN 列を ID に採り、全行を取り込む', () => {
    const parsed = parseKdpReportWorkbook(withPaperback('9月 2026', pb));
    const d = parsed.sheetDiagnostics.find((x) => x.name === 'ペーパーバックのロイヤリティ')!;
    expect(d.columns.asin).toBe(12); // ISBN(2) ではなく ASIN(12)
    expect(d.rowsEmitted).toBe(3);
    expect(d.sums.royalty).toBe(1942);
  });

  it('統合シートがあってもペーパーバック行は残る (シートごと捨てない)', () => {
    const parsed = parseKdpReportWorkbook(withPaperback('9月 2026', pb));
    expect(parsed.layout).toBe('unified');
    const d = parsed.sheetDiagnostics.find((x) => x.name === 'ペーパーバックのロイヤリティ')!;
    expect(d.superseded).not.toBe(true);
    const pbRows = parsed.rows.filter((r) => r.asin.startsWith('B0P'));
    expect(pbRows).toHaveLength(3);
    // 電子書籍/KENPC シートは総収益と同じ ASIN なので従来どおり除外される
    const ebookDiag = parsed.sheetDiagnostics.find((x) => x.name === '電子書籍のロイヤリティ')!;
    expect(ebookDiag.superseded).toBe(true);
  });

  it('合計が KDP ダッシュボードの ¥4,821 と一致する', () => {
    const parsed = parseKdpReportWorkbook(withPaperback('9月 2026', pb));
    const n = normalizeKdpRows(parsed.rows, { targetMonth: '2026-09', noEstimate: true });
    expect(n.totals.royalty_jpy).toBe(1230 + 1649 + 1942);
    expect(n.totals.units_sold).toBe(3 + 5);
    expect(n.totals.kenp_read).toBe(5042);
  });
});
