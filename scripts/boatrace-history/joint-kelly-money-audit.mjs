// Pure historical-unit evidence assembly. No I/O, fitting, purchase, or deployment attestation.
import { createHash } from 'node:crypto';
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const safe = v => Number.isSafeInteger(v) && v >= 0;
const fail = message => { throw new TypeError(message); };
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (obj(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  if (v === undefined || typeof v === 'bigint' || typeof v === 'function' || typeof v === 'number' && !Number.isFinite(v)) fail('noncanonical_value');
  return v;
}
export const moneyAuditDigest = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const MONEY_MONTHS = Object.freeze(['2026-02', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
export const MONEY_SAMPLE_SEED = 'KellyEdge-primary-money-units-v1';
export const TRIFECTAS = Object.freeze(Array.from({ length: 6 }, (_, i) => i + 1).flatMap(a => Array.from({ length: 6 }, (_, i) => i + 1).filter(b => b !== a).flatMap(b => Array.from({ length: 6 }, (_, i) => i + 1).filter(c => c !== a && c !== b).map(c => `${a}-${b}-${c}`))));
const triple = v => TRIFECTAS.includes(v);
const date = v => typeof v === 'string' && /^2026-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
export function parseQuoteDecimal(value) {
  // Native numbers are interpreted by their reported decimal representation, never binary floor.
  if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) fail('quote_nonpositive_or_nonfinite');
  const s = typeof value === 'number' ? String(value) : value;
  if (typeof s !== 'string' || s.length > 64 || !/^\d+(?:\.\d+)?$/.test(s)) fail('quote_decimal_required');
  const [whole, fraction = ''] = s.split('.');
  let numerator = BigInt(whole + fraction), denominator = 10n ** BigInt(fraction.length);
  if (numerator < denominator) fail('quote_below_one');
  while (denominator > 1n && numerator % 10n === 0n) { numerator /= 10n; denominator /= 10n; }
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}
export function quoteGrossPer100(value) {
  const q = parseQuoteDecimal(value), n = BigInt(q.numerator) * 100n, d = BigInt(q.denominator);
  if (n % d !== 0n || n / d > BigInt(Number.MAX_SAFE_INTEGER)) fail('quote_not_exact_safe_integer_per100');
  return Number(n / d);
}
export function validateUnitsContract(contract, independentlyExpectedDigest) {
  if (!obj(contract) || !hex(independentlyExpectedDigest) || moneyAuditDigest(contract) !== independentlyExpectedDigest) fail('contract_not_independently_pinned');
  if (contract.kind !== 'historical_backfill_units_contract' || contract.source !== 'turnmark_v1' || contract.currency !== 'JPY' || contract.stakeUnitYen !== 100 || contract.quoteBasis !== 'total_return_multiplier' || contract.payoutBasis !== 'gross_JPY_per100' || contract.market !== 'trifecta' || contract.snapshotClaim !== 'originally_unknown') fail('unsupported_units_contract');
  for (const key of ['schemaDigest', 'scraperDigest', 'parserDigest', 'sourceManifestDigest', 'cohortDigest']) if (!hex(contract[key])) fail('contract_binding_missing:' + key);
  if (!Array.isArray(contract.months) || JSON.stringify(contract.months) !== JSON.stringify(MONEY_MONTHS)) fail('required_scope_changed');
  if (!obj(contract.evidenceDigests) || !Object.keys(contract.evidenceDigests).length || Object.values(contract.evidenceDigests).some(v => !hex(v))) fail('provider_evidence_missing');
  return { contractDigest: independentlyExpectedDigest, kind: contract.kind };
}
function quotes(vector, nativeOnly) {
  if (!obj(vector) || Object.keys(vector).length !== 120 || TRIFECTAS.some(k => !Object.hasOwn(vector, k))) fail('quote_120_mapping_required');
  return TRIFECTAS.map(k => {
    if (nativeOnly && typeof vector[k] !== 'number') fail(vector[k] === null ? 'quote_null' : 'quote_native_number_required');
    return parseQuoteDecimal(vector[k]);
  });
}
function frame(row, contract) {
  if (!obj(row) || !date(row.date) || !contract.months.includes(row.date.slice(0, 7)) || !Number.isInteger(row.venue) || row.venue < 1 || row.venue > 24 || !Number.isInteger(row.raceNumber) || row.raceNumber < 1 || row.raceNumber > 12) fail('row_identity_invalid');
  const key = `turnmark_v1:${row.date}:${row.venue}:${row.raceNumber}`;
  if (row.key !== key || row.source !== contract.source || row.parserDigest !== contract.parserDigest || !hex(row.rawPartDigest)) fail('row_binding_invalid');
  return key;
}
function ordinary(row) {
  if (!['normal', 'refund', 'tie', 'special', 'cancelled', 'unresolved'].includes(row.state)) return 'state_unknown';
  if (row.state !== 'normal') return row.state;
  if (!Array.isArray(row.boatRegistrations) || row.boatRegistrations.length !== 6 || row.boatRegistrations.some(v => !Number.isSafeInteger(v) || v <= 0) || new Set(row.boatRegistrations).size !== 6 || !Array.isArray(row.resultBoatRegistrations) || JSON.stringify(row.boatRegistrations) !== JSON.stringify(row.resultBoatRegistrations)) return 'boat_identity_mapping_invalid';
  if (!triple(row.winner)) return 'winner_mapping_invalid';
  if (row.payoutPer100Yen === null) return 'payout_null';
  if (!Number.isSafeInteger(row.payoutPer100Yen) || row.payoutPer100Yen <= 0) return 'payout_nonpositive_or_noninteger';
  try { quotes(row.quotes, true); } catch (e) { return e.message; }
  return null;
}
export function createMoneyRowAudit({ contract, expectedContractDigest, rawPartDigests, expectedMonths }) {
  validateUnitsContract(contract, expectedContractDigest);
  contract = structuredClone(contract); rawPartDigests = structuredClone(rawPartDigests); expectedMonths = structuredClone(expectedMonths);
  if (!Array.isArray(rawPartDigests) || !rawPartDigests.length || rawPartDigests.some(v => !hex(v)) || new Set(rawPartDigests).size !== rawPartDigests.length) fail('raw_part_pins_required');
  if (!obj(expectedMonths) || Object.keys(expectedMonths).sort().join() !== [...MONEY_MONTHS].sort().join() || MONEY_MONTHS.some(m => !safe(expectedMonths[m]?.rows) || !hex(expectedMonths[m]?.keyDigest))) fail('independent_month_inventory_required');
  const parts = new Set(rawPartDigests), months = Object.fromEntries(MONEY_MONTHS.map(m => [m, { rows: 0, candidates: 0, excluded: {}, quoteValues: { missing: 0, null: 0, zero: 0, invalid: 0, positiveNative: 0 }, first: null, seeded: null, keys: createHash('sha256') }]));
  let previous = '', finished = false;
  const rowsHash = createHash('sha256');
  return {
    add(row) {
      if (finished) fail('audit_already_finished');
      const key = frame(row, contract);
      const order = key; // Same exact ASCII lexical order as the canonical dayreader/cohort.
      if (order <= previous) fail('unordered_or_duplicate_race');
      if (!parts.has(row.rawPartDigest)) fail('raw_part_not_pinned');
      previous = order;
      const m = months[row.date.slice(0, 7)]; m.rows++; m.keys.update(key + '\n'); rowsHash.update(moneyAuditDigest(row) + '\n');
      for (const k of TRIFECTAS) {
        const v = row.quotes?.[k];
        const category = !obj(row.quotes) || !Object.hasOwn(row.quotes, k) ? 'missing' : v === null ? 'null' : v === 0 ? 'zero' : typeof v !== 'number' || !Number.isFinite(v) || v < 1 ? 'invalid' : 'positiveNative';
        m.quoteValues[category]++;
      }
      const reason = ordinary(row);
      if (reason) { m.excluded[reason] = (m.excluded[reason] ?? 0) + 1; return { candidate: false, reason }; }
      m.candidates++;
      const candidate = { key, date: row.date, venue: row.venue, raceNumber: row.raceNumber, boatRegistrations: [...row.boatRegistrations], resultBoatRegistrations: [...row.resultBoatRegistrations], winner: row.winner, payoutPer100Yen: row.payoutPer100Yen, quotes: { ...row.quotes }, rawPartDigest: row.rawPartDigest, rowDigest: moneyAuditDigest(row), snapshotClaim: contract.snapshotClaim };
      if (!m.first) m.first = candidate;
      else if (!m.seeded || moneyAuditDigest([MONEY_SAMPLE_SEED, key]) < moneyAuditDigest([MONEY_SAMPLE_SEED, m.seeded.key])) m.seeded = candidate;
      return { candidate: true, reason: null };
    },
    finish() {
      if (finished) fail('audit_already_finished'); finished = true;
      const counts = {}, samples = []; let inventoryMatched = true;
      for (const month of MONEY_MONTHS) {
        const m = months[month], keyDigest = m.keys.digest('hex');
        const inventoryMatch = m.rows === expectedMonths[month].rows && keyDigest === expectedMonths[month].keyDigest;
        inventoryMatched &&= inventoryMatch;
        counts[month] = { rows: m.rows, candidates: m.candidates, excluded: m.excluded, quoteValues: m.quoteValues, keyDigest, inventoryMatch, sampleStatus: m.candidates ? 'required' : 'no_applicable_rows' };
        if (m.first) samples.push(m.first); if (m.seeded) samples.push(m.seeded);
      }
      const audit = { kind: 'all_saved_rows_structure_audit', contractDigest: expectedContractDigest, sourceManifestDigest: contract.sourceManifestDigest, parserDigest: contract.parserDigest, cohortDigest: contract.cohortDigest, rawPartDigests: [...rawPartDigests], expectedInventoryDigest: moneyAuditDigest(expectedMonths), rowsDigest: rowsHash.digest('hex'), months: counts, inventoryMatched };
      const plan = { kind: 'preselected_official_sample_check', contractDigest: expectedContractDigest, auditDigest: moneyAuditDigest(audit), seed: MONEY_SAMPLE_SEED, selection: 'first_canonical_then_seed_hash_min_distinct', samples };
      return { audit, auditDigest: moneyAuditDigest(audit), plan, planDigest: moneyAuditDigest(plan) };
    },
  };
}
export function compareOfficialMoneySample(sample, official) {
  if (!obj(sample) || !obj(official)) return { status: 'pending_official_sample' };
  if (official.unitOrMappingContradiction === true) return { status: 'fail_unit_or_mapping_contract' };
  if (official.contractConflict === true) return { status: 'pending_contract_conflict' };
  if (official.unitOrMappingContradiction !== false || official.contractConflict !== false) return { status: 'pending_contract_conflict' };
  if (official.resultAvailable !== true || official.oddsAvailable !== true || official.parsed !== true) return { status: 'pending_official_sample' };
  if (!['resultPageDigest', 'oddsPageDigest', 'parserDigest'].every(k => hex(official[k]))) return { status: 'pending_official_sample' };
  if (official.key !== sample.key || official.market !== 'trifecta' || official.identityVerified !== true || official.correctedOrConflicting === true) return { status: 'pending_identity_or_reference' };
  if (official.state !== 'normal') return { status: 'pending_state_conflict' };
  if (!triple(official.winner) || official.winner !== sample.winner) return { status: 'pending_identity_or_reference' };
  if (!Number.isSafeInteger(official.payoutPer100Yen) || official.payoutPer100Yen <= 0) return { status: 'pending_official_sample' };
  if (official.payoutPer100Yen !== sample.payoutPer100Yen) return { status: 'fail_normal_settlement_mismatch', saved: sample.payoutPer100Yen, official: official.payoutPer100Yen };
  let a, b; try { a = quotes(sample.quotes, true); b = quotes(official.quotes, false); } catch { return { status: 'pending_identity_or_reference' }; }
  const quoteDifferences = TRIFECTAS.filter((_, i) => a[i].numerator !== b[i].numerator || a[i].denominator !== b[i].denominator);
  if (official.snapshotRelation === 'same_snapshot_proven') {
    if (!hex(official.snapshotEvidenceDigest)) return { status: 'pending_identity_or_reference' };
    return { status: quoteDifferences.length ? 'fail_claimed_quote_frame' : 'unit_sample_consistent_same_snapshot', quoteDifferences };
  }
  if (sample.snapshotClaim !== 'originally_unknown' || official.snapshotRelation !== 'not_proven_same_snapshot') return { status: 'pending_contract_conflict' };
  return { status: quoteDifferences.length ? 'different_quote_unaligned_time' : 'unit_sample_consistent_time_unknown', quoteDifferences };
}
const admittedStatus = new Set(['unit_sample_consistent_time_unknown', 'unit_sample_consistent_same_snapshot', 'different_quote_unaligned_time']);
export function assembleMoneyUnitsReceipt({ contract, expectedContractDigest, audit, plan, officialSamples, independentAdmission }, verifyIndependentAdmission) {
  validateUnitsContract(contract, expectedContractDigest);
  if (!obj(audit) || !obj(plan) || audit.contractDigest !== expectedContractDigest || plan.contractDigest !== expectedContractDigest || plan.auditDigest !== moneyAuditDigest(audit) || audit.sourceManifestDigest !== contract.sourceManifestDigest || audit.parserDigest !== contract.parserDigest || audit.cohortDigest !== contract.cohortDigest) fail('audit_plan_binding_mismatch');
  if (!obj(audit.months) || Object.keys(audit.months).sort().join() !== [...MONEY_MONTHS].sort().join() || plan.seed !== MONEY_SAMPLE_SEED || plan.selection !== 'first_canonical_then_seed_hash_min_distinct' || !Array.isArray(plan.samples)) fail('required_sample_plan_changed');
  if (new Set(plan.samples.map(s => s.key)).size !== plan.samples.length) fail('duplicate_plan_sample');
  for (const month of MONEY_MONTHS) {
    const m = audit.months[month];
    if (!obj(m) || !safe(m.rows) || !safe(m.candidates) || m.candidates > m.rows || !obj(m.excluded) || Object.values(m.excluded).some(v => !safe(v)) || Object.values(m.excluded).reduce((a, b) => a + b, m.candidates) !== m.rows || !hex(m.keyDigest) || typeof m.inventoryMatch !== 'boolean') fail('month_audit_incomplete');
    if (plan.samples.filter(s => s.date?.slice(0, 7) === month).length !== Math.min(2, m.candidates)) fail('required_samples_missing');
  }
  for (const sample of plan.samples) { frame({ ...sample, source: contract.source, parserDigest: contract.parserDigest }, contract); if (ordinary({ ...sample, state: 'normal' })) fail('sample_not_ordinary'); }
  if (!Array.isArray(officialSamples) || new Set(officialSamples.map(o => o.key)).size !== officialSamples.length || officialSamples.some(o => !plan.samples.some(s => s.key === o.key))) fail('unplanned_or_duplicate_official_sample');
  const results = plan.samples.map(sample => ({ key: sample.key, ...compareOfficialMoneySample(sample, officialSamples.find(o => o.key === sample.key)) }));
  const failed = results.some(r => r.status.startsWith('fail_'));
  const applicableMonths = MONEY_MONTHS.filter(m => audit.months[m].candidates > 0);
  const complete = applicableMonths.length > 0 && audit.inventoryMatched === true && MONEY_MONTHS.every(m => audit.months[m].inventoryMatch) && results.every(r => admittedStatus.has(r.status));
  const bindings = { contractDigest: expectedContractDigest, auditDigest: moneyAuditDigest(audit), planDigest: moneyAuditDigest(plan), officialSamplesDigest: moneyAuditDigest(officialSamples) };
  // Verification is an external trust boundary, not a flag supplied in an audit frame.
  const independent = typeof verifyIndependentAdmission === 'function' && verifyIndependentAdmission({ bindings, independentAdmission }) === true;
  const moneyUnitsVerified = !failed && complete && independent;
  const receipt = { kind: 'historical_backfill_units_contract', version: 1, ...bindings, status: failed ? 'FAIL_SHARED_CONTRACT_REVIEW' : moneyUnitsVerified ? 'LIMITED_UNITS_ADMITTED' : applicableMonths.length ? 'PENDING' : 'NO_APPLICABLE_ROWS', moneyUnitsVerified, scope: { source: contract.source, months: contract.months, applicableMonths, cohortDigest: contract.cohortDigest }, results, months: audit.months, producerDeploymentAttested: false, priceTimingVerified: false, historicalPriceAccuracyVerified: false, t60Verified: false, featureAsOfVerified: false, operationalQualified: false };
  return { ...receipt, receiptDigest: moneyAuditDigest(receipt) };
}
