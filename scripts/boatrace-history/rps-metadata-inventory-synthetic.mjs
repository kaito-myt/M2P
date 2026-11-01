import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newFamilyActualDates} from './joint-new-family-descriptive-source.mjs';

const HELPER = fileURLToPath(new URL('./rps-metadata-inventory-helper.c', import.meta.url));
const HELPER_SHA256 = '48412fe3521dd767f9a62a2b19b284d883ef2f0c1804534442acbb220b83ff4c';
const MAX_FILE_BYTES = 33_554_432;
const MAX_TOTAL_BYTES = 7_500_000_000;
const MAX_WALL_MS = 10_000;
const MAX_HELPER_OUTPUT = 256 * 1024;
const HEX = /^[a-f0-9]{64}$/;

export class RpsMetadataInventoryError extends Error {
  constructor(code) { super(code); this.name = 'RpsMetadataInventoryError'; this.code = code; }
}

function fail(code) { throw new RpsMetadataInventoryError(code); }

function fixedEntries() {
  const dates = newFamilyActualDates();
  if (dates.length !== 211 || dates.some((date, index) => index > 0 && dates[index - 1] >= date)) fail('FIXED_DATE_SET_INVALID');
  const entries = [];
  for (const date of dates) {
    entries.push({date, kind: 'raw', basename: `day-${date}-raw.json`});
    entries.push({date, kind: 'day_manifest', basename: `day-${date}-manifest.json`});
  }
  entries.push(
    {kind: 'source_manifest', basename: 'source-manifest.json'},
    {kind: 'source_receipt', basename: 'source-receipt.json'},
    {kind: 'provenance', basename: 'original-part-provenance.json'},
  );
  if (entries.length !== 425 || new Set(entries.map(entry => entry.basename)).size !== 425) fail('FIXED_ENTRY_SET_INVALID');
  return Object.freeze(entries.map(entry => Object.freeze(entry)));
}

export const RPS_SYNTHETIC_METADATA_ENTRIES = fixedEntries();
const SYNTHETIC_DESCRIPTOR_DIGEST = createHash('sha256').update(JSON.stringify(RPS_SYNTHETIC_METADATA_ENTRIES)).digest('hex');

export function validateSyntheticMetadataRows(rows, {expectedUid, rootIdentity, maxFileBytes = MAX_FILE_BYTES, maxTotalBytes = MAX_TOTAL_BYTES} = {}) {
  if (!Array.isArray(rows) || rows.length !== RPS_SYNTHETIC_METADATA_ENTRIES.length) fail('METADATA_ROW_COUNT_INVALID');
  if (!Number.isSafeInteger(expectedUid) || expectedUid < 0) fail('EXPECTED_UID_INVALID');
  if (!rootIdentity || !/^\d+$/.test(String(rootIdentity.dev)) || !/^\d+$/.test(String(rootIdentity.ino)) || !/^\d+$/.test(String(rootIdentity.mountId))) fail('ROOT_IDENTITY_INVALID');
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) fail('SIZE_POLICY_INVALID');

  let totalBytes = 0;
  const files = rows.map((row, index) => {
    const expected = RPS_SYNTHETIC_METADATA_ENTRIES[index];
    const keys = row && typeof row === 'object' ? Object.keys(row).sort() : [];
    const required = ['basename', 'bytes', 'ctimeNs', 'dev', 'ino', 'kind', 'mountId', 'mtimeNs', 'nlink', 'uid', ...(expected.date ? ['date'] : [])].sort();
    if (!row || keys.join('|') !== required.join('|') || row.basename !== expected.basename || row.kind !== expected.kind || row.date !== expected.date) fail('METADATA_ROW_ORDER_OR_SHAPE_INVALID');
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > maxFileBytes
        || !Number.isSafeInteger(row.uid) || row.uid !== expectedUid || row.nlink !== 1
        || !/^\d+$/.test(String(row.dev)) || !/^\d+$/.test(String(row.ino))
        || !/^\d+$/.test(String(row.mountId)) || !/^\d+$/.test(String(row.mtimeNs)) || !/^\d+$/.test(String(row.ctimeNs))) fail('METADATA_ATTRIBUTE_INVALID');
    if (String(row.dev) !== String(rootIdentity.dev) || String(row.mountId) !== String(rootIdentity.mountId)) fail('METADATA_ROOT_BOUNDARY_MISMATCH');
    totalBytes += row.bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxTotalBytes) fail('TOTAL_SIZE_LIMIT_EXCEEDED');
    return Object.freeze({...row, dev: String(row.dev), ino: String(row.ino), mountId: String(row.mountId), mtimeNs: String(row.mtimeNs), ctimeNs: String(row.ctimeNs)});
  });

  return Object.freeze({
    version: 'rps_metadata_inventory_v1',
    descriptorDigest: SYNTHETIC_DESCRIPTOR_DIGEST,
    rootIdentity: Object.freeze({...rootIdentity}),
    files: Object.freeze(files),
    fileCount: files.length,
    totalBytes,
    status: 'METADATA_SHAPE_ONLY',
    byteIntegrity: 'NOT_VERIFIED',
    featureTime: 'NOT_VERIFIED',
    modelFitApproval: false,
    purchaseEligibility: false,
    exposureYen: 0,
    scope: 'SYNTHETIC_FIXTURE_ONLY',
    resourceMeasurement: 'NOT_PERFORMED',
    terminationVerification: 'NOT_PERFORMED',
  });
}

function checkHelperSource(source) {
  if (createHash('sha256').update(source).digest('hex') !== HELPER_SHA256) fail('HELPER_SOURCE_HASH_MISMATCH');
}

function parseRows(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { fail('HELPER_OUTPUT_INVALID'); }
  if (!parsed || Object.getPrototypeOf(parsed) !== Object.prototype
      || Object.keys(parsed).sort().join('|') !== 'mode|rootIdentity|rows'
      || parsed.mode !== 'SYNTHETIC_ONLY' || !Array.isArray(parsed.rows)) fail('HELPER_OUTPUT_INVALID');
  return parsed;
}

function nativeArgs(entries, uid) {
  return ['--synthetic-fixture', '1', '--expected-uid', String(uid), '--max-file-bytes', String(MAX_FILE_BYTES), '--max-total-bytes', String(MAX_TOTAL_BYTES), ...entries.flatMap(entry => ['--file', entry.basename])];
}

/** Builds and inventories only a fresh, caller-inaccessible synthetic fixture. */
export async function runSyntheticMetadataInventory({platform = process.platform, spawnProcess = spawnSync, getUid = process.getuid} = {}) {
  if (platform !== 'linux') fail('OPENAT2_UNAVAILABLE');
  if (typeof getUid !== 'function' || typeof spawnProcess !== 'function') fail('SYNTHETIC_IDENTITY_UNAVAILABLE');
  const entries = RPS_SYNTHETIC_METADATA_ENTRIES;
  let source;
  try { source = await readFile(HELPER); } catch { fail('HELPER_UNAVAILABLE'); }
  checkHelperSource(source);

  const work = await mkdtemp(path.join(tmpdir(), 'rps-metadata-inventory-'));
  try {
    const helperPath = path.join(work, 'metadata-helper.c');
    const binaryPath = path.join(work, 'metadata-helper');
    await writeFile(helperPath, source, {flag: 'wx', mode: 0o600});
    const compile = spawnProcess('cc', ['-std=c11', '-O2', helperPath, '-o', binaryPath], {encoding: 'utf8', timeout: MAX_WALL_MS, maxBuffer: MAX_HELPER_OUTPUT});
    if (compile.error || compile.status !== 0 || compile.signal) fail('HELPER_COMPILE_FAILED');
    const result = spawnProcess(binaryPath, nativeArgs(entries, getUid()), {encoding: 'utf8', timeout: MAX_WALL_MS, killSignal: 'SIGKILL', maxBuffer: MAX_HELPER_OUTPUT});
    if (result.error?.code === 'ETIMEDOUT') fail('RESOURCE_TIMEOUT_UNKNOWN');
    if (result.error || result.status !== 0 || result.signal) fail('SYNTHETIC_HELPER_FAILED');
    const receipt = parseRows(result.stdout);
    return validateSyntheticMetadataRows(receipt.rows, {
      expectedUid: getUid(),
      rootIdentity: receipt.rootIdentity,
    });
  } catch (error) {
    if (error instanceof RpsMetadataInventoryError) throw error;
    fail('SYNTHETIC_INVENTORY_FAILED');
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}
