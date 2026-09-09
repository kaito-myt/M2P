#!/usr/bin/env bash
# BookWalker 全冊一括申請。1冊=1プロセス(RAM安定)。素材(epub/trial/cover)が揃う本のみ。
#   bash scripts/paperback/pb-env.sh bash scripts/bookwalker/bw-batch.sh [--submit]
# 既に申請済み(申請中/販売中)は bw-submit 側では判定しないので、重複申請を避けたい場合は
# 事前に申請済みリストを bw-applied.txt に置く(1行1bookId)。
set -uo pipefail
cd /c/DEV/M2P
# 二重起動防止ロック(重複バッチが同一プロファイルを奪い合い全滅する事故の再発防止)
LOCK="scripts/bookwalker/.batch.lock"
if [ -f "$LOCK" ]; then
  PID=$(cat "$LOCK" 2>/dev/null)
  if kill -0 "$PID" 2>/dev/null; then echo "既に別バッチ稼働中(pid=$PID) — 中止"; exit 9; fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT
MODE="${1:-}"
APPLIED="scripts/bookwalker/bw-applied.txt"
touch "$APPLIED"
IDS=$(node -e "const p=require('C:/DEV/M2P/scripts/paperback/plan.json');console.log(p.filter(x=>x.ready).map(x=>x.book_id).join('\n'))")
ok=0; skip=0; fail=0
for id in $IDS; do
  if grep -qx "$id" "$APPLIED"; then echo "[skip-applied] $id"; skip=$((skip+1)); continue; fi
  for f in "$id.epub" "$id-trial.epub" "$id-cover.jpg"; do
    [ -f "scripts/bookwalker/out/$f" ] || { echo "[skip-nofile] $id ($f)"; continue 2; }
  done
  echo "=== 申請 $id ==="
  # 5分ハードタイムアウト。終了後は node/chrome を木ごと確実に掃除(ゾンビ蓄積→ロック/OOM連鎖を根絶)
  timeout 420 node scripts/bookwalker/bw-submit.mjs "$id" $MODE > "scripts/bookwalker/out/bwb-$id.log" 2>&1
  rc=$?
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { (\$_.Name -eq 'chrome.exe' -and \$_.CommandLine -like '*bw-userdata2*') } | ForEach-Object { taskkill /F /T /PID \$_.ProcessId 2>&1 | Out-Null }" >/dev/null 2>&1
  rm -f scripts/.bw-userdata2/Singleton* 2>/dev/null
  sleep 30  # BW申請APIのレート制限回避(短間隔連続申請でモーダル不出現=無言失敗が増える)
  if grep -q '審査待ち\|申請POST 200' "scripts/bookwalker/out/bwb-$id.log"; then
    echo "  ✔ SUBMITTED $id"; echo "$id" >> "$APPLIED"; ok=$((ok+1))
  elif [ "$MODE" != "--submit" ]; then
    echo "  (dry-run) $id"; ok=$((ok+1))
  else
    echo "  ✗ FAIL $id (rc=$rc)"; tail -2 "scripts/bookwalker/out/bwb-$id.log" | sed 's/^/    /'; fail=$((fail+1))
  fi
  sleep 2
done
echo "=== BW BATCH DONE: ok=$ok skip=$skip fail=$fail ==="
