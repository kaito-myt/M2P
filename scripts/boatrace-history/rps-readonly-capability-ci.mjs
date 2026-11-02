import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  probeReadonlyCgroupCapability,
  READONLY_CAPABILITY_PROBE_VERSION,
} from './rps-readonly-capability-probe.mjs';

const OUTPUT_VERSION = 'rps_ci_capability_summary_v1';
const KNOWN_REASONS = new Set([
  'probe_reader_unavailable',
  'procfs_capability_read_denied',
  'cgroup_v2_mount_or_membership_unknown',
  'self_cgroup_outside_mount_root',
  'cgroup_parent_read_denied_or_incomplete',
  'cgroup_parent_snapshot_malformed',
  'required_controller_unavailable',
  'cgroup_mount_read_only',
  'controller_delegation_not_enabled',
  'owned_delegated_subtree_unproven',
]);
function failClosedSummary() {
  return Object.freeze({
    schema: OUTPUT_VERSION,
    environment: 'invocation_process',
    scope: 'current_process_only',
    probeStatus: 'UNKNOWN',
    reason: 'unknown_probe_result',
    memoryAvailable: null,
    pidsAvailable: null,
    cpuAvailable: null,
    memoryDelegated: null,
    pidsDelegated: null,
    cpuDelegated: null,
    mountReadOnly: null,
    ownedSubtreeConfirmed: false,
    actualRunAllowed: false,
  });
}

/** Converts raw procfs/cgroup evidence to a fixed, non-identifying CI summary. */
export function sanitizeCapabilitySummary(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      result.version !== READONLY_CAPABILITY_PROBE_VERSION || result.status !== 'UNAVAILABLE' ||
      result.actualRun !== false || result.actualRunAllowed !== false ||
      (result.ownedSubtree !== undefined && result.ownedSubtree !== null) ||
      !KNOWN_REASONS.has(result.reason)) return failClosedSummary();

  const available = result.availableControllers;
  const delegated = result.enabledControllers;
  const validControllerSet = value => value === undefined || (Array.isArray(value) && value.length <= 64 &&
    value.every(item => typeof item === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(item)) &&
    new Set(value).size === value.length);
  const validMount = result.mount === undefined || (result.mount && typeof result.mount === 'object' &&
    typeof result.mount.readOnly === 'boolean');
  if (!validControllerSet(available) || !validControllerSet(delegated) || !validMount) return failClosedSummary();

  const observed = (value, controller) => value === undefined ? null : value.includes(controller);
  return Object.freeze({
    schema: OUTPUT_VERSION,
    environment: 'invocation_process',
    scope: 'current_process_only',
    probeStatus: 'READ_ONLY_PROBE_COMPLETED',
    reason: result.reason,
    memoryAvailable: observed(available, 'memory'),
    pidsAvailable: observed(available, 'pids'),
    cpuAvailable: observed(available, 'cpu'),
    memoryDelegated: observed(delegated, 'memory'),
    pidsDelegated: observed(delegated, 'pids'),
    cpuDelegated: observed(delegated, 'cpu'),
    mountReadOnly: result.mount?.readOnly ?? null,
    ownedSubtreeConfirmed: false,
    actualRunAllowed: false,
  });
}

export async function runReadonlyCapabilityCi({ probe = probeReadonlyCgroupCapability, write = console.log } = {}) {
  let summary;
  try {
    summary = sanitizeCapabilitySummary(await probe());
  } catch {
    summary = failClosedSummary();
  }
  write(JSON.stringify(summary));
  return summary.probeStatus === 'READ_ONLY_PROBE_COMPLETED' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runReadonlyCapabilityCi().then(code => { process.exitCode = code; }).catch(() => {
    console.log(JSON.stringify(failClosedSummary()));
    process.exitCode = 1;
  });
}
