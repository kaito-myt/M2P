import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  assertPinnedSyntheticHelperSource,
  createSyntheticOpenat2Bridge,
  RpsSyntheticOpenat2Error,
} from './rps-openat2-synthetic-bridge.mjs';

const helperSourcePath = fileURLToPath(new URL('./rps-openat2-synthetic-helper.c', import.meta.url));
const helperSource = readFileSync(helperSourcePath);

function successRunner(payload) {
  let calls = 0;
  return {
    get calls() { return calls; },
    run(command, args, options) {
      calls++;
      assert.equal(options.timeout, 5000);
      if (command === 'cc') return {status: 0, stdout: '', stderr: ''};
      assert.match(command, /rps-openat2-synthetic-helper$/);
      assert.equal(args[0], '--synthetic-fixture');
      assert.equal(args[args.indexOf('--relative-path') + 1], 'fixture/sample.json');
      assert.equal(args[args.indexOf('--max-bytes') + 1], String(payload.length));
      assert.equal(args.includes('--synthetic-test-blocking-open'), false);
      return {
        status: 0,
        stdout: JSON.stringify({
          mode: 'SYNTHETIC_ONLY',
          bytes: String(payload.length),
          sha256: createHash('sha256').update(payload).digest('hex'),
        }),
        stderr: '',
      };
    },
  };
}

test('pins the helper source before any subprocess invocation', () => {
  assert.match(assertPinnedSyntheticHelperSource(helperSource), /^[a-f0-9]{64}$/);
  assert.throws(() => assertPinnedSyntheticHelperSource(Buffer.from(`${helperSource}\n`)), error =>
    error instanceof RpsSyntheticOpenat2Error && error.code === 'HELPER_SOURCE_HASH_MISMATCH');
});

test('uses a fixed temp fixture path and returns synthetic-only non-promotable status', async () => {
  const payload = Buffer.from('{"synthetic":true}\n');
  const runner = successRunner(payload);
  const bridge = createSyntheticOpenat2Bridge({spawnProcess: runner.run, platform: 'linux', getUid: () => 1000});
  const result = await bridge.read(payload);

  assert.equal(runner.calls, 2);
  assert.equal(bridge.mode, 'SYNTHETIC_ONLY');
  assert.equal(result.mode, 'SYNTHETIC_ONLY');
  assert.equal(result.sourceByteStatus, 'SYNTHETIC_BYTES_ONLY');
  assert.equal(result.candidateStatus, 'NOT_CREATED');
  assert.deepEqual(result.blockers, ['SYNTHETIC_ONLY']);
  assert.equal(result.purchaseEligibility, false);
  assert.equal(result.actualExposureYen, 0);
});

test('Linux bridge compiles and invokes the pinned openat2 helper with a synthetic fixture', {skip: process.platform !== 'linux' && 'Linux openat2 integration is unavailable on this platform'}, async () => {
  const payload = Buffer.from('{"bridge":"linux-integration-fixture"}\n');
  const bridge = createSyntheticOpenat2Bridge();
  const result = await bridge.read(payload);

  assert.equal(result.mode, 'SYNTHETIC_ONLY');
  assert.equal(result.sourceByteStatus, 'SYNTHETIC_BYTES_ONLY');
  assert.equal(result.candidateStatus, 'NOT_CREATED');
  assert.deepEqual(result.blockers, ['SYNTHETIC_ONLY']);
  assert.equal(result.purchaseEligibility, false);
  assert.equal(result.actualExposureYen, 0);
});

test('rejects subprocess timeout and does not create an admission result', async () => {
  const payload = Buffer.from('fixture');
  let calls = 0;
  const bridge = createSyntheticOpenat2Bridge({
    platform: 'linux',
    getUid: () => 1000,
    spawnProcess() {
      calls++;
      if (calls === 1) return {status: 0, stdout: '', stderr: ''};
      return {status: null, signal: 'SIGKILL', error: {code: 'ETIMEDOUT'}};
    },
  });
  await assert.rejects(bridge.read(payload), error =>
    error instanceof RpsSyntheticOpenat2Error && error.code === 'SYNTHETIC_HELPER_TIMEOUT');
  assert.equal(calls, 2);
});

test('rejects helper output carrying actual-status claims or altered hash/size', async () => {
  const payload = Buffer.from('fixture');
  const invalidOutputs = [
    {mode: 'SYNTHETIC_ONLY', bytes: String(payload.length), sha256: createHash('sha256').update(payload).digest('hex'), status: 'CURRENT_425_BYTES_MATCH_PAST_RECEIPT'},
    {mode: 'ACTUAL', bytes: String(payload.length), sha256: createHash('sha256').update(payload).digest('hex')},
    {mode: 'SYNTHETIC_ONLY', bytes: '999', sha256: createHash('sha256').update(payload).digest('hex')},
    {mode: 'SYNTHETIC_ONLY', bytes: String(payload.length), sha256: '0'.repeat(64)},
  ];
  for (const output of invalidOutputs) {
    let calls = 0;
    const bridge = createSyntheticOpenat2Bridge({
      platform: 'linux',
      getUid: () => 1000,
      spawnProcess() {
        calls++;
        return calls === 1
          ? {status: 0, stdout: '', stderr: ''}
          : {status: 0, stdout: JSON.stringify(output), stderr: ''};
      },
    });
    await assert.rejects(bridge.read(payload), error =>
      error instanceof RpsSyntheticOpenat2Error && error.code === 'SYNTHETIC_RECEIPT_INVALID');
  }
});

test('fails closed on unsupported platforms and caller-provided non-buffer fixtures', async () => {
  const bridge = createSyntheticOpenat2Bridge({platform: 'win32', spawnProcess() {
    assert.fail('unsupported platform must not spawn a helper');
  }});
  await assert.rejects(bridge.read(Buffer.from('fixture')), error => error.code === 'OPENAT2_UNAVAILABLE');
  const linuxBridge = createSyntheticOpenat2Bridge({platform: 'linux'});
  await assert.rejects(linuxBridge.read('../outside'), error => error.code === 'SYNTHETIC_FIXTURE_INVALID');
});
