#!/usr/bin/env bash
# KDP 本棚 READ-ONLY スキャン（重複出版の洗い出し）。env 不要・破壊操作なし。
set -e
cd "$(dirname "$0")/.."
# 残留 Chrome(.kdp-userdata) を掃除（プロファイルロック回避）。個人 Chrome には触れない。
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*kdp-userdata*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
node scripts/kdp-scan-bookshelf.mjs
