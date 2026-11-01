import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  READONLY_CAPABILITY_PROBE_VERSION,
} from './rps-readonly-capability-probe.mjs';
import {
  runReadonlyCapabilityCi,
  sanitizeCapabilitySummary,
} from './rps-readonly-capability-ci.mjs';

function observed(reason = 'controller_delegation_not_enabled') {
  return {
    version: READONLY_CAPABILITY_PROBE_VERSION,
    status: 'UNAVAILABLE',
    reason,
    actualRun: false,
    actualRunAllowed: false,
    ownedSubtree: null,
    selfPath: '/host/private/path',
    mount: {root: '/private/root', mountPoint: '/sys/fs/cgroup', readOnly: false, device: 'hidden'},
    availableControllers: ['memory', 'pids', 'cpu', 'cpuset', 'io'],
    enabledControllers: ['memory', 'io'],
    parent: {memoryCurrentBytes: '123456', memoryMaxBytes: '999999', pidsCurrent: '42'},
  };
}

test('summary only emits a fixed allowlist and never discloses raw path or counters', () => {
  const summary = sanitizeCapabilitySummary(observed());
  assert.deepEqual(Object.keys(summary), [
    'schema', 'environment', 'scope', 'probeStatus', 'reason',
    'memoryAvailable', 'pidsAvailable', 'cpuAvailable',
    'memoryDelegated', 'pidsDelegated', 'cpuDelegated', 'mountReadOnly',
    'ownedSubtreeConfirmed', 'actualRunAllowed',
  ]);
  assert.equal(summary.probeStatus, 'READ_ONLY_PROBE_COMPLETED');
  assert.equal(summary.memoryAvailable, true);
  assert.equal(summary.pidsAvailable, true);
  assert.equal(summary.cpuAvailable, true);
  assert.equal(summary.memoryDelegated, true);
  assert.equal(summary.pidsDelegated, false);
  assert.equal(summary.cpuDelegated, false);
  assert.equal(summary.ownedSubtreeConfirmed, false);
  assert.equal(summary.actualRunAllowed, false);
  const serialized = JSON.stringify(summary);
  for (const forbidden of ['/host/private/path', '/private/root', '123456', '999999', 'device']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('unknown status, reason, controller, or malformed mount fails closed', () => {
  for (const mutate of [
    value => { value.status = 'AVAILABLE'; },
    value => { value.reason = 'new_unreviewed_reason'; },
    value => { value.availableControllers = ['memory', 'bad controller']; },
    value => { value.mount.readOnly = 'false'; },
  ]) {
    const value = observed();
    mutate(value);
    const summary = sanitizeCapabilitySummary(value);
    assert.equal(summary.probeStatus, 'UNKNOWN');
    assert.equal(summary.actualRunAllowed, false);
    assert.equal(JSON.stringify(summary).includes('/host/private/path'), false);
  }
});

test('CLI runner emits only sanitized JSON and returns nonzero on unknown evidence', async () => {
  const lines = [];
  const code = await runReadonlyCapabilityCi({probe: async () => observed(), write: line => lines.push(line)});
  assert.equal(code, 0);
  assert.equal(lines.length, 1);
  assert.doesNotThrow(() => JSON.parse(lines[0]));

  const unknownLines = [];
  const unknownCode = await runReadonlyCapabilityCi({
    probe: async () => ({...observed(), reason: 'unreviewed'}),
    write: line => unknownLines.push(line),
  });
  assert.equal(unknownCode, 1);
  assert.equal(JSON.parse(unknownLines[0]).probeStatus, 'UNKNOWN');
});

test('CLI has no environment, process-control, network, or volume integration', async () => {
  const source = await readFile(new URL('./rps-readonly-capability-ci.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|node:child_process|node:net|spawnSync|execSync|\.kill\(|writeFile|mkdir|unlink|volumePath/i);
});
