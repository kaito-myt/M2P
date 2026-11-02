import {FEATURE_INVENTORY_VERSION, NORMALIZED_FEATURE_FIELDS, inventoryHash} from './joint-feature-inventory-catalog.mjs';

export const validInventoryDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
export function inventoryRaceIdentity(race) {
  if (race?.provenance?.source !== 'turnmark_v1' || !validInventoryDate(race.date) || !integer(race.venue, 1, 24) ||
    !integer(race.raceNumber, 1, 12) || race.raceKey !== `turnmark_v1:${race.date}:${race.venue}:${race.raceNumber}`)
    throw Error('feature_inventory_race_identity');
  return {raceKey: race.raceKey, date: race.date, source: 'turnmark_v1', venue: race.venue, raceNumber: race.raceNumber};
}

function projectEnvelope(envelope, descriptor) {
  const scalar = envelope?.value, finite = typeof scalar === 'number' && Number.isFinite(scalar),
    validValue = descriptor.type === 'finite_number' ? finite : typeof scalar === 'string';
  let status = !envelope ? 'missing' : envelope.time === 'result_only' ? 'result_only_rejected'
    : envelope.valueState === 'null' ? 'null' : envelope.valueState !== 'recorded' ? 'invalid_or_unknown_state'
      : !validValue ? 'type_mismatch_or_nonfinite' : 'recorded';
  const value = scalar === null || typeof scalar === 'string' || typeof scalar === 'boolean' || finite ? scalar : null;
  return {value, valueState: envelope?.valueState ?? 'missing', status, reason: status === 'recorded' ? null : status,
    time: envelope?.time ?? null, publishedAt: typeof envelope?.publishedAt === 'string' ? envelope.publishedAt : null,
    sourceUnit: typeof envelope?.unit === 'string' ? envelope.unit : null,
    zero: finite && scalar === 0, negative: finite && scalar < 0,
    researchValue: status === 'recorded' ? value : null, meaningVerified: false, timingVerified: false,
    requiresSentinelAudit: finite && scalar === 0, liveEligible: false};
}

export function projectInventoryRace(race) {
  const identity = inventoryRaceIdentity(race), entries = race.entries;
  const validEntries = Array.isArray(entries) && entries.length === 6 && entries.every(entry => integer(entry.lane, 1, 6) && integer(entry.registration, 1, 99999)) &&
    new Set(entries.map(entry => entry.lane)).size === 6 && new Set(entries.map(entry => entry.registration)).size === 6;
  if (!validEntries) return {...identity, version: FEATURE_INVENTORY_VERSION, status: 'unsupported', reason: 'six_unique_lane_and_registration_required',
    fields: null, entries: [], evidence: {resultFieldsRead: false, liveEligible: false}};
  const raceFields = NORMALIZED_FEATURE_FIELDS.filter(field => field.grain === 'race'), boatFields = NORMALIZED_FEATURE_FIELDS.filter(field => field.grain === 'boat');
  const fields = Object.fromEntries(raceFields.map(field => [field.id, projectEnvelope(race[field.container]?.[field.key], field)]));
  const projected = [...entries].sort((a, b) => a.lane - b.lane).map(entry => ({lane: entry.lane, registration: entry.registration,
    fields: Object.fromEntries(boatFields.map(field => [field.id, projectEnvelope(entry[field.container === 'entry.fields' ? 'fields' : 'preview']?.[field.key], field)]))}));
  const body = {...identity, version: FEATURE_INVENTORY_VERSION, status: 'projected_with_unverified_semantics', reason: null, fields, entries: projected,
    evidence: {resultFieldsRead: false, normalizedFieldCount: 39, temporalQualification: 'retrospective_unverified',
      categories: 'native_codes_only_no_invented_labels', clock: 'raw_string_no_timezone_or_session_classification',
      titles: 'raw_strings_no_invented_race_type', equipment: 'venue_number_not_exchange_epoch_identity',
      modelConnection: 'not_implemented', liveEligible: false}};
  return {...body, featureDigest: inventoryHash(body)};
}

export function inventoryRelativeRank(projected, fieldId, lane, {higherBetter = true, lanes = [1, 2, 3, 4, 5, 6]} = {}) {
  const descriptor = NORMALIZED_FEATURE_FIELDS.find(field => field.id === fieldId);
  if (!descriptor || descriptor.grain !== 'boat' || descriptor.roleComparison !== 'numeric_relative_research_only')
    throw Error('feature_inventory_rank_not_numeric');
  if (!Array.isArray(lanes) || !lanes.length || lanes.some(value => !integer(value, 1, 6)) || new Set(lanes).size !== lanes.length || !lanes.includes(lane))
    throw Error('feature_inventory_rank_lanes');
  const rows = lanes.map(number => projected.entries.find(entry => entry.lane === number)?.fields[fieldId]);
  if (rows.some(field => field?.status !== 'recorded' || !Number.isFinite(field.researchValue)))
    return {status: 'unsupported', reason: 'requested_comparison_values_incomplete', low: null, high: null};
  const value = rows[lanes.indexOf(lane)].researchValue, better = rows.filter(field => higherBetter ? field.researchValue > value : field.researchValue < value).length,
    ties = rows.filter(field => field.researchValue === value).length;
  return {status: 'research_only', reason: null, low: better + 1, high: better + ties, tied: ties > 1};
}
