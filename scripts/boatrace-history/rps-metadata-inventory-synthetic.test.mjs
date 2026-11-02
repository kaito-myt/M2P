import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  RPS_SYNTHETIC_METADATA_ENTRIES,
  RpsMetadataInventoryError,
  runSyntheticMetadataInventory,
  validateSyntheticMetadataRows,
} from './rps-metadata-inventory-synthetic.mjs';

const rootIdentity = Object.freeze({dev: '8', ino: '1234', mountId: '99'});

function validRows() {
  return RPS_SYNTHETIC_METADATA_ENTRIES.map((entry, index) => ({
    ...entry,
    bytes: 128 + index,
    dev: rootIdentity.dev,
    ino: String(10_000 + index),
    mountId: rootIdentity.mountId,
    nlink: 1,
    uid: 1000,
    mtimeNs: '1793500000000000000',
    ctimeNs: '1793500000000000001',
  }));
}

function rejectsCode(operation, code) {
  assert.throws(operation, error => error instanceof RpsMetadataInventoryError && error.code === code);
}

test('fixed inventory is exactly 211 ordered day pairs plus three fixed metadata files', () => {
  assert.equal(RPS_SYNTHETIC_METADATA_ENTRIES.length, 425);
  assert.equal(new Set(RPS_SYNTHETIC_METADATA_ENTRIES.map(row => row.basename)).size, 425);
  assert.equal(RPS_SYNTHETIC_METADATA_ENTRIES[0].basename, 'day-2026-02-01-raw.json');
  assert.equal(RPS_SYNTHETIC_METADATA_ENTRIES[1].basename, 'day-2026-02-01-manifest.json');
  assert.deepEqual(RPS_SYNTHETIC_METADATA_ENTRIES.slice(-3).map(row => row.basename), [
    'source-manifest.json', 'source-receipt.json', 'original-part-provenance.json',
  ]);
});

test('metadata validator returns shape-only receipt and never grants admission', () => {
  const rows = validRows();
  const receipt = validateSyntheticMetadataRows(rows, {expectedUid: 1000, rootIdentity});
  assert.equal(receipt.version, 'rps_metadata_inventory_v1');
  assert.equal(receipt.fileCount, 425);
  assert.equal(receipt.totalBytes, rows.reduce((total, row) => total + row.bytes, 0));
  assert.equal(receipt.status, 'METADATA_SHAPE_ONLY');
  assert.equal(receipt.byteIntegrity, 'NOT_VERIFIED');
  assert.equal(receipt.featureTime, 'NOT_VERIFIED');
  assert.equal(receipt.modelFitApproval, false);
  assert.equal(receipt.purchaseEligibility, false);
  assert.equal(receipt.exposureYen, 0);
  assert.equal(receipt.scope, 'SYNTHETIC_FIXTURE_ONLY');
  assert.equal(receipt.resourceMeasurement, 'NOT_PERFORMED');
  assert.equal(Object.hasOwn(receipt, 'sha256'), false);
  assert.equal(Object.hasOwn(receipt, 'content'), false);
  assert.equal(Object.isFrozen(receipt.files), true);
});

test('rejects missing, reordered, duplicate, unexpected, or malformed metadata rows', () => {
  const rows = validRows();
  rejectsCode(() => validateSyntheticMetadataRows(rows.slice(0, -1), {expectedUid: 1000, rootIdentity}), 'METADATA_ROW_COUNT_INVALID');
  const reordered = validRows();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  rejectsCode(() => validateSyntheticMetadataRows(reordered, {expectedUid: 1000, rootIdentity}), 'METADATA_ROW_ORDER_OR_SHAPE_INVALID');
  const duplicate = validRows();
  duplicate[1] = {...duplicate[0]};
  rejectsCode(() => validateSyntheticMetadataRows(duplicate, {expectedUid: 1000, rootIdentity}), 'METADATA_ROW_ORDER_OR_SHAPE_INVALID');
  const unexpected = validRows();
  unexpected[0] = {...unexpected[0], basename: '../outside'};
  rejectsCode(() => validateSyntheticMetadataRows(unexpected, {expectedUid: 1000, rootIdentity}), 'METADATA_ROW_ORDER_OR_SHAPE_INVALID');
  const extraAttribute = validRows();
  extraAttribute[0] = {...extraAttribute[0], sha256: 'a'.repeat(64)};
  rejectsCode(() => validateSyntheticMetadataRows(extraAttribute, {expectedUid: 1000, rootIdentity}), 'METADATA_ROW_ORDER_OR_SHAPE_INVALID');
});

test('fails closed on unsafe metadata and root or resource boundary mismatches', () => {
  for (const [mutate, expected] of [
    [row => ({...row, nlink: 2}), 'METADATA_ATTRIBUTE_INVALID'],
    [row => ({...row, uid: 1001}), 'METADATA_ATTRIBUTE_INVALID'],
    [row => ({...row, bytes: 33_554_433}), 'METADATA_ATTRIBUTE_INVALID'],
    [row => ({...row, dev: '9'}), 'METADATA_ROOT_BOUNDARY_MISMATCH'],
    [row => ({...row, mountId: '100'}), 'METADATA_ROOT_BOUNDARY_MISMATCH'],
    [row => ({...row, ctimeNs: '-1'}), 'METADATA_ATTRIBUTE_INVALID'],
  ]) {
    const rows = validRows();
    rows[0] = mutate(rows[0]);
    rejectsCode(() => validateSyntheticMetadataRows(rows, {expectedUid: 1000, rootIdentity}), expected);
  }
  rejectsCode(() => validateSyntheticMetadataRows(validRows(), {expectedUid: 1000, rootIdentity, maxTotalBytes: 100}), 'TOTAL_SIZE_LIMIT_EXCEEDED');
  rejectsCode(() => validateSyntheticMetadataRows(validRows(), {expectedUid: -1, rootIdentity}), 'EXPECTED_UID_INVALID');
});

test('native Linux helper inventories only newly created synthetic fixture metadata', {skip: process.platform !== 'linux' && 'Linux openat2 integration runs in its dedicated CI workflow'}, async () => {
  const receipt = await runSyntheticMetadataInventory();
  assert.equal(receipt.fileCount, 425);
  assert.equal(receipt.status, 'METADATA_SHAPE_ONLY');
  assert.equal(receipt.scope, 'SYNTHETIC_FIXTURE_ONLY');
  assert.equal(receipt.byteIntegrity, 'NOT_VERIFIED');
  assert.equal(receipt.purchaseEligibility, false);
  assert.equal(receipt.exposureYen, 0);
  assert.equal(receipt.resourceMeasurement, 'NOT_PERFORMED');
  assert.equal(receipt.terminationVerification, 'NOT_PERFORMED');
  assert.equal(receipt.files.every(file => file.nlink === 1 && file.mountId === receipt.rootIdentity.mountId), true);
});

test('native timeout is unknown failure with no automatic retry', async () => {
  let calls = 0;
  await assert.rejects(runSyntheticMetadataInventory({
    platform: 'linux',
    getUid: () => 1000,
    spawnProcess(command, args) {
      calls++;
      if (command === 'cc') return {status: 0, stdout: '', stderr: ''};
      assert.equal(args.includes('--root'), false);
      return {status: null, signal: 'SIGKILL', error: {code: 'ETIMEDOUT'}};
    },
  }), error => error instanceof RpsMetadataInventoryError && error.code === 'RESOURCE_TIMEOUT_UNKNOWN');
  assert.equal(calls, 2);
});

test('metadata helper uses O_PATH/openat2 and does not read or hash fixture files', () => {
  const helper = readFileSync(fileURLToPath(new URL('./rps-metadata-inventory-helper.c', import.meta.url)), 'utf8');
  assert.match(helper, /O_PATH\s*\|\s*O_DIRECTORY/);
  assert.match(helper, /SYS_openat2/);
  assert.match(helper, /RESOLVE_BENEATH\s*\|\s*RESOLVE_NO_SYMLINKS\s*\|\s*RESOLVE_NO_MAGICLINKS/);
  assert.match(helper, /mnt_id:[\s\S]*?while \(end > value[\s\S]*?end\[-1\] == '\\n'/);
  assert.match(helper, /mkdtemp\(work_dir\)/);
  assert.match(helper, /synthetic_flag/);
  assert.match(helper, /!synthetic_flag/);
  assert.doesNotMatch(helper, /--root|root_path|--expected-dev|--expected-ino/);
  assert.doesNotMatch(helper, /\b(?:read|pread|mmap|EVP_Digest|SHA256)\s*\(/);
});

test('unsupported platform fails closed before invoking a native helper', async () => {
  let calls = 0;
  await assert.rejects(runSyntheticMetadataInventory({platform: 'win32', spawnProcess() { calls++; }}), error =>
    error instanceof RpsMetadataInventoryError && error.code === 'OPENAT2_UNAVAILABLE');
  assert.equal(calls, 0);
});
