#!/usr/bin/env bash
# Kobo再出版バッチ: 本文からAI開示文除去後、クリーンEPUBを作り直して既存商品(uuid)に上書き再出版。
#   引数: ONLY=<bookId> で1冊だけ / 無指定で kobo-map.txt 全件。
#   bash scripts/paperback/pb-env.sh bash scripts/kobo/kobo-republish.sh [ONLY=<bookId>]
set -uo pipefail
cd /c/DEV/M2P
MAP=scripts/kobo/kobo-map.txt
ONLY="${1:-}"; ONLY="${ONLY#ONLY=}"
OUT=scripts/bookwalker/out
LOG=scripts/kobo/kobo-republish.log
ok=0; fail=0; skip=0
# kobo-map はアダルト除外済み(検証済 2026-09-09)。
while read -r bid uuid; do
  [ -z "$bid" ] && continue
  [ -n "$ONLY" ] && [ "$bid" != "$ONLY" ] && continue
  echo "===== $bid ($uuid) $(date '+%m/%d %H:%M') ====="
  # クリーンEPUB再ビルド(本文chaptersは開示文除去済)
  node scripts/bookwalker/build-epub.mjs "$bid" > "$OUT/$bid-epubbuild.log" 2>&1
  if [ ! -f "$OUT/$bid.epub" ]; then echo "EPUBビルド失敗 $bid"; fail=$((fail+1)); continue; fi
  [ -f "$OUT/$bid-cover.jpg" ] || node scripts/bookwalker/bw-cover-jpg.mjs "$bid" > /dev/null 2>&1
  # 既存商品に上書き再出版
  KWL_TARGET_ID="$uuid" timeout 600 node scripts/kobo/kwl-submit.mjs "$bid" --submit > "scripts/kobo/out/$bid-republish.log" 2>&1
  if grep -qE 'PUBLISH_REQUESTED|ANALYZE|PUBLISHED|再出版OK|出版OK' "scripts/kobo/out/$bid-republish.log"; then
    echo "✅ 再出版 $bid"; ok=$((ok+1))
  else
    echo "再出版NG $bid ($(grep -oE 'status=[A-Z_]+|必須|ERROR' "scripts/kobo/out/$bid-republish.log" | head -1))"; fail=$((fail+1))
  fi
  sleep 5
done < "$MAP"
echo "===== KOBO REPUBLISH DONE ok=$ok fail=$fail skip=$skip ====="
