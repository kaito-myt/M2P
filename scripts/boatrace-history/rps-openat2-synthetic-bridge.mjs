import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluateSyntheticByteReceipt, RpsByteAdmissionError} from './rps-byte-admission-controller.mjs';

const HELPER_SOURCE = fileURLToPath(new URL('./rps-openat2-synthetic-helper.c', import.meta.url));
const HELPER_SOURCE_SHA256 = '420b4adc3ce9ed32d7eb419818205a2cf38addc8a3a8d8351df7e88252516ca0';
const FIXTURE_LIMIT_BYTES = 64 * 1024;
const PROCESS_TIMEOUT_MS = 5_000;
const ADDRESS_LIMIT_BYTES = 256 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;

export class RpsSyntheticOpenat2Error extends Error {
  constructor(code) {
    super(code);
    this.name = 'RpsSyntheticOpenat2Error';
    this.code = code;
  }
}

export function assertPinnedSyntheticHelperSource(source) {
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== HELPER_SOURCE_SHA256) throw new RpsSyntheticOpenat2Error('HELPER_SOURCE_HASH_MISMATCH');
  return digest;
}

function processFailed(result) {
  if (result?.error?.code === 'ETIMEDOUT') throw new RpsSyntheticOpenat2Error('SYNTHETIC_HELPER_TIMEOUT');
  if (result?.error || result?.status !== 0 || result?.signal) throw new RpsSyntheticOpenat2Error('SYNTHETIC_HELPER_FAILED');
  return result;
}

function parseHelperOutput(stdout, expectedBytes, expectedSha256) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new RpsSyntheticOpenat2Error('SYNTHETIC_RECEIPT_INVALID');
  }
  if (!parsed || Object.getPrototypeOf(parsed) !== Object.prototype
      || Object.keys(parsed).sort().join('|') !== 'bytes|mode|sha256'
      || parsed.mode !== 'SYNTHETIC_ONLY'
      || parsed.bytes !== String(expectedBytes)
      || typeof parsed.sha256 !== 'string' || !HEX.test(parsed.sha256)
      || parsed.sha256 !== expectedSha256) {
    throw new RpsSyntheticOpenat2Error('SYNTHETIC_RECEIPT_INVALID');
  }
  return parsed;
}

function helperArgs(root, identity, relativePath, bytes) {
  return [
    '--synthetic-fixture',
    '--root', root,
    '--expected-dev', String(identity.dev),
    '--expected-ino', String(identity.ino),
    '--expected-uid', String(identity.uid),
    '--relative-path', relativePath,
    '--max-bytes', String(bytes),
    '--max-wall-ms', '2500',
    '--max-address-bytes', String(ADDRESS_LIMIT_BYTES),
  ];
}

/** Reads only bytes this call itself writes under a fresh OS temp directory. */
export function createSyntheticOpenat2Bridge({spawnProcess = spawnSync, platform = process.platform, getUid = process.getuid} = {}) {
  if (typeof spawnProcess !== 'function') throw new TypeError('spawnProcess must be a function');

  return Object.freeze({
    mode: 'SYNTHETIC_ONLY',
    async read(fixtureBytes) {
      if (platform !== 'linux') throw new RpsSyntheticOpenat2Error('OPENAT2_UNAVAILABLE');
      if (!Buffer.isBuffer(fixtureBytes) || fixtureBytes.length === 0 || fixtureBytes.length > FIXTURE_LIMIT_BYTES) {
        throw new RpsSyntheticOpenat2Error('SYNTHETIC_FIXTURE_INVALID');
      }

      let source;
      try {
        source = await readFile(HELPER_SOURCE);
      } catch {
        throw new RpsSyntheticOpenat2Error('SYNTHETIC_HELPER_UNAVAILABLE');
      }
      assertPinnedSyntheticHelperSource(source);

      const work = await mkdtemp(path.join(tmpdir(), 'rps-openat2-bridge-'));
      try {
        const root = path.join(work, 'root');
        const relativePath = 'fixture/sample.json';
        const fixture = path.join(root, ...relativePath.split('/'));
        await mkdir(path.dirname(fixture), {recursive: true});
        await writeFile(fixture, fixtureBytes, {flag: 'wx', mode: 0o600});
        const rootStat = await stat(root, {bigint: true});
        const uid = typeof getUid === 'function' ? getUid() : null;
        if (uid === null) throw new RpsSyntheticOpenat2Error('SYNTHETIC_IDENTITY_UNAVAILABLE');

        const verifiedSourcePath = path.join(work, 'rps-openat2-synthetic-helper.c');
        const binary = path.join(work, 'rps-openat2-synthetic-helper');
        await writeFile(verifiedSourcePath, source, {flag: 'wx', mode: 0o600});
        processFailed(spawnProcess('cc', ['-std=c11', '-O2', verifiedSourcePath, '-lcrypto', '-o', binary], {
          encoding: 'utf8', timeout: PROCESS_TIMEOUT_MS, maxBuffer: 64 * 1024,
        }));
        const result = processFailed(spawnProcess(binary, helperArgs(root, {
          dev: rootStat.dev,
          ino: rootStat.ino,
          uid,
        }, relativePath, fixtureBytes.length), {
          encoding: 'utf8', timeout: PROCESS_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
        }));

        const digest = createHash('sha256').update(fixtureBytes).digest('hex');
        parseHelperOutput(result.stdout, fixtureBytes.length, digest);
        return evaluateSyntheticByteReceipt({
          mode: 'SYNTHETIC_ONLY',
          files: [{name: 'synthetic-fixture.json', bytes: fixtureBytes.length, sha256: digest}],
          sourceManifestBinding: 'CONTENT_UNDECLARED',
        });
      } catch (error) {
        if (error instanceof RpsSyntheticOpenat2Error || error instanceof RpsByteAdmissionError) throw error;
        throw new RpsSyntheticOpenat2Error('SYNTHETIC_HELPER_FAILED');
      } finally {
        await rm(work, {recursive: true, force: true});
      }
    },
  });
}
