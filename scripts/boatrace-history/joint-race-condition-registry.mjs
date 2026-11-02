import {FEATURE_INVENTORY_VERSION, NORMALIZED_FEATURE_FIELDS, HISTORY_FEATURE_CONTRACT, inventoryHash} from './joint-feature-inventory-catalog.mjs';
import {FEATURE_SEMANTICS_VERSION, MEANING_SOURCE_VERSION} from './joint-feature-semantics.mjs';

export const CONDITION_REGISTRY_VERSION = 'boat_role_condition_registry_v1';
export const CONDITION_INVENTORY_SHA = '560febca1b2756c38eb9511639a14681c8507666cfbd3f97467d6cbcae9c8362';
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const CONDITION_FIELD_FAMILIES = Object.freeze({
  'context.closed_at': 'meeting', 'context.grade_number': 'meeting', 'context.title': 'meeting', 'context.subtitle': 'meeting', 'context.distance': 'meeting', 'context.day_number': 'meeting',
  'entry.fields.rank_number': 'racer_ability', 'entry.fields.branch_number': 'racer_profile', 'entry.fields.birthplace_number': 'racer_profile', 'entry.fields.age': 'racer_profile', 'entry.fields.weight': 'racer_profile',
  'entry.fields.flying_count': 'start_skill', 'entry.fields.late_count': 'start_skill', 'entry.fields.average_start_timing': 'start_skill',
  'entry.fields.national_win_rate': 'racer_ability', 'entry.fields.national_top_2_percent': 'racer_ability', 'entry.fields.national_top_3_percent': 'racer_ability',
  'entry.fields.local_win_rate': 'racer_ability', 'entry.fields.local_top_2_percent': 'racer_ability', 'entry.fields.local_top_3_percent': 'racer_ability',
  'entry.fields.motor_number': 'motor', 'entry.fields.motor_top_2_percent': 'motor', 'entry.fields.motor_top_3_percent': 'motor',
  'entry.fields.boat_number': 'boat', 'entry.fields.boat_top_2_percent': 'boat', 'entry.fields.boat_top_3_percent': 'boat',
  'preview.wind_speed': 'weather', 'preview.wind_direction_number': 'weather', 'preview.wave_height': 'weather', 'preview.weather_number': 'weather', 'preview.air_temperature': 'weather', 'preview.water_temperature': 'weather',
  'entry.preview.course_number': 'exhibition', 'entry.preview.start_timing': 'exhibition', 'entry.preview.weight': 'exhibition', 'entry.preview.weight_adjustment': 'exhibition',
  'entry.preview.exhibition_time': 'exhibition', 'entry.preview.tilt_adjustment': 'exhibition', 'entry.preview.propeller': 'exhibition',
});
export const CONDITION_HISTORY_FIELDS = freeze([
  ...['recent10', 'preceding20'].flatMap(window => [
    {path: `${window}.meanPlace`, kind: 'number', unit: 'ordinary_finish_place', candidateIds: ['recent_finish_sequence']},
    {path: `${window}.winRate`, kind: 'number', unit: 'fraction_0_1', candidateIds: ['recent_win_rate']},
    {path: `${window}.top2Rate`, kind: 'number', unit: 'fraction_0_1', candidateIds: ['recent_top2_rate']},
    {path: `${window}.top3Rate`, kind: 'number', unit: 'fraction_0_1', candidateIds: ['recent_top3_rate']},
    {path: `${window}.support`, kind: 'number', unit: 'count', candidateIds: []},
  ]),
  {path: 'windowContrast.meanPlaceDelta', kind: 'number', unit: 'ordinary_finish_place', candidateIds: ['recent_score_trend']},
  {path: 'windowContrast.top2RateDelta', kind: 'number', unit: 'fraction_0_1', candidateIds: ['recent_top2_rate']},
  {path: 'windowContrast.fullWindowSupport', kind: 'boolean', unit: 'boolean', candidateIds: []},
  {path: 'daysSinceLastObservedProgram', kind: 'number', unit: 'calendar_days', candidateIds: ['rest_days']},
  {path: 'daysSinceLastEligibleResult', kind: 'number', unit: 'calendar_days', candidateIds: ['rest_days']},
  {path: 'support.observedPrograms', kind: 'number', unit: 'count', candidateIds: []},
  {path: 'support.excludedResultRaces', kind: 'number', unit: 'count', candidateIds: []},
]);
export const CONDITION_SEMANTIC_FIELDS = freeze([
  {decoder: 'grade', path: 'label', grain: 'race', kind: 'category', unit: 'category:grade', family: 'meeting', sourceFields: ['context.grade_number']},
  {decoder: 'rank', path: 'label', grain: 'boat', kind: 'category', unit: 'category:rank', family: 'racer_ability', sourceFields: ['entry.fields.rank_number']},
  {decoder: 'weather', path: 'label', grain: 'race', kind: 'category', unit: 'category:weather', family: 'weather', sourceFields: ['preview.weather_number']},
  {decoder: 'wind', path: 'label', grain: 'race', kind: 'category', unit: 'category:wind', family: 'weather', sourceFields: ['preview.wind_direction_number']},
  {decoder: 'wind', path: 'calm', grain: 'race', kind: 'boolean', unit: 'boolean', family: 'weather', sourceFields: ['preview.wind_direction_number']},
  {decoder: 'wind', path: 'compassDegreesClockwiseFromNorth', grain: 'race', kind: 'number', unit: 'compass_degrees', family: 'weather', sourceFields: ['preview.wind_direction_number']},
  {decoder: 'region', path: 'sameNativeRegion', grain: 'boat', kind: 'boolean', unit: 'boolean', family: 'racer_profile', sourceFields: ['entry.fields.branch_number', 'entry.fields.birthplace_number']},
  {decoder: 'startTiming', path: 'expectedSignedValue', grain: 'boat', kind: 'number', unit: 'seconds_exhibition_st', family: 'exhibition', sourceFields: ['entry.preview.start_timing']},
  {decoder: 'startTiming', path: 'earlyFlag', grain: 'boat', kind: 'boolean', unit: 'boolean', family: 'exhibition', sourceFields: ['entry.preview.start_timing']},
  {decoder: 'startTiming', path: 'lateFlag', grain: 'boat', kind: 'boolean', unit: 'boolean', family: 'exhibition', sourceFields: ['entry.preview.start_timing']},
  {decoder: 'startTiming', path: 'rawState', grain: 'boat', kind: 'category', unit: 'category:exhibition_st_raw_state', family: 'exhibition', sourceFields: ['entry.preview.start_timing']},
  {decoder: 'plannedClose', path: 'plannedHour', grain: 'race', kind: 'number', unit: 'scheduled_hour', family: 'meeting', sourceFields: ['context.closed_at']},
  {decoder: 'plannedClose', path: 'plannedMinutesOfDay', grain: 'race', kind: 'number', unit: 'scheduled_minutes_of_day', family: 'meeting', sourceFields: ['context.closed_at']},
  {decoder: 'raceSubtitle', path: 'raceType', grain: 'race', kind: 'category', unit: 'category:race_subtitle', family: 'meeting', sourceFields: ['context.subtitle']},
  {decoder: 'parts', path: 'hasAnyExchange', grain: 'boat', kind: 'boolean', unit: 'boolean', family: 'motor', sourceFields: []},
  {decoder: 'parts', path: 'totalQuantity', grain: 'boat', kind: 'number', unit: 'count', family: 'motor', sourceFields: []},
  {decoder: 'parts', path: 'propeller.exchangeMarked', grain: 'boat', kind: 'boolean', unit: 'boolean', family: 'exhibition', sourceFields: ['entry.preview.propeller']},
]);
const indices = new WeakMap();
const contract = row => ({...row, contractDigest: inventoryHash(row)});
const ops = kind => kind === 'number' ? ['compare', 'difference', 'aggregate', 'rank', 'in', 'same', 'state'] : ['in', 'same', 'state'];

export function buildConditionRegistry({catalog, crosswalk, crosswalkSha, semanticsVersion = FEATURE_SEMANTICS_VERSION} = {}) {
  const {digest: catalogDigest, ...catalogBody} = catalog ?? {};
  if (catalog?.version !== FEATURE_INVENTORY_VERSION || inventoryHash(catalogBody) !== catalogDigest || catalog.canonicalInventory?.sha256 !== CONDITION_INVENTORY_SHA ||
    catalog.candidates?.length !== 374 || catalog.normalizedFields?.length !== 39 || crosswalk?.schemaVersion !== 1 || crosswalk.source !== 'turnmark_v1' ||
    crosswalk.inventory?.sha256 !== CONDITION_INVENTORY_SHA || !sha(crosswalkSha) || crosswalkSha !== inventoryHash(crosswalk) || !Array.isArray(crosswalk.items) || crosswalk.items.length !== 374 ||
    ![FEATURE_SEMANTICS_VERSION, null].includes(semanticsVersion)) throw Error('condition_registry_source_binding');
  const candidates = new Map(catalog.candidates.map(row => [row.candidateId, row])), rows = new Map(crosswalk.items.map(row => [row.candidateId, row]));
  if (candidates.size !== 374 || rows.size !== 374 || [...candidates].some(([id, row]) => rows.get(id)?.usage !== row.usage || rows.get(id)?.expectedUnit !== row.expectedUnit || rows.get(id)?.inventoryTiming !== row.inventoryTiming))
    throw Error('condition_registry_candidate_binding');
  if (inventoryHash(catalog.normalizedFields) !== inventoryHash(NORMALIZED_FEATURE_FIELDS) || inventoryHash(catalog.historyContract) !== inventoryHash(HISTORY_FEATURE_CONTRACT))
    throw Error('condition_registry_projection_contract');
  const linked = field => catalog.candidates.filter(candidate => candidate.dependencies.some(dep => dep.normalizedFieldId === field)).map(row => row.candidateId).sort();
  const linksFor = fields => [...new Set(fields.flatMap(linked))].sort();
  const make = row => contract({...row, candidateIds: [...new Set(row.candidateIds)].sort(), candidateDefinitionCoverage: 'partial_not_candidate_definition_completion',
    relatedCandidateCategories: [...new Set(row.candidateIds.map(id => candidates.get(id)?.category).filter(Boolean))].sort(),
    usage: 'predictor_candidate', historicalGeneratorVerified: false, domain: {ordered: row.kind === 'number'}, supportedOps: ops(row.kind)});
  const descriptors = NORMALIZED_FEATURE_FIELDS.map(field => make({id: `native.${field.id}`, candidateIds: linked(field.id),
    kind: field.type === 'string' ? 'string' : ['source_category_uninterpreted', 'source_identifier_not_ordered'].includes(field.representation) ? 'category' : 'number',
    unit: `source_native:${field.id}`, family: CONDITION_FIELD_FAMILIES[field.id], grain: field.grain, implementation: 'implemented_primitive',
    meaning: 'native_only', meaningVersion: null, timing: 'retrospective_unverified', sourcePaths: [field.sourcePath], binding: {type: 'native', fieldId: field.id}}));
  for (const field of CONDITION_HISTORY_FIELDS) descriptors.push(make({id: `history.${field.path}`, candidateIds: field.candidateIds.filter(id => candidates.has(id)),
    kind: field.kind, unit: field.unit, family: 'recent_form', grain: 'boat', implementation: 'implemented_primitive', meaning: 'version_bound',
    meaningVersion: HISTORY_FEATURE_CONTRACT.version, timing: 'prior_day_observed', sourcePaths: ['strict_prior_program_identity', 'strict_prior_result_placings'],
    binding: {type: 'history', path: field.path}}));
  for (const field of CONDITION_SEMANTIC_FIELDS) descriptors.push(make({id: `semantic.${field.decoder}.${field.path}`, candidateIds: linksFor(field.sourceFields),
    kind: field.kind, unit: field.unit, family: field.family, grain: field.grain, implementation: semanticsVersion === null ? 'not_implemented' : 'implemented_primitive',
    meaning: semanticsVersion === null ? 'unverified' : 'version_bound', meaningVersion: semanticsVersion === null ? null : MEANING_SOURCE_VERSION,
    timing: 'retrospective_unverified', sourcePaths: field.sourceFields.map(id => NORMALIZED_FEATURE_FIELDS.find(row => row.id === id).sourcePath),
    binding: {type: 'semantic', decoder: field.decoder, path: field.path}}));
  descriptors.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const body = {version: CONDITION_REGISTRY_VERSION, canonicalInventorySha: CONDITION_INVENTORY_SHA, crosswalkSha,
    crosswalkContentDigest: inventoryHash(crosswalk), crosswalkHashFormat: 'parsed_JSON_order_preserving_sha256_not_raw_file_bytes', inventoryCatalogDigest: catalogDigest,
    projectionVersion: FEATURE_INVENTORY_VERSION, historyContractDigest: inventoryHash(HISTORY_FEATURE_CONTRACT), semanticsVersion,
    descriptors, candidates: [...candidates.values()].map(row => ({candidateId: row.candidateId, usage: row.usage,
      computation: row.candidateComputation, acquisition: row.sourceRoute, unresolved: [...row.unresolvedComponents],
      predictiveEffectVerified: false, selectionExplored: false, priceValidated: false})),
    scope: 'primitive_condition_evaluation_only_not_search_or_financial_qualification', financialActions: 0, liveEligible: false};
  const registry = freeze({...body, digest: inventoryHash(body)});
  assertConditionRegistry(registry);
  return registry;
}

export function assertConditionRegistry(registry) {
  if (indices.has(registry)) return registry;
  const {digest, ...body} = registry ?? {};
  if (registry?.version !== CONDITION_REGISTRY_VERSION || inventoryHash(body) !== digest || registry.canonicalInventorySha !== CONDITION_INVENTORY_SHA ||
    !Array.isArray(registry.descriptors) || registry.descriptors.length !== 73 || new Set(registry.descriptors.map(row => row.id)).size !== registry.descriptors.length ||
    !Array.isArray(registry.candidates) || registry.candidates.length !== 374 || new Set(registry.candidates.map(row => row.candidateId)).size !== 374)
    throw Error('condition_registry_integrity');
  for (const descriptor of registry.descriptors) {
    const {contractDigest, ...definition} = descriptor;
    if (inventoryHash(definition) !== contractDigest || !descriptor.family || !['number', 'category', 'string', 'boolean'].includes(descriptor.kind))
      throw Error('condition_registry_descriptor_integrity');
  }
  if (Object.isFrozen(registry) && registry.descriptors.every(Object.isFrozen)) indices.set(registry, new Map(registry.descriptors.map(row => [row.id, row])));
  return registry;
}
export function conditionDescriptor(registry, id) {
  assertConditionRegistry(registry);
  const descriptor = indices.get(registry)?.get(id) ?? registry.descriptors.find(row => row.id === id);
  if (!descriptor) {
    const candidate = registry.candidates.find(row => `candidate.${row.candidateId}` === id);
    if (candidate && candidate.usage !== 'predictor_candidate') throw Error('condition_usage_forbidden');
    if (candidate) throw Error('condition_unsupported_feature');
    throw Error('condition_unknown_feature');
  }
  if (descriptor.usage !== 'predictor_candidate') throw Error('condition_usage_forbidden');
  return descriptor;
}
