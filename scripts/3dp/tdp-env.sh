#!/usr/bin/env bash
# 3DP スクリプト用の env ランチャー。**秘密情報はファイルに書かず実行時に Railway から取る**
# (scripts/paperback/pb-env.sh / scripts/anp/anp-env.sh と同じ流儀)。
#
# API キーの解決規約はポータルの「API 管理」(ApiCredential テーブル, @a2p/credentials) が
# 第一優先で、未登録なら env フォールバック (packages/agents/src/lib/get-api-key.ts)。
# ここで export するのはその env フォールバック分。
#
#   bash scripts/3dp/tdp-env.sh apps/worker/node_modules/.bin/tsx scripts/3dp/gen-logo.mjs --dry-run
set -euo pipefail
cd /c/DEV/M2P
export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env.local | head -1 | cut -d= -f2- | tr -d '\r"'"'")
PG=$(railway variables --service Postgres --kv 2>/dev/null)
WK=$(railway variables --service A2P-Worker --kv 2>/dev/null)
pick(){ printf '%s\n' "$1" | grep "^$2=" | head -1 | cut -d= -f2- | tr -d '\r'; }
export DBURL=$(pick "$PG" DATABASE_PUBLIC_URL)
export DATABASE_URL="$DBURL"
export R2_ACCOUNT_ID=$(pick "$WK" R2_ACCOUNT_ID)
export R2_ACCESS_KEY_ID=$(pick "$WK" R2_ACCESS_KEY_ID)
export R2_SECRET_ACCESS_KEY=$(pick "$WK" R2_SECRET_ACCESS_KEY)
export R2_BUCKET_NAME=$(pick "$WK" R2_BUCKET_NAME)
export OPENAI_API_KEY=$(pick "$WK" OPENAI_API_KEY)
export ANTHROPIC_API_KEY=$(pick "$WK" ANTHROPIC_API_KEY)
export GOOGLE_API_KEY=$(pick "$WK" GOOGLE_API_KEY)
export API_CRED_KEY=$(pick "$WK" API_CRED_KEY)
# Inc-2 以降: Meshy の API キー (未設定なら空のまま。Meshy Pro 契約後にポータルの
# 「API 管理」へ provider='meshy' で入れるのが本線で、ここは env フォールバック)。
export MESHY_API_KEY=$(pick "$WK" MESHY_API_KEY || true)
echo "env: DBURL=${#DBURL} R2=${#R2_BUCKET_NAME} OPENAI=${#OPENAI_API_KEY} CRED=${#API_CRED_KEY} MESHY=${#MESHY_API_KEY}"
exec "$@"
