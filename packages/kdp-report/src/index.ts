/**
 * @a2p/kdp-report — KDP 売上レポート(xlsx/csv)のパーサ + 正規化。
 *
 * web(手動アップロード取込) と worker(自動取得) の両方から使う共有ロジック。
 * SheetJS(xlsx) 依存はこのパッケージに閉じる。
 */
export {
  parseKdpReportWorkbook,
  parseMonth,
  type ParseResult,
  type KdpReportKind,
  type KdpSheetDiagnostic,
} from './parse.js';

export {
  normalizeKdpRows,
  normalizeCurrency,
  deriveKenpRate,
  deriveKenpRateFromRecords,
  KENP_RATE_MIN_JPY_PER_PAGE,
  KENP_RATE_MAX_JPY_PER_PAGE,
  KENP_RATE_MAX_RATIO,
  isPlausibleKenpRate,
  KENP_RATE_MIN_PAGES,
  type KenpEffectiveRate,
  type KenpRateSample,
  type KenpRateBasis,
  type KdpReportRow,
  type KdpMonthlySummary,
  type NormalizedSalesRow,
  type NormalizeResult,
  type NormalizeOptions,
} from './normalize.js';
