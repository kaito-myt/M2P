#!/usr/bin/env bash
# KDP 準自動出版ランチャー（運営者が自分のターミナルで実行し、ブラウザを直接操作する用）。
#
# 使い方: Git Bash で C:/DEV/M2P に移動して
#     bash scripts/kdp-assist.sh
#   → Chrome が開き、既存の下書きを1冊ずつ resume して各ステップを自動入力する。
#     「保存して続行 / 出版」は自分で押す（各ステップ最大30分待機）。
#
# 秘密情報は Railway から実行時に取得し、ファイルには保存しない。
# 前提: railway CLI がこの端末でログイン済み & プロジェクト link 済み。
set -e
cd "$(dirname "$0")/.."

# RAILWAY_TOKEN（プロジェクトトークン）を .env.local から読み込む。
# これがあれば `railway link` 不要で railway variables が通る（別ワークスペース所属でもOK）。
if [ -z "$RAILWAY_TOKEN" ] && [ -f .env.local ]; then
  export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env.local | head -1 | cut -d= -f2- | tr -d '\r"'"'")
fi
if [ -z "$RAILWAY_TOKEN" ]; then
  echo "ERROR: RAILWAY_TOKEN が未設定です（.env.local に RAILWAY_TOKEN=... を置くか、環境変数で渡してください）。" >&2
  exit 1
fi

echo "Railway から環境変数を取得中..."
export DBURL=$(railway variables --service Postgres --kv 2>/dev/null | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2- | tr -d '\r')
export LINE_CHANNEL_ACCESS_TOKEN=$(railway variables --service A2P --kv 2>/dev/null | grep '^LINE_CHANNEL_ACCESS_TOKEN=' | cut -d= -f2- | tr -d '\r')
export LINE_USER_ID=$(railway variables --service A2P --kv 2>/dev/null | grep '^LINE_ALLOWED_USER_ID=' | cut -d= -f2- | tr -d '\r')
export R2_ACCOUNT_ID=$(railway variables --service A2P-Worker --kv 2>/dev/null | grep '^R2_ACCOUNT_ID=' | cut -d= -f2- | tr -d '\r')
export R2_ACCESS_KEY_ID=$(railway variables --service A2P-Worker --kv 2>/dev/null | grep '^R2_ACCESS_KEY_ID=' | cut -d= -f2- | tr -d '\r')
export R2_SECRET_ACCESS_KEY=$(railway variables --service A2P-Worker --kv 2>/dev/null | grep '^R2_SECRET_ACCESS_KEY=' | cut -d= -f2- | tr -d '\r')
export R2_BUCKET_NAME=$(railway variables --service A2P-Worker --kv 2>/dev/null | grep '^R2_BUCKET_NAME=' | cut -d= -f2- | tr -d '\r')

if [ -z "$DBURL" ] || [ -z "$R2_BUCKET_NAME" ]; then
  echo "ERROR: 環境変数の取得に失敗しました。railway login / railway link を確認してください。" >&2
  exit 1
fi
# 実行モード（第1引数で切替、既定=assist）:
#   assist … 本棚の既存「下書き」をresumeして上書き入力。新規作成の5冊/日上限を消費しない（要・下書きが本棚にあること）
#   create … 新規タイトルを作成して出版。下書きが無いときはこちら（5冊/日の作成上限あり・新規作成時はOTP再認証が発生）
#   auto   … 既存下書きをresumeし、保存/出版まで全自動クリック
MODE="assist"
if [ "$1" = "assist" ] || [ "$1" = "create" ] || [ "$1" = "auto" ] || [ "$1" = "overwrite" ]; then MODE="$1"; shift; fi
case "$MODE" in
  assist)    MODEFLAG="--assist" ;;
  create)    MODEFLAG="" ;;
  auto)      MODEFLAG="--auto" ;;
  overwrite) MODEFLAG="" ;;   # --overwrite-map=<file> を追加引数で渡す
esac
# 前回の実行で残った Chrome が .kdp-userdata プロファイルを掴んでいると
# 「既存のブラウザセッションで開いています」でロック起動失敗する。kdp-userdata を使う Chrome だけ掃除する
# （個人の Chrome には触れない）。Windows 前提。
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*kdp-userdata*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true

echo "OK. 準自動出版を開始します（mode=${MODE} ${*}）。Chrome が開きます。"
node scripts/kdp-publish.mjs $MODEFLAG "$@"
