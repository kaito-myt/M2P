import {createHash} from 'node:crypto';
import {NORMALIZER_VERSION} from './normalize.mjs';
import {NEW_FAMILY_ACTUAL_SOURCE, newFamilyActualDates} from './joint-new-family-descriptive-source.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const MANIFEST_MAX = 131072;
const RAW_MAX = 33554432;
const DAY_MANIFEST_MAX = 131072;
const PROVENANCE_MAX = 2097152;
const ACTUAL_PROVENANCE_SHA = '68a3404dd9ab6aac5c5fcdb12ddff795d1465d7780caf7ba67052411f34a0484';
const MANIFEST_KEYS = [
  'originalPartProvenanceSHA', 'version', 'scope', 'datasetDigest', 'sourceSnapshotDigest',
  'originalPrefitManifestSHA', 'originalPrefitSourceDigest', 'original365ManifestSummaryDigest',
  'readerAdmissionDigest', 'normalizerVersion', 'sourceOnly', 'moneyUnitsVerified', 'days',
];
const RECEIPT_KEYS = [
  'version', 'scope', 'status', 'manifestSHA', 'manifestSummaryDigest', 'datasetDigest',
  'sourceSnapshotDigest', 'originalPrefitManifestSHA', 'originalPrefitSourceDigest', 'dayCount',
  'rawRows', 'authenticatedDecisions', 'nonemptyA0', 'unknownClocks', 'targetCount',
  'decisionDigest', 'targetDigest', 'sourceImplementations', 'originalExtractorIdentity',
  'normalizerVersion', 'rawPacketSemantics', 'moneyUnitsVerified', 'sourceApprovalForFit',
  'actualFit', 'profit', 'financialActions', 'operationalQualified',
];
const DAY_KEYS = ['date', 'rawSHA', 'rawBytes', 'manifestSHA', 'rawName', 'manifestName'];
const FAIL = (code) => { throw new RpsSourceSchemaError(code); };

export class RpsSourceSchemaError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RpsSourceSchemaError';
    this.code = code;
  }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, code) {
  if (!isObject(value)) FAIL(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) FAIL(code);
}

function sha(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function parseStrictJsonBytes(bytes, maxBytes, code) {
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maxBytes) FAIL(`${code}_SIZE`);
  let source;
  try {
    source = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  } catch {
    FAIL(`${code}_UTF8`);
  }

  let index = 0;
  const whitespace = () => {
    while (source[index] === ' ' || source[index] === '\t' || source[index] === '\r' || source[index] === '\n') index += 1;
  };
  const string = () => {
    const start = index;
    if (source[index] !== '"') FAIL(`${code}_JSON`);
    index += 1;
    while (index < source.length) {
      const char = source[index];
      if (char === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch {
          FAIL(`${code}_JSON`);
        }
      }
      if (char === '\\') {
        index += 1;
        if (index >= source.length) FAIL(`${code}_JSON`);
        const escaped = source[index];
        if (escaped === 'u') {
          if (!/^[a-fA-F0-9]{4}$/.test(source.slice(index + 1, index + 5))) FAIL(`${code}_JSON`);
          index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escaped)) FAIL(`${code}_JSON`);
        index += 1;
        continue;
      }
      if (char.charCodeAt(0) < 0x20) FAIL(`${code}_JSON`);
      index += 1;
    }
    FAIL(`${code}_JSON`);
  };
  const value = (depth = 0) => {
    if (depth > 64) FAIL(`${code}_DEPTH`);
    whitespace();
    const char = source[index];
    if (char === '"') return string();
    if (char === '{') {
      index += 1;
      whitespace();
      const result = Object.create(null);
      const seen = new Set();
      if (source[index] === '}') {
        index += 1;
        return result;
      }
      while (index < source.length) {
        whitespace();
        const key = string();
        if (seen.has(key)) FAIL(`${code}_DUPLICATE_KEY`);
        seen.add(key);
        whitespace();
        if (source[index] !== ':') FAIL(`${code}_JSON`);
        index += 1;
        result[key] = value(depth + 1);
        whitespace();
        if (source[index] === '}') {
          index += 1;
          return result;
        }
        if (source[index] !== ',') FAIL(`${code}_JSON`);
        index += 1;
      }
      FAIL(`${code}_JSON`);
    }
    if (char === '[') {
      index += 1;
      whitespace();
      const result = [];
      if (source[index] === ']') {
        index += 1;
        return result;
      }
      while (index < source.length) {
        result.push(value(depth + 1));
        whitespace();
        if (source[index] === ']') {
          index += 1;
          return result;
        }
        if (source[index] !== ',') FAIL(`${code}_JSON`);
        index += 1;
      }
      FAIL(`${code}_JSON`);
    }
    const rest = source.slice(index);
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (rest.startsWith(literal)) {
        index += literal.length;
        return parsed;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      index += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed)) FAIL(`${code}_NONFINITE_NUMBER`);
      return parsed;
    }
    FAIL(`${code}_JSON`);
  };

  const parsed = value();
  whitespace();
  if (index !== source.length) FAIL(`${code}_JSON`);
  return parsed;
}

function validateDayRow(day) {
  exactKeys(day, DAY_KEYS, 'DAY_ROW_SCHEMA');
  if (!validDate(day.date) || !sha(day.rawSHA) || !sha(day.manifestSHA)
      || !Number.isSafeInteger(day.rawBytes) || day.rawBytes < 1 || day.rawBytes > RAW_MAX
      || day.rawName !== `day-${day.date}-raw.json`
      || day.manifestName !== `day-${day.date}-manifest.json`) FAIL('DAY_ROW_SCHEMA');
  return day;
}

function validateSourceImplementations(value) {
  if (value === null) return;
  const keys = ['runtimeClosureDigest', 'readerSHA', 'nativeExtractorSHA', 'normalizerSHA', 'richMaterializerSHA'];
  exactKeys(value, keys, 'RECEIPT_IMPLEMENTATIONS');
  if (keys.some((key) => !sha(value[key]))) FAIL('RECEIPT_IMPLEMENTATIONS');
}

function validateReceipt(receipt, manifest, manifestBytes, expectedScope) {
  exactKeys(receipt, RECEIPT_KEYS, 'RECEIPT_SCHEMA');
  const fieldsMatch = receipt.version === 'inbox_raw_packet_source_receipt_v1'
    && receipt.scope === expectedScope
    && receipt.status === 'source_packet_prepared'
    && receipt.manifestSHA === hash(manifestBytes)
    && receipt.manifestSummaryDigest === manifest.original365ManifestSummaryDigest
    && receipt.datasetDigest === manifest.datasetDigest
    && receipt.sourceSnapshotDigest === manifest.sourceSnapshotDigest
    && receipt.originalPrefitManifestSHA === manifest.originalPrefitManifestSHA
    && receipt.originalPrefitSourceDigest === manifest.originalPrefitSourceDigest
    && receipt.dayCount === manifest.days.length
    && receipt.normalizerVersion === NORMALIZER_VERSION
    && receipt.rawPacketSemantics === 'original_decompressed_bytes_and_original_manifest_no_merge'
    && receipt.moneyUnitsVerified === false
    && receipt.sourceApprovalForFit === false
    && receipt.actualFit === 0
    && receipt.profit === null
    && receipt.financialActions === 0
    && receipt.operationalQualified === false;
  if (!fieldsMatch || !sha(receipt.manifestSHA) || !sha(receipt.manifestSummaryDigest)
      || !sha(receipt.datasetDigest) || !sha(receipt.sourceSnapshotDigest)
      || !sha(receipt.originalPrefitManifestSHA) || !sha(receipt.originalPrefitSourceDigest)
      || !sha(receipt.decisionDigest) || !sha(receipt.targetDigest)
      || !sha(receipt.originalExtractorIdentity)
      || !nonnegativeInteger(receipt.dayCount) || !nonnegativeInteger(receipt.rawRows)
      || !nonnegativeInteger(receipt.authenticatedDecisions) || !nonnegativeInteger(receipt.nonemptyA0)
      || !nonnegativeInteger(receipt.unknownClocks) || !nonnegativeInteger(receipt.targetCount)
      || receipt.authenticatedDecisions + receipt.unknownClocks !== receipt.rawRows) FAIL('RECEIPT_BINDING');
  validateSourceImplementations(receipt.sourceImplementations);

  if (expectedScope === 'ACTUAL_ARCHIVE'
      && (receipt.manifestSHA !== NEW_FAMILY_ACTUAL_SOURCE.manifestSHA
        || receipt.datasetDigest !== NEW_FAMILY_ACTUAL_SOURCE.datasetDigest
        || receipt.sourceSnapshotDigest !== NEW_FAMILY_ACTUAL_SOURCE.sourceSnapshotDigest
        || receipt.originalPrefitManifestSHA !== NEW_FAMILY_ACTUAL_SOURCE.originalPrefitManifestSHA
        || receipt.originalPrefitSourceDigest !== NEW_FAMILY_ACTUAL_SOURCE.originalPrefitSourceDigest
        || receipt.rawRows !== 32748 || receipt.authenticatedDecisions !== 32688 || receipt.unknownClocks !== 60)) {
    FAIL('ACTUAL_RECEIPT_PIN');
  }
  return receipt;
}

/** Validates only the pinned header schema and cross-bindings; it performs no source-byte admission. */
export function validateSourceHeaders({manifestBytes, receiptBytes, expectedScope = 'ACTUAL_ARCHIVE'}) {
  if (!['ACTUAL_ARCHIVE', 'SYNTHETIC_FIXTURE'].includes(expectedScope)) FAIL('SCOPE');
  const manifest = parseStrictJsonBytes(manifestBytes, MANIFEST_MAX, 'SOURCE_MANIFEST');
  const receipt = parseStrictJsonBytes(receiptBytes, MANIFEST_MAX, 'SOURCE_RECEIPT');
  exactKeys(manifest, MANIFEST_KEYS, 'MANIFEST_SCHEMA');
  if (manifest.version !== 'inbox_raw_source_packets_v1' || manifest.scope !== expectedScope
      || !sha(manifest.originalPartProvenanceSHA) || !sha(manifest.datasetDigest)
      || !sha(manifest.sourceSnapshotDigest) || !sha(manifest.originalPrefitManifestSHA)
      || !sha(manifest.originalPrefitSourceDigest) || !sha(manifest.original365ManifestSummaryDigest)
      || !sha(manifest.readerAdmissionDigest) || manifest.normalizerVersion !== NORMALIZER_VERSION
      || manifest.sourceOnly !== true || manifest.moneyUnitsVerified !== false
      || !Array.isArray(manifest.days) || manifest.days.length < 1 || manifest.days.length > 211) FAIL('MANIFEST_BINDING');
  for (const day of manifest.days) validateDayRow(day);
  const dates = manifest.days.map(({date}) => date);
  if (dates.some((date, index) => index > 0 && date <= dates[index - 1])) FAIL('DAY_ORDER');
  if (expectedScope === 'ACTUAL_ARCHIVE') {
    if (dates.length !== 211 || JSON.stringify(dates) !== JSON.stringify(newFamilyActualDates())) FAIL('ACTUAL_DATES');
    if (hash(manifestBytes) !== NEW_FAMILY_ACTUAL_SOURCE.manifestSHA) FAIL('ACTUAL_MANIFEST_PIN');
    if (hash(receiptBytes) !== '98c2bed45905bb0ebb256bd80643e4ca56cb3520f443ae4f2ad752ee6563e459') FAIL('ACTUAL_RECEIPT_BYTE_PIN');
    if (manifest.datasetDigest !== NEW_FAMILY_ACTUAL_SOURCE.datasetDigest
        || manifest.sourceSnapshotDigest !== NEW_FAMILY_ACTUAL_SOURCE.sourceSnapshotDigest
        || manifest.originalPrefitManifestSHA !== NEW_FAMILY_ACTUAL_SOURCE.originalPrefitManifestSHA
        || manifest.originalPrefitSourceDigest !== NEW_FAMILY_ACTUAL_SOURCE.originalPrefitSourceDigest) FAIL('ACTUAL_MANIFEST_FIELDS');
  }
  validateReceipt(receipt, manifest, manifestBytes, expectedScope);
  return Object.freeze({
    scope: expectedScope,
    manifest: Object.freeze(manifest),
    receipt: Object.freeze(receipt),
    dates: Object.freeze(dates),
    sourceByteStatus: 'SCHEMA_ONLY_NO_PHYSICAL_ADMISSION',
    sourceManifestBinding: 'CONTENT_UNDECLARED',
    featureTimeStatus: 'TIME_UNKNOWN',
    sourceApprovalForFit: false,
    actualFit: 0,
    financialActions: 0,
    operationalQualified: false,
  });
}

/** Binds one observed raw and its original day manifest to a previously schema-checked row. */
export function validateSourceDayPacket({day, rawBytes, manifestBytes}) {
  validateDayRow(day);
  if (!(Buffer.isBuffer(rawBytes) || rawBytes instanceof Uint8Array)
      || rawBytes.byteLength !== day.rawBytes || rawBytes.byteLength > RAW_MAX || hash(rawBytes) !== day.rawSHA) FAIL('DAY_RAW_BINDING');
  if (!(Buffer.isBuffer(manifestBytes) || manifestBytes instanceof Uint8Array)
      || manifestBytes.byteLength < 1 || manifestBytes.byteLength > DAY_MANIFEST_MAX
      || hash(manifestBytes) !== day.manifestSHA) FAIL('DAY_MANIFEST_PIN');
  const originalManifest = parseStrictJsonBytes(manifestBytes, DAY_MANIFEST_MAX, 'DAY_MANIFEST');
  if (!isObject(originalManifest) || originalManifest.source !== 'turnmark_v1'
      || originalManifest.date !== day.date || originalManifest.status !== 'collected'
      || originalManifest.sha256 !== day.rawSHA || originalManifest.bytes !== day.rawBytes) FAIL('DAY_MANIFEST_BINDING');
  const ignoredExtraKeys = Object.keys(originalManifest).filter((key) => !['source', 'date', 'status', 'sha256', 'bytes'].includes(key));
  return Object.freeze({
    date: day.date,
    rawByteBinding: 'MATCHED_INPUT_BYTES_ONLY',
    dayManifestBinding: 'MATCHED_REQUIRED_FIELDS',
    ignoredExtraKeys: Object.freeze(ignoredExtraKeys),
    sourceByteStatus: 'SCHEMA_ONLY_NO_PHYSICAL_ADMISSION',
    featureTimeStatus: 'TIME_UNKNOWN',
    actualFit: 0,
    financialActions: 0,
    operationalQualified: false,
  });
}

/** Binds the provenance document to the schema-checked manifest and each of its daily source rows. */
export function validateSourceProvenance({sourceHeaders, provenanceBytes}) {
  if (!sourceHeaders || !['ACTUAL_ARCHIVE', 'SYNTHETIC_FIXTURE'].includes(sourceHeaders.scope)
      || !isObject(sourceHeaders.manifest)) FAIL('PROVENANCE_SOURCE_HEADERS');
  if (!(Buffer.isBuffer(provenanceBytes) || provenanceBytes instanceof Uint8Array)
      || provenanceBytes.byteLength < 1 || provenanceBytes.byteLength > PROVENANCE_MAX) FAIL('PROVENANCE_SIZE');
  const {manifest} = sourceHeaders;
  const digest = hash(provenanceBytes);
  if (digest !== manifest.originalPartProvenanceSHA) FAIL('PROVENANCE_SHA_BINDING');
  if (sourceHeaders.scope === 'ACTUAL_ARCHIVE' && digest !== ACTUAL_PROVENANCE_SHA) FAIL('ACTUAL_PROVENANCE_PIN');
  const provenance = parseStrictJsonBytes(provenanceBytes, PROVENANCE_MAX, 'PROVENANCE');
  exactKeys(provenance, ['version', 'scope', 'original365ManifestSummaryDigest', 'days'], 'PROVENANCE_SCHEMA');
  if (provenance.version !== 'inbox_original_part_provenance_v1'
      || provenance.scope !== sourceHeaders.scope
      || provenance.original365ManifestSummaryDigest !== manifest.original365ManifestSummaryDigest
      || !Array.isArray(provenance.days)
      || provenance.days.length !== manifest.days.length) FAIL('PROVENANCE_BINDING');

  for (let index = 0; index < manifest.days.length; index += 1) {
    const row = validateDayRow(manifest.days[index]);
    const day = provenance.days[index];
    exactKeys(day, ['date', 'originalParts'], 'PROVENANCE_DAY_SCHEMA');
    if (day.date !== row.date || !Array.isArray(day.originalParts) || day.originalParts.length !== 1) FAIL('PROVENANCE_DAY_BINDING');
    const part = day.originalParts[0];
    const partKeys = ['name', 'compressedSHA', 'compressedBytes', 'rawSHA', 'rawBytes', 'manifestName', 'manifestSHA', 'partCount', 'assembly'];
    exactKeys(part, partKeys, 'PROVENANCE_PART_SCHEMA');
    const stem = `${row.date.slice(0, 4)}/${row.date.replaceAll('-', '')}`;
    const expectedName = `raw/turnmark_v1/${stem}.json.gz`;
    const expectedManifestName = `manifests/turnmark_v1/${stem}.json`;
    if (part.name !== expectedName || part.manifestName !== expectedManifestName
        || !sha(part.compressedSHA) || !Number.isSafeInteger(part.compressedBytes)
        || part.compressedBytes < 1 || part.compressedBytes > RAW_MAX
        || part.rawSHA !== row.rawSHA || part.rawBytes !== row.rawBytes
        || part.manifestSHA !== row.manifestSHA || part.partCount !== 1
        || part.assembly !== 'none_byte_preserving_single_turnmark_part') FAIL('PROVENANCE_PART_BINDING');
  }
  return Object.freeze({
    scope: sourceHeaders.scope,
    provenanceSHA: digest,
    provenanceBinding: 'CONTENT_MATCH',
    sourceManifestBinding: 'CONTENT_UNDECLARED',
    sourceByteStatus: 'SCHEMA_ONLY_NO_PHYSICAL_ADMISSION',
    featureTimeStatus: 'TIME_UNKNOWN',
    sourceApprovalForFit: false,
    actualFit: 0,
    financialActions: 0,
    operationalQualified: false,
  });
}

/** Exposed for bounded parser contract tests; output is never an admission receipt. */
export function parseRpsStrictJson(bytes, {maxBytes = MANIFEST_MAX} = {}) {
  return parseStrictJsonBytes(bytes, maxBytes, 'JSON');
}
