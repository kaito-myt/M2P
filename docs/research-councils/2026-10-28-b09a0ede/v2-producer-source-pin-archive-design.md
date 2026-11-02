# v2 producer: dual source pin and runtime closure binding

## Hypothesis

The fixed r2 source pins were produced from Windows raw bytes while the v2 runtime closure is verified against Linux LF bytes. Keeping both identities in distinct paths and binding them through explicit CRLF-to-LF conversion should preserve the original artifact pins and still prove that the executable code is the normalized form of those pinned bytes.

## Design

- Runtime modules stay under the staged `runtime/` root and remain byte-pinned by `v2-producer-cloud-runtime-closure.json`.
- Raw source snapshots live separately under `runtime/v2-producer-source-pin-archive/raw/<source-pin-relative-path>`; they are inputs to provenance verification and are never imported as executable modules.
- `manifest.json` records the fixed config SHA and, per source pin, configured raw bytes/SHA, snapshot raw bytes/SHA, runtime bytes/SHA, normalization mode, and explicit override metadata where applicable. Its complete SHA is compiled into the fixed cloud-input module.
- The loader checks snapshot SHA against fixed raw pins, reads the executable runtime path independently, canonicalizes only UTF-8 `.mjs` CRLF to LF, and requires byte equality with the runtime file. JSON pins require exact byte equality.
- `joint-kelly-prefit-pending-admission.mjs` is a known content override, not an EOL conversion. Its config pin and effective SHA stay separately visible and the only accepted override is the already fixed `updatedAdmissionSHA`.
- The runtime receipt carries the verified manifest SHA, count, and per-file raw/runtime hashes. The candidate remains non-admitted and cannot write a purchase queue.

## Synthetic evidence

The helper rejects raw pin edits, runtime byte edits, incorrect normalization labels, unlisted overrides, and malformed manifest binding. It accepts CRLF raw bytes only when their normalized LF bytes exactly equal the runtime file. It treats public JSON as exact bytes. Test: `node --test scripts/boatrace-history/v2-producer-cloud-source-pin-archive.test.mjs`.

The stage builder separately verifies each local source pin, runtime closure entry, and normalized byte relationship before building a read-only payload. The two sets are staged beneath one uniquely named, atomically published runtime namespace; the independent raw archive directory never overlaps executable paths.

No private race source or runtime source archive contents are needed for this binding, and this design does not claim that source hashes prove predictive accuracy or profitability. The new verifier and updated closure have not yet received Linux Actions review; Railway staging remains prohibited until that review and all live resource gates pass.
