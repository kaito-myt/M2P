import {FEATURE_INVENTORY_VERSION, NORMALIZED_FEATURE_FIELDS, inventoryHash} from './joint-feature-inventory-catalog.mjs';
import {validInventoryDate} from './joint-feature-inventory-projection.mjs';
import {FEATURE_SEMANTICS_VERSION, MEANING_SOURCE_VERSION, decodeFeatureCategory, decodeRegionCodes,
  decodeExhibitionStartTiming, decodePlannedClose, decodeRaceSubtitle, decodePartsAndPropeller} from './joint-feature-semantics.mjs';

export const RAW_FEATURE_EXPANSION_VERSION = 'boat_raw_feature_expansion_v1';
export const RAW_FEATURE_LIMITS = Object.freeze({keys: 128, stringLength: 4096, parts: 32, outputBytes: 256 * 1024});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const scalar = value => value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = (value, lo, hi) => Number.isSafeInteger(value) && value >= lo && value <= hi;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function assertObject(value) {
  if (!object(value)) throw Error('raw_feature_object_or_key_limit');
  const keys = Object.keys(value);
  if (keys.length > RAW_FEATURE_LIMITS.keys || keys.some(key => key.length > RAW_FEATURE_LIMITS.stringLength)) throw Error('raw_feature_object_or_key_limit');
  return value;
}
function get(node, key) {
  if (node === undefined || node === null) return undefined;
  assertObject(node);
  const descriptor = Object.getOwnPropertyDescriptor(node, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) throw Error('raw_feature_accessor_forbidden');
  return descriptor.value;
}
function envelope(value) {
  if (typeof value === 'string' && value.length > RAW_FEATURE_LIMITS.stringLength) throw Error('raw_feature_string_limit');
  return {status: value === undefined ? 'missing' : value === null ? 'null' : scalar(value) ? 'recorded' : 'invalid_scalar_type',
    value: scalar(value) ? value : null, valueType: value === null ? 'null' : typeof value,
    negative: finite(value) && value < 0, zero: finite(value) && value === 0};
}
function sources(node) {
  if (node === undefined || node === null) return {};
  assertObject(node);
  return Object.fromEntries(Object.keys(node).filter(key => key.endsWith('_source') && !['name_source', 'number_source', 'registration_source'].includes(key))
    .sort().map(key => [key, envelope(get(node, key))]));
}
function compare(raw, normalized) {
  if (!normalized) return raw.status === 'missing' ? 'both_missing' : 'projection_field_missing';
  if (normalized.status === 'recorded') return raw.status === 'recorded' && raw.value === normalized.researchValue ? 'match' : 'mismatch';
  if (normalized.status === 'null') return raw.status === 'null' ? 'match_null' : 'mismatch';
  if (normalized.status === 'missing') return raw.status === 'missing' ? 'both_missing' : 'mismatch';
  return 'projection_value_not_comparable';
}
function extractFields(node, projected, grain, container) {
  return Object.fromEntries(NORMALIZED_FEATURE_FIELDS.filter(field => field.grain === grain && field.container === container).map(field => {
    const raw = envelope(get(node, field.key));
    return [field.id, {raw, projectionConsistency: compare(raw, projected?.[field.id])}];
  }));
}
const regionShortNames = Object.freeze('北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄'.split(' '));
const gradeSourceCodes = Object.freeze({SGA: 1, SGB: 1, G1A: 6, G1B: 2, G2A: 3, G2B: 3, G3A: 4, G3B: 4, IPPAN: 5});
function categoryConsistency(kind, raw, code) {
  let expected = null;
  if (typeof raw === 'string') {
    if (kind === 'grade') expected = gradeSourceCodes[raw.toUpperCase()] ?? null;
    else if (kind === 'region') { const i = regionShortNames.indexOf(raw); expected = i < 0 ? null : i + 1; }
    else for (const n of kind === 'rank' ? [1, 2, 3, 4] : kind === 'weather' ? [1, 2, 3, 4, 5, 6, 99] : Array.from({length: 17}, (_, i) => i + 1)) {
      if (decodeFeatureCategory(kind, n).label === raw) { expected = n; break; }
    }
  }
  return {source: envelope(raw), native: envelope(code), expectedCodeUnderSourceVersion: expected,
    consistency: expected === null ? 'source_not_comparable' : code === undefined ? 'numeric_missing' : code === expected ? 'match' : 'mismatch'};
}
function identity(raw, projected) {
  assertObject(raw); assertObject(projected);
  if (projected.version !== FEATURE_INVENTORY_VERSION || projected.status !== 'projected_with_unverified_semantics' ||
    !validInventoryDate(projected.date) || !integer(projected.venue, 1, 24) || !integer(projected.raceNumber, 1, 12) ||
    projected.source !== 'turnmark_v1' || projected.raceKey !== `turnmark_v1:${projected.date}:${projected.venue}:${projected.raceNumber}` || !hex(projected.featureDigest))
    throw Error('raw_feature_projection_identity');
  for (const [key, expected] of [['date', projected.date], ['stadium_number', projected.venue], ['race_number', projected.raceNumber]])
    if (get(raw, key) !== expected) throw Error('raw_feature_race_identity_mismatch');
}
function checkedRacers(rawRacers, entries) {
  assertObject(rawRacers);
  if (Object.keys(rawRacers).length !== 6 || !Array.isArray(entries) || entries.length !== 6 ||
    entries.some(entry => !integer(entry.lane, 1, 6) || !integer(entry.registration, 1, 99999)) ||
    new Set(entries.map(entry => entry.lane)).size !== 6 || new Set(entries.map(entry => entry.registration)).size !== 6)
    throw Error('raw_feature_six_racer_identity');
  for (const entry of entries) {
    const raw = get(rawRacers, String(entry.lane));
    if (get(raw, 'entry_number') !== entry.lane || get(raw, 'number') !== entry.registration) throw Error('raw_feature_racer_identity_mismatch');
  }
}
function checkedPreview(rawPreview, projected) {
  if (rawPreview === undefined || rawPreview === null) return {state: rawPreview === null ? 'null' : 'missing', node: rawPreview, racers: null};
  assertObject(rawPreview);
  for (const [key, expected] of [['date', projected.date], ['stadium_number', projected.venue], ['race_number', projected.raceNumber]])
    if (get(rawPreview, key) !== expected) throw Error('raw_feature_preview_identity_mismatch');
  const racers = get(rawPreview, 'racers');
  if (racers === undefined || racers === null) return {state: 'racers_missing_or_null', node: rawPreview, racers};
  assertObject(racers);
  let present = 0;
  for (const key of Object.keys(racers)) {
    if (!/^[1-6]$/.test(key)) throw Error('raw_feature_preview_lane_identity');
    const entry = get(racers, key);
    if (entry === undefined || entry === null) continue;
    if (get(entry, 'entry_number') !== Number(key)) throw Error('raw_feature_preview_lane_identity');
    present++;
    const reg = get(entry, 'number');
    if (reg !== undefined && reg !== projected.entries.find(entry => entry.lane === Number(key)).registration) throw Error('raw_feature_preview_registration_mismatch');
  }
  return {state: present === 6 ? 'six_preview_entries' : 'partial_preview_entries', node: rawPreview, racers};
}
function partsValue(value) {
  if (value === undefined || value === null) return {raw: envelope(value), decodedInput: value};
  if (!Array.isArray(value)) return {raw: {status: 'invalid_parts_type', value: null, valueType: typeof value}, decodedInput: value};
  if (value.length > RAW_FEATURE_LIMITS.parts) throw Error('raw_feature_parts_limit');
  if (Object.keys(value).length !== value.length) throw Error('raw_feature_parts_dense_array_required');
  const items = Array.from({length: value.length}, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('raw_feature_parts_dense_array_required');
    const part = descriptor.value;
    if (!object(part)) throw Error('raw_feature_part_object');
    assertObject(part);
    return Object.fromEntries(Object.keys(part).sort().map(key => {
      const scalarValue = get(part, key), record = envelope(scalarValue);
      if (record.status === 'invalid_scalar_type') throw Error('raw_feature_nested_part_value');
      return [key, scalarValue];
    }));
  });
  return {raw: {status: items.length ? 'nonempty_array' : 'empty_array', value: items}, decodedInput: items};
}

export function expandRawRaceFeatures({rawRace, projected, lineage} = {}) {
  identity(rawRace, projected);
  if (!object(lineage) || !hex(get(lineage, 'rawSha256')) || get(lineage, 'projectionDigest') !== projected.featureDigest)
    throw Error('raw_feature_lineage_mismatch');
  const racers = get(rawRace, 'racers'); checkedRacers(racers, projected.entries);
  const preview = checkedPreview(get(rawRace, 'preview'), projected), p = preview.node;
  const body = {version: RAW_FEATURE_EXPANSION_VERSION, raceKey: projected.raceKey, date: projected.date, venue: projected.venue,
    raceNumber: projected.raceNumber, lineage: {rawSha256: lineage.rawSha256, projectionDigest: projected.featureDigest,
      semanticsVersion: FEATURE_SEMANTICS_VERSION, meaningSourceVersion: MEANING_SOURCE_VERSION,
      rawBytesVerifiedByAdapter: false, historicalGeneratorVerified: false}, previewState: preview.state,
    fields: {...extractFields(rawRace, projected.fields, 'race', 'context'), ...extractFields(p, projected.fields, 'race', 'preview')},
    sources: {program: sources(rawRace), preview: sources(p)},
    semantics: {grade: decodeFeatureCategory('grade', get(rawRace, 'grade_number')),
      weather: decodeFeatureCategory('weather', get(p, 'weather_number')), wind: decodeFeatureCategory('wind', get(p, 'wind_direction_number')),
      plannedClose: decodePlannedClose({raw: get(rawRace, 'closed_at'), sourceDate: projected.date}), subtitle: decodeRaceSubtitle(get(rawRace, 'subtitle'))},
    sourceConsistency: {grade: categoryConsistency('grade', get(rawRace, 'grade_number_source'), get(rawRace, 'grade_number')),
      weather: categoryConsistency('weather', get(p, 'weather_number_source'), get(p, 'weather_number')),
      wind: categoryConsistency('wind', get(p, 'wind_direction_number_source'), get(p, 'wind_direction_number'))},
    entries: [...projected.entries].sort((a, b) => a.lane - b.lane).map(entry => {
      const raw = get(racers, String(entry.lane)), before = get(preview.racers, String(entry.lane)), parts = partsValue(get(before, 'parts'));
      return {lane: entry.lane, previewEntryState: before === undefined ? 'missing' : before === null ? 'null' : 'recorded',
        fields: {...extractFields(raw, entry.fields, 'boat', 'entry.fields'), ...extractFields(before, entry.fields, 'boat', 'entry.preview')},
        sources: {program: sources(raw), preview: sources(before)}, parts: parts.raw,
        semantics: {rank: decodeFeatureCategory('rank', get(raw, 'rank_number')),
          region: decodeRegionCodes(get(raw, 'branch_number'), get(raw, 'birthplace_number')),
          exhibitionStartTiming: decodeExhibitionStartTiming({raw: get(before, 'start_timing_source'), numeric: get(before, 'start_timing')}),
          equipment: decodePartsAndPropeller({parts: parts.decodedInput, propeller: get(before, 'propeller')})},
        sourceConsistency: {rank: categoryConsistency('rank', get(raw, 'rank_number_source'), get(raw, 'rank_number')),
          branch: categoryConsistency('region', get(raw, 'branch_number_source'), get(raw, 'branch_number')),
          birthplace: categoryConsistency('region', get(raw, 'birthplace_number_source'), get(raw, 'birthplace_number'))}};
    }), evidence: {resultFieldsRead: false, oddsFieldsRead: false, registrationExported: false, modelConnection: 'not_implemented',
      timingVerified: false, predictiveEffectVerified: false, liveEligible: false}};
  if (Buffer.byteLength(JSON.stringify(body)) > RAW_FEATURE_LIMITS.outputBytes) throw Error('raw_feature_output_limit');
  return {...body, digest: inventoryHash(body)};
}

export function expandRawDayRaceFeatures({rawDay, projected, lineage} = {}) {
  const programs = get(rawDay, 'programs'), stadiums = get(programs, 'stadiums'), stadium = get(stadiums, String(projected?.venue)),
    races = get(stadium, 'races'), rawRace = get(races, String(projected?.raceNumber));
  return expandRawRaceFeatures({rawRace, projected, lineage});
}
