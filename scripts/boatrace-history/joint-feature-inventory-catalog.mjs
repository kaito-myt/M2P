import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const FEATURE_INVENTORY_VERSION = 'boat_feature_inventory_v1';
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const inventoryHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rfhNumeric = new Set(['age', 'weight', 'flying_count', 'late_count', 'average_start_timing', 'national_win_rate',
  'national_top_2_percent', 'national_top_3_percent', 'local_win_rate', 'local_top_2_percent', 'local_top_3_percent',
  'motor_top_2_percent', 'motor_top_3_percent', 'boat_top_2_percent', 'boat_top_3_percent']);
const specs = [
  ['context', 'program', 'race', ['closed_at', 'grade_number', 'title', 'subtitle', 'distance', 'day_number']],
  ['entry.fields', 'program.racers', 'boat', ['rank_number', 'branch_number', 'birthplace_number', 'age', 'weight', 'flying_count', 'late_count',
    'average_start_timing', 'national_win_rate', 'national_top_2_percent', 'national_top_3_percent', 'local_win_rate', 'local_top_2_percent',
    'local_top_3_percent', 'motor_number', 'motor_top_2_percent', 'motor_top_3_percent', 'boat_number', 'boat_top_2_percent', 'boat_top_3_percent']],
  ['preview', 'preview', 'race', ['wind_speed', 'wind_direction_number', 'wave_height', 'weather_number', 'air_temperature', 'water_temperature']],
  ['entry.preview', 'preview.racers', 'boat', ['course_number', 'start_timing', 'weight', 'weight_adjustment', 'exhibition_time', 'tilt_adjustment', 'propeller']],
];
const strings = new Set(['closed_at', 'title', 'subtitle', 'propeller']);
const codes = new Set(['grade_number', 'rank_number', 'branch_number', 'birthplace_number', 'wind_direction_number', 'weather_number']);
export const NORMALIZED_FEATURE_FIELDS = freeze(specs.flatMap(([container, rawPrefix, grain, keys]) => keys.map(key => {
  const id = `${container}.${key}`, identity = ['motor_number', 'boat_number'].includes(key);
  const usedInRfh = container === 'context' ? ['grade_number', 'day_number'].includes(key)
    : container === 'entry.fields' ? rfhNumeric.has(key)
      : container === 'preview' ? ['wind_speed', 'wave_height', 'air_temperature', 'water_temperature'].includes(key)
        : ['course_number', 'weight_adjustment', 'exhibition_time', 'tilt_adjustment'].includes(key);
  return {id, container, key, sourcePath: `${rawPrefix}.${key}`, grain, type: strings.has(key) ? 'string' : 'finite_number',
    representation: identity ? 'source_identifier_not_ordered' : codes.has(key) ? 'source_category_uninterpreted' : strings.has(key) ? 'source_string_uninterpreted' : 'source_numeric_unconverted',
    meaningVerified: false, unitVerified: false, timingVerified: false, sentinelVerified: false,
    expectedTiming: 'retrospective_unverified', missingPolicy: 'preserve_missing_null_invalid_result_only_separately',
    negativePolicy: 'preserve_finite_signed_value', zeroPolicy: 'preserve_and_flag_unverified_sentinel',
    usedInRfh, implementation: 'projection_only_not_model_connection',
    roleComparison: grain !== 'boat' ? 'context_requires_ticket_varying_interaction' : identity || strings.has(key) || codes.has(key) ? 'equality_only_semantics_unverified' : 'numeric_relative_research_only',
    identityScope: identity ? 'venue_and_exchange_epoch_required_epoch_unavailable' : null};
})));

export const HISTORY_FEATURE_CONTRACT = freeze({version: 'boat_strict_prior_day_history_v1', recentStarts: 10, precedingStarts: 20,
  retainedStarts: 31, cutoff: 'strictly_prior_calendar_date', sameDayOrder: 'unverified_excluded_from_current_day',
  windowBoundary: 'split_same_day_boundary_unsupported', courseDefinition: 'historical_exhibition_course_not_result_course',
  rateUnit: 'fraction_0_1', restDefinition: 'calendar_days_since_last_observed_program_not_medical_rest',
  acceptedPlacings: 'normal_result_six_unique_ordinary_places_1_to_6', residualBaseline: 'not_defined_not_computed',
  windowsCount: 'eligible_ordinary_finish_races_not_all_observed_starts', incidentPolicy: 'excluded_result_count_and_latest_native_place_code_retained_not_diagnosis',
  historyCompleteness: 'observed_archive_only_not_career_complete', liveEligible: false});

export function buildFeatureInventoryCatalog(inventory, crosswalk, {inventorySha256} = {}) {
  const items = inventory?.items, mappings = crosswalk?.items;
  if (inventory?.schemaVersion !== 1 || crosswalk?.schemaVersion !== 1 || crosswalk.source !== 'turnmark_v1' ||
    !Array.isArray(items) || items.length !== inventory.total || !Array.isArray(mappings) || mappings.length !== items.length ||
    crosswalk.inventory?.count !== items.length || !/^[a-f0-9]{64}$/.test(inventorySha256 ?? '') || inventorySha256 !== crosswalk.inventory.sha256)
    throw Error('feature_inventory_binding_invalid');
  const mapping = new Map(mappings.map(row => [row.candidateId, row]));
  if (mapping.size !== items.length || new Set(items.map(row => row.id)).size !== items.length) throw Error('feature_inventory_duplicate_id');
  const fieldByRaw = new Map(NORMALIZED_FEATURE_FIELDS.map(field => [field.sourcePath, field]));
  const identityPaths = new Map([['program.date', 'date'], ['program.stadium_number', 'venue'], ['program.race_number', 'raceNumber'],
    ['program.racers.entry_number', 'entry.lane'], ['program.racers.number', 'entry.registration']]);
  const candidates = items.map(item => {
    const row = mapping.get(item.id);
    if (!row || row.usage !== item.usage || row.expectedUnit !== item.unit || row.inventoryTiming !== item.timing ||
      !['predictor_candidate', 'audit_only', 'label_only', 'negative_control'].includes(item.usage)) throw Error('feature_inventory_mapping_mismatch');
    const dependencies = ['requiredPaths', 'supportingPaths', 'documentedNestedPaths'].flatMap(kind => {
      if (!Array.isArray(row[kind])) throw Error('feature_inventory_paths_invalid');
      return row[kind].map(path => {
        const field = fieldByRaw.get(path);
        return {path, dependency: kind, normalizedFieldId: field?.id ?? null, identityField: identityPaths.get(path) ?? null,
          normalizedProjection: field ? 'implemented_not_measured_this_version' : identityPaths.has(path) ? 'projected_identity_outside_39_not_predictor' : 'not_in_39_field_projection',
          usedAsRfhInput: field?.usedInRfh ?? false, temporalScope: path.startsWith('result.') ? 'strictly_prior_races_only_or_label_audit' : row.pathTemporalScope};
      });
    });
    const requirements = dependencies.filter(dep => dep.dependency === 'requiredPaths');
    return {candidateId: item.id, category: item.category, label: item.label, definition: item.definition, usage: item.usage,
      expectedUnit: item.unit, inventoryTiming: item.timing, sourceRoute: row.route, dependencies,
      requiredProjectionCoverage: !requirements.length ? 'no_required_path_mapping' : requirements.every(dep => dep.normalizedFieldId || dep.identityField) ? 'all_upstream_paths_projected_definition_still_unverified' : 'partial_or_unprojected',
      structuralSignals: structuredClone(row.structuralSignals), additionalSources: structuredClone(row.additionalSources),
      unresolvedComponents: structuredClone(row.unresolvedComponents), derivation: structuredClone(row.derivation), pathTemporalScope: row.pathTemporalScope,
      candidateComputation: 'not_connected_or_validated_as_candidate_definition', candidateModelUse: 'not_established_by_field_use',
      acquisitionNeeded: ['external_source', 'unknown'].includes(row.route) || row.additionalSources.length > 0,
      meaningVerified: false, timingVerified: false, predictiveEffectVerified: false, selectionExplored: false, priceValidated: false, liveEligible: false};
  });
  const body = {version: FEATURE_INVENTORY_VERSION, canonicalInventory: {count: items.length, sha256: inventorySha256,
    path: 'docs/data/racing-condition-inventory.json'}, normalizedFieldCount: NORMALIZED_FEATURE_FIELDS.length,
    rfhInputFieldCount: NORMALIZED_FEATURE_FIELDS.filter(field => field.usedInRfh).length,
    normalizedFields: NORMALIZED_FEATURE_FIELDS, candidates, historyContract: HISTORY_FEATURE_CONTRACT,
    rawReextractionCandidates: [{path: 'preview.racers.parts', status: 'outside_normalized_39_not_source_absent',
      sourceSchema: 'https://raw.githubusercontent.com/turnmark/api/gh-pages/docs/v1/schema.md',
      schemaNotes: 'parts_array_empty_vs_null_and_quantity_null_must_remain_distinct',
      valueExtraction: 'not_implemented', historicalTiming: 'unverified'}],
    scope: 'canonical_candidate_coverage_not_all_possible_hypotheses_not_model_or_profit_qualification'};
  return freeze({...body, digest: inventoryHash(body)});
}

export function loadFeatureInventoryCatalog({inventoryUrl = new URL('../../docs/data/racing-condition-inventory.json', import.meta.url),
  crosswalkUrl = new URL('../../docs/data/boatrace-source-crosswalk.json', import.meta.url)} = {}) {
  const bytes = readFileSync(inventoryUrl), crosswalk = JSON.parse(readFileSync(crosswalkUrl, 'utf8'));
  return buildFeatureInventoryCatalog(JSON.parse(bytes.toString('utf8')), crosswalk,
    {inventorySha256: createHash('sha256').update(bytes).digest('hex')});
}
