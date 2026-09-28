export { resizeCover } from './resize-cover.js';
export {
  composeCoverTypography,
  notoSansJpBoldPath,
  sanitizeTelopText,
  type CoverText,
  type ComposeCoverOptions,
} from './compose-cover.js';
export {
  composePromoCreative,
  promoAccent,
  type PromoContent,
  type PromoOptions,
} from './compose-promo.js';
export {
  composeNoteEyecatch,
  accentForNiche,
  schemeForNiche,
  copySizeForLength,
  subSizeFor,
  fitCopy,
  defaultEyecatchAlt,
  NOTE_EYECATCH_WIDTH,
  NOTE_EYECATCH_HEIGHT,
  NOTE_EYECATCH_SCHEMES,
  type NoteEyecatchText,
  type NoteEyecatchOptions,
  type NoteEyecatchScheme,
} from './compose-note-eyecatch.js';
export {
  parseMarkdownTable,
  renderTableImage,
  splitTableSegments,
  tableToPlainText,
  tableImageAlt,
  isTableRow,
  isTableSeparator,
  type MarkdownTable,
  type TableImageOptions,
} from './render-table-image.js';
