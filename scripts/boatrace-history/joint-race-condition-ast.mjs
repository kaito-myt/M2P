import {inventoryHash} from './joint-feature-inventory-catalog.mjs';
import {conditionDescriptor, assertConditionRegistry} from './joint-race-condition-registry.mjs';
import {bindTicket, CONDITION_TICKETS, resolveConditionSet} from './joint-race-condition-features.mjs';

export const CONDITION_AST_VERSION = 'boat_role_condition_ast_v1';
export const CONDITION_AST_LIMITS = Object.freeze({nodes: 256, depth: 16, array: 64, string: 256});
const roles = ['head', 'second', 'third'], states = ['available', 'missing', 'null', 'invalid', 'unsupported'];
const scalar = value => typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const key = value => JSON.stringify(canonical(value));
function guardJson(value) {
  let nodes = 0;
  const walk = (node, depth) => {
    if (depth > CONDITION_AST_LIMITS.depth) throw Error('condition_ast_depth_limit');
    if (++nodes > CONDITION_AST_LIMITS.nodes) throw Error('condition_ast_node_limit');
    if (typeof node === 'string') { if (node.length > CONDITION_AST_LIMITS.string) throw Error('condition_ast_string_limit'); return; }
    if (node === null || typeof node === 'boolean' || typeof node === 'number' && Number.isFinite(node)) return;
    if (Array.isArray(node)) {
      if (Object.getPrototypeOf(node) !== Array.prototype) throw Error('condition_ast_array_prototype');
      const lengthDescriptor = Object.getOwnPropertyDescriptor(node, 'length');
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || lengthDescriptor.enumerable || lengthDescriptor.configurable ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) throw Error('condition_ast_array_length');
      const length = lengthDescriptor.value;
      if (length > CONDITION_AST_LIMITS.array) throw Error('condition_ast_array_limit');
      const properties = Reflect.ownKeys(node);
      if (properties.length !== length + 1 || properties.some(property => typeof property !== 'string' ||
        property !== 'length' && (!/^(?:0|[1-9]\d*)$/.test(property) || Number(property) >= length))) throw Error('condition_ast_array_property_or_hole');
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(node, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw Error('condition_ast_array_dense_data_required');
        walk(descriptor.value, depth + 1);
      }
      return;
    }
    if (!node || typeof node !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(node))) throw Error('condition_ast_not_json');
    for (const property of Reflect.ownKeys(node)) {
      if (typeof property !== 'string' || property.length > CONDITION_AST_LIMITS.string || ['__proto__', 'prototype', 'constructor'].includes(property)) throw Error('condition_ast_property');
      const descriptor = Object.getOwnPropertyDescriptor(node, property);
      if (!Object.hasOwn(descriptor, 'value')) throw Error('condition_ast_accessor');
      walk(descriptor.value, depth + 1);
    }
  };
  walk(value, 0);
}
function shape(node, required, optional = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || required.some(property => !Object.hasOwn(node, property)) ||
    Object.keys(node).some(property => !required.includes(property) && !optional.includes(property))) throw Error('condition_ast_shape');
}
function setReference(ref) {
  shape(ref, ['set'], ['of', 'exclude', 'adjacency']);
  if (['all', 'remaining'].includes(ref.set)) { if (Object.keys(ref).length !== 1) throw Error('condition_set_shape'); }
  else if (ref.set === 'other_than') {
    if (!Array.isArray(ref.exclude) || ref.exclude.some(role => !roles.includes(role)) || ref.of !== undefined || ref.adjacency !== undefined) throw Error('condition_set_exclusion');
  } else if (['inner', 'outer', 'adjacent'].includes(ref.set)) {
    if (!roles.includes(ref.of) || ref.exclude !== undefined || ref.set !== 'adjacent' && ref.adjacency !== undefined ||
      ref.adjacency !== undefined && !['immediate', 'all'].includes(ref.adjacency)) throw Error('condition_set_relative');
  } else throw Error('condition_set_unknown');
  return canonical({...ref, ...(ref.set === 'other_than' ? {exclude: [...new Set(ref.exclude)].sort()} : {}),
    ...(ref.set === 'adjacent' ? {adjacency: ref.adjacency ?? 'immediate'} : {})});
}

export function validateCondition(ast, registry) {
  assertConditionRegistry(registry); guardJson(ast);
  const features = new Set(), unsupported = new Set();
  const feature = (id, role, operation) => {
    if (typeof id !== 'string') throw Error('condition_feature_id');
    const descriptor = conditionDescriptor(registry, id);
    if (descriptor.grain === 'boat' ? !roles.includes(role) : role !== undefined) throw Error('condition_feature_role');
    if (!descriptor.supportedOps.includes(operation)) throw Error('condition_feature_operation');
    features.add(id); if (descriptor.implementation !== 'implemented_primitive') unsupported.add(id);
    return descriptor;
  };
  const aggregateDescriptor = (id, operation) => {
    const descriptor = conditionDescriptor(registry, id);
    if (descriptor.grain !== 'boat' || !descriptor.supportedOps.includes(operation)) throw Error('condition_aggregate_feature');
    features.add(id); if (descriptor.implementation !== 'implemented_primitive') unsupported.add(id);
    return descriptor;
  };
  const numeric = node => {
    if (!node || typeof node !== 'object') throw Error('condition_numeric_shape');
    if (node.kind === 'number') {
      shape(node, ['kind', 'value', 'unit']);
      if (!Number.isFinite(node.value) || typeof node.value !== 'number' || typeof node.unit !== 'string' || !node.unit) throw Error('condition_numeric_literal');
      return {node: canonical(node), unit: node.unit};
    }
    if (node.kind === 'field') {
      shape(node, ['kind', 'feature'], ['role']); const descriptor = feature(node.feature, node.role, 'compare');
      if (descriptor.kind !== 'number') throw Error('condition_numeric_feature_required');
      return {node: canonical(node), unit: descriptor.unit};
    }
    if (node.kind === 'aggregate') {
      shape(node, ['kind', 'op', 'feature', 'over', 'require']);
      if (!['min', 'max', 'mean', 'median', 'spread', 'count'].includes(node.op) || node.require !== 'complete') throw Error('condition_aggregate_operation');
      const descriptor = aggregateDescriptor(node.feature, 'aggregate');
      if (descriptor.kind !== 'number' || !descriptor.domain.ordered) throw Error('condition_aggregate_numeric_required');
      return {node: canonical({...node, over: setReference(node.over)}), unit: node.op === 'count' ? 'count' : descriptor.unit};
    }
    if (node.kind === 'difference') {
      shape(node, ['kind', 'left', 'right']); const left = numeric(node.left), right = numeric(node.right);
      if (left.unit !== right.unit) throw Error('condition_unit_mismatch');
      return {node: canonical({kind: 'difference', left: left.node, right: right.node}), unit: left.unit};
    }
    if (node.kind === 'rank') {
      shape(node, ['kind', 'feature', 'role', 'over', 'direction', 'bound']); const descriptor = feature(node.feature, node.role, 'rank');
      if (descriptor.grain !== 'boat' || descriptor.kind !== 'number' || !descriptor.domain.ordered ||
        !['ascending', 'descending'].includes(node.direction) || !['low', 'high'].includes(node.bound)) throw Error('condition_rank_type');
      return {node: canonical({...node, over: setReference(node.over)}), unit: 'rank_count'};
    }
    throw Error('condition_numeric_unknown');
  };
  const expression = node => {
    if (!node || typeof node !== 'object') throw Error('condition_expression_shape');
    if (node.op === 'and' || node.op === 'or') {
      shape(node, ['op', 'args']); if (!Array.isArray(node.args) || !node.args.length) throw Error('condition_logical_empty');
      const flattened = node.args.map(expression).flatMap(child => child.op === node.op ? child.args : [child]), dedup = new Map(flattened.map(child => [key(child), child]));
      const args = [...dedup].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, child]) => child);
      return args.length === 1 ? args[0] : {op: node.op, args};
    }
    if (node.op === 'compare') {
      shape(node, ['op', 'cmp', 'left', 'right']); if (!['lt', 'le', 'eq', 'ge', 'gt'].includes(node.cmp)) throw Error('condition_compare_operator');
      const left = numeric(node.left), right = numeric(node.right);
      if (left.unit !== right.unit) throw Error('condition_unit_mismatch');
      return canonical({...node, left: left.node, right: right.node});
    }
    if (node.op === 'in') {
      shape(node, ['op', 'value', 'values']); shape(node.value, ['feature'], ['role']);
      const descriptor = feature(node.value.feature, node.value.role, 'in');
      const type = descriptor.kind === 'number' || descriptor.kind === 'category' && descriptor.binding.type === 'native' ? 'number' : descriptor.kind === 'boolean' ? 'boolean' : 'string';
      if (!Array.isArray(node.values) || !node.values.length || node.values.some(value => !scalar(value) || typeof value !== type)) throw Error('condition_in_value_type');
      return canonical({...node, values: [...new Map(node.values.map(value => [key(value), value]))].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value)});
    }
    if (node.op === 'same') {
      shape(node, ['op', 'feature', 'left', 'right']); const descriptor = feature(node.feature, node.left, 'same');
      if (descriptor.grain !== 'boat' || !roles.includes(node.right)) throw Error('condition_same_role');
      const ordered = [node.left, node.right].sort(); return canonical({...node, left: ordered[0], right: ordered[1]});
    }
    if (node.op === 'state') {
      shape(node, ['op', 'feature', 'is'], ['role']); feature(node.feature, node.role, 'state');
      if (!states.includes(node.is)) throw Error('condition_state_unknown'); return canonical(node);
    }
    throw Error('condition_expression_unknown');
  };
  const normalized = expression(ast); guardJson(normalized);
  const body = {version: CONDITION_AST_VERSION, registryDigest: registry.digest, ast: canonical(normalized)};
  const result = {...body, hash: inventoryHash(body), featureIds: [...features].sort(), unsupportedFeatureIds: [...unsupported].sort(),
    safetyLimits: CONDITION_AST_LIMITS, scientificSearchLimits: 'not_defined_by_AST_safety_limits'};
  Object.defineProperty(result, 'registry', {value: registry, enumerable: false});
  return result;
}

const unknown = (...reasons) => ({truth: 'unknown', reasons: [...new Set(reasons.flat())].sort()});
const truth = (value, reasons = []) => ({truth: value ? 'true' : 'false', reasons: [...new Set(reasons)].sort()});
const badValue = (...reasons) => ({available: false, value: null, reasons: [...new Set(reasons.flat())].sort()});
const goodValue = value => Number.isFinite(value) ? {available: true, value, reasons: []} : badValue('nonfinite_numeric_result');
function fieldValue(context, feature, role) {
  const descriptor = conditionDescriptor(context.registry, feature);
  if (descriptor.implementation !== 'implemented_primitive') return {status: 'unsupported', value: null, reason: 'unsupported_feature'};
  return (descriptor.grain === 'race' ? context.race.raceValues : context.race.boats.find(boat => boat.lane === context.roles[role])?.values)?.[feature]
    ?? {status: 'unsupported', value: null, reason: 'feature_not_bound'};
}
function numericValue(node, context) {
  if (node.kind === 'number') return goodValue(node.value);
  if (node.kind === 'field') { const field = fieldValue(context, node.feature, node.role); return field.status === 'available' ? goodValue(field.value) : badValue(field.reason ?? field.status); }
  if (node.kind === 'difference') {
    const left = numericValue(node.left, context), right = numericValue(node.right, context);
    return left.available && right.available ? goodValue(left.value - right.value) : badValue(left.reasons, right.reasons);
  }
  const set = resolveConditionSet(context, node.over);
  if (set.status !== 'available') return badValue(set.reason);
  if (!set.lanes.length) return node.kind === 'aggregate' && node.op === 'count' ? goodValue(0) : badValue('empty_role_set');
  const fields = set.lanes.map(lane => context.race.boats.find(boat => boat.lane === lane)?.values[node.feature]);
  if (fields.some(field => field?.status !== 'available')) return badValue(fields.filter(field => field?.status !== 'available').map(field => field?.reason ?? 'feature_not_bound'));
  const values = fields.map(field => field.value);
  if (node.kind === 'rank') {
    const index = set.lanes.indexOf(context.roles[node.role]); if (index < 0) return badValue('rank_role_outside_set');
    const current = values[index], better = values.filter(value => node.direction === 'ascending' ? value < current : value > current).length,
      ties = values.filter(value => value === current).length;
    return goodValue(better + (node.bound === 'high' ? ties : 1));
  }
  if (node.op === 'count') return goodValue(values.length);
  if (node.op === 'min') return goodValue(Math.min(...values));
  if (node.op === 'max') return goodValue(Math.max(...values));
  if (node.op === 'spread') return goodValue(Math.max(...values) - Math.min(...values));
  if (node.op === 'mean') return goodValue(values.reduce((sum, value) => sum + value / values.length, 0));
  const sorted = [...values].sort((a, b) => a - b), half = Math.floor(sorted.length / 2);
  return goodValue(sorted.length % 2 ? sorted[half] : sorted[half - 1] / 2 + sorted[half] / 2);
}

export function evaluateCondition(condition, context) {
  if (!context?.registry || context.registryDigest !== context.registry.digest || context.race?.registryDigest !== context.registryDigest)
    throw Error('condition_context_binding');
  const prepared = validateCondition(condition?.version === CONDITION_AST_VERSION ? condition.ast : condition, context.registry);
  if (prepared.registryDigest !== context.registryDigest || condition?.version === CONDITION_AST_VERSION &&
    (condition.registryDigest !== prepared.registryDigest || condition.hash !== prepared.hash))
    throw Error('condition_prepared_binding');
  const run = node => {
    if (node.op === 'and' || node.op === 'or') {
      const results = node.args.map(run), reasons = results.flatMap(result => result.reasons);
      if (node.op === 'and' && results.some(result => result.truth === 'false')) return truth(false, reasons);
      if (node.op === 'or' && results.some(result => result.truth === 'true')) return truth(true, reasons);
      if (results.some(result => result.truth === 'unknown')) return unknown(reasons);
      return truth(node.op === 'and', reasons);
    }
    if (node.op === 'compare') {
      const left = numericValue(node.left, context), right = numericValue(node.right, context);
      if (!left.available || !right.available) return unknown(left.reasons, right.reasons);
      return truth(node.cmp === 'lt' ? left.value < right.value : node.cmp === 'le' ? left.value <= right.value : node.cmp === 'eq' ? left.value === right.value
        : node.cmp === 'ge' ? left.value >= right.value : left.value > right.value);
    }
    if (node.op === 'state') { const field = fieldValue(context, node.feature, node.role); return truth(field.status === node.is); }
    if (node.op === 'in') { const field = fieldValue(context, node.value.feature, node.value.role); return field.status === 'available' ? truth(node.values.includes(field.value)) : unknown(field.reason ?? field.status); }
    const left = fieldValue(context, node.feature, node.left), right = fieldValue(context, node.feature, node.right);
    return left.status === 'available' && right.status === 'available' ? truth(left.value === right.value) : unknown(left.reason ?? left.status, right.reason ?? right.status);
  };
  return {...run(prepared.ast), conditionHash: prepared.hash, registryDigest: prepared.registryDigest, coordinateOnly: true, financialActions: 0, liveEligible: false};
}

export function matchConditionPatterns(patterns, race) {
  if (!Array.isArray(patterns) || patterns.length > 64 || patterns.some(row => typeof row.patternId !== 'string' || !row.patternId || row.patternId.length > 256) ||
    new Set(patterns.map(row => row.patternId)).size !== patterns.length) throw Error('condition_pattern_batch_invalid');
  const provenance = new Map(), matches = patterns.map(pattern => {
    const condition = validateCondition(pattern.ast, race.registry), ticketIndices = [], unknownIndices = [], reasons = new Set();
    for (let index = 0; index < CONDITION_TICKETS.length; index++) {
      const result = evaluateCondition(condition, bindTicket(race, CONDITION_TICKETS[index]));
      result.reasons.forEach(reason => reasons.add(reason));
      if (result.truth === 'true') { ticketIndices.push(index); if (!provenance.has(index)) provenance.set(index, []); provenance.get(index).push(pattern.patternId); }
      else if (result.truth === 'unknown') unknownIndices.push(index);
    }
    return {patternId: pattern.patternId, conditionHash: condition.hash, ticketIndices, unknownIndices,
      counts: {match: ticketIndices.length, unknown: unknownIndices.length, false: 120 - ticketIndices.length - unknownIndices.length}, reasons: [...reasons].sort()};
  });
  return {raceKey: race.raceKey, registryDigest: race.registryDigest, matches,
    ticketProvenance: [...provenance].sort(([a], [b]) => a - b).map(([ticketIndex, patternIds]) => ({ticketIndex, patternIds: patternIds.sort()})),
    status: 'research_matches_only', batchSafetyLimit: 64, financialActions: 0, liveEligible: false};
}
