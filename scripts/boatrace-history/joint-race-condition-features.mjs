import {FEATURE_INVENTORY_VERSION, HISTORY_FEATURE_CONTRACT, inventoryHash} from './joint-feature-inventory-catalog.mjs';
import {FEATURE_SEMANTICS_VERSION, MEANING_SOURCE_VERSION} from './joint-feature-semantics.mjs';
import {validInventoryDate} from './joint-feature-inventory-projection.mjs';
import {assertConditionRegistry} from './joint-race-condition-registry.mjs';

export const CONDITION_TICKETS = Object.freeze(Array.from({length: 6}, (_, a) => a + 1).flatMap(a =>
  Array.from({length: 6}, (_, b) => b + 1).filter(b => b !== a).flatMap(b =>
    Array.from({length: 6}, (_, c) => c + 1).filter(c => c !== a && c !== b).map(c => Object.freeze([a, b, c])))));
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const valueAt = (object, path) => path.split('.').reduce((node, key) => node?.[key], object);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const blank = (status, reason, sourceDateMax = null, support = null) => ({status, value: null, reason, support, sourceDateMax});
function recorded(value, descriptor, date, support = 1) {
  if (value === undefined) return blank('missing', 'value_not_provided', date, support);
  if (value === null) return blank('null', 'recorded_null', date, support);
  const valid = descriptor.kind === 'number' ? finite(value) : descriptor.kind === 'boolean' ? typeof value === 'boolean'
    : descriptor.kind === 'category' && descriptor.binding.type === 'native' ? finite(value) : typeof value === 'string';
  return valid ? {status: 'available', value, reason: null, support, sourceDateMax: date} : blank('invalid', 'feature_type_mismatch', date, support);
}
function nativeValue(envelope, descriptor, date) {
  if (!envelope) return blank('missing', 'projection_field_missing', date);
  const statuses = {missing: 'missing', null: 'null', invalid_or_unknown_state: 'invalid', type_mismatch_or_nonfinite: 'invalid', result_only_rejected: 'unsupported'};
  if (envelope.status !== 'recorded') return blank(statuses[envelope.status] ?? 'invalid', envelope.reason ?? 'projection_state_invalid', date);
  return recorded(envelope.researchValue, descriptor, date);
}
function historyValue(history, descriptor, priorDate) {
  if (!history) return blank('missing', 'prior_day_history_not_provided');
  const path = descriptor.binding.path, first = path.split('.')[0], raw = valueAt(history, path);
  const support = first === 'recent10' || first === 'preceding20' ? history[first]?.support : null;
  if (support !== null && (!Number.isSafeInteger(support) || support < 0)) return blank('invalid', 'history_support_invalid', priorDate);
  if (['recent10', 'preceding20'].includes(first) && !path.endsWith('.support') && history[first]?.status !== 'available')
    return blank('unsupported', history[first]?.status ?? 'history_window_status_missing', priorDate, support);
  if (first === 'windowContrast' && !path.endsWith('.fullWindowSupport') && history.windowContrast?.status !== 'available')
    return blank('unsupported', history.windowContrast?.status ?? 'history_contrast_status_missing', priorDate);
  if (raw !== null && raw !== undefined && (descriptor.unit === 'count' && (!Number.isSafeInteger(raw) || raw < 0) ||
    descriptor.unit === 'fraction_0_1' && !path.endsWith('Delta') && (!finite(raw) || raw < 0 || raw > 1) ||
    descriptor.unit === 'calendar_days' && (!Number.isSafeInteger(raw) || raw < 0) || path.endsWith('.meanPlace') && (!finite(raw) || raw < 1 || raw > 6)))
    return blank('invalid', 'history_value_out_of_contract', priorDate, support);
  return recorded(raw, descriptor, priorDate, support);
}
function semanticValue(packet, descriptor, date) {
  if (!packet) return blank('missing', 'semantic_decoder_not_provided', date);
  if (packet.evidence?.version !== FEATURE_SEMANTICS_VERSION || packet.evidence?.meaningSourceVersion !== MEANING_SOURCE_VERSION || packet.evidence?.liveEligible !== false)
    throw Error('condition_semantic_packet_version');
  const {decoder, path} = descriptor.binding;
  if (['grade', 'rank', 'weather', 'wind'].includes(decoder) && packet.kind !== decoder) throw Error('condition_semantic_decoder_kind');
  if (decoder === 'startTiming' && packet.consistency === 'mismatch') return blank('unsupported', 'semantic_raw_numeric_mismatch', date);
  if (decoder === 'startTiming' && path === 'expectedSignedValue' && packet.consistency !== 'match')
    return blank('unsupported', 'semantic_st_numeric_not_confirmed', date);
  if (['grade', 'rank', 'weather', 'wind'].includes(decoder) && packet.status !== 'decoded_under_source_version')
    return blank(packet.status === 'missing' ? 'missing' : packet.status === 'null' ? 'null' : 'unsupported', packet.status, date);
  if (decoder === 'plannedClose' && packet.status !== 'parsed_scheduled_local_time') return blank('unsupported', packet.status, date);
  if (decoder === 'raceSubtitle' && packet.status !== 'exact_match') return blank('unsupported', packet.status, date);
  const value = valueAt(packet, path);
  if (value === null) return blank('unsupported', decoder === 'wind' ? 'calm_has_no_compass_angle' : 'semantic_value_unresolved', date);
  return recorded(value, descriptor, date);
}

function semanticNativeCheck(packet, descriptor, fields, date) {
  if (!packet) return;
  const decoder = descriptor.binding.decoder, paths = {grade: 'context.grade_number', rank: 'entry.fields.rank_number',
    weather: 'preview.weather_number', wind: 'preview.wind_direction_number', plannedClose: 'context.closed_at', raceSubtitle: 'context.subtitle'};
  if (paths[decoder]) {
    const envelope = fields[paths[decoder]];
    if (envelope && ['recorded', 'null'].includes(envelope.status) && (['grade', 'rank', 'weather', 'wind'].includes(decoder) ? packet.rawCode : packet.raw) !== envelope.researchValue)
      throw Error('condition_semantic_native_mismatch');
    if (decoder === 'plannedClose' && packet.sourceDate !== date) throw Error('condition_semantic_clock_date');
  }
  if (decoder === 'region') for (const [property, field] of [['branch', 'entry.fields.branch_number'], ['birthplace', 'entry.fields.birthplace_number']]) {
    const envelope = fields[field];
    if (envelope && ['recorded', 'null'].includes(envelope.status) && packet[property]?.rawCode !== envelope.researchValue) throw Error('condition_semantic_native_mismatch');
  }
  if (decoder === 'startTiming') {
    const envelope = fields['entry.preview.start_timing'];
    if (envelope && ['recorded', 'null'].includes(envelope.status) && packet.observedNumericValue !== envelope.researchValue) throw Error('condition_semantic_native_mismatch');
  }
  if (decoder === 'parts' && descriptor.binding.path === 'propeller.exchangeMarked') {
    const envelope = fields['entry.preview.propeller'];
    if (envelope && ['recorded', 'null'].includes(envelope.status) && packet.propeller?.raw !== envelope.researchValue) throw Error('condition_semantic_native_mismatch');
  }
}

function validateHistory(priorHistory, projected, lineage) {
  if (priorHistory === null) {
    if (lineage.historySnapshotDigest !== null) throw Error('condition_history_lineage_without_packet');
    return null;
  }
  if (priorHistory?.version !== HISTORY_FEATURE_CONTRACT.version || priorHistory.date !== projected.date || priorHistory.cutoff !== 'strictly_prior_calendar_date' ||
    !(priorHistory.priorStateDate === null || validInventoryDate(priorHistory.priorStateDate) && priorHistory.priorStateDate < projected.date) ||
    !sha(priorHistory.dayFeatureDigest) || !sha(lineage.historySnapshotDigest) || !Array.isArray(priorHistory.races) ||
    priorHistory.evidence?.currentDayResultsUsed !== false || priorHistory.evidence?.resultFieldsRead !== false)
    throw Error('condition_history_cutoff_or_binding');
  const matches = priorHistory.races.filter(race => race.raceKey === projected.raceKey);
  if (matches.length !== 1 || matches[0].date !== projected.date || !Array.isArray(matches[0].entries) || matches[0].entries.length !== 6)
    throw Error('condition_history_race_identity');
  const byLane = new Map(matches[0].entries.map(entry => [entry.lane, entry]));
  if (byLane.size !== 6 || projected.entries.some(entry => byLane.get(entry.lane)?.registration !== entry.registration)) throw Error('condition_history_registration_identity');
  if (priorHistory.priorStateDate === null && [...byLane.values()].some(entry => entry.history?.support?.observedPrograms !== 0))
    throw Error('condition_history_initial_state_inconsistent');
  return byLane;
}

export function buildConditionRace({projected, priorHistory = null, semanticValues = null, registry, lineage} = {}) {
  assertConditionRegistry(registry);
  const projectionDigest = projected?.featureDigest, projectionBody = {raceKey: projected?.raceKey, date: projected?.date, source: projected?.source,
    venue: projected?.venue, raceNumber: projected?.raceNumber, version: projected?.version, status: projected?.status,
    reason: projected?.reason, fields: projected?.fields, entries: projected?.entries, evidence: projected?.evidence};
  if (projected?.version !== FEATURE_INVENTORY_VERSION || projected.status !== 'projected_with_unverified_semantics' ||
    !validInventoryDate(projected.date) || inventoryHash(projectionBody) !== projectionDigest || !Array.isArray(projected.entries) || projected.entries.length !== 6 ||
    new Set(projected.entries.map(entry => entry.lane)).size !== 6 || new Set(projected.entries.map(entry => entry.registration)).size !== 6 ||
    projected.entries.some(entry => !Number.isSafeInteger(entry.lane) || entry.lane < 1 || entry.lane > 6 || !Number.isSafeInteger(entry.registration) || entry.registration < 1 || entry.registration > 99999) ||
    projected.raceKey !== `turnmark_v1:${projected.date}:${projected.venue}:${projected.raceNumber}` || projected.source !== 'turnmark_v1' ||
    !Number.isSafeInteger(projected.venue) || projected.venue < 1 || projected.venue > 24 || !Number.isSafeInteger(projected.raceNumber) || projected.raceNumber < 1 || projected.raceNumber > 12 ||
    !sha(lineage?.rawSha) || lineage.projectionDigest !== projectionDigest || lineage.semanticsVersion !== registry.semanticsVersion)
    throw Error('condition_race_projection_or_lineage');
  if (semanticValues !== null && (registry.semanticsVersion === null || semanticValues.version !== registry.semanticsVersion ||
    semanticValues.raceKey !== projected.raceKey || semanticValues.date !== projected.date ||
    !Array.isArray(semanticValues.boats) || new Set(semanticValues.boats.map(entry => entry.lane)).size !== semanticValues.boats.length ||
    semanticValues.boats.some(entry => !Number.isSafeInteger(entry.lane) || entry.lane < 1 || entry.lane > 6 ||
      entry.registration !== projected.entries.find(boat => boat.lane === entry.lane)?.registration))) throw Error('condition_semantics_binding');
  const history = validateHistory(priorHistory, projected, lineage), semanticByLane = new Map((semanticValues?.boats ?? []).map(entry => [entry.lane, entry]));
  const raceValues = {}, boats = projected.entries.map(entry => ({lane: entry.lane, course: null, values: {}})), byLane = new Map(boats.map(boat => [boat.lane, boat]));
  for (const descriptor of registry.descriptors) {
    const targets = descriptor.grain === 'race' ? [{values: raceValues, projection: null, lane: null}] : projected.entries.map(entry => ({values: byLane.get(entry.lane).values, projection: entry, lane: entry.lane}));
    for (const target of targets) {
      let value;
      if (descriptor.implementation !== 'implemented_primitive') value = blank('unsupported', 'unsupported_feature');
      else if (descriptor.binding.type === 'native') value = nativeValue((target.projection?.fields ?? projected.fields)?.[descriptor.binding.fieldId], descriptor, projected.date);
      else if (descriptor.binding.type === 'history') value = historyValue(history?.get(target.lane)?.history, descriptor, priorHistory?.priorStateDate ?? null);
      else {
        const packet = (target.lane === null ? semanticValues?.race : semanticByLane.get(target.lane))?.[descriptor.binding.decoder];
        semanticNativeCheck(packet, descriptor, target.projection?.fields ?? projected.fields, projected.date);
        value = semanticValue(packet, descriptor, projected.date);
      }
      target.values[descriptor.id] = value;
    }
  }
  for (const boat of boats) {
    const field = boat.values['native.entry.preview.course_number'];
    boat.course = field.status === 'available' && Number.isInteger(field.value) && field.value >= 1 && field.value <= 6 ? field.value : null;
  }
  const body = {raceKey: projected.raceKey, date: projected.date, venue: projected.venue, registryDigest: registry.digest,
    raceValues, boats, lineage: {rawSha: lineage.rawSha, projectionDigest, historySnapshotDigest: lineage.historySnapshotDigest,
      historyDayFeatureDigest: priorHistory?.dayFeatureDigest ?? null, semanticsVersion: registry.semanticsVersion, timingScope: 'retrospective_unverified'},
    evidence: {resultFieldsRead: false, pricesRead: false, interpretation: 'research_coordinate_only_not_selected_bets', financialActions: 0, liveEligible: false}};
  const race = {...body, featureDigest: inventoryHash(body)};
  Object.defineProperty(race, 'registry', {value: registry, enumerable: false});
  return freeze(race);
}

export function bindTicket(race, ticket) {
  if (!race?.registry || race.registryDigest !== race.registry.digest || !Array.isArray(ticket) || ticket.length !== 3 ||
    ticket.some(lane => !Number.isInteger(lane) || lane < 1 || lane > 6) || new Set(ticket).size !== 3) throw Error('condition_ticket_identity');
  const context = {race, ticket: [...ticket], roles: {head: ticket[0], second: ticket[1], third: ticket[2]},
    registryDigest: race.registryDigest, featureDigest: race.featureDigest};
  Object.defineProperty(context, 'registry', {value: race.registry, enumerable: false});
  return context;
}

export function resolveConditionSet(context, reference) {
  const all = context.race.boats.map(boat => boat.lane).sort((a, b) => a - b), selected = new Set(context.ticket);
  if (reference.set === 'all') return {status: 'available', lanes: all, reason: null};
  if (reference.set === 'remaining') return {status: 'available', lanes: all.filter(lane => !selected.has(lane)), reason: null};
  if (reference.set === 'other_than') return {status: 'available', lanes: all.filter(lane => !(reference.exclude ?? []).some(role => context.roles[role] === lane)), reason: null};
  const courses = context.race.boats.map(boat => boat.course);
  if (courses.some(course => course === null) || new Set(courses).size !== 6) return {status: 'unsupported', lanes: [], reason: 'exhibition_course_not_permutation'};
  if (reference.set === 'adjacent' && reference.adjacency === 'all') return {status: 'unsupported', lanes: [], reason: 'adjacency_all_semantics_unresolved'};
  const source = context.race.boats.find(boat => boat.lane === context.roles[reference.of]);
  const lanes = context.race.boats.filter(boat => reference.set === 'inner' ? boat.course < source.course : reference.set === 'outer' ? boat.course > source.course
    : Math.abs(boat.course - source.course) === 1).map(boat => boat.lane).sort((a, b) => a - b);
  return {status: 'available', lanes, reason: null};
}
