import {createHash} from 'node:crypto';
import {FORMATION_CALIBRATION_POLICY, fitFormationCalibration, calibratedFormationProbability} from './joint-formation-calibration.mjs';
export const GLOBAL_REFERENCE_VERSION = 'boat_selected_policy_global_reference_v1';
export const GLOBAL_REFERENCE_METHOD = 'formation_global_mass_logistic_reference_v1';
const window = Object.freeze({from: '2026-02-01', to: '2026-03-01', evaluationFrom: '2026-04-01', evaluationTo: '2026-10-01', timeZone: 'Asia/Tokyo', labelCutoffSemantics: 'exclusive'});
const fail = code => {throw Error('global_reference_' + code);};
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const plain = x => x !== null && typeof x === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(x));
function canonical(x) {if (x === null || typeof x === 'boolean' || typeof x === 'string' || finite(x)) return JSON.stringify(x); if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']'; if (plain(x)) return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}'; fail('hash_value');}
export const globalReferenceDigest = x => createHash('sha256').update(canonical(x)).digest('hex');
const exact = (x, keys) => {if (!plain(x) || Object.keys(x).sort().join('|') !== [...keys].sort().join('|')) fail('shape');};
const freeze = x => {if (x && typeof x === 'object') {Object.values(x).forEach(freeze); Object.freeze(x);} return x;};
export const GLOBAL_REFERENCE_BOUNDARY_DIGEST = globalReferenceDigest({kind: 'not_used_global_only', version: GLOBAL_REFERENCE_VERSION});
export const GLOBAL_REFERENCE_SCHEMA_DIGEST = globalReferenceDigest({version: GLOBAL_REFERENCE_VERSION, methodId: GLOBAL_REFERENCE_METHOD, policy: FORMATION_CALIBRATION_POLICY, window, boundaryDigest: GLOBAL_REFERENCE_BOUNDARY_DIGEST});
const bindingKeys = ['modelArtifactSHA', 'rawInputDigest', 'modelLabelOrderDigest', 'policyDigest', 'selectorDigest', 'inputContractDigest', 'windowDigest', 'cohortDigest', 'pricingContractDigest', 'methodSourceDigest', 'fitterSourceDigest', 'targetIsolationDigest', 'policyProvenanceDigest'];
const rowKeys = ['raceKey', 'date', 'tickets', 'p', 'q', 'hit', 'policyDigest', 'modelArtifactSHA', 'sourceDigest', 'priceDigest', 'targetDigest', 'moneyUnitEvidenceDigest'];
function bindingValid(binding) {exact(binding, bindingKeys); if (!bindingKeys.every(k => sha(binding[k])) || binding.windowDigest !== globalReferenceDigest(window)) fail('binding');}
export function fitGlobalReferenceCalibration({rows, binding, expectedAdmissionDigest, verifyCohort}) {
  if (!Array.isArray(rows) || rows.length > 100000 || !sha(expectedAdmissionDigest) || typeof verifyCohort !== 'function') fail('admission_required');
  bindingValid(binding);
  let accepted; try {accepted = verifyCohort({rows, binding, expectedAdmissionDigest});} catch {fail('admission_verifier');}
  if (!plain(accepted) || accepted.rows !== rows || globalReferenceDigest(accepted.receipt) !== expectedAdmissionDigest) fail('independent_admission');
  exact(accepted.receipt, ['bindingDigest', 'cohortDigest', 'moneyUnitsVerified', 'targetIsolationVerified', 'labelOrderVerified', 'posthocReferenceOnly']);
  if (accepted.receipt.bindingDigest !== globalReferenceDigest(binding) || accepted.receipt.cohortDigest !== globalReferenceDigest(rows) || binding.cohortDigest !== accepted.receipt.cohortDigest || accepted.receipt.moneyUnitsVerified !== true || accepted.receipt.targetIsolationVerified !== true || accepted.receipt.labelOrderVerified !== true || accepted.receipt.posthocReferenceOnly !== true) fail('cohort_binding');
  const admitted = [], exclusions = {}; let previous = '', priorDate = '', hits = 0;
  const excluded = reason => {exclusions[reason] = (exclusions[reason] ?? 0) + 1;};
  for (const row of rows) {
    exact(row, rowKeys);
    if (typeof row.raceKey !== 'string' || !/^turnmark_v1:\d{4}-\d{2}-\d{2}:(?:[1-9]|1[0-9]|2[0-4]):(?:[1-9]|1[0-2])$/.test(row.raceKey) || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || new Date(row.date + 'T00:00:00.000Z').toISOString().slice(0,10) !== row.date || row.raceKey.split(':')[1] !== row.date || row.date < priorDate || row.date === priorDate && row.raceKey <= previous) fail('cohort_order');
    priorDate = row.date; previous = row.raceKey;
    if (row.date < window.from || row.date >= window.to) fail('future_or_outside_window');
    if (row.policyDigest !== binding.policyDigest || row.modelArtifactSHA !== binding.modelArtifactSHA || !['sourceDigest', 'priceDigest', 'targetDigest', 'moneyUnitEvidenceDigest'].every(k => sha(row[k]))) fail('row_binding');
    if (!Array.isArray(row.tickets) || row.tickets.some((n,i) => !Number.isSafeInteger(n) || n < 0 || n >= 120 || i > 0 && n <= row.tickets[i-1])) fail('tickets');
    if (row.tickets.length === 0) {excluded('empty_T'); continue;} if (row.tickets.length === 120) {excluded('full_T'); continue;}
    if (!finite(row.p) || row.p <= 0 || row.p >= 1) {excluded('raw_mass_not_interior'); continue;}
    if (!finite(row.q) || row.q <= 0 || row.q >= 1) {excluded('market_mass_not_interior'); continue;}
    if (![0,1].includes(row.hit)) {excluded('target_unknown'); continue;}
    admitted.push({date: row.date, p: row.p, q: row.q, hit: row.hit}); hits += row.hit;
  }
  const samples = admitted.length, status = samples === 0 ? 'calibration_no_admissible_rows' : hits === 0 || hits === samples ? 'calibration_one_class_reference_not_fitted' : 'fitted_reference';
  const globalModel = status === 'fitted_reference' ? fitFormationCalibration(admitted, {from: window.from, to: window.to}) : null;
  const massSummary = key => admitted.length ? {minimum: Math.min(...admitted.map(r => r[key])), maximum: Math.max(...admitted.map(r => r[key])), mean: admitted.reduce((n,r) => n + r[key] / admitted.length, 0)} : {minimum: null, maximum: null, mean: null};
  const methodReceipt = {rawMassSummary: massSummary('p'), normalizedMarketMassSummary: massSummary('q'), binding: structuredClone(binding), expectedAdmissionDigest, samples, hits, inputRows: rows.length, exclusions, admittedRowsDigest: globalReferenceDigest(admitted), fitStatus: globalModel?.status ?? status, fitModelDigest: globalModel ? globalReferenceDigest(globalModel) : null, inSampleFitDiagnosticOnly: true};
  return freeze({version: GLOBAL_REFERENCE_VERSION, methodId: GLOBAL_REFERENCE_METHOD, methodSchemaDigest: GLOBAL_REFERENCE_SCHEMA_DIGEST, methodReceiptDigest: globalReferenceDigest(methodReceipt), methodReceipt, from: window.from, to: window.to, evaluationFrom: window.evaluationFrom, evaluationTo: window.evaluationTo, boundaryDigest: GLOBAL_REFERENCE_BOUNDARY_DIGEST, status, samples, hits, globalModel, contextFitAttempted: false, contextModel: null, contextLeafQualified: false, supportBelowContextMinimum: samples < 200, researchSmallSample: samples < 200, qualification: 'not_operationally_qualified', operationalQualified: false, configuredTier: 0, realAllocation: 0});
}
export function assertGlobalReferenceArtifact(model) {
  if (!plain(model) || model.version !== GLOBAL_REFERENCE_VERSION || model.methodId !== GLOBAL_REFERENCE_METHOD || model.methodSchemaDigest !== GLOBAL_REFERENCE_SCHEMA_DIGEST || globalReferenceDigest(model.methodReceipt) !== model.methodReceiptDigest || model.boundaryDigest !== GLOBAL_REFERENCE_BOUNDARY_DIGEST || model.from !== window.from || model.to !== window.to || model.evaluationFrom !== window.evaluationFrom || model.evaluationTo !== window.evaluationTo || model.contextFitAttempted !== false || model.contextModel !== null || model.contextLeafQualified !== false || model.qualification !== 'not_operationally_qualified' || model.operationalQualified !== false || model.configuredTier !== 0 || model.realAllocation !== 0) fail('artifact');
  bindingValid(model.methodReceipt.binding);
  if (model.status !== 'fitted_reference' || !model.globalModel || !Number.isSafeInteger(model.samples) || model.samples < 2 || !Number.isSafeInteger(model.hits) || model.hits <= 0 || model.hits >= model.samples || model.methodReceipt.samples !== model.samples || model.methodReceipt.hits !== model.hits || model.methodReceipt.fitModelDigest !== globalReferenceDigest(model.globalModel) || model.globalModel.samples !== model.samples || model.globalModel.from !== model.from || model.globalModel.to !== model.to || globalReferenceDigest(model.globalModel.policy) !== globalReferenceDigest(FORMATION_CALIBRATION_POLICY) || model.globalModel.version !== FORMATION_CALIBRATION_POLICY.version || !['fitted_fixed_iterations','stopped_no_finite_descent'].includes(model.globalModel.status) || !Array.isArray(model.globalModel.weights) || model.globalModel.weights.length !== 3 || !model.globalModel.weights.every(finite) || !finite(model.globalModel.finalLoss) || !finite(model.globalModel.initialLoss) || model.supportBelowContextMinimum !== (model.samples < 200) || model.researchSmallSample !== (model.samples < 200)) fail('not_fitted');
  return model;
}
export function predictGlobalReferenceProbability(model, {date, p, q, ticketCount}) {
  assertGlobalReferenceArtifact(model);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < window.evaluationFrom || date >= window.evaluationTo) fail('evaluation_window');
  if (!Number.isSafeInteger(ticketCount) || ticketCount < 1 || ticketCount >= 120 || ![p,q].every(x => finite(x) && x > 0 && x < 1)) fail('prediction_boundary');
  const probability = calibratedFormationProbability(model.globalModel, {date, p, q});
  return {version: GLOBAL_REFERENCE_VERSION, methodId: GLOBAL_REFERENCE_METHOD, probability, globalProbability: probability, contextFitAttempted: false, operationalQualified: false};
}
export const GLOBAL_REFERENCE_WINDOW = window;
