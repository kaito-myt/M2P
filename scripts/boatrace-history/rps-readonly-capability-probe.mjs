import { open } from 'node:fs/promises';
import { constants } from 'node:fs';

const VERSION = 'rps_readonly_capability_probe_v1';
const REQUIRED_CONTROLLERS = Object.freeze(['memory', 'pids', 'cpu']);
const CGROUP_MOUNT_ALLOWLIST = new Set(['/sys/fs/cgroup']);

async function nativeReadBounded(path, maxBytes) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) return null;
    return buffer.subarray(0, length).toString('utf8');
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}

const nativeReader = Object.freeze({ readBounded: nativeReadBounded });

function unavailable(reason, evidence = {}) {
  return Object.freeze({
    version: VERSION,
    status: 'UNAVAILABLE',
    reason,
    evidenceScope: 'read_only_capability_probe',
    actualRun: false,
    actualRunAllowed: false,
    volumeMounted: false,
    ...evidence,
  });
}

function parseSelfMembership(text) {
  if (typeof text !== 'string' || text.length > 8192) return null;
  const rows = text.trim().split(/\n/);
  if (rows.length !== 1) return null;
  const match = /^0::(\/[^\0\n]*)$/.exec(rows[0]);
  if (!match || match[1].split('/').includes('..')) return null;
  return match[1] || '/';
}

function parseCgroup2Mount(text) {
  if (typeof text !== 'string' || text.length > 65536) return null;
  const matches = [];
  for (const line of text.split(/\n/)) {
    const separator = line.indexOf(' - ');
    if (separator < 0) continue;
    const fields = line.slice(separator + 3).split(' ');
    if (fields[0] === 'cgroup2') {
      const mountFields = line.slice(0, separator).split(' ');
      if (mountFields.length < 6) return null;
      if (fields.length < 3) return null;
      matches.push({
        root: mountFields[3],
        mountPoint: mountFields[4],
        mountOptions: mountFields[5],
        superOptions: fields[2],
      });
    }
  }
  if (matches.length !== 1) return null;
  const unescape = value => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  return {
    root: unescape(matches[0].root),
    mountPoint: unescape(matches[0].mountPoint),
    readOnly: matches[0].mountOptions.split(',').includes('ro') || matches[0].superOptions.split(',').includes('ro'),
  };
}

function parseControllers(text) {
  if (typeof text !== 'string' || text.length > 1024) return null;
  const values = text.trim().split(/\s+/).filter(Boolean);
  if (values.some(value => !/^[a-z]+$/.test(value)) || new Set(values).size !== values.length) return null;
  return values;
}

function safeScopePath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') &&
    value.split('/').slice(1).every(part => part === '' || (/^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'));
}

function resolveVisibleScope(mount, membership) {
  if (mount.root === '/') return `${mount.mountPoint}${membership === '/' ? '' : membership}`;
  if (membership !== mount.root && !membership.startsWith(`${mount.root}/`)) return null;
  const relative = membership.slice(mount.root.length);
  return `${mount.mountPoint}${relative}`;
}

/**
 * Reads only injected procfs/cgroup-v2 snapshots. It never infers writable
 * delegation from controller availability or shared-parent emptiness.
 */
export async function probeReadonlyCgroupCapability(io = nativeReader) {
  if (!io || typeof io.readBounded !== 'function') return unavailable('probe_reader_unavailable');
  const read = async (path, maxBytes) => {
    try {
      const value = await io.readBounded(path, maxBytes);
      return typeof value === 'string' && value.length <= maxBytes ? value : null;
    } catch { return null; }
  };
  const selfCgroupText = await read('/proc/self/cgroup', 8192);
  const mountInfoText = await read('/proc/self/mountinfo', 65536);
  if (selfCgroupText === null || mountInfoText === null) return unavailable('procfs_capability_read_denied');
  const selfPath = parseSelfMembership(selfCgroupText);
  const mount = parseCgroup2Mount(mountInfoText);
  if (selfPath === null || !mount || !safeScopePath(mount.root) || !safeScopePath(mount.mountPoint) ||
      !CGROUP_MOUNT_ALLOWLIST.has(mount.mountPoint)) {
    return unavailable('cgroup_v2_mount_or_membership_unknown');
  }
  const root = resolveVisibleScope(mount, selfPath);
  if (!root || !safeScopePath(root)) return unavailable('self_cgroup_outside_mount_root', { selfPath, mount });
  const controllerText = await read(`${root}/cgroup.controllers`, 1024);
  const subtreeText = await read(`${root}/cgroup.subtree_control`, 1024);
  const memoryCurrent = await read(`${root}/memory.current`, 128);
  const memoryMax = await read(`${root}/memory.max`, 128);
  const pidsCurrent = await read(`${root}/pids.current`, 128);
  if ([controllerText, subtreeText, memoryCurrent, memoryMax, pidsCurrent].some(value => value === null)) {
    return unavailable('cgroup_parent_read_denied_or_incomplete', { selfPath, mount });
  }
  const available = parseControllers(controllerText);
  const delegated = parseControllers(subtreeText);
  const countersValid = /^(0|[1-9][0-9]*)$/.test(memoryCurrent.trim()) &&
    /^(max|0|[1-9][0-9]*)$/.test(memoryMax.trim()) &&
    /^(0|[1-9][0-9]*)$/.test(pidsCurrent.trim());
  if (!available || !delegated || !countersValid) {
    return unavailable('cgroup_parent_snapshot_malformed', { selfPath, mount });
  }
  const missingControllers = REQUIRED_CONTROLLERS.filter(name => !available.includes(name));
  const missingDelegation = REQUIRED_CONTROLLERS.filter(name => !delegated.includes(name));
  // Parent/subtree read access is observational only; it is not an owned worker scope.
  return unavailable(missingControllers.length ? 'required_controller_unavailable' :
    mount.readOnly ? 'cgroup_mount_read_only' :
      missingDelegation.length ? 'controller_delegation_not_enabled' : 'owned_delegated_subtree_unproven', {
    selfPath,
    mount,
    availableControllers: available,
    enabledControllers: delegated,
    missingControllers,
    missingDelegation,
    parent: {
      memoryCurrentBytes: memoryCurrent.trim(),
      memoryMaxBytes: memoryMax.trim(),
      pidsCurrent: pidsCurrent.trim(),
    },
    ownedSubtree: null,
  });
}

export const READONLY_CAPABILITY_PROBE_VERSION = VERSION;
