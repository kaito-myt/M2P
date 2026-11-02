export const FEATURE_SEMANTICS_VERSION = 'boat_feature_semantics_turnmark_0_10_1_v1';
export const MEANING_SOURCE_VERSION = 'turnmark_scraper_0.10.1_81f93f005277d3f424a0c7f64c2e6040e073a9d4';
const root = 'https://github.com/turnmark/scraper/blob/81f93f005277d3f424a0c7f64c2e6040e073a9d4';
const dictionary = Object.freeze({
  grade: Object.freeze({1: 'SG', 2: 'G1', 3: 'G2', 4: 'G3', 5: '一般', 6: 'PG1'}),
  rank: Object.freeze({1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2'}),
  weather: Object.freeze({1: '晴', 2: '曇り', 3: '雨', 4: '雪', 5: '霧', 6: '台風', 99: 'その他'}),
  wind: Object.freeze({1: '北', 2: '北北東', 3: '北東', 4: '東北東', 5: '東', 6: '東南東', 7: '南東', 8: '南南東',
    9: '南', 10: '南南西', 11: '南西', 12: '西南西', 13: '西', 14: '西北西', 15: '北西', 16: '北北西', 17: '無風'}),
  part: Object.freeze({1: 'ピストン', 2: 'ピストンリング', 3: '電気一式', 4: 'キャブレター', 5: 'シリンダ',
    6: 'クランクシャフト', 7: 'ギヤケース', 8: 'キャリアボデー'}),
});
const enumFiles = Object.freeze({grade: 'Grade', rank: 'Rank', weather: 'Weather', wind: 'WindDirection', part: 'Part'});
const partShort = Object.freeze({1: 'ピストン', 2: 'リング', 3: '電気', 4: 'キャブ', 5: 'シリンダ', 6: 'シャフト', 7: 'ギヤ', 8: 'キャリボ'});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const scalar = value => value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value) ? value : null;
const inputState = value => value === undefined ? 'missing' : value === null ? 'null' : finite(value) ? 'finite_number' : 'other_type';
const evidence = source => ({version: FEATURE_SEMANTICS_VERSION, meaningSourceVersion: MEANING_SOURCE_VERSION,
  source, historicalGeneratorVerified: false, timingVerified: false, predictiveEffectVerified: false, liveEligible: false});
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function decodeFeatureCategory(kind, code) {
  if (!Object.hasOwn(dictionary, kind)) throw Error('feature_semantics_category_kind');
  const known = Number.isSafeInteger(code) && Object.hasOwn(dictionary[kind], code),
    status = code === undefined ? 'missing' : code === null ? 'null' : !Number.isSafeInteger(code) ? 'invalid_type_or_noninteger' : known ? 'decoded_under_source_version' : 'unknown_code';
  return {kind, rawCode: scalar(code), inputState: inputState(code), status, label: known ? dictionary[kind][code] : null,
    semanticType: 'nominal_category_not_numeric_strength',
    ...(kind === 'wind' ? {calm: known ? code === 17 : null,
      compassDegreesClockwiseFromNorth: known && code !== 17 ? (code - 1) * 22.5 : null,
      venueRelativeDirection: null, physicalFromOrToConvention: 'not_verified_by_icon_codebook'} : {}),
    evidence: evidence(`${root}/src/Enums/${enumFiles[kind]}.php`)};
}

export function decodeRegionCodes(branch, birthplace) {
  const decode = (concept, code) => ({concept, rawCode: scalar(code), inputState: inputState(code),
    status: code === undefined ? 'missing' : code === null ? 'null' : !Number.isSafeInteger(code) ? 'invalid_type_or_noninteger'
      : code >= 1 && code <= 47 ? 'valid_prefecture_code_under_source_version' : 'unknown_code',
    valid: Number.isSafeInteger(code) && code >= 1 && code <= 47});
  const a = decode('registered_branch', branch), b = decode('birthplace', birthplace);
  return {branch: a, birthplace: b, sameNativeRegion: a.valid && b.valid ? branch === birthplace : null,
    sameConcept: false, geographicDistance: null, homeVenue: null,
    evidence: evidence(`${root}/src/Enums/Prefecture.php`)};
}

export function decodeExhibitionStartTiming({raw, numeric} = {}) {
  let rawState = raw === undefined ? 'raw_missing' : raw === null ? 'raw_null' : raw === '' ? 'raw_empty' : 'unrecognized_raw',
    expectedSignedValue = null, earlyFlag = null, lateFlag = null, knownRaw = false;
  if (raw === 'L') { rawState = 'late_without_numeric'; lateFlag = true; earlyFlag = false; knownRaw = true; }
  else if (typeof raw === 'string' && /^(?:0?\.\d{2}|F\.\d{2})$/.test(raw)) {
    earlyFlag = raw[0] === 'F'; lateFlag = false; knownRaw = true;
    const magnitude = Number(earlyFlag ? raw.slice(1) : raw);
    expectedSignedValue = earlyFlag ? -magnitude : magnitude;
    rawState = earlyFlag ? magnitude === 0 ? 'flying_zero' : 'flying' : magnitude === 0 ? 'ordinary_zero' : 'ordinary';
  }
  let consistency = 'not_comparable';
  if (knownRaw) consistency = numeric === undefined ? 'numeric_missing'
    : lateFlag ? numeric === null ? 'match' : 'mismatch'
      : finite(numeric) && numeric === expectedSignedValue ? 'match' : 'mismatch';
  return {raw: scalar(raw), rawState, observedNumericValue: finite(numeric) ? numeric : null, numericState: inputState(numeric),
    expectedSignedValue, earlyFlag, lateFlag, consistency,
    ambiguity: !knownRaw && (numeric === null || numeric === undefined) ? 'late_blank_missing_or_unrecognized_not_identifiable'
      : !knownRaw && numeric === 0 ? 'ordinary_zero_vs_flying_zero_not_identifiable' : !knownRaw ? 'raw_category_not_reconstructable' : null,
    numericNegativeZeroObserved: Object.is(numeric, -0),
    resultFoulOrRefund: 'not_inferred_from_exhibition',
    evidence: evidence(`${root}/src/Parsers/PreviewParser.php`)};
}

export function decodePlannedClose({raw, sourceDate} = {}) {
  const base = {raw: scalar(raw), sourceDate: typeof sourceDate === 'string' ? sourceDate : null,
    plannedHour: null, plannedMinute: null, plannedSecond: null, plannedMinutesOfDay: null,
    timezoneBasis: 'provider_default_JST_not_individually_verified', actualCloseTime: null, publicationTime: null,
    officialSessionClass: null, evidence: evidence(`${root}/src/Scrapers/ProgramScraper.php`)};
  if (!validDate(sourceDate)) return {...base, status: 'invalid_source_date'};
  if (raw === undefined || raw === null) return {...base, status: raw === undefined ? 'missing' : 'null'};
  if (typeof raw !== 'string') return {...base, status: 'invalid_type'};
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (!match || !validDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59)
    return {...base, status: 'unrecognized_or_invalid_datetime'};
  if (match[1] !== sourceDate) return {...base, status: 'source_date_mismatch'};
  return {...base, status: 'parsed_scheduled_local_time', plannedHour: Number(match[2]), plannedMinute: Number(match[3]),
    plannedSecond: Number(match[4]), plannedMinutesOfDay: Number(match[2]) * 60 + Number(match[3])};
}

export const RACE_SUBTITLE_DICTIONARY = Object.freeze({version: 'boat_subtitle_exact_v1', normalization: 'none_exact_source_string',
  labels: Object.freeze({'予選': 'qualifier', '準優勝戦': 'semifinal', '優勝戦': 'final', '一般': 'general',
    '一般戦': 'general', '選抜戦': 'selection', '特選': 'special_selection', '特選戦': 'special_selection'})});
export function decodeRaceSubtitle(raw) {
  const known = typeof raw === 'string' && Object.hasOwn(RACE_SUBTITLE_DICTIONARY.labels, raw);
  return {raw: scalar(raw), status: raw === undefined ? 'missing' : raw === null ? 'null' : typeof raw !== 'string' ? 'invalid_type'
    : known ? 'exact_match' : 'unmapped_subtitle', raceType: known ? RACE_SUBTITLE_DICTIONARY.labels[raw] : null,
    dictionaryVersion: RACE_SUBTITLE_DICTIONARY.version, normalization: RACE_SUBTITLE_DICTIONARY.normalization,
    meetingGrade: null, participantGenderOrAgeClass: null, titleSubstringUsed: false,
    evidence: evidence(`${root}/src/Scrapers/ProgramScraper.php`)};
}

export function decodePartsAndPropeller({parts, propeller} = {}) {
  const propellerState = propeller === undefined ? 'missing' : propeller === null ? 'null_exchange_state_unresolved_without_preview_publication'
    : propeller === '新' ? 'new_mark_under_source_version' : typeof propeller === 'string' ? 'unrecognized_mark' : 'invalid_type';
  const base = {propeller: {raw: scalar(propeller), status: propellerState, exchangeMarked: propeller === '新' ? true : null},
    evidence: evidence(`${root}/src/Parsers/PreviewParser.php`)};
  if (!Array.isArray(parts)) return {...base, status: parts === undefined ? 'missing' : parts === null ? 'null_preview_unpublished_or_unknown_historical_version' : 'invalid_parts_type',
    items: [], hasAnyExchange: null, totalQuantity: null, knownQuantitySum: null};
  const items = parts.map(part => {
    if (!part || typeof part !== 'object' || Array.isArray(part) || !['number', 'number_source', 'quantity'].every(key => Object.hasOwn(part, key)))
      return {status: 'invalid_part_element', raw: scalar(part)};
    const decoded = decodeFeatureCategory('part', part.number), quantityKnown = Number.isSafeInteger(part.quantity) && part.quantity >= 0,
      sourceKnown = decoded.label !== null && typeof part.number_source === 'string' && (part.number_source === partShort[part.number] || part.number_source === decoded.label),
      sourceStatus = part.number_source === undefined ? 'missing' : part.number_source === null ? 'null'
        : typeof part.number_source !== 'string' ? 'invalid_type' : decoded.label === null ? 'unrecognized_name_preserved' : sourceKnown ? 'name_code_match' : 'name_code_mismatch';
    return {status: 'parsed_part_element', number: scalar(part.number), numberSource: scalar(part.number_source),
      category: decoded, nameCodeConsistency: sourceStatus, quantityRaw: scalar(part.quantity),
      quantity: quantityKnown ? part.quantity : null,
      quantityState: part.quantity === undefined ? 'missing' : part.quantity === null ? 'not_printed_or_unknown' : quantityKnown ? 'recorded' : 'invalid_quantity',
      zeroQuantity: quantityKnown && part.quantity === 0};
  });
  const valid = items.every(item => item.status === 'parsed_part_element'),
    allQuantityKnown = valid && items.every(item => item.quantityState === 'recorded'),
    sum = valid ? items.reduce((sum, item) => sum + (item.quantity ?? 0), 0) : null,
    knownQuantitySum = Number.isSafeInteger(sum) ? sum : null;
  return {...base, status: parts.length === 0 ? 'published_empty_no_exchange_under_source_version' : valid ? 'nonempty_exchange_list' : 'partially_invalid_exchange_list',
    items, hasAnyExchange: parts.length === 0 ? false : valid ? true : null,
    totalQuantity: allQuantityKnown ? knownQuantitySum : null, knownQuantitySum,
    quantitySumStatus: !valid ? 'invalid_elements' : !Number.isSafeInteger(sum) ? 'outside_safe_integer_range' : allQuantityKnown ? 'all_quantities_known' : 'partial_known_quantities_only'};
}
