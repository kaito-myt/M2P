import { describe, expect, it } from 'vitest';

import { PRODUCT_STATUSES } from '@a2p/contracts/tdp/status';

import {
  buildHero,
  buildLaunchChecklist,
  buildQuotaSummary,
  buildQuotaView,
  buildStatusRows,
  determineStage,
  totalCount,
  visibleChecklist,
} from '../home-core';
import { messages } from '../messages';
import { settingsFromRow } from '../tdp-settings';

describe('buildStatusRows', () => {
  it('0 件の状態も行として残す (ゲートが空いていることの確認になるため)', () => {
    const rows = buildStatusRows([{ status: 'planned', count: 3 }]);
    expect(rows).toHaveLength(PRODUCT_STATUSES.length);
    expect(rows.find((r) => r.status === 'planned')?.count).toBe(3);
    expect(rows.find((r) => r.status === 'review')?.count).toBe(0);
  });

  it('11 状態を正準順 (contracts と同一) で返し、approved / withdrawn を含む', () => {
    expect(PRODUCT_STATUSES).toHaveLength(11);
    const rows = buildStatusRows([
      { status: 'listed', count: 1 },
      { status: 'planned', count: 1 },
      { status: 'approved', count: 2 },
    ]);
    expect(rows.map((r) => r.status)).toEqual([...PRODUCT_STATUSES]);
    expect(rows.find((r) => r.status === 'withdrawn')?.count).toBe(0);
    expect(rows.find((r) => r.status === 'approved')?.count).toBe(2);
  });

  it('未知の status は末尾に残す (消すと合計が合わなくなる)', () => {
    const rows = buildStatusRows([{ status: 'zzz_unknown', count: 2 }]);
    expect(rows.at(-1)).toEqual({ status: 'zzz_unknown', count: 2 });
    expect(rows).toHaveLength(PRODUCT_STATUSES.length + 1);
    expect(totalCount(rows)).toBe(2);
  });

  it('同じ status が複数来たら合算する', () => {
    const rows = buildStatusRows([
      { status: 'ready', count: 2 },
      { status: 'ready', count: 5 },
    ]);
    expect(rows.find((r) => r.status === 'ready')?.count).toBe(7);
  });

  it('空入力でも全状態 0 の行を返す', () => {
    const rows = buildStatusRows([]);
    expect(totalCount(rows)).toBe(0);
    expect(rows).toHaveLength(PRODUCT_STATUSES.length);
  });

  it('全ての正準状態に表示名がある', () => {
    for (const st of PRODUCT_STATUSES) expect(messages.productStatus[st]).toBeTruthy();
  });
});

describe('buildQuotaView', () => {
  it('残枠があれば allowed=true で reason を持たない', () => {
    const q = buildQuotaView({ listedThisMonth: 3, monthlyLimit: 8 });
    expect(q).toMatchObject({ limit: 8, listed: 3, remaining: 5, allowed: true });
    expect(q.reason).toBeUndefined();
  });

  it('使い切ったら allowed=false + R-1 の理由を返す', () => {
    const q = buildQuotaView({ listedThisMonth: 8, monthlyLimit: 8 });
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
    expect(q.reason).toContain('上限');
  });

  it('上限を超えて出てしまっていても remaining は負にしない', () => {
    const q = buildQuotaView({ listedThisMonth: 12, monthlyLimit: 8 });
    expect(q.remaining).toBe(0);
    expect(q.allowed).toBe(false);
  });

  it('上限 0 = 出品停止', () => {
    const q = buildQuotaView({ listedThisMonth: 0, monthlyLimit: 0 });
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it('負の入力は 0 に寄せる (DB 不整合で画面が壊れないように)', () => {
    const q = buildQuotaView({ listedThisMonth: -3, monthlyLimit: -1 });
    expect(q.listed).toBe(0);
    expect(q.limit).toBe(0);
    expect(q.remaining).toBe(0);
  });
});

describe('buildQuotaView: 天井を超えた設定値', () => {
  it('設定値 20・当月 3 → 実効上限 12 / 残り 9 (ホームと設定で同じ数を言う)', () => {
    const q = buildQuotaView({ listedThisMonth: 3, monthlyLimit: 20 });
    expect(q.limit).toBe(12);
    expect(q.configuredLimit).toBe(20);
    expect(q.clamped).toBe(true);
    expect(q.remaining).toBe(9);
  });
  it('天井内なら読み替えない', () => {
    const q = buildQuotaView({ listedThisMonth: 3, monthlyLimit: 8 });
    expect(q.clamped).toBe(false);
    expect(q.limit).toBe(8);
  });
});

describe('buildQuotaSummary', () => {
  it('buildQuotaView と同じ数を返す (設定 20 → 実効 12)', () => {
    const q = buildQuotaSummary({ listedThisMonth: 3, monthlyLimit: 20 });
    const v = buildQuotaView({ listedThisMonth: 3, monthlyLimit: 20 });
    expect(q).toMatchObject({ limit: v.limit, configuredLimit: 20, clamped: true, listed: 3, allowed: true });
  });
  it('出品数を取得できないときは 0 ではなく null', () => {
    const q = buildQuotaSummary({ listedThisMonth: null, monthlyLimit: 8 });
    expect(q.listed).toBeNull();
    expect(q.allowed).toBeNull();
    expect(q.limit).toBe(8);
  });
  it('上限を読めないときは 0 (停止) ではなく null', () => {
    const q = buildQuotaSummary({ listedThisMonth: 2, monthlyLimit: null });
    expect(q.limit).toBeNull();
    expect(q.allowed).toBeNull();
    expect(q.clamped).toBe(false);
  });
  it('上限 0 は停止として判定される (null と別物)', () => {
    const q = buildQuotaSummary({ listedThisMonth: 0, monthlyLimit: 0 });
    expect(q.limit).toBe(0);
    expect(q.allowed).toBe(false);
  });
});

describe('determineStage', () => {
  it('商品 0 件 → stage0', () => expect(determineStage({ total: 0, listed: 0 })).toBe('stage0'));
  it('1 件以上かつ listed 0 → stage1', () => expect(determineStage({ total: 3, listed: 0 })).toBe('stage1'));
  it('listed あり → stage2', () => expect(determineStage({ total: 3, listed: 1 })).toBe('stage2'));
});

describe('buildHero (UR-2)', () => {
  it('売上を取得していないときは — と理由。0 を返さない', () => {
    const h = buildHero({ salesFetched: false, netProfitJpy: null, salesTotalJpy: null, listedProducts: 0 });
    for (const metric of [h.netProfit, h.salesPerProduct]) {
      expect(metric.value).toBe('—');
      expect(metric.available).toBe(false);
      expect(metric.reason).toBe('売上の取得はまだ始まっていません');
      expect(metric.value).not.toMatch(/0/);
    }
  });
  it('取得済みで売上ゼロは ¥0 (未取得と別物)', () => {
    const h = buildHero({ salesFetched: true, netProfitJpy: -300, salesTotalJpy: 0, listedProducts: 2 });
    expect(h.salesPerProduct.value).toBe('¥0');
    expect(h.salesPerProduct.available).toBe(true);
    expect(h.netProfit.value).toBe('−¥300');
  });
  it('出品済みが 0 件なら 1 商品あたりは — + 理由 (0 除算しない)', () => {
    const h = buildHero({ salesFetched: true, netProfitJpy: 0, salesTotalJpy: 0, listedProducts: 0 });
    expect(h.salesPerProduct.value).toBe('—');
    expect(h.salesPerProduct.reason).toContain('出品済み');
  });
  it('実コスト不明なら純利益は — (0 にしない)', () => {
    const h = buildHero({ salesFetched: true, netProfitJpy: null, salesTotalJpy: 100, listedProducts: 1 });
    expect(h.netProfit.value).toBe('—');
    expect(h.netProfit.reason).toBeTruthy();
  });
  it('1 商品あたり = 売上 ÷ 出品済み', () => {
    const h = buildHero({ salesFetched: true, netProfitJpy: 1, salesTotalJpy: 3200, listedProducts: 5 });
    expect(h.salesPerProduct.value).toBe('¥640');
  });
});

describe('buildLaunchChecklist', () => {
  const fresh = settingsFromRow({});
  const states = (c: ReturnType<typeof buildLaunchChecklist>) => Object.fromEntries(c.map((i) => [i.id, i.state]));
  const answeredAt = '2026-10-01T00:00:00.000Z';

  it('初期状態: 提案値未確認・試作なし・U-9/U-10 未回答 → すべて未', () => {
    expect(states(buildLaunchChecklist({ settings: fresh, settingsOk: true, productTotal: 0 }))).toEqual({
      confirm_proposals: 'todo',
      first_prototype: 'todo',
      u9u10: 'todo',
    });
  });
  it('設定を読めないとき項目 1 / 4 は確認できない (済にも未にも倒さない)', () => {
    const s = states(buildLaunchChecklist({ settings: fresh, settingsOk: false, productTotal: 2 }));
    expect(s).toEqual({ confirm_proposals: 'unknown', first_prototype: 'done', u9u10: 'unknown' });
  });
  it('商品件数を読めないとき試作は確認できない', () => {
    const s = states(buildLaunchChecklist({ settings: fresh, settingsOk: true, productTotal: null }));
    expect(s.first_prototype).toBe('unknown');
  });
  it('U-9 だけの回答では済にならない。両方そろって済', () => {
    const half = settingsFromRow({ tdp_u9_json: { answered_at: answeredAt, shares_pixiv_account: false, note: '' } });
    expect(states(buildLaunchChecklist({ settings: half, settingsOk: true, productTotal: 0 })).u9u10).toBe('todo');
    const both = settingsFromRow({
      tdp_u9_json: { answered_at: answeredAt, shares_pixiv_account: false, note: '' },
      tdp_u10_json: { answered_at: answeredAt, booth_share_pct: 0 },
    });
    expect(states(buildLaunchChecklist({ settings: both, settingsOk: true, productTotal: 0 })).u9u10).toBe('done');
  });
  it('Stage 0 は全項目、Stage 1 以降は済を畳む', () => {
    const items = [
      { id: 'confirm_proposals' as const, state: 'done' as const },
      { id: 'first_prototype' as const, state: 'todo' as const },
      { id: 'u9u10' as const, state: 'unknown' as const },
    ];
    expect(visibleChecklist('stage0', items)).toHaveLength(3);
    expect(visibleChecklist('stage1', items).map((i) => i.id)).toEqual(['first_prototype', 'u9u10']);
    expect(visibleChecklist('stage2', items.map((i) => ({ ...i, state: 'done' as const })))).toEqual([]);
  });
});

function collect(root: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') out.push(String((v as (...a: unknown[]) => unknown)(1, 2, 3)));
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(root);
  return out;
}

describe('messages: 運営者向け文言', () => {
  it('開発の都合 (Inc-N) を含む文言が 0 件 (UR-8)', () => {
    const texts = collect(messages);
    expect(texts.length).toBeGreaterThan(100);
    expect(texts.filter((t) => /Inc-\d/.test(t) || /Inc-/.test(t))).toEqual([]);
  });
  it('ホームの文言に「残り」「上げ」「増や」を含まない (UR-1)', () => {
    const texts = collect(messages.home);
    expect(texts.length).toBeGreaterThan(20);
    for (const t of texts) expect(t.replaceAll('立ち上げ', '')).not.toMatch(/残り|上げ|増や/);
  });
});
