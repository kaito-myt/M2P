# KellyEdge v2 producer UID launcher

## Scope and status

This is a fail-closed launcher for the already pinned one-candidate cloud entry. It does not collect private source data itself, create a queue item, fit a model, or purchase. The caller must explicitly pass `--launch-fixed-entry`; arbitrary entry paths and arguments are rejected. Runtime source and transitive closure hashes are checked before resource preflight.

## Privilege and environment contract

The SSH launcher must start as UID/GID 0 so it can inspect cgroup and volume resources and perform a controlled UID drop. It invokes the fixed `/usr/bin/setpriv` with target UID/GID 1000, cleared supplementary groups, `SIGKILL` parent-death signal, empty bounding/inheritable/ambient capability sets, and `no-new-privs`. The child receives only a fixed environment (`PATH`, `HOME`, `TMPDIR`, `LANG`, `TZ`) through `/usr/bin/env -i`; Node and entry paths are fixed. A separate identity probe checks real/effective IDs, groups, `NoNewPrivs`, effective capabilities and the exact environment before the entry is spawned.

## Resource gates

The launcher retains strict cgroup current memory `< 3 GiB`, cgroup max `>= 6 GiB`, volume free fraction `>= 20%`, and launcher heap `< 900 MiB` checks. It does not alter the cloud controller's separate 3 GiB gate. Any unsupported platform, stale pin, failed identity proof, missing measurement, or threshold failure returns a not-started result.

## Verification boundary

The synthetic test verifies argument construction, rejection paths, thresholds, and identity-proof parsing. Linux CI attempts the actual setpriv identity probe. A non-root CI runner is reported as `NOT_CAPABLE_UNPRIVILEGED`; it is not silently marked as a successful UID-drop test. Neither CI nor this launcher test invokes the producer entry. Railway resource preflight previously measured cgroup usage above the strict 3 GiB gate, so producer execution remains prohibited until a new authorized preflight demonstrates all gates pass.
