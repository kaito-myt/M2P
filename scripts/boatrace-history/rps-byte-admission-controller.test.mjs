import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSyntheticByteAdmissionAdapter,
  evaluateSyntheticByteReceipt,
  inspectRpsByteAdmissionReadiness,
  readFixedSourceBytes,
  RpsByteAdmissionError,
} from './rps-byte-admission-controller.mjs';

const hash = 'a'.repeat(64);

function syntheticReceipt(overrides = {}) {
  return {
    mode: 'SYNTHETIC_ONLY',
    files: [{name: 'day-2026-01-01-raw.json', bytes: 12, sha256: hash}],
    sourceManifestBinding: 'CONTENT_UNDECLARED',
    ...overrides,
  };
}

test('actual admission remains blocked without audited openat2, frozen identity, budgets, schemas, and resource profile', async () => {
  const readiness = inspectRpsByteAdmissionReadiness();
  assert.equal(readiness.status, 'NOT_ADMITTED');
  assert.equal(readiness.sourceByteStatus, 'NOT_READ');
  assert.equal(readiness.candidateStatus, 'NOT_CREATED');
  assert.deepEqual(readiness.blockers, [
    'DESCRIPTOR_UNKNOWN',
    'OPENAT2_HELPER_UNAVAILABLE',
    'RESOURCE_PRECHECK',
    'MANIFEST_BINDING',
    'ACTUAL_READER_NOT_IMPLEMENTED',
  ]);
  assert.equal(readiness.purchaseEligibility, false);
  assert.equal(readiness.actualExposureYen, 0);
  await assert.rejects(readFixedSourceBytes({root: '/arbitrary/caller/path'}), error =>
    error instanceof RpsByteAdmissionError && error.code === 'DESCRIPTOR_UNKNOWN');
});

test('synthetic adapter is labeled synthetic and cannot promote bytes to actual admission', async () => {
  let reads = 0;
  const adapter = createSyntheticByteAdmissionAdapter(async () => {
    reads++;
    return syntheticReceipt({sourceManifestBinding: 'CONTENT_MATCH'});
  });
  const result = await adapter.read();
  assert.equal(reads, 1);
  assert.equal(adapter.mode, 'SYNTHETIC_ONLY');
  assert.equal(result.mode, 'SYNTHETIC_ONLY');
  assert.equal(result.sourceByteStatus, 'SYNTHETIC_BYTES_ONLY');
  assert.equal(result.candidateStatus, 'NOT_CREATED');
  assert.deepEqual(result.blockers, ['SYNTHETIC_ONLY']);
  assert.equal(result.purchaseEligibility, false);
  assert.equal(result.actualExposureYen, 0);
});

test('synthetic receipt rejects unexpected fields, caller actual status, and malformed byte facts', () => {
  for (const value of [
    syntheticReceipt({status: 'CURRENT_425_BYTES_MATCH_PAST_RECEIPT'}),
    syntheticReceipt({mode: 'ACTUAL'}),
    syntheticReceipt({files: [{name: 'raw', bytes: -1, sha256: hash}]}),
    syntheticReceipt({files: [{name: 'raw', bytes: 1, sha256: 'not-a-hash'}]}),
    syntheticReceipt({sourceManifestBinding: 'VERIFIED'}),
  ]) {
    assert.throws(() => evaluateSyntheticByteReceipt(value), error =>
      error instanceof RpsByteAdmissionError && error.code === 'SYNTHETIC_RECEIPT_INVALID');
  }
});

test('a synthetic result is immutable and never reports a current-byte match', () => {
  const result = evaluateSyntheticByteReceipt(syntheticReceipt());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.blockers));
  assert.notEqual(result.sourceByteStatus, 'CURRENT_425_BYTES_MATCH_PAST_RECEIPT');
});
