const ACTUAL_PREREQUISITES = Object.freeze({
  fixedRootIdentity: false,
  openat2HelperAudited: false,
  byteBudgetsFrozen: false,
  manifestSchemasFrozen: false,
  resourceProfileVerified: false,
  actualReaderImplemented: false,
});

const PREREQUISITE_CODES = Object.freeze([
  ['fixedRootIdentity', 'DESCRIPTOR_UNKNOWN'],
  ['openat2HelperAudited', 'OPENAT2_HELPER_UNAVAILABLE'],
  ['byteBudgetsFrozen', 'RESOURCE_PRECHECK'],
  ['manifestSchemasFrozen', 'MANIFEST_BINDING'],
  ['resourceProfileVerified', 'RESOURCE_PRECHECK'],
  ['actualReaderImplemented', 'ACTUAL_READER_NOT_IMPLEMENTED'],
]);

const HEX = /^[a-f0-9]{64}$/;

export class RpsByteAdmissionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RpsByteAdmissionError';
    this.code = code;
  }
}

function frozenResult(blockers, extra = {}) {
  return Object.freeze({
    status: blockers.length === 0 ? 'READY_FOR_SEPARATE_REVIEW' : 'NOT_ADMITTED',
    sourceByteStatus: 'NOT_READ',
    candidateStatus: 'NOT_CREATED',
    blockers: Object.freeze([...blockers]),
    purchaseEligibility: false,
    actualExposureYen: 0,
    ...extra,
  });
}

function getBlockers() {
  return [...new Set(PREREQUISITE_CODES
    .filter(([key]) => !ACTUAL_PREREQUISITES[key])
    .map(([, code]) => code))];
}

/** Reports code-fixed readiness; caller assertions can never enable actual byte reads. */
export function inspectRpsByteAdmissionReadiness() {
  return frozenResult(getBlockers());
}

/** Actual reads remain disabled until fixed identity, helper, budgets, schemas, and resources are reviewed. */
export async function readFixedSourceBytes(_policy) {
  const blockers = getBlockers();
  if (blockers.length > 0) throw new RpsByteAdmissionError(blockers[0]);
  throw new RpsByteAdmissionError('ACTUAL_READER_NOT_IMPLEMENTED');
}

function validateSyntheticReceipt(receipt) {
  if (!receipt || Object.getPrototypeOf(receipt) !== Object.prototype) {
    throw new RpsByteAdmissionError('SYNTHETIC_RECEIPT_INVALID');
  }
  const expectedKeys = ['mode', 'files', 'sourceManifestBinding'];
  if (Object.keys(receipt).sort().join('|') !== expectedKeys.sort().join('|')
      || receipt.mode !== 'SYNTHETIC_ONLY'
      || !Array.isArray(receipt.files)
      || !['CONTENT_MATCH', 'CONTENT_UNDECLARED'].includes(receipt.sourceManifestBinding)) {
    throw new RpsByteAdmissionError('SYNTHETIC_RECEIPT_INVALID');
  }
  for (const file of receipt.files) {
    if (!file || Object.getPrototypeOf(file) !== Object.prototype
        || Object.keys(file).sort().join('|') !== 'bytes|name|sha256'
        || typeof file.name !== 'string' || file.name.length === 0
        || !Number.isSafeInteger(file.bytes) || file.bytes < 0
        || typeof file.sha256 !== 'string' || !HEX.test(file.sha256)) {
      throw new RpsByteAdmissionError('SYNTHETIC_RECEIPT_INVALID');
    }
  }
  return receipt;
}

/** Synthetic adapter contract-test path; its output can never authorize actual admission. */
export function evaluateSyntheticByteReceipt(receipt) {
  const validated = validateSyntheticReceipt(receipt);
  return frozenResult(['SYNTHETIC_ONLY'], {
    mode: 'SYNTHETIC_ONLY',
    sourceByteStatus: 'SYNTHETIC_BYTES_ONLY',
    candidateStatus: 'NOT_CREATED',
    fileCount: validated.files.length,
    sourceManifestBinding: validated.sourceManifestBinding,
  });
}

export function createSyntheticByteAdmissionAdapter(readFixture) {
  if (typeof readFixture !== 'function') throw new TypeError('readFixture must be a function');
  return Object.freeze({
    mode: 'SYNTHETIC_ONLY',
    async read() {
      const fixtureReceipt = await readFixture();
      return evaluateSyntheticByteReceipt(fixtureReceipt);
    },
  });
}
