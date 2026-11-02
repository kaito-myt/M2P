import {
  validateSourceDayPacket,
  validateSourceHeaders,
  validateSourceProvenance,
} from './rps-source-schema-validator.mjs';
import {createSyntheticOpenat2Bridge} from './rps-openat2-synthetic-bridge.mjs';

const FILE_LIMIT = 64 * 1024;
const TOTAL_LIMIT = 256 * 1024;
const DAY_LIMIT = 16;
const FILES = Object.freeze(['manifest', 'receipt', 'provenance']);

export class RpsSyntheticSchemaIntegrationError extends Error {
  constructor(code, logicalFile = null) {
    super(code);
    this.name = 'RpsSyntheticSchemaIntegrationError';
    this.code = code;
    this.logicalFile = logicalFile;
  }
}

function snapshotPacket(packet) {
  if (!packet || Object.getPrototypeOf(packet) !== Object.prototype
      || Object.keys(packet).sort().join('|') !== 'days|manifestBytes|provenanceBytes|receiptBytes'
      || !Array.isArray(packet.days) || packet.days.length < 1 || packet.days.length > DAY_LIMIT) {
    throw new RpsSyntheticSchemaIntegrationError('PACKET_SHAPE');
  }

  const copy = (bytes, name) => {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new RpsSyntheticSchemaIntegrationError('FILE_INVALID', name);
    if (bytes.length > FILE_LIMIT) throw new RpsSyntheticSchemaIntegrationError('FILE_TOO_LARGE', name);
    return Buffer.from(bytes);
  };

  const copied = {
    manifestBytes: copy(packet.manifestBytes, 'manifest'),
    receiptBytes: copy(packet.receiptBytes, 'receipt'),
    provenanceBytes: copy(packet.provenanceBytes, 'provenance'),
    days: packet.days.map((day, index) => {
      if (!day || Object.getPrototypeOf(day) !== Object.prototype
          || Object.keys(day).sort().join('|') !== 'manifestBytes|rawBytes') {
        throw new RpsSyntheticSchemaIntegrationError('DAY_PACKET_SHAPE', `day-${index}`);
      }
      return {
        rawBytes: copy(day.rawBytes, `day-${index}-raw`),
        manifestBytes: copy(day.manifestBytes, `day-${index}-manifest`),
      };
    }),
  };
  const totalBytes = [copied.manifestBytes, copied.receiptBytes, copied.provenanceBytes,
    ...copied.days.flatMap(({rawBytes, manifestBytes}) => [rawBytes, manifestBytes])]
    .reduce((sum, bytes) => sum + bytes.length, 0);
  if (totalBytes > TOTAL_LIMIT) throw new RpsSyntheticSchemaIntegrationError('TOTAL_TOO_LARGE');
  return copied;
}

function assertBridgeReceipt(receipt) {
  const expectedKeys = 'actualExposureYen|blockers|candidateStatus|fileCount|mode|purchaseEligibility|sourceByteStatus|sourceManifestBinding|status';
  if (!receipt || Object.getPrototypeOf(receipt) !== Object.prototype
      || Object.keys(receipt).sort().join('|') !== expectedKeys
      || receipt.status !== 'NOT_ADMITTED'
      || receipt.mode !== 'SYNTHETIC_ONLY'
      || receipt.sourceByteStatus !== 'SYNTHETIC_BYTES_ONLY'
      || receipt.candidateStatus !== 'NOT_CREATED'
      || receipt.fileCount !== 1
      || receipt.sourceManifestBinding !== 'CONTENT_UNDECLARED'
      || !Array.isArray(receipt.blockers) || receipt.blockers.length !== 1
      || receipt.blockers[0] !== 'SYNTHETIC_ONLY'
      || receipt.purchaseEligibility !== false || receipt.actualExposureYen !== 0) {
    throw new RpsSyntheticSchemaIntegrationError('BRIDGE_RECEIPT_INVALID');
  }
  return receipt;
}

/** Joins schema checks and the hash-only openat2 test over one private synthetic byte snapshot. */
export async function validateSyntheticPacketWithOpenat2(packet, {bridge = createSyntheticOpenat2Bridge()} = {}) {
  if (!bridge || bridge.mode !== 'SYNTHETIC_ONLY' || typeof bridge.read !== 'function') {
    throw new RpsSyntheticSchemaIntegrationError('BRIDGE_MODE_INVALID');
  }
  const snapshot = snapshotPacket(packet);
  const headers = validateSourceHeaders({
    manifestBytes: snapshot.manifestBytes,
    receiptBytes: snapshot.receiptBytes,
    expectedScope: 'SYNTHETIC_FIXTURE',
  });
  if (headers.manifest.days.length !== snapshot.days.length) {
    throw new RpsSyntheticSchemaIntegrationError('DAY_COUNT_MISMATCH');
  }
  for (let index = 0; index < snapshot.days.length; index += 1) {
    const day = snapshot.days[index];
    validateSourceDayPacket({day: headers.manifest.days[index], ...day});
  }
  validateSourceProvenance({sourceHeaders: headers, provenanceBytes: snapshot.provenanceBytes});

  const files = [
    ['manifest', snapshot.manifestBytes],
    ['receipt', snapshot.receiptBytes],
    ['provenance', snapshot.provenanceBytes],
    ...snapshot.days.flatMap((day, index) => [
      [`day-${index}-raw`, day.rawBytes],
      [`day-${index}-manifest`, day.manifestBytes],
    ]),
  ];
  for (const [logicalFile, bytes] of files) {
    try {
      assertBridgeReceipt(await bridge.read(bytes));
    } catch (error) {
      if (error instanceof RpsSyntheticSchemaIntegrationError) throw error;
      throw new RpsSyntheticSchemaIntegrationError(error?.code ?? 'BRIDGE_READ_FAILED', logicalFile);
    }
  }

  return Object.freeze({
    mode: 'SYNTHETIC_ONLY',
    status: 'SYNTHETIC_SCHEMA_AND_HASH_BINDING_ONLY',
    checkedFiles: files.length,
    sourceByteStatus: 'SYNTHETIC_ONLY',
    sourceManifestBinding: 'CONTENT_UNDECLARED',
    featureTimeStatus: 'TIME_UNKNOWN',
    sourceApprovalForFit: false,
    actualFit: 0,
    financialActions: 0,
    operationalQualified: false,
  });
}

export const RPS_SYNTHETIC_SCHEMA_INTEGRATION_LIMITS = Object.freeze({
  perFileBytes: FILE_LIMIT,
  totalBytes: TOTAL_LIMIT,
  maxDays: DAY_LIMIT,
});
