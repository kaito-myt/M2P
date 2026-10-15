/**
 * KDP レポート行の正規化コア (docs/09 §2, T-KS-03)。
 *
 * パース済みの生行 (KdpReportRow[]) を、対象月・ASIN 単位に集約し、ロイヤリティを
 * 円換算して合算する **純関数**。ブラウザ/ワーカー双方から使えるよう外部依存を
 * 持たない (xlsx も prisma も触らない)。ASIN→book_id の解決は呼び出し側が行う。
 *
 * ロイヤリティは 2 系統を合算する:
 *  - 有料販売ロイヤリティ (royalty_kind='paid'): レポートに明細金額あり
 *  - KENP ロイヤリティ (royalty_kind='kenp'):
 *      「月別ロイヤリティ明細」は ASIN 別金額を持つ → そのまま合算
 *      「ロイヤリティ推定」は ASIN 別金額を持たない → 「概要」の月次合計から
 *      各書籍の KENP ページ数で按分して推定計上する
 */

/** パーサが 1 行から抽出する生データ (1 マーケットプレイス×1 タイトル分)。 */
export interface KdpReportRow {
  asin: string;
  title?: string | null;
  marketplace?: string | null;
  /** ロイヤリティの通貨コード ("JPY" / "USD" 等)。空/未検出は JPY 扱い。 */
  currency?: string | null;
  /** この行が属する月 (YYYY-MM)。未検出は null。 */
  month?: string | null;
  units_sold: number;
  kenp_read: number;
  /** `currency` 建てのロイヤリティ額。 */
  royalty: number;
  /** ロイヤリティの種別 (有料販売 or KENP)。未指定は 'paid' 扱い。 */
  royalty_kind?: 'paid' | 'kenp';
  /** 由来シート名 (診断用。集計には使わない) */
  sheet?: string;
}

/** 「概要」シート由来の月次サマリ (KENP ロイヤリティ按分の原資)。 */
export interface KdpMonthlySummary {
  month: string;
  kenp_read: number;
  /** その月の総ロイヤリティ (JPY 建て・KENP 分を含む)。 */
  royalty_jpy: number;
}

/** ASIN 単位に集約・円換算した結果。 */
export interface NormalizedSalesRow {
  asin: string;
  title: string | null;
  /** 有料販売 + KENP (確定 + 推計) の合計。 */
  royalty_jpy: number;
  units_sold: number;
  kenp_read: number;
  /** royalty_jpy のうち KENP 確定分 (明細金額 or 概要サマリ按分)。内数。 */
  kenp_royalty_jpy: number;
  /** royalty_jpy のうち KENP 推計分 (確定月の実効レート × ページ数)。内数。0 なら推計を含まない。 */
  kenp_royalty_estimated_jpy: number;
}

/**
 * KENP の実効レート (円/ページ)。確定月の `KENP収益 ÷ KENPページ数` から導出する。
 * 定数を焼き込まない: KDP が単価を変えても確定月が更新されれば自動追従する。
 */
export interface KenpEffectiveRate {
  /** レートの根拠にした確定月 (YYYY-MM) */
  month: string;
  jpyPerPage: number;
  /** 根拠の種類。detail = 明細に KENP 金額あり / allocated = 概要サマリ按分由来 (劣後) / setting = 運営者設定 (最劣後)。 */
  basis?: KenpRateBasis;
}

export type KenpRateBasis = 'detail' | 'allocated' | 'setting';

/** 運営者設定レートの month 表記 (根拠月が無いため空)。 */
export const KENP_RATE_SETTING_MONTH = '';

/**
 * 妥当性ガード (docs/09 §10.2)。単月レートは実データで ±46% ぶれる
 * (実測: 2026-06 = 0.371 円/頁、2026-10 逆算 = 約 0.5426 円/頁)ため、帯は広めに取り、
 * 桁違いの異常値 (少数ページ × 高額収益など) だけを弾く。帯外の月は採用せず次に古い月へ。
 */
export const KENP_RATE_MIN_JPY_PER_PAGE = 0.1;
export const KENP_RATE_MAX_JPY_PER_PAGE = 1.0;
/** 他の確定月レートの最小値のこの倍率を超えるレートは不採用 (按分由来への PB ロイヤリティ混入などの吸収)。 */
export const KENP_RATE_MAX_RATIO = 3;

/** 帯 (と、ページ数が分かるなら下限) の判定。呼び出し側が直接渡すレートにも必ず通す。 */
export function isPlausibleKenpRate(jpyPerPage: number, pages?: number): boolean {
  if (!Number.isFinite(jpyPerPage)) return false;
  if (pages !== undefined && !(pages >= KENP_RATE_MIN_PAGES)) return false;
  return jpyPerPage >= KENP_RATE_MIN_JPY_PER_PAGE && jpyPerPage <= KENP_RATE_MAX_JPY_PER_PAGE;
}

/** 優先順位順に並べ、他候補の最小レートの KENP_RATE_MAX_RATIO 倍を超えない最初の候補を返す。 */
function pickByPreference(cands: KenpEffectiveRate[]): KenpEffectiveRate | null {
  const sorted = [...cands].sort((a, b) => (isBetterRate(a, b) ? -1 : isBetterRate(b, a) ? 1 : 0));
  for (const c of sorted) {
    const others = sorted.filter((o) => o !== c).map((o) => o.jpyPerPage);
    if (others.length === 0 || c.jpyPerPage <= KENP_RATE_MAX_RATIO * Math.min(...others)) return c;
  }
  return null;
}
/** 根拠月の KENP ページ数の下限。少ないページ数のレートは分散が大きく根拠にしない。 */
export const KENP_RATE_MIN_PAGES = 100;

/** 確定月 1 か月分の KENP 実績 (レート導出の入力)。 */
export interface KenpRateSample {
  month: string;
  kenp_read: number;
  /** その月の確定 KENP 収益 (JPY) */
  kenp_royalty_jpy: number;
  /** 未指定は 'detail' 扱い */
  basis?: KenpRateBasis;
}

/**
 * 確定月サンプルから、`beforeMonth` より前の実効レートを導出する。
 * - ページ数が下限未満 / 収益が 0 / レートが妥当帯の外の月は根拠にせず、次の候補へフォールバック。
 * - 優先順位: 明細に KENP 金額がある月 (detail) > 概要サマリ按分由来の月 (allocated)。同順位なら新しい月。
 *   按分は「概要にあって電子書籍有料シートに無い収益」を全部 KENP とみなすため、PB ロイヤリティ等が
 *   混ざるとレートが過大になり得る (未検証の前提。docs/09 §10.2)。
 * 全滅なら null (= 推計しない。既定レートは置かない)。
 */
export function deriveKenpRate(
  samples: KenpRateSample[],
  beforeMonth: string,
): KenpEffectiveRate | null {
  const cands: KenpEffectiveRate[] = [];
  for (const s of samples) {
    if (s.month >= beforeMonth) continue;
    if (!(s.kenp_royalty_jpy > 0) || !(s.kenp_read > 0)) continue;
    const rate = s.kenp_royalty_jpy / s.kenp_read;
    if (!isPlausibleKenpRate(rate, s.kenp_read)) continue;
    cands.push({ month: s.month, jpyPerPage: rate, basis: s.basis ?? 'detail' });
  }
  return pickByPreference(cands);
}

function isBetterRate(a: KenpEffectiveRate, b: KenpEffectiveRate): boolean {
  const rank = (r: KenpEffectiveRate): number => (r.basis === 'setting' ? 2 : r.basis === 'allocated' ? 1 : 0);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb;
  return a.month > b.month;
}

export interface NormalizeResult {
  rows: NormalizedSalesRow[];
  /** 集約前の総行数 (対象月フィルタ後) */
  inputRowCount: number;
  /** 円換算できず royalty を合計から除外した行の通貨→件数 */
  unconvertedCurrencies: Record<string, number>;
  totals: { royalty_jpy: number; units_sold: number; kenp_read: number };
  /** KENP ロイヤリティを概要合計から按分計上した場合の按分総額 (JPY)。0 なら按分なし。 */
  allocatedKenpRoyaltyJpy: number;
  /** 確定月レートによる KENP 推計の総額 (JPY)。0 なら推計を含まない。 */
  estimatedKenpRoyaltyJpy: number;
  /** 診断用: KENP 金額が確定できなかった理由を切り分けるための中間値 (docs/09 §10.4) */
  kenpDiagnostics: {
    /** 明細に KENP 金額 (royalty_kind='kenp' の金額) が 1 件でもあったか */
    kenpRoyaltyInDetail: boolean;
    /** 対象月の概要サマリが見つかったか */
    summaryFound: boolean;
    summaryRoyaltyJpy: number | null;
    /** 有料販売ロイヤリティ合計 (JPY・按分の控除額) */
    paidTotalJpy: number;
    /** 按分原資 = max(0, summary − paidTotal)。サマリ無しは null */
    pool: number | null;
    totalPages: number;
  };
  /** 推計に使った実効レート。推計しなかった場合は null。 */
  kenpRateUsed: KenpEffectiveRate | null;
}

export interface NormalizeOptions {
  /** 通貨コード(大文字) → JPY 換算レート。JPY は 1 固定で不要。例: { USD: 152.3 } */
  fxToJpy?: Record<string, number>;
  /** 対象月 (YYYY-MM)。指定時はこの月の行のみ集約する。 */
  targetMonth?: string;
  /** Estimator の KENP ロイヤリティ按分に使う月次サマリ。 */
  monthlySummaries?: KdpMonthlySummary[];
  /**
   * 呼び出し側 (DB の確定月実績) が導出した実効レート。対象月の KENP 金額が確定できない
   * (明細に無く、概要サマリも無い/原資 0) ときだけ推計に使う。レポート内の他の確定月から
   * 導出したレートと比べ、より新しい月の方を採用する。
   */
  kenpRate?: KenpEffectiveRate | null;
  /** 内部用: 推計を行わない (他月の確定レート導出のための再帰呼び出し)。 */
  noEstimate?: boolean;
}

/** 通貨表記を正規化 (¥ / 円 / 空 → JPY、記号を ISO 風コードへ)。 */
export function normalizeCurrency(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().toUpperCase();
  if (s === '' || s === 'JPY' || s === '¥' || s === '円' || s === 'YEN') return 'JPY';
  if (s === 'USD' || s === '$' || s === 'US$') return 'USD';
  if (s === 'EUR' || s === '€') return 'EUR';
  if (s === 'GBP' || s === '£') return 'GBP';
  return s;
}

interface Acc extends Omit<NormalizedSalesRow, 'kenp_royalty_jpy' | 'kenp_royalty_estimated_jpy'> {
  /** 有料販売ロイヤリティ (JPY) */
  paid_jpy: number;
  /** ASIN 別に明細金額のある KENP ロイヤリティ (JPY) */
  kenp_jpy: number;
  /** KENP ロイヤリティ金額が明細に存在したか (按分要否の判定用) */
  kenp_royalty_present: boolean;
}

/**
 * KDP 生行 → 対象月・ASIN 別・円換算・合算。
 * - units_sold / kenp_read は通貨に依らず常に合算 (件数のため)。
 * - royalty は JPY はそのまま、換算レートがある通貨は換算、無い通貨は合計から除外し
 *   `unconvertedCurrencies` に計上 (units/kenp は残す)。
 * - KENP ロイヤリティ金額が明細に無い(Estimator)場合、`monthlySummaries` の月次合計から
 *   各書籍の KENP ページ数で按分して計上する。
 */
export function normalizeKdpRows(
  rows: KdpReportRow[],
  options: NormalizeOptions = {},
): NormalizeResult {
  const fx = options.fxToJpy ?? {};
  const target = options.targetMonth;
  const src = target ? rows.filter((r) => (r.month ?? target) === target) : rows;
  const byAsin = new Map<string, Acc>();
  const unconverted: Record<string, number> = {};

  for (const row of src) {
    const asin = row.asin.trim();
    if (!asin) continue;

    let acc = byAsin.get(asin);
    if (!acc) {
      acc = {
        asin,
        title: row.title?.trim() || null,
        royalty_jpy: 0,
        units_sold: 0,
        kenp_read: 0,
        paid_jpy: 0,
        kenp_jpy: 0,
        kenp_royalty_present: false,
      };
      byAsin.set(asin, acc);
    }
    if (!acc.title && row.title?.trim()) acc.title = row.title.trim();

    acc.units_sold += toSafeInt(row.units_sold);
    acc.kenp_read += toSafeInt(row.kenp_read);

    const royalty = Number.isFinite(row.royalty) ? row.royalty : 0;
    if (royalty !== 0) {
      const cur = normalizeCurrency(row.currency);
      let jpy: number | null = null;
      if (cur === 'JPY') jpy = royalty;
      else if (fx[cur] && fx[cur] > 0) jpy = royalty * fx[cur];

      if (jpy === null) {
        unconverted[cur] = (unconverted[cur] ?? 0) + 1;
      } else if (row.royalty_kind === 'kenp') {
        acc.kenp_jpy += jpy;
        acc.kenp_royalty_present = true;
      } else {
        acc.paid_jpy += jpy;
      }
    }
  }

  const accs = Array.from(byAsin.values());

  // KENP ロイヤリティ按分 (Estimator 対応):
  // 明細に KENP ロイヤリティ金額が一切無く、対象月の概要サマリがある場合、
  // 概要合計 − 有料販売合計 = KENP 原資 を、各書籍の KENP ページ数で按分する。
  let allocatedKenpRoyaltyJpy = 0;
  const anyKenpRoyaltyPresent = accs.some((a) => a.kenp_royalty_present);
  const diag: NormalizeResult['kenpDiagnostics'] = {
    kenpRoyaltyInDetail: anyKenpRoyaltyPresent,
    summaryFound: false,
    summaryRoyaltyJpy: null,
    paidTotalJpy: Math.round(accs.reduce((t, a) => t + a.paid_jpy, 0)),
    pool: null,
    totalPages: accs.reduce((t, a) => t + a.kenp_read, 0),
  };
  if (!anyKenpRoyaltyPresent && target && options.monthlySummaries) {
    const summary = options.monthlySummaries.find((s) => s.month === target);
    if (summary) {
      const paidTotal = accs.reduce((t, a) => t + a.paid_jpy, 0);
      const pool = Math.max(0, Math.round(summary.royalty_jpy) - Math.round(paidTotal));
      diag.summaryFound = true;
      diag.summaryRoyaltyJpy = Math.round(summary.royalty_jpy);
      diag.pool = pool;
      const totalPages = accs.reduce((t, a) => t + a.kenp_read, 0);
      if (pool > 0 && totalPages > 0) {
        for (const [acc, add] of allocateByPages(accs, pool)) {
          acc.kenp_jpy += add;
          allocatedKenpRoyaltyJpy += add;
        }
      }
    }
  }

  // KENP 推計: 明細金額も概要サマリ按分も得られなかった月 (= 当月。KDP は翌月 15 日頃に
  // 確定する) は、確定月の実効レート × ページ数で見込み計上する。確定できる月には適用しない。
  let estimatedKenpRoyaltyJpy = 0;
  let kenpRateUsed: KenpEffectiveRate | null = null;
  const kenpUnresolved = !anyKenpRoyaltyPresent && allocatedKenpRoyaltyJpy === 0;
  const estimated = new Map<string, number>();
  if (kenpUnresolved && target && !options.noEstimate && accs.some((a) => a.kenp_read > 0)) {
    const rate = pickKenpRate(rows, options, target);
    if (rate && rate.jpyPerPage > 0) {
      kenpRateUsed = rate;
      // 合計は ページ数合計 × レート を丸めた値に一致させる (行ごとの丸めズレを出さない)
      const totalPages = accs.reduce((t, a) => t + a.kenp_read, 0);
      for (const [acc, v] of allocateByPages(accs, Math.round(totalPages * rate.jpyPerPage))) {
        estimated.set(acc.asin, v);
        estimatedKenpRoyaltyJpy += v;
      }
    }
  }

  const outRows: NormalizedSalesRow[] = accs
    .map((a) => ({
      asin: a.asin,
      title: a.title,
      royalty_jpy: Math.round(a.paid_jpy + a.kenp_jpy) + (estimated.get(a.asin) ?? 0),
      units_sold: a.units_sold,
      kenp_read: a.kenp_read,
      kenp_royalty_jpy: Math.round(a.kenp_jpy),
      kenp_royalty_estimated_jpy: estimated.get(a.asin) ?? 0,
    }))
    .sort((a, b) => b.royalty_jpy - a.royalty_jpy);

  const totals = outRows.reduce(
    (t, r) => ({
      royalty_jpy: t.royalty_jpy + r.royalty_jpy,
      units_sold: t.units_sold + r.units_sold,
      kenp_read: t.kenp_read + r.kenp_read,
    }),
    { royalty_jpy: 0, units_sold: 0, kenp_read: 0 },
  );

  return {
    rows: outRows,
    inputRowCount: src.length,
    unconvertedCurrencies: unconverted,
    totals,
    allocatedKenpRoyaltyJpy,
    estimatedKenpRoyaltyJpy,
    kenpDiagnostics: diag,
    kenpRateUsed,
  };
}

/**
 * 推計に使うレートを決める。候補は (a) 呼び出し側が渡した DB 由来のレート、
 * (b) このレポートに含まれる対象月より前の確定月 (明細金額 or 概要サマリ按分) から導出したレート。
 * より新しい根拠月を採用する。どちらも無ければ null (推計しない)。
 */
function pickKenpRate(
  rows: KdpReportRow[],
  options: NormalizeOptions,
  target: string,
): KenpEffectiveRate | null {
  const months = new Set<string>();
  for (const r of rows) if (r.month) months.add(r.month);
  for (const s of options.monthlySummaries ?? []) months.add(s.month);

  const samples: KenpRateSample[] = [];
  for (const m of months) {
    if (m >= target) continue;
    const res = normalizeKdpRows(rows, { ...options, targetMonth: m, kenpRate: null, noEstimate: true });
    samples.push({
      basis: res.allocatedKenpRoyaltyJpy > 0 ? 'allocated' : 'detail',
      month: m,
      kenp_read: res.rows.reduce((t, r) => t + r.kenp_read, 0),
      kenp_royalty_jpy: res.rows.reduce((t, r) => t + r.kenp_royalty_jpy, 0),
    });
  }
  const fromReport = deriveKenpRate(samples, target);
  // 直接渡されたレートも帯ガードを通す (帯外は無視して fromReport へ)
  const given =
    options.kenpRate && options.kenpRate.month < target && isPlausibleKenpRate(options.kenpRate.jpyPerPage)
      ? options.kenpRate
      : null;
  return pickByPreference([given, fromReport].filter((r): r is KenpEffectiveRate => r !== null));
}

/** pool (円) を KENP ページ数比で最大剰余法により整数配分する (合計は pool に一致)。 */
function allocateByPages(accs: Acc[], pool: number): Array<[Acc, number]> {
  const targets = accs.filter((a) => a.kenp_read > 0);
  const totalPages = targets.reduce((t, a) => t + a.kenp_read, 0);
  if (pool <= 0 || totalPages <= 0) return [];
  const shares = targets.map((a) => {
    const exact = (pool * a.kenp_read) / totalPages;
    const floor = Math.floor(exact);
    return { acc: a, floor, rem: exact - floor };
  });
  let leftover = pool - shares.reduce((t, x) => t + x.floor, 0);
  shares.sort((x, y) => y.rem - x.rem);
  return shares.map((x) => {
    const add = x.floor + (leftover > 0 ? 1 : 0);
    if (leftover > 0) leftover--;
    return [x.acc, add] as [Acc, number];
  });
}

function toSafeInt(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * DB の sales_records (確定済み行のみ) から、`beforeMonth` より前で最新の確定月の実効レートを導出する。
 * 推計行 (kenp_royalty_estimated_jpy > 0) は呼び出し側で除外しておくこと。
 */
export function deriveKenpRateFromRecords(
  records: Array<{ year_month: string; kenp_read: number; kenp_royalty_jpy: number; source?: string }>,
  beforeMonth: string,
): KenpEffectiveRate | null {
  const byMonth = new Map<string, KenpRateSample>();
  for (const r of records) {
    const s = byMonth.get(r.year_month) ?? { month: r.year_month, kenp_read: 0, kenp_royalty_jpy: 0 };
    s.kenp_read += r.kenp_read;
    s.kenp_royalty_jpy += r.kenp_royalty_jpy;
    // manual_estimate = Estimator 取込 (概要サマリ按分由来)。月内に 1 行でもあれば按分由来として劣後させる。
    if (r.source === 'manual_estimate') s.basis = 'allocated';
    byMonth.set(r.year_month, s);
  }
  return deriveKenpRate(Array.from(byMonth.values()), beforeMonth);
}

/**
 * 呼び出し側 (DB) の実効レート解決: 確定月から導出したレートを優先し、無ければ運営者設定値を使う。
 * 設定値も帯ガード (isPlausibleKenpRate) を通す。帯外/未設定は null (= 推計しない)。
 * 設定値による推計も「推計」であり、確定値ではない (kenp_royalty_estimated_jpy に入る)。
 */
export function resolveKenpRate(
  derived: KenpEffectiveRate | null,
  settingJpyPerPage: number | null | undefined,
): KenpEffectiveRate | null {
  if (derived) return derived;
  if (settingJpyPerPage == null || !isPlausibleKenpRate(settingJpyPerPage)) return null;
  return { month: KENP_RATE_SETTING_MONTH, jpyPerPage: settingJpyPerPage, basis: 'setting' };
}
