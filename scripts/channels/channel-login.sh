#!/usr/bin/env bash
# 楽天Kobo / BOOTH の手動ログイン捕獲。秘密は実行時に Railway から取得。
#   bash scripts/channels/channel-login.sh kobo
#   bash scripts/channels/channel-login.sh booth
set -euo pipefail
cd /c/DEV/M2P
export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env.local | head -1 | cut -d= -f2- | tr -d '\r"'"'")
PG=$(railway variables --service Postgres --kv 2>/dev/null)
WK=$(railway variables --service A2P-Worker --kv 2>/dev/null)
pick(){ printf '%s\n' "$1" | grep "^$2=" | head -1 | cut -d= -f2- | tr -d '\r'; }
export DBURL=$(pick "$PG" DATABASE_PUBLIC_URL)
export KDP_CRED_KEY=$(pick "$WK" KDP_CRED_KEY)
exec node scripts/channels/channel-login.mjs "${1:-}"
