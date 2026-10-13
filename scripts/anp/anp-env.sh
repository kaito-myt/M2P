#!/usr/bin/env bash
# ANP スクリプト用の env ランチャー。pb-env.sh に LLM/画像生成の API キーを足したもの。
# (タイトル再生成・アイキャッチ再生成は anp.seo / anp.eyecatch を実際に呼ぶため鍵が要る。
#  api_credentials に行が無い環境では env フォールバックが使われる — get-api-key.ts)
#   bash scripts/anp/anp-env.sh apps/worker/node_modules/.bin/tsx scripts/anp/regen-title-eyecatch.mjs
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
echo "env: DBURL=${#DBURL} R2=${#R2_BUCKET_NAME} OPENAI=${#OPENAI_API_KEY} ANTHROPIC=${#ANTHROPIC_API_KEY} GOOGLE=${#GOOGLE_API_KEY} CRED=${#API_CRED_KEY}"
exec "$@"
