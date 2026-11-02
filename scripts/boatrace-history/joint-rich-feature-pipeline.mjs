import {FEATURE_INVENTORY_VERSION, NORMALIZED_FEATURE_FIELDS, HISTORY_FEATURE_CONTRACT, inventoryHash} from './joint-feature-inventory-catalog.mjs';
import {projectInventoryRace, validInventoryDate} from './joint-feature-inventory-projection.mjs';
import {createFeatureHistory} from './joint-feature-inventory-history.mjs';
import {FEATURE_SEMANTICS_VERSION} from './joint-feature-semantics.mjs';
import {expandRawRaceFeatures} from './joint-raw-feature-expansion.mjs';
import {assertConditionRegistry} from './joint-race-condition-registry.mjs';
import {buildConditionRace} from './joint-race-condition-features.mjs';

export const RICH_FEATURE_PIPELINE_VERSION = 'boat_rich_feature_day_pipeline_v1';
export const RICH_FEATURE_PIPELINE_LIMITS = Object.freeze({races: 1000, stringLength: 4096, objectKeys: 512,
  snapshotBytes: 32 * 1024 ** 2, packetBytes: 128 * 1024 ** 2});
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function read(node, key) {
  if (node === null || node === undefined) return undefined;
  if (!plain(node) || Object.keys(node).length > RICH_FEATURE_PIPELINE_LIMITS.objectKeys) throw Error('rich_pipeline_object_shape');
  const descriptor = Object.getOwnPropertyDescriptor(node, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) throw Error('rich_pipeline_accessor_forbidden');
  return descriptor.value;
}
function array(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum ||
    Object.keys(value).length !== value.length) throw Error('rich_pipeline_dense_array_or_budget');
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('rich_pipeline_dense_array_or_budget');
    result.push(descriptor.value);
  }
  return result;
}
function scalar(value) {
  if (typeof value === 'string' && value.length > RICH_FEATURE_PIPELINE_LIMITS.stringLength) throw Error('rich_pipeline_string_budget');
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return value;
  throw Error('rich_pipeline_scalar_required');
}
function envelope(value) {
  if (value === undefined || value === null) return value;
  return Object.fromEntries(['value', 'valueState', 'time', 'publishedAt', 'unit'].map(key => [key, scalar(read(value, key))]));
}
function normalizedFeatures(input) {
  const provenance = read(input, 'provenance'), entries = array(read(input, 'entries'), 6);
  const output = {raceKey: scalar(read(input, 'raceKey')), date: scalar(read(input, 'date')), venue: scalar(read(input, 'venue')),
    raceNumber: scalar(read(input, 'raceNumber')), provenance: {source: scalar(read(provenance, 'source')), rawSha256: scalar(read(provenance, 'rawSha256'))},
    context: {}, preview: {}, entries: entries.map(entry => ({lane: scalar(read(entry, 'lane')), registration: scalar(read(entry, 'registration')), fields: {}, preview: {}}))};
  for (const descriptor of NORMALIZED_FEATURE_FIELDS) {
    if (descriptor.grain === 'race') output[descriptor.container][descriptor.key] = envelope(read(read(input, descriptor.container), descriptor.key));
    else for (let i = 0; i < entries.length; i++) {
      const container = descriptor.container === 'entry.fields' ? 'fields' : 'preview';
      output.entries[i][container][descriptor.key] = envelope(read(read(entries[i], container), descriptor.key));
    }
  }
  return output;
}
function safeSnapshotCopy(value) {
  let nodes = 0;
  const copy = (node, depth) => {
    if (++nodes > 500000 || depth > 24) throw Error('rich_pipeline_snapshot_shape_budget');
    if (node === null || typeof node !== 'object') return scalar(node);
    if (Array.isArray(node)) return array(node, 20000).map(item => copy(item, depth + 1));
    if (!plain(node)) throw Error('rich_pipeline_snapshot_shape_budget');
    return Object.fromEntries(Object.keys(node).map(key => { scalar(key); return [key, copy(read(node, key), depth + 1)]; }));
  };
  const output = copy(value, 0);
  if (Buffer.byteLength(JSON.stringify(output)) > RICH_FEATURE_PIPELINE_LIMITS.snapshotBytes) throw Error('rich_pipeline_snapshot_bytes');
  return output;
}
function controlledReason(error) {
  const message = error instanceof Error ? error.message : '';
  return /^(?:rich_pipeline|feature_inventory|raw_feature)_[a-z0-9_]{1,100}$/.test(message) ? message : 'unsupported_feature_input';
}
function observedEntries(input) {
  try { return array(read(input, 'entries'), 6).length; } catch { return null; }
}
function fieldMismatch(expanded) {
  return [...Object.values(expanded.fields), ...expanded.entries.flatMap(entry => Object.values(entry.fields))]
    .some(field => ['mismatch', 'projection_field_missing'].includes(field.projectionConsistency));
}
const usable = value => value && ['recorded', 'null'].includes(value.status);
function semanticPacket(expanded, projected) {
  const race = {}, byLane = new Map(projected.entries.map(entry => [entry.lane, entry]));
  for (const [decoder, field, property] of [['grade', 'context.grade_number', 'grade'], ['weather', 'preview.weather_number', 'weather'],
    ['wind', 'preview.wind_direction_number', 'wind'], ['plannedClose', 'context.closed_at', 'plannedClose'], ['raceSubtitle', 'context.subtitle', 'subtitle']]) {
    if (!usable(projected.fields[field])) continue;
    const packet = expanded.semantics[property];
    race[decoder] = expanded.sourceConsistency[decoder]?.consistency === 'mismatch' ? {...packet, status: 'raw_source_native_mismatch'} : packet;
  }
  return {version: FEATURE_SEMANTICS_VERSION, raceKey: projected.raceKey, date: projected.date, race,
    boats: expanded.entries.map(entry => {
      const projectedEntry = byLane.get(entry.lane), fields = projectedEntry.fields;
      const packet = {lane: entry.lane, registration: projectedEntry.registration};
      if (usable(fields['entry.fields.rank_number'])) packet.rank = entry.sourceConsistency.rank.consistency === 'mismatch'
        ? {...entry.semantics.rank, status: 'raw_source_native_mismatch'} : entry.semantics.rank;
      if (usable(fields['entry.fields.branch_number']) && usable(fields['entry.fields.birthplace_number'])) {
        const bad = ['branch', 'birthplace'].some(key => entry.sourceConsistency[key].consistency === 'mismatch');
        packet.region = bad ? {...entry.semantics.region, sameNativeRegion: null} : entry.semantics.region;
      }
      if (usable(fields['entry.preview.start_timing'])) packet.startTiming = entry.semantics.exhibitionStartTiming;
      packet.parts = usable(fields['entry.preview.propeller']) ? entry.semantics.equipment : {...entry.semantics.equipment,
        propeller: {...entry.semantics.equipment.propeller, exchangeMarked: null}};
      return packet;
    })};
}
function availability(registry, records, inputCount) {
  return Object.fromEntries(registry.descriptors.map(descriptor => {
    const values = records.filter(record => record.status === 'ready').flatMap(record => descriptor.grain === 'race'
      ? [record.conditionRace.raceValues[descriptor.id]] : record.conditionRace.boats.map(boat => boat.values[descriptor.id]));
    const statuses = {available: 0, missing: 0, null: 0, invalid: 0, unsupported: 0}, reasons = {};
    for (const value of values) { statuses[value.status]++; if (value.reason) reasons[value.reason] = (reasons[value.reason] ?? 0) + 1; }
    const inputOpportunities = inputCount * (descriptor.grain === 'race' ? 1 : 6);
    return [descriptor.id, {grain: descriptor.grain, inputOpportunities, evaluated: values.length,
      notBuilt: inputOpportunities - values.length, statuses, reasons}];
  }));
}
function resultInput(input) {
  const result = read(input, 'result'), placings = read(result, 'placings');
  return {...normalizedFeatures(input), result: {state: scalar(read(result, 'state')),
    placings: placings === undefined || placings === null ? placings : array(placings, 16).map(entry => ({lane: scalar(read(entry, 'lane')),
      registration: scalar(read(entry, 'registration')), placeNumber: scalar(read(entry, 'placeNumber'))}))}};
}

export function createRichFeaturePipeline({catalog, registry, sourceBinding, snapshot = null} = {}) {
  assertConditionRegistry(registry);
  const {digest: catalogDigest, ...catalogBody} = catalog ?? {};
  if (catalog?.version !== FEATURE_INVENTORY_VERSION || inventoryHash(catalogBody) !== catalogDigest || catalogDigest !== registry.inventoryCatalogDigest ||
    registry.semanticsVersion !== FEATURE_SEMANTICS_VERSION || !sha(read(sourceBinding, 'datasetDigest')) || read(sourceBinding, 'source') !== 'turnmark_v1')
    throw Error('rich_pipeline_catalog_registry_source_binding');
  const binding = freeze({pipelineVersion: RICH_FEATURE_PIPELINE_VERSION, registryDigest: registry.digest, catalogDigest,
    projectionVersion: FEATURE_INVENTORY_VERSION, historyContractDigest: inventoryHash(HISTORY_FEATURE_CONTRACT),
    semanticsVersion: FEATURE_SEMANTICS_VERSION, sourceBinding: {source: 'turnmark_v1', datasetDigest: sourceBinding.datasetDigest}});
  let committed, pending = null;
  const makeState = (history, counts) => {
    const body = {binding, history, counts};
    const output = {...body, digest: inventoryHash(body)};
    if (Buffer.byteLength(JSON.stringify(output)) > RICH_FEATURE_PIPELINE_LIMITS.snapshotBytes) throw Error('rich_pipeline_snapshot_bytes');
    return output;
  };
  if (snapshot === null) committed = makeState(createFeatureHistory().snapshot(), {committedDays: 0, inputRaces: 0, acceptedRaces: 0, unsupportedRaces: 0});
  else {
    const saved = safeSnapshotCopy(snapshot), {digest, ...body} = saved;
    if (inventoryHash(body) !== digest || inventoryHash(saved.binding) !== inventoryHash(binding) ||
      !plain(saved.counts) || !['committedDays', 'inputRaces', 'acceptedRaces', 'unsupportedRaces'].every(key => Number.isSafeInteger(saved.counts[key]) && saved.counts[key] >= 0) ||
      saved.counts.inputRaces !== saved.counts.acceptedRaces + saved.counts.unsupportedRaces ||
      (saved.counts.committedDays === 0) !== (saved.history?.lastCommittedDate === null)) throw Error('rich_pipeline_snapshot_binding');
    const checked = createFeatureHistory(saved.history).snapshot();
    if (checked.digest !== saved.history.digest) throw Error('rich_pipeline_snapshot_history');
    committed = makeState(checked, saved.counts);
  }
  return {
    prepareDay({date, rows} = {}) {
      if (pending) throw Error('rich_pipeline_day_pending');
      if (!validInventoryDate(date) || committed.history.lastCommittedDate !== null && date <= committed.history.lastCommittedDate) throw Error('rich_pipeline_day_order');
      const inputs = array(rows, RICH_FEATURE_PIPELINE_LIMITS.races), accepted = [], records = [], keys = new Set(), observed = [];
      for (let i = 0; i < inputs.length; i++) {
        const row = inputs[i], source = read(row, 'normalizedRace'), key = scalar(read(source, 'raceKey'));
        observed.push(observedEntries(source));
        if (typeof key === 'string') { if (keys.has(key)) throw Error('rich_pipeline_duplicate_race'); keys.add(key); }
        let stage = 'projection';
        try {
          const features = normalizedFeatures(source), projected = projectInventoryRace(features);
          if (projected.date !== date) throw Error('rich_pipeline_row_date_mismatch');
          if (projected.status === 'unsupported') throw Error('rich_pipeline_projection_unsupported');
          const rawSha256 = scalar(read(row, 'rawSha256'));
          if (!sha(rawSha256) || features.provenance.rawSha256 !== rawSha256) throw Error('rich_pipeline_raw_sha_binding');
          stage = 'raw';
          const expanded = expandRawRaceFeatures({rawRace: read(row, 'rawRace'), projected, lineage: {rawSha256, projectionDigest: projected.featureDigest}});
          if (fieldMismatch(expanded)) throw Error('rich_pipeline_raw_projection_mismatch');
          accepted.push({inputIndex: i, features, projected, rawSha256, expanded});
        } catch (error) {
          records.push({inputIndex: i, raceKey: typeof key === 'string' ? key : null, observedEntryCount: observed[i], status: 'unsupported', stage, reason: controlledReason(error)});
        }
      }
      const working = createFeatureHistory(committed.history), priorHistory = working.beginDay(date, accepted.map(row => row.features));
      for (const row of accepted) {
        const conditionRace = buildConditionRace({projected: row.projected, priorHistory, semanticValues: semanticPacket(row.expanded, row.projected), registry,
          lineage: {rawSha: row.rawSha256, projectionDigest: row.projected.featureDigest, historySnapshotDigest: committed.history.digest, semanticsVersion: registry.semanticsVersion}});
        records.push({inputIndex: row.inputIndex, raceKey: row.projected.raceKey, observedEntryCount: 6, status: 'ready', reason: null, conditionRace,
          rawExpansionDigest: row.expanded.digest});
      }
      records.sort((a, b) => a.inputIndex - b.inputIndex);
      const reasons = {};
      for (const record of records) if (record.reason) reasons[record.reason] = (reasons[record.reason] ?? 0) + 1;
      const body = {version: RICH_FEATURE_PIPELINE_VERSION, date, binding, baseSnapshotDigest: committed.digest,
        priorHistoryDigest: committed.history.digest, dayFeatureDigest: priorHistory.dayFeatureDigest, records,
        summary: {inputRaces: inputs.length, expectedBoatSlots: inputs.length * 6, acceptedRaces: accepted.length,
          observedEntrySlots: observed.reduce((sum, n) => sum + (n ?? 0), 0), unknownEntryCountRaces: observed.filter(n => n === null).length,
          acceptedBoatSlots: accepted.length * 6, unsupportedRaces: inputs.length - accepted.length, unsupportedExpectedBoatSlots: (inputs.length - accepted.length) * 6,
          reasons, descriptorAvailability: availability(registry, records, inputs.length)},
        evidence: {resultFieldsRead: false, oddsFieldsRead: false, currentDayResultsUsed: false, rawBytesVerifiedByPipeline: false,
          historicalGeneratorVerified: false, timingVerified: false, financialActions: 0, liveEligible: false}};
      if (Buffer.byteLength(JSON.stringify(body)) > RICH_FEATURE_PIPELINE_LIMITS.packetBytes) throw Error('rich_pipeline_packet_bytes');
      const packet = freeze({...body, digest: inventoryHash(body)});
      pending = {date, packetDigest: packet.digest, dayFeatureDigest: priorHistory.dayFeatureDigest, accepted,
        inputRaces: inputs.length, unsupportedRaces: inputs.length - accepted.length};
      return packet;
    },
    commitDay({date, dayPacketDigest, resultRaces} = {}) {
      if (!pending || date !== pending.date || dayPacketDigest !== pending.packetDigest) throw Error('rich_pipeline_commit_binding');
      const rows = array(resultRaces, RICH_FEATURE_PIPELINE_LIMITS.races);
      if (rows.length !== pending.accepted.length) throw Error('rich_pipeline_commit_count');
      const safe = rows.map(resultInput), byKey = new Map(safe.map(row => [row.raceKey, row]));
      if (byKey.size !== safe.length || pending.accepted.some(row => {
        const result = byKey.get(row.features.raceKey);
        return !result || result.provenance.rawSha256 !== row.rawSha256 || projectInventoryRace(result).featureDigest !== row.projected.featureDigest;
      })) throw Error('rich_pipeline_commit_features_or_identity');
      const working = createFeatureHistory(committed.history), replay = working.beginDay(date, pending.accepted.map(row => row.features));
      if (replay.dayFeatureDigest !== pending.dayFeatureDigest) throw Error('rich_pipeline_commit_replay_binding');
      const historyReceipt = working.commitDay(date, safe), nextHistory = working.snapshot(), nextCounts = {
        committedDays: committed.counts.committedDays + 1, inputRaces: committed.counts.inputRaces + pending.inputRaces,
        acceptedRaces: committed.counts.acceptedRaces + pending.accepted.length, unsupportedRaces: committed.counts.unsupportedRaces + pending.unsupportedRaces};
      const next = makeState(nextHistory, nextCounts), receipt = {date, dayPacketDigest, historyReceipt,
        pipelineSnapshotDigest: next.digest, acceptedRaces: pending.accepted.length, unsupportedRaces: pending.unsupportedRaces,
        evidence: {currentDayResultsUsedOnlyForFutureDays: true, financialActions: 0, liveEligible: false}};
      committed = next; pending = null;
      return receipt;
    },
    abortDay() { const aborted = pending !== null; pending = null; return {aborted, snapshotDigest: committed.digest}; },
    snapshot() { if (pending) throw Error('rich_pipeline_snapshot_pending_day'); return safeSnapshotCopy(committed); },
    state() { return {version: RICH_FEATURE_PIPELINE_VERSION, lastCommittedDate: committed.history.lastCommittedDate, counts: {...committed.counts},
      snapshotDigest: committed.digest, pendingDate: pending?.date ?? null, pendingPacketDigest: pending?.packetDigest ?? null, liveEligible: false}; },
  };
}
