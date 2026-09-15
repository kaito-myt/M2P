#!/usr/bin/env bash
# note セッションを config_json.note_session_enc (API_CRED_KEY) から
# note_accounts.session_state_enc (KDP_CRED_KEY) へ移行。
#   bash scripts/anp/note-session-migrate.sh <note_account_id>
set -euo pipefail
cd /c/DEV/M2P
export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env.local | head -1 | cut -d= -f2- | tr -d '\r"'"'")
PG=$(railway variables --service Postgres --kv 2>/dev/null)
WK=$(railway variables --service A2P-Worker --kv 2>/dev/null)
pick(){ printf '%s\n' "$1" | grep "^$2=" | head -1 | cut -d= -f2- | tr -d '\r'; }
export DBURL=$(pick "$PG" DATABASE_PUBLIC_URL)
export API_CRED_KEY=$(pick "$WK" API_CRED_KEY)
export KDP_CRED_KEY=$(pick "$WK" KDP_CRED_KEY)
echo "env: DBURL=${#DBURL} API_KEY=${#API_CRED_KEY} KDP_KEY=${#KDP_CRED_KEY}"
exec node scripts/anp/note-session-migrate.mjs "$@"
