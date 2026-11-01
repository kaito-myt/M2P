# RPS openat2 synthetic Linux workflow

`.github/workflows/rps-openat2-synthetic.yml` is a Linux-only check for synthetic packet schema validation through the openat2 helper and bridge, plus a read-only cgroup capability observation. It runs on manual dispatch and pull requests targeting `main`. It runs only these related tests:

- `scripts/boatrace-history/rps-readonly-capability-probe.test.mjs`
- `scripts/boatrace-history/rps-readonly-capability-ci.test.mjs`
- `scripts/boatrace-history/rps-openat2-synthetic-helper.test.mjs`
- `scripts/boatrace-history/rps-openat2-synthetic-bridge.test.mjs`
- `scripts/boatrace-history/rps-byte-admission-controller.test.mjs`
- `scripts/boatrace-history/rps-synthetic-schema-integration.test.mjs`
- `scripts/boatrace-history/rps-metadata-inventory-synthetic.test.mjs`

The capability CLI invokes only `rps-readonly-capability-probe.mjs` and serializes a fixed allowlist: schema, current-process scope, a known reason code, boolean/null observations for the required `memory`/`pids`/`cpu` controllers, read-only mount state, and hard-false ownership/execution fields. Other valid Linux controller names are tolerated as input but never emitted. It never prints self membership, mount paths/options, raw controller lists, counters, environment variables, or the raw probe object. Unknown shapes or reason codes produce a generic `UNKNOWN` result and a nonzero exit. A completed observation is not evidence of delegated ownership and does not enable execution; the probe always remains read-only and `actualRunAllowed` remains false.

The workflow grants only `contents: read`, has no secret inputs, does not install software, and does not mount or inspect a Railway/project volume. Checkout and the standard Node setup are GitHub Actions platform operations; the probe and tests themselves make no outbound network calls. The read-only capability observation is scoped to the ephemeral GitHub runner process and does not establish capabilities on Railway. The CI job's synthetic openat2 tests use temporary synthetic fixtures and remove them after each test; they do not use application history or production data.

The schema integration test runs a full synthetic packet through the Linux openat2 helper and checks schema, day, provenance, and hash bindings. Its integration module is `rps-synthetic-schema-integration.mjs`; that module's direct dependencies are `rps-source-schema-validator.mjs` and `rps-openat2-synthetic-bridge.mjs`. Transitive local dependencies are `normalize.mjs`, `joint-new-family-descriptive-source.mjs`, and `rps-byte-admission-controller.mjs`. The bridge compiles `rps-openat2-synthetic-helper.c` with the system C compiler and OpenSSL headers already present on the GitHub-hosted runner; the workflow does not install them over the network.

The metadata inventory test imports `rps-metadata-inventory-synthetic.mjs`, which directly depends on `joint-new-family-descriptive-source.mjs` and transitively on `normalize.mjs`. It compiles `rps-metadata-inventory-helper.c` with the system C compiler; this helper uses Linux `openat2` and standard libc/Linux headers and does not require OpenSSL. Both inventory helper and openat2 byte helper C sources are part of the tested fixture set. All JavaScript dependencies are local modules or Node built-ins; no npm installation is required. The workflow does not access race history, production data, application servers, Railway, or external credentials.

The C helper and related tests are currently untracked. For manual dispatch, first commit the reviewed helper, tests, and workflow, then dispatch from the exact reviewed commit. For pull requests, the workflow tests the immutable GitHub PR merge revision. In both cases it records the run's commit SHA and verifies checked-out `HEAD` matches `GITHUB_SHA`.

This file defines a candidate workflow only. It has not been pushed or run, so it provides no GitHub Actions result by itself. Local Node tests validate summary redaction and fail-closed behavior; they do not validate the hosted runner's actual cgroup layout.
