# RPS openat2 synthetic Linux workflow

`.github/workflows/rps-openat2-synthetic.yml` is a Linux-only check for the synthetic openat2 fixture helper and bridge. It runs on manual dispatch and pull requests targeting `main`. It runs only these related tests:

- `scripts/boatrace-history/rps-openat2-synthetic-helper.test.mjs`
- `scripts/boatrace-history/rps-openat2-synthetic-bridge.test.mjs`
- `scripts/boatrace-history/rps-byte-admission-controller.test.mjs`

The helper and bridge tests compile the matching C source and use temporary synthetic files; the bridge exercises the byte-admission controller dependency. The workflow does not access race history, production data, application servers, Railway, or external credentials. It has no inputs or secrets and only grants `contents: read`.

The C helper and related tests are currently untracked. For manual dispatch, first commit the reviewed helper, tests, and workflow, then dispatch from the exact reviewed commit. For pull requests, the workflow tests the immutable GitHub PR merge revision. In both cases it records the run's commit SHA and verifies checked-out `HEAD` matches `GITHUB_SHA`.

This file defines a candidate workflow only. It has not been pushed or run, so it provides no Linux test result by itself.
