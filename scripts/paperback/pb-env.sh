#!/usr/bin/env bash
# ペーパーバック関連スクリプト用の env ランチャー。秘密情報はファイルに書かず実行時に Railway から取得。
#   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-plan.cjs
set -euo pipefail
cd /c/DEV/M2P
export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env.local | head -1 | cut -d= -f2- | tr -d '\r"'"'")
PG=$(railway variables --service Postgres --kv 2>/dev/null)
WK=$(railway variables --service A2P-Worker --kv 2>/dev/null)
pick(){ printf '%s\n' "$1" | grep "^$2=" | head -1 | cut -d= -f2- | tr -d '\r'; }
export DBURL=$(pick "$PG" DATABASE_PUBLIC_URL)
export R2_ACCOUNT_ID=$(pick "$WK" R2_ACCOUNT_ID)
export R2_ACCESS_KEY_ID=$(pick "$WK" R2_ACCESS_KEY_ID)
export R2_SECRET_ACCESS_KEY=$(pick "$WK" R2_SECRET_ACCESS_KEY)
export R2_BUCKET_NAME=$(pick "$WK" R2_BUCKET_NAME)
export AMAZON_EMAIL=$(pick "$WK" AMAZON_EMAIL)
export AMAZON_PASSWORD=$(pick "$WK" AMAZON_PASSWORD)
export AMAZON_TOTP_SECRET=$(pick "$WK" AMAZON_TOTP_SECRET)
export KDP_CRED_KEY=$(pick "$WK" KDP_CRED_KEY)
echo "env: DBURL=${#DBURL} R2=${#R2_BUCKET_NAME} AMZ=${#AMAZON_EMAIL} TOTP=${#AMAZON_TOTP_SECRET} KEY=${#KDP_CRED_KEY}"
exec "$@"
