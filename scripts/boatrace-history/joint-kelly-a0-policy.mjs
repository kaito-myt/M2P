import {kellyPredictionDigest as H, kellyPolicyFeatureSchemaDigest} from './joint-kelly-prediction-port.mjs';
import {matchConditionPatterns} from './joint-race-condition-ast.mjs';
import {inventoryHash} from './joint-feature-inventory-catalog.mjs';
import {JOINT_COMBINATIONS} from './joint-model.mjs';

export const A0_POLICY_ID = 'BOAT_A0_NATIVE_F_GT1_AVAILABILITY';
export const A0_AST = Object.freeze({args: [{cmp: 'gt', left: {feature: 'native.entry.fields.flying_count', kind: 'field', role: 'head'}, op: 'compare', right: {kind: 'number', unit: 'source_native:entry.fields.flying_count', value: 1}}, {feature: 'semantic.grade.label', is: 'available', op: 'state'}, {feature: 'semantic.wind.calm', is: 'available', op: 'state'}], op: 'and'});
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const fail = code => {throw Error('a0_' + code);};
const plain = x => x !== null && typeof x === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, names) => {if (!plain(x) || Object.keys(x).sort().join('|') !== [...names].sort().join('|')) fail('shape');};
const frozen = x => {if (x && typeof x === 'object') {Object.values(x).forEach(frozen); Object.freeze(x);} return x;};
frozen(A0_AST);
const instant = x => {const t = typeof x === 'string' ? Date.parse(x) : NaN; if (!Number.isFinite(t) || new Date(t).toISOString() !== x) fail('time'); return t;};
const names = [...Array.from({length: 6}, (_, i) => `boat/${i + 1}/flying_count`), 'race/grade_label', 'race/wind_calm'];
const field = name => ({name, type: name.startsWith('boat/') ? 'number' : name === 'race/grade_label' ? 'string' : 'boolean', unit: name.startsWith('boat/') ? 'source_native:entry.fields.flying_count' : name === 'race/grade_label' ? 'category:grade' : 'boolean', timing: 'publication_unverified'});
const originalStatuses = ['available', 'missing', 'null', 'invalid', 'unsupported'];
const stateFor = status => status === 'available' ? 'available' : status === 'invalid' ? 'invalid' : status === 'missing' ? 'missing' : 'unknown';
export function createA0FeatureSchema({sourceDigest, extractorDigest}) {
  if (!sha(sourceDigest) || !sha(extractorDigest)) fail('schema_pin');
  const fields = [...names.map(field), ...names.map(name => ({name: 'status/' + name, type: 'string', unit: 'e0_field_status', timing: 'publication_unverified'}))].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const schema = {sourceDigest, extractorDigest, fields}; return frozen({...schema, schemaDigest: kellyPolicyFeatureSchemaDigest(schema)});
}
function inspectFrame(frame, schema, decisionAt) {
  exact(frame, ['schemaDigest', 'sourceDigest', 'values', 'states', 'asOfByField']);
  if (frame.schemaDigest !== schema.schemaDigest || frame.sourceDigest !== schema.sourceDigest) fail('frame_binding');
  const all = schema.fields.map(f => f.name); for (const part of [frame.values, frame.states, frame.asOfByField]) exact(part, all);
  const at = instant(decisionAt);
  for (const name of names) {
    const statusName = 'status/' + name, status = frame.values[statusName], value = frame.values[name], type = field(name).type;
    if (!originalStatuses.includes(status) || frame.states[statusName] !== 'available' || frame.states[name] !== stateFor(status) || (status === 'available' ? typeof value !== type || type === 'number' && !Number.isFinite(value) : value !== null)) fail('field_status');
  }
  for (const name of all) if (frame.asOfByField[name] !== null && instant(frame.asOfByField[name]) > at) fail('known_future');
}
export function evaluateA0Frame({policyFeatures, schema, decisionAt}) {
  inspectFrame(policyFeatures, schema, decisionAt);
  const values = policyFeatures.values, context = values['status/race/grade_label'] === 'available' && values['status/race/wind_calm'] === 'available';
  const tickets = [], unknownIndices = [], reasons = [];
  for (let i = 0; i < JOINT_COMBINATIONS.length; i++) {
    const name = `boat/${JOINT_COMBINATIONS[i][0]}/flying_count`, status = values['status/' + name];
    if (!context) continue;
    if (status !== 'available') {unknownIndices.push(i); if (!reasons.includes(status)) reasons.push(status);}
    else if (values[name] > 1) tickets.push(i);
  }
  return frozen({tickets, unknownIndices, counts: {match: tickets.length, unknown: unknownIndices.length, false: 120 - tickets.length - unknownIndices.length}, reason: tickets.length ? null : !context ? 'context_not_available' : unknownIndices.length ? 'no_true_unknown_heads' : 'no_true_heads', unknownStatuses: reasons.sort(), operationalQualified: false, realAllocation: 0});
}
export function createA0FrameAdapter({schema, expectedAdmissionDigest, verifyConditionRace}) {
  if (!sha(expectedAdmissionDigest) || typeof verifyConditionRace !== 'function') fail('admission_required');
  exact(schema, ['sourceDigest', 'extractorDigest', 'fields', 'schemaDigest']);
  const expectedSchema = createA0FeatureSchema(schema); if (H(schema) !== H(expectedSchema)) fail('schema_exact');
  const ownedSchema = structuredClone(schema); frozen(ownedSchema);
  return Object.freeze({schema: ownedSchema, adapt({conditionRace, decisionAt, asOfByField}) {
    const at = instant(decisionAt), race = conditionRace;
    let admission; try {admission = verifyConditionRace({conditionRace: race, schema: ownedSchema, expectedAdmissionDigest});} catch {fail('admission_verifier');}
    if (!plain(admission) || admission.conditionRace !== race || H(admission.receipt) !== expectedAdmissionDigest) fail('independent_admission');
    const receipt = admission.receipt;
    exact(receipt, ['sourceDigest', 'extractorDigest', 'schemaDigest', 'registryDigest', 'materializerDigest', 'sourceConsistencyPreserved', 'resultFallbackUsed']);
    if (receipt.sourceDigest !== ownedSchema.sourceDigest || receipt.extractorDigest !== ownedSchema.extractorDigest || receipt.schemaDigest !== ownedSchema.schemaDigest || receipt.registryDigest !== race.registryDigest || !sha(receipt.materializerDigest) || receipt.sourceConsistencyPreserved !== true || receipt.resultFallbackUsed !== false) fail('materializer_binding');
    const {featureDigest, ...body} = race;
    if (!sha(featureDigest) || inventoryHash(body) !== featureDigest || race.evidence?.resultFieldsRead !== false || race.evidence?.pricesRead !== false || race.lineage?.timingScope !== 'retrospective_unverified' || race.date !== new Date(at + 9 * 3600000).toISOString().slice(0, 10) || !race.registry || race.registryDigest !== race.registry.digest || !Array.isArray(race.boats) || race.boats.length !== 6 || new Set(race.boats.map(b => b.lane)).size !== 6 || race.boats.some(b => !Number.isInteger(b.lane) || b.lane < 1 || b.lane > 6)) fail('condition_race');
    const fullNames = ownedSchema.fields.map(f => f.name); exact(asOfByField, fullNames);
    const values = {}, states = {}, originals = {};
    for (const name of names) {
      const packet = name.startsWith('boat/') ? race.boats.find(b => b.lane === Number(name.split('/')[1])).values['native.entry.fields.flying_count'] : race.raceValues[name === 'race/grade_label' ? 'semantic.grade.label' : 'semantic.wind.calm'];
      if (!packet || !originalStatuses.includes(packet.status)) fail('materialized_status');
      originals[name] = {status: packet.status, reason: packet.reason};
      values[name] = packet.status === 'available' ? packet.value : null; states[name] = stateFor(packet.status);
      values['status/' + name] = packet.status; states['status/' + name] = 'available';
    }
    const frame = {schemaDigest: ownedSchema.schemaDigest, sourceDigest: ownedSchema.sourceDigest, values, states, asOfByField: structuredClone(asOfByField)};
    const selection = evaluateA0Frame({policyFeatures: frame, schema: ownedSchema, decisionAt});
    const original = matchConditionPatterns([{patternId: A0_POLICY_ID, ast: A0_AST}], race).matches[0];
    if (H(selection.tickets) !== H(original.ticketIndices) || H(selection.unknownIndices) !== H(original.unknownIndices)) fail('materializer_ast_equivalence');
    return frozen({policyFeatures: frame, selection, diagnostics: {originals, originalReasons: original.reasons, conditionRaceDigest: featureDigest, expectedAdmissionDigest, materializerDigest: receipt.materializerDigest, publicationTimingVerified: false, nativeFMeaningVerified: false, nativeFWindowVerified: false, operationalQualified: false, financialActions: 0}});
  }});
}
export function createA0Selector(schema) {
  const owned = frozen(structuredClone(schema));
  if (H(owned) !== H(createA0FeatureSchema(owned))) fail('schema_exact');
  return ({policyFeatures, decisionAt}) => [...evaluateA0Frame({policyFeatures, schema: owned, decisionAt}).tickets];
}
