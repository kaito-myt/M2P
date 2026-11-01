# RPS openat2 synthetic Linux workflow

`.github/workflows/rps-openat2-synthetic.yml` is a Linux-only check for synthetic packet schema validation through the openat2 helper and bridge. It runs on manual dispatch and pull requests targeting `main`. It runs only these related tests:

- `scripts/boatrace-history/rps-openat2-synthetic-helper.test.mjs`
- `scripts/boatrace-history/rps-openat2-synthetic-bridge.test.mjs`
- `scripts/boatrace-history/rps-byte-admission-controller.test.mjs`
- `scripts/boatrace-history/rps-synthetic-schema-integration.test.mjs`

The schema integration test runs a full synthetic packet through the Linux openat2 helper and checks schema, day, provenance, and hash bindings. Its integration module is `rps-synthetic-schema-integration.mjs`; that module's direct dependencies are `rps-source-schema-validator.mjs` and `rps-openat2-synthetic-bridge.mjs`. Transitive local dependencies are `normalize.mjs`, `joint-new-family-descriptive-source.mjs`, and `rps-byte-admission-controller.mjs`. The bridge compiles `rps-openat2-synthetic-helper.c` with the system C compiler and OpenSSL headers. These are local modules and system packages; no npm installation is required. The workflow does not access race history, production data, application servers, Railway, or external credentials. It has no inputs or secrets and only grants `contents: read`.

The C helper and related tests are currently untracked. For manual dispatch, first commit the reviewed helper, tests, and workflow, then dispatch from the exact reviewed commit. For pull requests, the workflow tests the immutable GitHub PR merge revision. In both cases it records the run's commit SHA and verifies checked-out `HEAD` matches `GITHUB_SHA`.

This file defines a candidate workflow only. It has not been pushed or run, so it provides no Linux test result by itself.
