#!/usr/bin/env bash
# note ログインセッションのローカル手動キャプチャ(ローカル実行専用。DC-IPではログイン不可)。
#   bash scripts/anp/note-session-capture.sh <note_account_id>
set -euo pipefail
cd /c/DEV/M2P
export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env.local | head -1 | cut -d= -f2- | tr -d '\r"'"'")
PG=$(railway variables --service Postgres --kv 2>/dev/null)
WK=$(railway variables --service A2P-Worker --kv 2>/dev/null)
pick(){ printf '%s\n' "$1" | grep "^$2=" | head -1 | cut -d= -f2- | tr -d '\r'; }
export DBURL=$(pick "$PG" DATABASE_PUBLIC_URL)
export KDP_CRED_KEY=$(pick "$WK" KDP_CRED_KEY)
echo "env: DBURL=${#DBURL} KEY=${#KDP_CRED_KEY}"
exec node scripts/anp/note-session-capture.mjs "$@"
