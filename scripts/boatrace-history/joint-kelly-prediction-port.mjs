import {createHash} from 'node:crypto';
import {JOINT_COMBINATIONS, indexOfJointTriple, predictJoint, withJointTemperature} from './joint-model.mjs';
import {contextFeatures} from './joint-context-features.mjs';
import {predictContextProbability} from './joint-context-calibration.mjs';
import {globalReferenceDigest, GLOBAL_REFERENCE_VERSION, GLOBAL_REFERENCE_METHOD, GLOBAL_REFERENCE_SCHEMA_DIGEST, GLOBAL_REFERENCE_BOUNDARY_DIGEST, assertGlobalReferenceArtifact, predictGlobalReferenceProbability} from './joint-kelly-global-calibration.mjs';
import {formationMarketMass} from './joint-formation-calibration.mjs';

export const KELLY_PREDICTION_PORT_VERSION = 'kelly_selected_package_prediction_v1';
const modes = ['STRICT_OPERATIONAL', 'RETROSPECTIVE_REFERENCE'];
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const object = x => x !== null && typeof x === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(x));
class Rejection extends Error {constructor(code) {super(`kelly_prediction_${code}`); this.code = code;}}
const reject = code => {throw new Rejection(code);};
function shape(x, keys, code = 'shape') {
  if (!object(x) || Object.keys(x).sort().join('|') !== [...keys].sort().join('|')) reject(code);
}
function stamp(x) {
  const t = typeof x === 'string' ? Date.parse(x.length === 10 ? x + 'T00:00:00.000Z' : x) : NaN;
  if (!Number.isFinite(t) || (x.length === 10 ? new Date(t).toISOString().slice(0, 10) !== x : new Date(t).toISOString() !== x)) reject('time');
  return t;
}
const iso = x => new Date(stamp(x)).toISOString();
function instant(x) {if (typeof x !== 'string' || x.length !== 24 || iso(x) !== x) reject('instant'); return stamp(x);}
const labelTime = x => stamp(x) - (x.length === 10 ? 9 * 3600000 : 0);
const labelISO = x => new Date(labelTime(x)).toISOString();
const sourceDay = at => new Date(at + 9 * 3600000).toISOString().slice(0, 10);
function tagged(x) {
  if (x === null) return ['null'];
  if (typeof x === 'boolean' || typeof x === 'string') return [typeof x, x];
  if (typeof x === 'number') {
    if (!finite(x) && !Number.isNaN(x)) reject('hash_value');
    return ['number', Number.isNaN(x) ? 'NaN' : Object.is(x, -0) ? '-0' : String(x)];
  }
  if (ArrayBuffer.isView(x) && !(x instanceof DataView)) return ['typed', x.constructor.name, Array.from(x, tagged)];
  if (Array.isArray(x)) return ['array', x.map(tagged)];
  if (object(x)) return ['object', Object.keys(x).sort().map(k => [k, tagged(x[k])])];
  reject('hash_value');
}
export const kellyPredictionDigest = value => createHash('sha256').update(JSON.stringify(tagged(value))).digest('hex');
export function kellyExpertPolicyDigest(value) {
  const keys = ['generatorDigest', 'selectorDigest', 'catalogDigest', 'missingPolicyDigest', 'implementationDigest', 'configDigest'];
  digests(value, keys);
  return kellyPredictionDigest({version: 'kelly_expert_policy_binding_v1', ...Object.fromEntries(keys.map(k => [k, value[k]]))});
}
export function kellyPolicyFeatureSchemaDigest({extractorDigest, fields}) {
  return kellyPredictionDigest({version: 'kelly_policy_feature_schema_v1', extractorDigest, fields});
}
function jsonCanonical(x) {
  if (x === null || typeof x === 'boolean' || typeof x === 'string' || finite(x)) return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(jsonCanonical).join(',') + ']';
  if (object(x)) return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + jsonCanonical(x[k])).join(',') + '}';
  reject('funding_hash_value');
}
const fundingHash = value => createHash('sha256').update(jsonCanonical(value)).digest('hex');
function freeze(x) {if (x && typeof x === 'object') {for (const child of Object.values(x)) freeze(child); if (!ArrayBuffer.isView(x)) Object.freeze(x);} return x;}
const clone = value => structuredClone(value);
function digests(x, keys) {if (!keys.every(k => sha(x[k]))) reject('digest');}
function range(from, to) {if (labelTime(from) >= labelTime(to)) reject('range');}

function inspectAdmission(a, artifacts, policy) {
  shape(a, ['version', 'evidenceDigest', 'timeZone', 'labelCutoffSemantics', 'model', 'calibration', 'policy', 'evaluation', 'referenceAssumptionDigest', 'moneyUnitEvidenceDigest', 'policyFeatureSchema']);
  if (a.version !== 'kelly_prediction_admission_v1' || a.timeZone !== 'Asia/Tokyo' || a.labelCutoffSemantics !== 'exclusive' || !sha(a.evidenceDigest) || !(a.referenceAssumptionDigest === null || sha(a.referenceAssumptionDigest)) || !(a.moneyUnitEvidenceDigest === null || sha(a.moneyUnitEvidenceDigest))) reject('admission');
  const m = a.model, c = a.calibration, p = a.policy;
  shape(policy.config, ['settings', 'policyFeatureSchemaDigest']);
  if (!object(policy.config.settings)) reject('policy_config');
  const schema = a.policyFeatureSchema;
  if (schema !== null) {
    shape(schema, ['schemaDigest', 'sourceDigest', 'extractorDigest', 'fields']); digests(schema, ['schemaDigest', 'sourceDigest', 'extractorDigest']);
    if (!Array.isArray(schema.fields) || schema.fields.length < 1 || schema.fields.length > 512) reject('policy_feature_schema');
    let previous = '';
    for (const field of schema.fields) {
      shape(field, ['name', 'type', 'unit', 'timing']);
      if (typeof field.name !== 'string' || !/^[A-Za-z0-9_./:-]{1,160}$/.test(field.name) || field.name <= previous || ['__proto__', 'prototype', 'constructor'].includes(field.name) || !['number', 'string', 'boolean'].includes(field.type) || typeof field.unit !== 'string' || !field.unit.length || field.unit.length > 128 || !['before_decision', 'strict_past', 'publication_unverified'].includes(field.timing)) reject('policy_feature_schema');
      previous = field.name;
    }
    if (kellyPolicyFeatureSchemaDigest(schema) !== schema.schemaDigest) reject('policy_feature_schema');
  }
  if (policy.config.policyFeatureSchemaDigest !== (schema?.schemaDigest ?? null)) reject('policy_feature_schema');
  shape(m, ['artifactSHA', 'bodyDigest', 'codeDigest', 'modelDigest', 'featureSpecDigest', 'featureSchemaDigest', 'sourceSnapshotDigest', 'trainFrom', 'trainEnd', 'internalSelectionEnd', 'labelUseEnd', 'computedAt', 'labelOrderVerified', 'timingVerified', 'featureUnitsVerified', 'inputSchemaVerified', 'codeTransformVerified', 'knownPostDecisionFeatures']);
  const globalOnly = artifacts.calibration?.version === GLOBAL_REFERENCE_VERSION;
  shape(c, ['artifactSHA', 'bodyDigest', 'boundaryBodyDigest', 'modelArtifactSHA', 'policyDigest', 'selectorDigest', 'catalogDigest', 'missingPolicyDigest', 'temperature', 'from', 'to', 'boundaryDigest', 'oofDigest', 'oofKind', 'labelUseEnd', 'computedAt', 'labelOrderVerified', ...(globalOnly ? ['methodId', 'methodSchemaDigest', 'methodReceiptDigest'] : [])]);
  shape(p, ['policyDigest', 'generatorDigest', 'selectorDigest', 'catalogDigest', 'missingPolicyDigest', 'implementationDigest', 'configDigest', 'frozenAt', 'replayFrozenAt', 'replayStartedAt', 'selectionLabelUseEnd', 'discoveryLabelWindows', 'policyProvenance', 'nonOraclePolicyReviewed', 'runtimeInputIsolationVerified']);
  shape(a.evaluation, ['from', 'to']); range(a.evaluation.from, a.evaluation.to);
  digests(m, ['artifactSHA', 'bodyDigest', 'codeDigest', 'modelDigest', 'featureSpecDigest', 'featureSchemaDigest', 'sourceSnapshotDigest']);
  digests(c, ['artifactSHA', 'bodyDigest', 'boundaryBodyDigest', 'modelArtifactSHA', 'policyDigest', 'selectorDigest', 'catalogDigest', 'missingPolicyDigest', 'boundaryDigest', 'oofDigest']);
  digests(p, ['policyDigest', 'generatorDigest', 'selectorDigest', 'catalogDigest', 'missingPolicyDigest', 'implementationDigest', 'configDigest']);
  for (const k of ['labelOrderVerified', 'timingVerified', 'featureUnitsVerified', 'inputSchemaVerified', 'codeTransformVerified', 'knownPostDecisionFeatures']) if (typeof m[k] !== 'boolean') reject('admission_flags');
  if (typeof c.labelOrderVerified !== 'boolean' || !m.labelOrderVerified || !c.labelOrderVerified || !m.inputSchemaVerified || !m.codeTransformVerified || m.knownPostDecisionFeatures) reject('admission_flags');
  range(m.trainFrom, m.trainEnd); range(c.from, c.to);
  for (const value of [m.computedAt, c.computedAt]) if (value !== null) instant(value);
  if (labelTime(m.trainEnd) > labelTime(c.from) || labelTime(m.internalSelectionEnd) > labelTime(c.from) || labelTime(m.labelUseEnd) < labelTime(m.trainEnd) || labelTime(m.labelUseEnd) > labelTime(c.from) || labelTime(c.labelUseEnd) < labelTime(c.to)) reject('label_order');
  if (c.oofKind !== 'out_of_time' || c.temperature !== 1 || c.modelArtifactSHA !== m.artifactSHA) reject('calibration_provenance');
  if (['policyDigest', 'selectorDigest', 'catalogDigest', 'missingPolicyDigest'].some(k => c[k] !== p[k]) || policy.digest !== p.policyDigest || policy.implementationDigest !== p.implementationDigest || kellyPredictionDigest(policy.config) !== p.configDigest || kellyExpertPolicyDigest(p) !== p.policyDigest) reject('calibration_policy');
  if (!['PAST_ONLY', 'POSTHOC_HYPOTHESIS'].includes(p.policyProvenance) || p.nonOraclePolicyReviewed !== true || p.runtimeInputIsolationVerified !== true || !Array.isArray(p.discoveryLabelWindows) || p.discoveryLabelWindows.length > 32) reject('policy_provenance');
  let discoveryEnd = null;
  for (const window of p.discoveryLabelWindows) {
    shape(window, ['from', 'to']); range(window.from, window.to);
    if (discoveryEnd !== null && labelTime(window.from) < labelTime(discoveryEnd)) reject('discovery_windows');
    discoveryEnd = window.to;
  }
  if (discoveryEnd === null ? p.selectionLabelUseEnd !== null : labelISO(p.selectionLabelUseEnd) !== labelISO(discoveryEnd)) reject('discovery_label_use_unknown');
  if (instant(p.replayFrozenAt) < instant(p.frozenAt) || instant(p.replayFrozenAt) >= instant(p.replayStartedAt) || discoveryEnd !== null && stamp(p.frozenAt) < labelTime(discoveryEnd)) reject('policy_freeze');
  if (labelTime(c.to) > labelTime(a.evaluation.from) || labelTime(c.labelUseEnd) > labelTime(a.evaluation.from)) reject('evaluation_label_order');
  if (p.policyProvenance === 'PAST_ONLY' && (stamp(p.frozenAt) > labelTime(c.from) || discoveryEnd !== null && labelTime(discoveryEnd) > labelTime(c.from))) reject('policy_not_past_only');
  if (kellyPredictionDigest(artifacts.model) !== m.bodyDigest || kellyPredictionDigest(artifacts.calibration) !== c.bodyDigest || kellyPredictionDigest(artifacts.boundaries) !== c.boundaryBodyDigest) reject('artifact_body');
  const recomputed = withJointTemperature(artifacts.model, artifacts.model.temperature);
  if (recomputed.modelDigest !== m.modelDigest || artifacts.model.featureSpec.digest !== m.featureSpecDigest || artifacts.model.featureSpec.timingVerified !== m.timingVerified || artifacts.model.featureSpec.rawUnitsVerified !== m.featureUnitsVerified || labelISO(artifacts.model.featureSpec.fitRange.from) !== labelISO(m.trainFrom) || labelISO(artifacts.model.featureSpec.fitRange.to) !== labelISO(m.trainEnd)) reject('model_binding');
  if (globalOnly) {
    assertGlobalReferenceArtifact(artifacts.calibration);
    const g = artifacts.calibration, binding = g.methodReceipt.binding;
    if (binding.rawInputDigest !== globalReferenceDigest({codeDigest: m.codeDigest, featureSpecDigest: m.featureSpecDigest, featureSchemaDigest: m.featureSchemaDigest, temperature: 1}) || binding.modelLabelOrderDigest !== globalReferenceDigest({trainFrom: labelISO(m.trainFrom), trainEnd: labelISO(m.trainEnd), internalSelectionEnd: labelISO(m.internalSelectionEnd), labelUseEnd: labelISO(m.labelUseEnd)}) || binding.inputContractDigest !== globalReferenceDigest({sourceSnapshotDigest: m.sourceSnapshotDigest, featureSchemaDigest: m.featureSchemaDigest, policyFeatureSchemaDigest: a.policyFeatureSchema?.schemaDigest ?? null, missingPolicyDigest: p.missingPolicyDigest, moneyUnitEvidenceDigest: a.moneyUnitEvidenceDigest, mode: 'RETROSPECTIVE_REFERENCE'})) reject('global_source_binding');
    if (artifacts.boundaries !== null || c.methodId !== GLOBAL_REFERENCE_METHOD || c.methodSchemaDigest !== GLOBAL_REFERENCE_SCHEMA_DIGEST || c.methodReceiptDigest !== g.methodReceiptDigest || c.boundaryDigest !== GLOBAL_REFERENCE_BOUNDARY_DIGEST || labelISO(g.from) !== labelISO(c.from) || labelISO(g.to) !== labelISO(c.to) || labelISO(g.evaluationFrom) !== labelISO(a.evaluation.from) || labelISO(g.evaluationTo) !== labelISO(a.evaluation.to) || binding.policyDigest !== p.policyDigest || binding.selectorDigest !== p.selectorDigest || binding.modelArtifactSHA !== m.artifactSHA) reject('global_calibration_binding');
  } else {
  if (labelISO(artifacts.calibration.from) !== labelISO(c.from) || labelISO(artifacts.calibration.to) !== labelISO(c.to) || labelISO(artifacts.calibration.globalModel?.from) !== labelISO(c.from) || labelISO(artifacts.calibration.globalModel?.to) !== labelISO(c.to) || artifacts.calibration.boundaryDigest !== c.boundaryDigest || artifacts.boundaries.digest !== c.boundaryDigest || labelTime(artifacts.boundaries.from) >= labelTime(artifacts.boundaries.to) || labelTime(artifacts.boundaries.to) > labelTime(c.from)) reject('calibration_binding');
  }
}

function inspectFrame(frame, a, mode) {
  shape(frame, ['raceKey', 'date', 'decisionAt', 'modelInput', 'sourceSnapshotDigest', 'featureSchemaDigest', 'cohortDigest', 'featureAsOf', 'fieldAsOf', 'knownPostDecisionFeatures', 'missingPolicyDigest', 'policyFeatureFrame']);
  if (typeof frame.raceKey !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(frame.raceKey) || ['__proto__', 'prototype', 'constructor'].includes(frame.raceKey) || frame.date !== sourceDay(instant(frame.decisionAt))) reject('race');
  const at = instant(frame.decisionAt), m = a.model, c = a.calibration, p = a.policy;
  if (labelTime(c.to) > at || labelTime(c.labelUseEnd) > at || labelTime(m.trainEnd) > at || labelTime(m.internalSelectionEnd) > at || labelTime(m.labelUseEnd) > at) reject('not_past_only');
  if (at < labelTime(a.evaluation.from) || at >= labelTime(a.evaluation.to)) reject('evaluation_range');
  if (mode === 'STRICT_OPERATIONAL' && p.policyProvenance !== 'PAST_ONLY') reject('posthoc_not_operational');
  if (mode === 'STRICT_OPERATIONAL' && (m.computedAt === null || c.computedAt === null || stamp(m.computedAt) > at || stamp(c.computedAt) > at)) reject('artifact_not_existing_asof');
  if (mode === 'STRICT_OPERATIONAL' && (!m.timingVerified || !m.featureUnitsVerified)) reject('operational_feature_unverified');
  if (mode === 'RETROSPECTIVE_REFERENCE' && !sha(a.referenceAssumptionDigest)) reject('reference_assumptions_missing');
  digests(frame, ['sourceSnapshotDigest', 'featureSchemaDigest', 'cohortDigest', 'missingPolicyDigest']);
  if (frame.sourceSnapshotDigest !== m.sourceSnapshotDigest || frame.featureSchemaDigest !== m.featureSchemaDigest || frame.missingPolicyDigest !== p.missingPolicyDigest) reject('feature_binding');
  if (frame.knownPostDecisionFeatures !== false || !object(frame.fieldAsOf)) reject('known_postdecision_feature');
  if (m.timingVerified) {if (frame.featureAsOf === 'unverified' || instant(frame.featureAsOf) > at) reject('feature_asof');}
  else if (mode !== 'RETROSPECTIVE_REFERENCE' || frame.featureAsOf !== 'unverified') reject('feature_asof_status');
  for (const value of Object.values(frame.fieldAsOf)) if (value !== 'unverified' ? instant(value) > at : mode === 'STRICT_OPERATIONAL') reject('known_postdecision_feature');
  const input = frame.modelInput; shape(input, ['values', 'context', 'venue', 'grade']);
  for (const [key, n] of [['values', 108], ['context', 5]]) if ((!Array.isArray(input[key]) && !ArrayBuffer.isView(input[key])) || input[key].length !== n || Array.from(input[key]).some(x => typeof x !== 'number' || !finite(x) && !Number.isNaN(x))) reject('feature_input');
  if (!Number.isSafeInteger(input.venue) || input.venue < 1 || input.venue > 24 || !Number.isSafeInteger(input.grade) || input.grade < -1 || input.grade > 32767) reject('feature_input');
  return at;
}
function nativeModelInput(input) {
  const result = {venue: input.venue, grade: input.grade};
  for (const name of ['values', 'context']) {
    result[name] = Float32Array.from(input[name]);
    if (Array.from(result[name]).some((x, i) => !Number.isFinite(x) && !Number.isNaN(input[name][i]))) reject('feature_float32_overflow');
  }
  return result;
}
function inspectPolicyFeatures(frame, schema, mode, at) {
  if (schema === null) {if (frame !== null) reject('policy_features_not_admitted'); return {digest: null, unknownAsOf: []};}
  if (frame === null) reject('policy_features_missing');
  shape(frame, ['schemaDigest', 'sourceDigest', 'values', 'states', 'asOfByField']);
  if (frame.schemaDigest !== schema.schemaDigest || frame.sourceDigest !== schema.sourceDigest) reject('policy_features_binding');
  const names = schema.fields.map(f => f.name); for (const values of [frame.values, frame.states, frame.asOfByField]) shape(values, names, 'policy_feature_fields');
  const unknownAsOf = [];
  for (const field of schema.fields) {
    const value = frame.values[field.name], state = frame.states[field.name], asOf = frame.asOfByField[field.name];
    if (!['available', 'missing', 'unknown', 'invalid'].includes(state) || (state === 'available' ? typeof value !== field.type || field.type === 'number' && !finite(value) || field.type === 'string' && value.length > 8192 : value !== null)) reject('policy_feature_type');
    if (asOf !== null && instant(asOf) > at) reject('policy_feature_future');
    if (asOf === null || field.timing === 'publication_unverified') {
      if (mode === 'STRICT_OPERATIONAL') reject('policy_feature_asof_unverified');
      unknownAsOf.push(field.name);
    }
  }
  return {digest: kellyPredictionDigest(frame), unknownAsOf};
}
function inspectPrice(price, mode, at, a) {
  shape(price, ['status', 'basis', 'observedAt', 'snapshotDigest', 'odds', 'payoutPer100Yen', 'moneyUnitsVerified', 'unitEvidenceDigest', 'currency', 'payoutUnitYen', 'settlementRule', 'costAssumption']);
  if (price.status !== 'valid') reject('price_unavailable');
  if (!sha(price.snapshotDigest) || !Array.isArray(price.odds) || price.odds.length !== 120 || price.odds.some(o => !finite(o) || o < 1) || typeof price.moneyUnitsVerified !== 'boolean') reject('price_invalid');
  if (!['decision_snapshot', 'historical_final_proxy', 'historical_final_or_unknown_not_T60'].includes(price.basis)) reject('price_basis');
  if (mode === 'STRICT_OPERATIONAL' && (price.basis !== 'decision_snapshot' || price.observedAt === 'unverified' || instant(price.observedAt) > at || !price.moneyUnitsVerified)) reject('operational_price_unverified');
  if (price.basis === 'decision_snapshot' && (price.observedAt === 'unverified' || instant(price.observedAt) > at)) reject('price_asof');
  if (price.observedAt !== 'unverified') instant(price.observedAt);
  if (price.moneyUnitsVerified && (!sha(a.moneyUnitEvidenceDigest) || price.unitEvidenceDigest !== a.moneyUnitEvidenceDigest) || !price.moneyUnitsVerified && price.unitEvidenceDigest !== null) reject('money_units_not_admitted');
  if (price.moneyUnitsVerified && (price.currency !== 'JPY' || price.payoutUnitYen !== 100 || price.settlementRule !== 'integer_per_100_yen_v1' || price.costAssumption !== 'zero_cost_reference' || !Array.isArray(price.payoutPer100Yen) || price.payoutPer100Yen.length !== 120 || price.payoutPer100Yen.some((pay, i) => !Number.isSafeInteger(pay) || pay < 100 || Math.abs(pay / 100 - price.odds[i]) > 1e-12 * Math.max(1, price.odds[i])))) reject('money_units');
  if (!price.moneyUnitsVerified && price.payoutPer100Yen !== null) reject('money_units_unverified');
}
function ticketsOf(values) {
  if (!Array.isArray(values) || values.length > 120) reject('selection');
  const tickets = values.map(x => typeof x === 'string' ? indexOfJointTriple(x) : x);
  if (tickets.some(x => !Number.isSafeInteger(x) || x < 0 || x >= 120) || new Set(tickets).size !== tickets.length) reject('selection');
  return tickets.sort((a, b) => a - b);
}
function provenanceFor(a, mode) {
  const p = a.policy, posthoc = p.policyProvenance === 'POSTHOC_HYPOTHESIS';
  return {kind: p.policyProvenance, policyFrozenAt: p.frozenAt, replayFrozenAt: p.replayFrozenAt, replayStartedAt: p.replayStartedAt,
    discoveryLabelWindows: p.discoveryLabelWindows.map(w => ({from: labelISO(w.from), to: labelISO(w.to)})), policySelectionLabelUseEnd: p.selectionLabelUseEnd === null ? null : labelISO(p.selectionLabelUseEnd),
    nonOraclePolicyReviewed: true, runtimeInputIsolationVerified: true, policyAsOfEvaluationStart: !posthoc, strategyOutOfTime: false, independentConfirmation: false, explorationPeriodReused: mode === 'RETROSPECTIVE_REFERENCE'};
}
function fundingPacket(frame, price, a, mode, tickets, probabilities, pT, rawModelDigest) {
  const selectionDigest = fundingHash(tickets), featureDigest = fundingHash({legacy: {values: Array.from(frame.modelInput.values, x => Number.isNaN(x) ? null : x), context: Array.from(frame.modelInput.context, x => Number.isNaN(x) ? null : x), venue: frame.modelInput.venue, grade: frame.modelInput.grade}, policyFeatureFrame: frame.policyFeatureFrame});
  const priceBody = {status: 'valid', mode: price.basis, observedAt: price.observedAt, odds: tickets.map(i => price.odds[i]), payoutPer100Yen: tickets.map(i => price.payoutPer100Yen[i]), settlementRule: price.settlementRule, costAssumption: price.costAssumption};
  const priced = {...priceBody, digest: fundingHash(priceBody)}, policy = a.policy, m = a.model, c = a.calibration;
  const context = {dataValid: true, sourceDigest: frame.sourceSnapshotDigest, featureDigest, featureAsOf: frame.featureAsOf, missingPolicyDigest: policy.missingPolicyDigest, catalogDigest: policy.catalogDigest};
  const calibrationPolicyBinding = {policyDigest: policy.policyDigest, generatorDigest: policy.generatorDigest, selectorDigest: policy.selectorDigest, catalogDigest: policy.catalogDigest, missingPolicyDigest: policy.missingPolicyDigest, implementationDigest: policy.implementationDigest, configDigest: policy.configDigest, modelArtifactSHA: m.artifactSHA, rawTemperature: 1, calibrationArtifactSHA: c.artifactSHA, boundaryDigest: c.boundaryDigest, oofDigest: c.oofDigest, oofKind: c.oofKind};
  const receipt = {raceKey: frame.raceKey, decisionAt: frame.decisionAt, ...Object.fromEntries(['sourceDigest', 'featureDigest', 'featureAsOf', 'missingPolicyDigest', 'catalogDigest'].map(k => [k, context[k]])), modelDigest: rawModelDigest, modelArtifactSHA: m.artifactSHA, modelInternalSelectionEnd: labelISO(m.internalSelectionEnd), modelLabelUseEnd: labelISO(m.labelUseEnd), trainFrom: labelISO(m.trainFrom), trainEnd: labelISO(m.trainEnd), calibrationFrom: labelISO(c.from), calibrationEnd: labelISO(c.to), calibrationLabelUseEnd: labelISO(c.labelUseEnd), calibrationDigest: c.artifactSHA, boundaryDigest: c.boundaryDigest, calibrationPolicyDigest: policy.policyDigest, calibrationPolicyBinding, calibrationPolicyBindingDigest: fundingHash(calibrationPolicyBinding), policyProvenance: provenanceFor(a, mode), policyDigest: policy.policyDigest, selectorDigest: policy.selectorDigest, selectionDigest, priceDigest: priced.digest, rawVectorDigest: fundingHash(probabilities), oofDigest: c.oofDigest};
  const body = {version: 'context_funding_opportunity_v2', raceKey: frame.raceKey, decisionAt: frame.decisionAt,
    eligibility: {mode, timingVerified: m.timingVerified, featureUnitsVerified: m.featureUnitsVerified, moneyUnitsVerified: true, labelOrderVerified: true, modelSelectionPastOnly: true, inputSchemaVerified: true, codeTransformVerified: true, knownPostDecisionFeatures: false, referenceAssumptionDigest: mode === 'RETROSPECTIVE_REFERENCE' ? a.referenceAssumptionDigest : null},
    context, selection: {policyDigest: policy.policyDigest, generatorDigest: policy.generatorDigest, selectorDigest: policy.selectorDigest, implementationDigest: policy.implementationDigest, configDigest: policy.configDigest, tickets, digest: selectionDigest}, prediction: {status: 'available', probability: pT, rawProbabilities: probabilities, receipt}, price: priced};
  return {...body, digest: fundingHash(body)};
}

/** verifyAdmission is the trusted artifact-loader boundary, never a self-signed receipt fallback. */
export function createKellyPredictionPort({expectedAdmissionDigest, artifacts, policy, verifyAdmission, mode = 'STRICT_OPERATIONAL', maxCacheEntries = 1024, ports = {}}) {
  if (!sha(expectedAdmissionDigest) || typeof verifyAdmission !== 'function' || !modes.includes(mode) || !Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 1 || maxCacheEntries > 4096 || !object(policy) || typeof policy.select !== 'function' || !sha(policy.digest) || !sha(policy.implementationDigest)) reject('configuration');
  if (!object(ports) || Object.keys(ports).length !== 0) reject('predictor_override_forbidden');
  shape(artifacts, ['model', 'calibration', 'boundaries']);
  let accepted; try {accepted = verifyAdmission({artifacts, policy, expectedAdmissionDigest});} catch {reject('admission_verifier_failure');}
  if (!object(accepted) || accepted.policyFunction !== policy.select || kellyPredictionDigest(accepted.receipt) !== expectedAdmissionDigest) reject('independent_admission');
  const a = clone(accepted.receipt), owned = clone(artifacts), select = policy.select, policyConfig = freeze(clone(policy.config));
  inspectAdmission(a, owned, policy);
  owned.model = withJointTemperature(owned.model, owned.model.temperature);
  freeze(a); freeze(owned);
  const rawModelDigest = withJointTemperature(owned.model, 1).modelDigest;
  const predictRaw = (model, input) => predictJoint(model, input, {temperature: 1});
  const predictPackage = (model, row, boundaries, ticketCount) => model.version === GLOBAL_REFERENCE_VERSION ? predictGlobalReferenceProbability(model, {...row, ticketCount}) : predictContextProbability(model, row, boundaries);
  const cache = new Map();
  return Object.freeze({version: KELLY_PREDICTION_PORT_VERSION, mode,
    predict(input) {
      try {
        shape(input, ['frame', 'price'], 'input_shape');
        const frame = clone(input.frame), price = clone(input.price);
        if (object(frame) && !Object.hasOwn(frame, 'policyFeatureFrame')) frame.policyFeatureFrame = null;
        const at = inspectFrame(frame, a, mode);
        if (owned.calibration.version === GLOBAL_REFERENCE_VERSION && mode !== 'RETROSPECTIVE_REFERENCE') reject('global_reference_only');
        inspectPrice(price, mode, at, a);
        const policyFeatures = inspectPolicyFeatures(frame.policyFeatureFrame, a.policyFeatureSchema, mode, at);
        const executedInput = nativeModelInput(frame.modelInput);
        const originalPriceFrameDigest = kellyPredictionDigest(price);
        if (price.moneyUnitsVerified) price.odds = price.payoutPer100Yen.map(pay => pay / 100);
        const preKey = kellyPredictionDigest({version: KELLY_PREDICTION_PORT_VERSION, mode, expectedAdmissionDigest, frame, price, originalPriceFrameDigest});
        if (cache.has(preKey)) return cache.get(preKey);
        if (cache.size >= maxCacheEntries) reject('cache_limit');
        let raw;
        try {raw = predictRaw(owned.model, executedInput, {temperature: 1});} catch {reject('predictor_failure');}
        const probabilities = Array.from(raw?.probabilities ?? []);
        if (raw?.temperature !== 1 || probabilities.length !== 120 || probabilities.some(p => !finite(p) || p < 0 || p > 1) || Math.abs(probabilities.reduce((s, p) => s + p, 0) - 1) > 1e-10 || raw?.combinations?.length !== 120 || raw.combinations.some((x, i) => x !== JOINT_COMBINATIONS[i])) reject('raw_distribution');
        const rawPrediction = freeze({combinations: [...JOINT_COMBINATIONS], probabilities});
        let selected;
        const policyInput = {...executedInput, values: Array.from(executedInput.values), context: Array.from(executedInput.context)};
        try {selected = select(freeze({raceKey: frame.raceKey, date: frame.date, decisionAt: frame.decisionAt, modelInput: policyInput, policyFeatures: clone(frame.policyFeatureFrame), rawPrediction, price: clone(price), policyConfig}));} catch {reject('policy_failure');}
        const tickets = ticketsOf(selected); if (!tickets.length) reject('empty_selection');
        const rawMass = tickets.reduce((s, i) => s + probabilities[i], 0), odds = Object.fromEntries(JOINT_COMBINATIONS.map((t, i) => [t, price.odds[i]])), market = formationMarketMass(tickets.map(i => JOINT_COMBINATIONS[i]), odds);
        if (!market) reject('price_invalid');
        const features = contextFeatures(executedInput, rawPrediction), row = freeze({date: frame.date, p: rawMass, q: market.q, features});
        let calibrated; try {calibrated = predictPackage(owned.calibration, row, owned.boundaries, tickets.length);} catch {reject('calibrator_failure');}
        const pT = calibrated?.probability;
        if (calibrated?.version !== owned.calibration.version || !finite(pT) || pT < 0 || pT > 1 || rawMass === 0 && pT > 0) reject('package_probability');
        const selectionDigest = fundingHash(tickets), cacheKey = kellyPredictionDigest({preKey, tickets, selectionDigest}), B = tickets.reduce((s, i) => s + 1 / price.odds[i], 0);
        const packet = price.moneyUnitsVerified ? fundingPacket(frame, price, a, mode, tickets, probabilities, pT, rawModelDigest) : null;
        const posthocPolicy = a.policy.policyProvenance === 'POSTHOC_HYPOTHESIS';
        const result = freeze({version: KELLY_PREDICTION_PORT_VERSION, status: packet ? 'prediction_available' : 'prediction_reference_only', reason: packet ? null : 'money_units_unverified', mode, raceKey: frame.raceKey, decisionAt: frame.decisionAt, cacheKey, expectedAdmissionDigest,
          rawPrediction: {kind: 'raw_not_calibrated_120', temperature: 1, probabilities}, selection: {tickets, digest: selectionDigest, policyDigest: a.policy.policyDigest, selectorDigest: a.policy.selectorDigest}, rawMass, packageProbability: pT,
          moneyUnitEvidenceDigest: a.moneyUnitEvidenceDigest,
          policyFeatureReceipt: {schemaDigest: a.policyFeatureSchema?.schemaDigest ?? null, extractorDigest: a.policyFeatureSchema?.extractorDigest ?? null, frameDigest: policyFeatures.digest, unknownAsOfFields: policyFeatures.unknownAsOf, raw120ModelUsesRichFeatures: false},
          marketQ: {value: market.q, interpretation: 'normalized_inverse_odds_not_true_probability'}, B: packet ? B : null, D: packet ? market.syntheticOdds : null, weights: packet ? tickets.map(i => 1 / (price.odds[i] * B)) : null,
          receipt: {executedInputDigest: kellyPredictionDigest(executedInput), inputTransform: 'validated_float32_native_v1_preserve_nan', admissionDigest: expectedAdmissionDigest, evidenceDigest: a.evidenceDigest, timeZone: a.timeZone, labelCutoffSemantics: a.labelCutoffSemantics, sourceRaceDate: frame.date, modelArtifactSHA: a.model.artifactSHA, sourceModelDigest: a.model.modelDigest, effectiveRawModelDigest: rawModelDigest, modelComputedAt: a.model.computedAt, calibrationArtifactSHA: a.calibration.artifactSHA, calibrationComputedAt: a.calibration.computedAt, calibrationMethod: owned.calibration.version === GLOBAL_REFERENCE_VERSION ? GLOBAL_REFERENCE_METHOD : 'context_calibration_v3', calibrationMethodSchemaDigest: a.calibration.methodSchemaDigest ?? null, calibrationMethodReceiptDigest: a.calibration.methodReceiptDigest ?? null, boundaryDigest: a.calibration.boundaryDigest, oofDigest: a.calibration.oofDigest, frameDigest: kellyPredictionDigest(frame), priceFrameDigest: originalPriceFrameDigest, resolvedPriceFrameDigest: kellyPredictionDigest(price), generatorDigest: a.policy.generatorDigest, catalogDigest: a.policy.catalogDigest, missingPolicyDigest: a.policy.missingPolicyDigest, featureSchemaDigest: frame.featureSchemaDigest, sourceSnapshotDigest: frame.sourceSnapshotDigest, cohortDigest: frame.cohortDigest, policyProvenance: a.policy.policyProvenance, policyFrozenAt: a.policy.frozenAt, replayFrozenAt: a.policy.replayFrozenAt, replayStartedAt: a.policy.replayStartedAt, discoveryLabelWindows: a.policy.discoveryLabelWindows, policySelectionLabelUseEnd: a.policy.selectionLabelUseEnd, evaluation: a.evaluation, evaluationInstants: {from: labelISO(a.evaluation.from), to: labelISO(a.evaluation.to)}, fundingPacketDigest: packet?.digest ?? null},
          evidence: {timingVerified: a.model.timingVerified, featureUnitsVerified: a.model.featureUnitsVerified, moneyUnitsVerified: price.moneyUnitsVerified, conditionalOnSnapshot: mode === 'RETROSPECTIVE_REFERENCE', posthocPolicy, policyAsOfEvaluationStart: !posthocPolicy, strategyOutOfTime: false, independentConfirmation: false, explorationPeriodReused: mode === 'RETROSPECTIVE_REFERENCE', forecastTrainingLabelOrderVerified: true, modelInternalSelectionLabelOrderVerified: true, calibrationLabelOrderVerified: true, priceBasis: price.basis, calibrated120Produced: false, operationalQualified: false, configuredTier: 0, realAllocation: 0, financialActions: 0, artifactsAuthenticity: 'external_verifier_responsibility'}, fundingPacket: packet});
        cache.set(preKey, result); return result;
      } catch (e) {
        if (!(e instanceof Rejection)) throw e;
        return freeze({version: KELLY_PREDICTION_PORT_VERSION, status: 'skipped', reason: e.code, mode, packageProbability: null, fundingPacket: null, operationalQualified: false, configuredTier: 0, realAllocation: 0, financialActions: 0});
      }
    }, get cacheSize() {return cache.size;}, financialActions: 0});
}
