#!/usr/bin/env bash
set -uo pipefail
cd /c/DEV/M2P
n=0
for f in scripts/paperback/out/*-pb-cover.pdf; do
  bid=$(basename "$f" -pb-cover.pdf)
  node scripts/paperback/build-wrap-cover.mjs "$bid" > "scripts/paperback/out/$bid-cover-regen.log" 2>&1 && n=$((n+1))
done
echo "COVERS REGEN DONE: $n 冊"
