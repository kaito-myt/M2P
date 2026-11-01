import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  RPS_SYNTHETIC_SCHEMA_INTEGRATION_LIMITS,
  RpsSyntheticSchemaIntegrationError,
  validateSyntheticPacketWithOpenat2,
} from './rps-synthetic-schema-integration.mjs';
import {createSyntheticOpenat2Bridge} from './rps-openat2-synthetic-bridge.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = (n) => n.toString(16).slice(-1).repeat(64);
const json = (value) => Buffer.from(JSON.stringify(value));
const pad = (bytes, length) => Buffer.concat([bytes, Buffer.alloc(length - bytes.length, 0x20)]);

function packetFixture(rawText = '{"races":[]}') {
  const rawBytes = Buffer.from(rawText);
  const date = '2026-04-01';
  const dayManifestBytes = json({source: 'turnmark_v1', date, status: 'collected', sha256: hash(rawBytes), bytes: rawBytes.length});
  const manifest = {
    originalPartProvenanceSHA: sha(1), version: 'inbox_raw_source_packets_v1', scope: 'SYNTHETIC_FIXTURE',
    datasetDigest: sha(2), sourceSnapshotDigest: sha(3), originalPrefitManifestSHA: sha(4),
    originalPrefitSourceDigest: sha(5), original365ManifestSummaryDigest: sha(6), readerAdmissionDigest: sha(7),
    normalizerVersion: 'turnmark_structure_v1', sourceOnly: true, moneyUnitsVerified: false,
    days: [{date, rawSHA: hash(rawBytes), rawBytes: rawBytes.length, manifestSHA: hash(dayManifestBytes),
      rawName: `day-${date}-raw.json`, manifestName: `day-${date}-manifest.json`}],
  };
  const provenance = {
    version: 'inbox_original_part_provenance_v1', scope: 'SYNTHETIC_FIXTURE',
    original365ManifestSummaryDigest: manifest.original365ManifestSummaryDigest,
    days: [{date, originalParts: [{name: 'raw/turnmark_v1/2026/20260401.json.gz', compressedSHA: sha(8),
      compressedBytes: 120, rawSHA: manifest.days[0].rawSHA, rawBytes: rawBytes.length,
      manifestName: 'manifests/turnmark_v1/2026/20260401.json', manifestSHA: manifest.days[0].manifestSHA,
      partCount: 1, assembly: 'none_byte_preserving_single_turnmark_part'}]}],
  };
  const provenanceBytes = json(provenance);
  manifest.originalPartProvenanceSHA = hash(provenanceBytes);
  const manifestBytes = json(manifest);
  const receipt = {
    version: 'inbox_raw_packet_source_receipt_v1', scope: 'SYNTHETIC_FIXTURE', status: 'source_packet_prepared',
    manifestSHA: hash(manifestBytes), manifestSummaryDigest: manifest.original365ManifestSummaryDigest,
    datasetDigest: manifest.datasetDigest, sourceSnapshotDigest: manifest.sourceSnapshotDigest,
    originalPrefitManifestSHA: manifest.originalPrefitManifestSHA,
    originalPrefitSourceDigest: manifest.originalPrefitSourceDigest, dayCount: 1,
    rawRows: 2, authenticatedDecisions: 1, nonemptyA0: 1, unknownClocks: 1, targetCount: 1,
    decisionDigest: sha(9), targetDigest: sha(10), sourceImplementations: null,
    originalExtractorIdentity: sha(11), normalizerVersion: manifest.normalizerVersion,
    rawPacketSemantics: 'original_decompressed_bytes_and_original_manifest_no_merge',
    moneyUnitsVerified: false, sourceApprovalForFit: false, actualFit: 0, profit: null,
    financialActions: 0, operationalQualified: false,
  };
  return {manifestBytes, receiptBytes: json(receipt), provenanceBytes,
    days: [{rawBytes, manifestBytes: dayManifestBytes}]};
}

function replaceJsonBytesWithPadding(bytes, size) {
  return pad(bytes, size);
}

function rebindRawBytes(packet, nextRawBytes) {
  const updated = structuredClone({
    manifest: JSON.parse(packet.manifestBytes.toString()),
    receipt: JSON.parse(packet.receiptBytes.toString()),
    provenance: JSON.parse(packet.provenanceBytes.toString()),
    dayManifest: JSON.parse(packet.days[0].manifestBytes.toString()),
  });
  const rawBytes = Buffer.from(nextRawBytes);
  updated.dayManifest.bytes = rawBytes.length;
  updated.dayManifest.sha256 = hash(rawBytes);
  const dayManifestBytes = json(updated.dayManifest);
  const row = updated.manifest.days[0];
  Object.assign(row, {rawBytes: rawBytes.length, rawSHA: hash(rawBytes), manifestSHA: hash(dayManifestBytes)});
  const part = updated.provenance.days[0].originalParts[0];
  Object.assign(part, {rawBytes: rawBytes.length, rawSHA: hash(rawBytes), manifestSHA: row.manifestSHA});
  const provenanceBytes = json(updated.provenance);
  updated.manifest.originalPartProvenanceSHA = hash(provenanceBytes);
  const manifestBytes = json(updated.manifest);
  updated.receipt.manifestSHA = hash(manifestBytes);
  return {manifestBytes, receiptBytes: json(updated.receipt), provenanceBytes,
    days: [{rawBytes, manifestBytes: dayManifestBytes}]};
}

function safeBridge({onRead} = {}) {
  const seen = [];
  return {
    seen,
    mode: 'SYNTHETIC_ONLY',
    async read(bytes) {
      seen.push(Buffer.from(bytes));
      onRead?.(bytes);
      return {status: 'NOT_ADMITTED', mode: 'SYNTHETIC_ONLY', sourceByteStatus: 'SYNTHETIC_BYTES_ONLY',
        candidateStatus: 'NOT_CREATED', fileCount: 1, sourceManifestBinding: 'CONTENT_UNDECLARED',
        blockers: ['SYNTHETIC_ONLY'], purchaseEligibility: false, actualExposureYen: 0};
    },
  };
}

test('runs schema, day, provenance and synthetic hash bridge over one copied fixture packet', async () => {
  const packet = packetFixture();
  const bridge = safeBridge();
  const result = await validateSyntheticPacketWithOpenat2(packet, {bridge});
  assert.equal(result.status, 'SYNTHETIC_SCHEMA_AND_HASH_BINDING_ONLY');
  assert.equal(result.mode, 'SYNTHETIC_ONLY');
  assert.equal(result.checkedFiles, 5);
  assert.equal(bridge.seen.length, 5);
  assert.equal(result.sourceApprovalForFit, false);
  assert.equal(result.actualFit, 0);
  assert.equal(result.financialActions, 0);
  assert.equal(result.operationalQualified, false);
});

test('snapshots caller buffers before async bridge work can mutate them', async () => {
  const packet = packetFixture();
  const original = Buffer.from(packet.manifestBytes);
  const bridge = safeBridge({onRead() { packet.manifestBytes.fill(0); }});
  await validateSyntheticPacketWithOpenat2(packet, {bridge});
  assert.deepEqual(bridge.seen[0], original);
});

test('rejects malformed scope and altered raw binding before invoking the bridge', async () => {
  const invalid = packetFixture();
  const manifest = JSON.parse(invalid.manifestBytes.toString());
  manifest.scope = 'ACTUAL_ARCHIVE';
  invalid.manifestBytes = json(manifest);
  const fake = safeBridge();
  await assert.rejects(validateSyntheticPacketWithOpenat2(invalid, {bridge: fake}));
  assert.equal(fake.seen.length, 0);

  const tampered = packetFixture();
  tampered.days[0].rawBytes[0] ^= 1;
  await assert.rejects(validateSyntheticPacketWithOpenat2(tampered, {bridge: fake}), /DAY_RAW_BINDING/);
  assert.equal(fake.seen.length, 0);
});

test('rejects changed header, receipt, day-manifest and provenance bindings before bridge execution', async () => {
  const cases = [
    (p) => { const value = JSON.parse(p.manifestBytes); value.datasetDigest = sha(12); p.manifestBytes = json(value); },
    (p) => { const value = JSON.parse(p.receiptBytes); value.manifestSHA = sha(13); p.receiptBytes = json(value); },
    (p) => { p.days[0].manifestBytes[0] ^= 1; },
    (p) => { p.provenanceBytes[p.provenanceBytes.length - 1] ^= 1; },
  ];
  const codes = ['RECEIPT_BINDING', 'RECEIPT_BINDING', 'DAY_MANIFEST_PIN', 'PROVENANCE_SHA_BINDING'];
  for (let index = 0; index < cases.length; index += 1) {
    const packet = packetFixture();
    cases[index](packet);
    const bridge = safeBridge();
    await assert.rejects(validateSyntheticPacketWithOpenat2(packet, {bridge}), new RegExp(codes[index]));
    assert.equal(bridge.seen.length, 0);
  }
});

test('strictly rejects duplicate JSON keys, invalid UTF-8 and packet/header day-count disagreement', async () => {
  const bridge = safeBridge();
  const duplicateKey = packetFixture();
  duplicateKey.manifestBytes = Buffer.from('{"scope":"SYNTHETIC_FIXTURE","scope":"SYNTHETIC_FIXTURE"}');
  await assert.rejects(validateSyntheticPacketWithOpenat2(duplicateKey, {bridge}), /DUPLICATE_KEY/);

  const invalidUtf8 = packetFixture();
  invalidUtf8.receiptBytes = Buffer.from([0xff]);
  await assert.rejects(validateSyntheticPacketWithOpenat2(invalidUtf8, {bridge}), /UTF8/);

  const countMismatch = packetFixture();
  const manifest = JSON.parse(countMismatch.manifestBytes.toString());
  manifest.days.push({...manifest.days[0], date: '2026-04-02', rawName: 'day-2026-04-02-raw.json',
    manifestName: 'day-2026-04-02-manifest.json'});
  countMismatch.manifestBytes = json(manifest);
  const receipt = JSON.parse(countMismatch.receiptBytes.toString());
  receipt.dayCount = 2;
  receipt.manifestSHA = hash(countMismatch.manifestBytes);
  countMismatch.receiptBytes = json(receipt);
  await assert.rejects(validateSyntheticPacketWithOpenat2(countMismatch, {bridge}), /DAY_COUNT_MISMATCH/);
  assert.equal(bridge.seen.length, 0);
});

test('enforces the effective bridge per-file cap and total-byte ceiling before bridge execution', async () => {
  assert.deepEqual(RPS_SYNTHETIC_SCHEMA_INTEGRATION_LIMITS,
    {perFileBytes: 65_536, totalBytes: 262_144, maxDays: 16});
  const fake = safeBridge();
  const oversizedCases = [
    ['manifest', (p) => { p.manifestBytes = Buffer.alloc(65_537); }],
    ['receipt', (p) => { p.receiptBytes = Buffer.alloc(65_537); }],
    ['provenance', (p) => { p.provenanceBytes = Buffer.alloc(65_537); }],
    ['day-0-raw', (p) => { p.days[0].rawBytes = Buffer.alloc(65_537); }],
    ['day-0-manifest', (p) => { p.days[0].manifestBytes = Buffer.alloc(65_537); }],
  ];
  for (const [logicalFile, alter] of oversizedCases) {
    const oversized = packetFixture();
    alter(oversized);
    await assert.rejects(validateSyntheticPacketWithOpenat2(oversized, {bridge: fake}), (error) =>
      error instanceof RpsSyntheticSchemaIntegrationError && error.code === 'FILE_TOO_LARGE'
        && error.logicalFile === logicalFile);
  }
  assert.equal(fake.seen.length, 0);

  const atLimit = packetFixture(`{"races":[]}${' '.repeat(65_536 - Buffer.byteLength('{"races":[]}'))}`);
  const accepted = safeBridge();
  await validateSyntheticPacketWithOpenat2(atLimit, {bridge: accepted});
  assert.equal(accepted.seen[3].length, 65_536);

  const zero = packetFixture();
  zero.provenanceBytes = Buffer.alloc(0);
  await assert.rejects(validateSyntheticPacketWithOpenat2(zero, {bridge: fake}), /FILE_INVALID/);

  const large = packetFixture();
  const targetBytes = 53_000;
  large.days[0].rawBytes = pad(large.days[0].rawBytes, targetBytes);
  const dayManifest = JSON.parse(large.days[0].manifestBytes.toString());
  dayManifest.bytes = targetBytes;
  dayManifest.sha256 = hash(large.days[0].rawBytes);
  large.days[0].manifestBytes = replaceJsonBytesWithPadding(json(dayManifest), targetBytes);
  const largeManifest = JSON.parse(large.manifestBytes.toString());
  largeManifest.days[0].rawBytes = targetBytes;
  largeManifest.days[0].rawSHA = hash(large.days[0].rawBytes);
  largeManifest.days[0].manifestSHA = hash(large.days[0].manifestBytes);
  const provenance = JSON.parse(large.provenanceBytes.toString());
  Object.assign(provenance.days[0].originalParts[0], {
    rawBytes: targetBytes,
    rawSHA: largeManifest.days[0].rawSHA,
    manifestSHA: largeManifest.days[0].manifestSHA,
  });
  large.provenanceBytes = pad(json(provenance), targetBytes);
  largeManifest.originalPartProvenanceSHA = hash(large.provenanceBytes);
  large.manifestBytes = pad(json(largeManifest), targetBytes);
  const largeReceipt = JSON.parse(large.receiptBytes.toString());
  largeReceipt.manifestSHA = hash(large.manifestBytes);
  large.receiptBytes = pad(json(largeReceipt), targetBytes);
  await assert.rejects(validateSyntheticPacketWithOpenat2(large, {bridge: fake}), /TOTAL_TOO_LARGE/);
  assert.equal(fake.seen.length, 0);
});

test('rejects bridge promotion claims and bridge failures without partial result', async () => {
  const packet = packetFixture();
  const forged = safeBridge();
  forged.read = async () => ({status: 'ADMITTED', mode: 'ACTUAL', candidateStatus: 'CREATED'});
  await assert.rejects(validateSyntheticPacketWithOpenat2(packet, {bridge: forged}), /BRIDGE_RECEIPT_INVALID/);

  const failed = safeBridge();
  failed.read = async () => { throw Object.assign(new Error('hidden details'), {code: 'OPENAT2_UNAVAILABLE'}); };
  await assert.rejects(validateSyntheticPacketWithOpenat2(packet, {bridge: failed}), (error) =>
    error instanceof RpsSyntheticSchemaIntegrationError && error.code === 'OPENAT2_UNAVAILABLE'
      && error.logicalFile === 'manifest');
});

test('Linux uses the pinned openat2 C helper for the integrated synthetic packet', {
  skip: process.platform !== 'linux' && 'Linux openat2 integration is unavailable on this platform',
}, async () => {
  const first = await validateSyntheticPacketWithOpenat2(packetFixture(), {bridge: createSyntheticOpenat2Bridge()});
  const original = packetFixture();
  const changedRaw = Buffer.from(original.days[0].rawBytes);
  changedRaw[changedRaw.length - 2] ^= 1;
  const changedValidFixture = await validateSyntheticPacketWithOpenat2(
    rebindRawBytes(original, changedRaw), {bridge: createSyntheticOpenat2Bridge()});
  assert.equal(first.status, 'SYNTHETIC_SCHEMA_AND_HASH_BINDING_ONLY');
  assert.equal(changedValidFixture.checkedFiles, 5);
  assert.equal(changedValidFixture.purchaseEligibility, undefined);

  const invalidOneByteMutation = packetFixture();
  invalidOneByteMutation.days[0].rawBytes[0] ^= 1;
  await assert.rejects(validateSyntheticPacketWithOpenat2(invalidOneByteMutation,
    {bridge: createSyntheticOpenat2Bridge()}), /DAY_RAW_BINDING/);
});
