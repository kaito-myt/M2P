# RPS openat2 synthetic Linux workflow

`.github/workflows/rps-openat2-synthetic.yml` is a Linux-only check for the synthetic openat2 fixture helper. It runs on manual dispatch and pull requests targeting `main`. It runs only `scripts/boatrace-history/rps-openat2-synthetic-helper.test.mjs`; that test compiles the matching C source and uses temporary synthetic files. It does not access race history, production data, application servers, Railway, or external credentials. The workflow has no inputs or secrets and only grants `contents: read`.

The helper and test are currently untracked. For manual dispatch, first commit both reviewed files and the workflow, then dispatch from the exact reviewed commit. For pull requests, the workflow tests the immutable GitHub PR merge revision. In both cases it records the run's commit SHA and verifies checked-out `HEAD` matches `GITHUB_SHA`.

This file defines a candidate workflow only. It has not been pushed or run, so it provides no Linux test result by itself.
