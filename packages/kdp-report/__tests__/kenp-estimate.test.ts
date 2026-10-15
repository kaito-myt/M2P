import { describe, expect, it } from 'vitest';

import { deriveKenpRate, deriveKenpRateFromRecords, normalizeKdpRows, resolveKenpRate, type KdpReportRow } from '../src/index.js';

/**
 * 2026-10-15 実測の再現 (docs/09 §KENP 当月推計)。
 * KDP ダッシュボード「今月」= 推計ロイヤリティ ¥3,211 / 注文 7 / 既読KENPC 2,770。
 * 旧実装は当月の概要サマリが無く、KENP 収益が丸ごと ¥0 (印税 ¥1,708) になっていた。
 */
const PAID_ROYALTY_TOTAL = 1708;
const KENP_PAGES = [873, 456, 272, ...Array<number>(20).fill(55), 69]; // 24 冊・合計 2,770

function octoberRows(): KdpReportRow[] {
  const rows: KdpReportRow[] = [];
  KENP_PAGES.forEach((pages, i) => {
    const asin = `B0TEST${String(i).padStart(4, '0')}`;
    rows.push({ asin, month: '2026-10', units_sold: 0, kenp_read: pages, royalty: 0, royalty_kind: 'kenp' });
  });
  // 有料販売: 5 冊 × 2 部 (合計 ¥1,708)
  [400, 400, 300, 300, 308].forEach((royalty, i) => {
    rows.push({
      asin: `B0TEST${String(i + 3).padStart(4, '0')}`,
      month: '2026-10',
      units_sold: 2,
      kenp_read: 0,
      royalty,
      currency: 'JPY',
      royalty_kind: 'paid',
    });
  });
  return rows;
}

/** 9 月 (確定月): 明細に KENP 金額あり。実効レート = 5,426 ÷ 10,000 = 0.5426 円/頁。 */
function septemberRows(): KdpReportRow[] {
  return [
    { asin: 'B0TEST0000', month: '2026-09', units_sold: 0, kenp_read: 6000, royalty: 3256, currency: 'JPY', royalty_kind: 'kenp' },
    { asin: 'B0TEST0001', month: '2026-09', units_sold: 0, kenp_read: 4000, royalty: 2170, currency: 'JPY', royalty_kind: 'kenp' },
  ];
}

describe('normalizeKdpRows: 当月 KENP 推計 (概要サマリ無し)', () => {
  it('確定月 (明細に KENP 金額) のレートで当月を推計し、¥1,708 → ¥3,211 になる', () => {
    const res = normalizeKdpRows([...septemberRows(), ...octoberRows()], { targetMonth: '2026-10' });

    expect(res.totals.kenp_read).toBe(2770);
    expect(res.totals.units_sold).toBe(10);
    expect(res.kenpRateUsed).toMatchObject({ month: '2026-09', jpyPerPage: 0.5426 });
    expect(res.estimatedKenpRoyaltyJpy).toBe(1503);
    expect(res.totals.royalty_jpy).toBe(PAID_ROYALTY_TOTAL + 1503); // 3,211
    // 内訳: 推計分は royalty_jpy の内数。確定 KENP 金額は 0
    const est = res.rows.reduce((t, r) => t + r.kenp_royalty_estimated_jpy, 0);
    expect(est).toBe(1503);
    expect(res.rows.every((r) => r.kenp_royalty_jpy === 0)).toBe(true);
    // 競馬本 873 頁は印税 0 ではなくなる
    const keiba = res.rows.find((r) => r.kenp_read === 873);
    expect(keiba?.kenp_royalty_estimated_jpy).toBeGreaterThanOrEqual(473); // 873 × 0.5426 ≒ 473.7
  });

  it('呼び出し側 (DB) が渡した kenpRate でも推計できる', () => {
    const res = normalizeKdpRows(octoberRows(), {
      targetMonth: '2026-10',
      kenpRate: { month: '2026-09', jpyPerPage: 0.5426 },
    });
    expect(res.totals.royalty_jpy).toBe(3211);
    expect(res.estimatedKenpRoyaltyJpy).toBe(1503);
  });

  it('概要サマリがある月は按分 (確定) を使い、推計しない', () => {
    const res = normalizeKdpRows(octoberRows(), {
      targetMonth: '2026-10',
      monthlySummaries: [{ month: '2026-10', kenp_read: 2770, royalty_jpy: 3300 }],
      kenpRate: { month: '2026-09', jpyPerPage: 0.5426 },
    });
    expect(res.allocatedKenpRoyaltyJpy).toBe(3300 - PAID_ROYALTY_TOTAL);
    expect(res.estimatedKenpRoyaltyJpy).toBe(0);
    expect(res.kenpRateUsed).toBeNull();
    expect(res.totals.royalty_jpy).toBe(3300);
    expect(res.rows.every((r) => r.kenp_royalty_estimated_jpy === 0)).toBe(true);
    expect(res.rows.reduce((t, r) => t + r.kenp_royalty_jpy, 0)).toBe(3300 - PAID_ROYALTY_TOTAL);
  });

  it('確定月が 1 つも無ければ推計しない (既定レートを置かない・従来どおり ¥0)', () => {
    const res = normalizeKdpRows(octoberRows(), { targetMonth: '2026-10' });
    expect(res.kenpRateUsed).toBeNull();
    expect(res.estimatedKenpRoyaltyJpy).toBe(0);
    expect(res.totals.royalty_jpy).toBe(PAID_ROYALTY_TOTAL);
    expect(res.totals.kenp_read).toBe(2770);
  });

  it('確定月が当月以降のみ (前月が無い) なら推計しない', () => {
    const res = normalizeKdpRows(octoberRows(), {
      targetMonth: '2026-10',
      kenpRate: { month: '2026-10', jpyPerPage: 0.5 },
    });
    expect(res.estimatedKenpRoyaltyJpy).toBe(0);
  });

  it('概要サマリのある確定月 (Estimator) からもレートを導出できる', () => {
    const res = normalizeKdpRows(
      [
        { asin: 'B0TEST0000', month: '2026-09', units_sold: 0, kenp_read: 10000, royalty: 0, royalty_kind: 'kenp' },
        ...octoberRows(),
      ],
      { targetMonth: '2026-10', monthlySummaries: [{ month: '2026-09', kenp_read: 10000, royalty_jpy: 5426 }] },
    );
    expect(res.kenpRateUsed?.month).toBe('2026-09');
    expect(res.totals.royalty_jpy).toBe(3211);
  });

  it('レポートの他の確定月より DB のレートの方が新しければそちらを採用する', () => {
    const res = normalizeKdpRows([...septemberRows(), ...octoberRows()], {
      targetMonth: '2026-11',
      kenpRate: { month: '2026-10', jpyPerPage: 1 },
      noEstimate: false,
    });
    // 2026-11 の行は無いので推計対象ページ 0 → 推計なし
    expect(res.estimatedKenpRoyaltyJpy).toBe(0);
  });
});

describe('deriveKenpRate', () => {
  it('対象月より前で最新の確定月の 収益÷ページ数 を返す', () => {
    const rate = deriveKenpRate(
      [
        { month: '2026-07', kenp_read: 1000, kenp_royalty_jpy: 400 },
        { month: '2026-09', kenp_read: 10000, kenp_royalty_jpy: 5426 },
        { month: '2026-10', kenp_read: 2770, kenp_royalty_jpy: 1 },
      ],
      '2026-10',
    );
    expect(rate).toMatchObject({ month: '2026-09', jpyPerPage: 0.5426 });
  });

  it('収益 0 / ページ 0 の月は根拠にしない。無ければ null', () => {
    expect(
      deriveKenpRate(
        [
          { month: '2026-09', kenp_read: 5000, kenp_royalty_jpy: 0 },
          { month: '2026-08', kenp_read: 0, kenp_royalty_jpy: 100 },
        ],
        '2026-10',
      ),
    ).toBeNull();
    expect(deriveKenpRate([], '2026-10')).toBeNull();
  });
});

describe('deriveKenpRate: 妥当性ガード (NG1)', () => {
  it('レートが妥当帯 (0.1〜2.0 円/頁) の外なら採用せず null (架空売上を作らない)', () => {
    // 1 頁 × ¥5,000 = 5,000 円/頁 → 当月 2,770 頁で ¥13,850,000 になる事故の再現
    expect(deriveKenpRateFromRecords([{ year_month: '2026-09', kenp_read: 1, kenp_royalty_jpy: 5000 }], '2026-10')).toBeNull();
    expect(deriveKenpRate([{ month: '2026-09', kenp_read: 10000, kenp_royalty_jpy: 500 }], '2026-10')).toBeNull(); // 0.05
    expect(deriveKenpRate([{ month: '2026-09', kenp_read: 1000, kenp_royalty_jpy: 2500 }], '2026-10')).toBeNull(); // 2.5
  });

  it('帯外の最新月をスキップして前々月を採用する', () => {
    const rate = deriveKenpRate(
      [
        { month: '2026-08', kenp_read: 5000, kenp_royalty_jpy: 1855 }, // 0.371 (実測 6 月相当)
        { month: '2026-09', kenp_read: 3000, kenp_royalty_jpy: 30000 }, // 10 円/頁 → 帯外
      ],
      '2026-10',
    );
    expect(rate).toMatchObject({ month: '2026-08', jpyPerPage: 0.371 });
  });

  it('ページ数が下限 (100 頁) 未満の月は不採用', () => {
    expect(deriveKenpRate([{ month: '2026-09', kenp_read: 99, kenp_royalty_jpy: 50 }], '2026-10')).toBeNull();
    expect(deriveKenpRate([{ month: '2026-09', kenp_read: 100, kenp_royalty_jpy: 50 }], '2026-10')).toMatchObject({
      jpyPerPage: 0.5,
    });
  });

  it('按分由来の月より、明細に KENP 金額がある月を優先する (より古くても)', () => {
    const rate = deriveKenpRate(
      [
        { month: '2026-08', kenp_read: 5000, kenp_royalty_jpy: 1855, basis: 'detail' },
        { month: '2026-09', kenp_read: 5000, kenp_royalty_jpy: 4000, basis: 'allocated' },
      ],
      '2026-10',
    );
    expect(rate).toMatchObject({ month: '2026-08', basis: 'detail' });
    // 明細月が無ければ按分由来を使う
    expect(
      deriveKenpRate([{ month: '2026-09', kenp_read: 5000, kenp_royalty_jpy: 4000, basis: 'allocated' }], '2026-10'),
    ).toMatchObject({ month: '2026-09', basis: 'allocated' });
  });

  it('DB 行: manual_estimate (Estimator 取込) の月は按分由来として劣後する', () => {
    const rate = deriveKenpRateFromRecords(
      [
        { year_month: '2026-08', kenp_read: 5000, kenp_royalty_jpy: 1855, source: 'auto' },
        { year_month: '2026-09', kenp_read: 5000, kenp_royalty_jpy: 4000, source: 'manual_estimate' },
      ],
      '2026-10',
    );
    expect(rate?.month).toBe('2026-08');
  });

  it('帯外レートのレポート内確定月では推計しない (normalize 経由)', () => {
    const res = normalizeKdpRows(
      [
        { asin: 'B0TEST0000', month: '2026-09', units_sold: 0, kenp_read: 1, royalty: 5000, currency: 'JPY', royalty_kind: 'kenp' },
        ...octoberRows(),
      ],
      { targetMonth: '2026-10' },
    );
    expect(res.estimatedKenpRoyaltyJpy).toBe(0);
    expect(res.totals.royalty_jpy).toBe(PAID_ROYALTY_TOTAL);
  });
});

describe('帯ガードの強制 (given 経路 / 上限 1.0 / 相対チェック)', () => {
  it('kenpRate に 5,000 円/頁 を直接渡しても推計 0 (帯外の given は無視)', () => {
    const res = normalizeKdpRows(octoberRows(), {
      targetMonth: '2026-10',
      kenpRate: { month: '2026-09', jpyPerPage: 5000 },
    });
    expect(res.estimatedKenpRoyaltyJpy).toBe(0);
    expect(res.kenpRateUsed).toBeNull();
    expect(res.totals.royalty_jpy).toBe(PAID_ROYALTY_TOTAL);
  });

  it('帯外の given は無視して、レポート内の確定月 (fromReport) にフォールバックする', () => {
    const res = normalizeKdpRows([...septemberRows(), ...octoberRows()], {
      targetMonth: '2026-10',
      kenpRate: { month: '2026-09', jpyPerPage: 5000 },
    });
    expect(res.kenpRateUsed).toMatchObject({ month: '2026-09', jpyPerPage: 0.5426 });
    expect(res.totals.royalty_jpy).toBe(3211);
  });

  it('上限は 1.0 円/頁 (1.5 は不採用)', () => {
    expect(deriveKenpRate([{ month: '2026-09', kenp_read: 1000, kenp_royalty_jpy: 1500 }], '2026-10')).toBeNull();
    expect(deriveKenpRate([{ month: '2026-09', kenp_read: 1000, kenp_royalty_jpy: 1000 }], '2026-10')).toMatchObject({
      jpyPerPage: 1,
    });
  });

  it('他の確定月の最小レートの 3 倍超は不採用 (按分への PB 混入を吸収)', () => {
    const rate = deriveKenpRate(
      [
        { month: '2026-08', kenp_read: 5000, kenp_royalty_jpy: 1500, basis: 'allocated' }, // 0.3
        { month: '2026-09', kenp_read: 5000, kenp_royalty_jpy: 4500, basis: 'allocated' }, // 0.9 = 3 倍超
      ],
      '2026-10',
    );
    expect(rate).toMatchObject({ month: '2026-08' });
  });

  it('given は当月以降の月を根拠にしない・3 倍以内なら採用される', () => {
    const res = normalizeKdpRows([...septemberRows(), ...octoberRows()], {
      targetMonth: '2026-10',
      kenpRate: { month: '2026-09', jpyPerPage: 0.9, basis: 'detail' },
    });
    // 0.9 は 0.5426 の 1.66 倍 → 3 倍以内なので given (同月・同優先) が通る。比較の健全性のみ確認
    expect(res.estimatedKenpRoyaltyJpy).toBeGreaterThan(0);
    const res2 = normalizeKdpRows([...septemberRows(), ...octoberRows()], {
      targetMonth: '2026-10',
      kenpRate: { month: '2026-10', jpyPerPage: 0.9 },
    });
    expect(res2.kenpRateUsed?.month).toBe('2026-09'); // 当月以降の given は不採用
  });
});

describe('resolveKenpRate: 運営者設定レート (導出できないときのフォールバック)', () => {
  it('確定月から導出できればそれを優先し、設定値は使わない', () => {
    const derived = { month: '2026-09', jpyPerPage: 0.5, basis: 'detail' as const };
    expect(resolveKenpRate(derived, 0.9)).toBe(derived);
  });

  it('導出できなければ設定値 (帯内) を使う。basis=setting', () => {
    expect(resolveKenpRate(null, 0.5426)).toEqual({ month: '', jpyPerPage: 0.5426, basis: 'setting' });
  });

  it('設定値も帯ガードを通す: 帯外 / 未設定 / NaN は null (推計しない)', () => {
    expect(resolveKenpRate(null, 5000)).toBeNull();
    expect(resolveKenpRate(null, 0.05)).toBeNull();
    expect(resolveKenpRate(null, null)).toBeNull();
    expect(resolveKenpRate(null, Number.NaN)).toBeNull();
  });

  it('設定レートで 2026-10 の ¥1,708 → ¥3,211 になる。推計扱い (確定 KENP 金額は 0)', () => {
    const res = normalizeKdpRows(octoberRows(), {
      targetMonth: '2026-10',
      kenpRate: resolveKenpRate(null, 0.5426),
    });
    expect(res.totals.royalty_jpy).toBe(3211);
    expect(res.estimatedKenpRoyaltyJpy).toBe(1503);
    expect(res.rows.every((r) => r.kenp_royalty_jpy === 0)).toBe(true);
    expect(res.kenpRateUsed?.basis).toBe('setting');
  });

  it('設定レートよりレポート内の確定月 (明細金額) を優先する', () => {
    const res = normalizeKdpRows([...septemberRows(), ...octoberRows()], {
      targetMonth: '2026-10',
      kenpRate: resolveKenpRate(null, 0.9),
    });
    expect(res.kenpRateUsed).toMatchObject({ month: '2026-09', basis: 'detail' });
  });
});
