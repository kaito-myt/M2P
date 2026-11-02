import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { probeReadonlyCgroupCapability, READONLY_CAPABILITY_PROBE_VERSION } from './rps-readonly-capability-probe.mjs';

const root = '/sys/fs/cgroup';
const fixture = ({
  self = '0::/runner/job-1/step-1\n',
  mountinfo = '31 22 0:28 / /sys/fs/cgroup rw,nosuid,nodev,noexec,relatime shared:1 - cgroup2 cgroup rw\n',
  available = 'cpu memory pids\n', enabled = 'cpu memory pids\n',
  events = 'populated 1\nfrozen 0\n', memoryCurrent = '1048576\n', memoryMax = 'max\n', pidsCurrent = '4\n',
} = {}) => {
  const values = new Map([
    ['/proc/self/cgroup', self], ['/proc/self/mountinfo', mountinfo],
    [`${root}/runner/job-1/step-1/cgroup.controllers`, available], [`${root}/runner/job-1/step-1/cgroup.subtree_control`, enabled],
    [`${root}/runner/job-1/step-1/cgroup.events`, events], [`${root}/runner/job-1/step-1/memory.current`, memoryCurrent],
    [`${root}/runner/job-1/step-1/memory.max`, memoryMax], [`${root}/runner/job-1/step-1/pids.current`, pidsCurrent],
  ]);
  const accessed = [];
  return {
    accessed,
    io: { async readBounded(path, maxBytes) { accessed.push(path); const value = values.get(path) ?? null; return value?.length <= maxBytes ? value : null; } },
  };
};

test('read-only snapshots never claim delegated ownership or authorize an actual run', async () => {
  const { io, accessed } = fixture();
  const result = await probeReadonlyCgroupCapability(io);
  assert.equal(result.version, READONLY_CAPABILITY_PROBE_VERSION);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reason, 'owned_delegated_subtree_unproven');
  assert.equal(result.actualRun, false);
  assert.equal(result.actualRunAllowed, false);
  assert.equal(result.volumeMounted, false);
  assert.deepEqual(result.parent, {
    memoryCurrentBytes: '1048576', memoryMaxBytes: 'max', pidsCurrent: '4',
  });
  assert.equal(result.ownedSubtree, null);
  assert.ok(accessed.every(path => path.startsWith('/proc/') || path.startsWith(`${root}/runner/job-1/step-1/`)));
});

test('reports missing delegation even if controllers are available', async () => {
  const { io } = fixture({ enabled: 'memory\n' });
  const result = await probeReadonlyCgroupCapability(io);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reason, 'controller_delegation_not_enabled');
  assert.deepEqual(result.missingDelegation, ['pids', 'cpu']);
  assert.equal(result.actualRun, false);
});

test('reports unavailable when required controllers are absent', async () => {
  const { io } = fixture({ available: 'memory pids\n', enabled: 'memory pids\n' });
  const result = await probeReadonlyCgroupCapability(io);
  assert.equal(result.reason, 'required_controller_unavailable');
  assert.deepEqual(result.missingControllers, ['cpu']);
});

test('fails closed when procfs or cgroup read permission is denied', async () => {
  const deniedProc = fixture();
  deniedProc.io.readBounded = async path => path === '/proc/self/cgroup' ? null : undefined;
  assert.equal((await probeReadonlyCgroupCapability(deniedProc.io)).reason, 'procfs_capability_read_denied');

  const deniedCgroup = fixture();
  const original = deniedCgroup.io.readBounded;
  deniedCgroup.io.readBounded = async (path, maxBytes) => path === `${root}/runner/job-1/step-1/memory.current` ? null : original(path, maxBytes);
  assert.equal((await probeReadonlyCgroupCapability(deniedCgroup.io)).reason, 'cgroup_parent_read_denied_or_incomplete');
});

test('does not interpret shared parent populated=0 as an owned empty subtree', async () => {
  const { io, accessed } = fixture({ events: 'populated 0\nfrozen 0\n' });
  const result = await probeReadonlyCgroupCapability(io);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(accessed.includes(`${root}/runner/job-1/step-1/cgroup.events`), false);
  assert.equal(Object.hasOwn(result.parent, 'populated'), false);
  assert.equal(result.ownedSubtree, null);
  assert.equal(result.reason, 'owned_delegated_subtree_unproven');
});

test('reports a read-only cgroup mount as unavailable', async () => {
  for (const mountinfo of [
    '31 22 0:28 / /sys/fs/cgroup ro,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw\n',
    '31 22 0:28 / /sys/fs/cgroup rw,nosuid,nodev,noexec,relatime - cgroup2 cgroup ro\n',
  ]) {
    const { io } = fixture({ mountinfo });
    assert.equal((await probeReadonlyCgroupCapability(io)).reason, 'cgroup_mount_read_only');
  }
});

test('rejects malformed membership, duplicate cgroup2 mount and incomplete parent snapshots', async () => {
  assert.equal((await probeReadonlyCgroupCapability(fixture({ self: '0::/../escape\n' }).io)).reason, 'cgroup_v2_mount_or_membership_unknown');
  const duplicateMount = '31 22 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n32 22 0:29 / /other rw - cgroup2 cgroup rw\n';
  assert.equal((await probeReadonlyCgroupCapability(fixture({ mountinfo: duplicateMount }).io)).reason, 'cgroup_v2_mount_or_membership_unknown');
  const incomplete = fixture({ memoryCurrent: null });
  assert.equal((await probeReadonlyCgroupCapability(incomplete.io)).reason, 'cgroup_parent_read_denied_or_incomplete');
});

test('native reader is read-only and has no process control, network, environment, or volume integration', async () => {
  const source = await readFile(new URL('./rps-readonly-capability-probe.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:child_process|node:net|process\.env|process\.argv|spawnSync|execSync|\.kill\(|writeFile|mkdir|unlink|volumePath/i);
  assert.match(source, /actualRun: false/);
  assert.match(source, /ownedSubtree: null/);
  assert.match(source, /constants\.O_RDONLY \| constants\.O_NOFOLLOW/);
  assert.match(source, /CGROUP_MOUNT_ALLOWLIST/);
});
