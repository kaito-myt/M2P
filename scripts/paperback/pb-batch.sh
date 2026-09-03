#!/usr/bin/env bash
# 全書籍ペーパーバック出版バッチ (F-094関連: docs/05 §5.3.15b)。
#   nohup bash scripts/paperback/pb-env.sh bash scripts/paperback/pb-batch.sh > scripts/paperback/pb-batch.log 2>&1 &
# 1冊 = pb-pilot(下書き作成〜STEP2) → pb-complete --go(previewer承認→価格→出版)。
# creation_limit 検知(exit 4)で当日終了。連続3失敗で中断(RAM劣化対策)。
set -uo pipefail
cd /c/DEV/M2P
LOCK=scripts/paperback/.batch.lock
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then echo "既にバッチ稼働中 pid=$(cat "$LOCK")"; exit 0; fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
PUB=scripts/paperback/pb-published.txt; touch "$PUB"

cleanup_chrome() {
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*kdp-userdata*' } | ForEach-Object { taskkill /F /T /PID \$_.ProcessId 2>&1 | Out-Null }" 2>/dev/null || true
  rm -f scripts/.kdp-userdata/SingletonLock scripts/.kdp-userdata/SingletonCookie scripts/.kdp-userdata/SingletonSocket 2>/dev/null || true
}

LIST=$(node -e "const p=require('./scripts/paperback/plan.json');for(const b of p){if(b.ready&&b.asin&&b.publish_status==='published')console.log(b.book_id+' '+b.asin)}")
total=0; okc=0; fail=0; consec=0
while read -r bid asin; do
  [ -z "$bid" ] && continue
  grep -q "^$bid\$" "$PUB" && continue
  [ -f "scripts/paperback/out/$bid-pb-cover.pdf" ] || { echo "SKIP(no cover) $bid"; continue; }
  total=$((total+1))
  echo "=== [$total] $bid $asin $(date '+%m/%d %H:%M') ==="
  cleanup_chrome
  timeout 900 node scripts/paperback/pb-pilot.mjs "$bid" "$asin" > "scripts/paperback/out/$bid-pilot.log" 2>&1
  rc=$?
  if [ $rc -eq 4 ]; then echo "!!! CREATION_LIMIT — 本日はここまで ($(date '+%H:%M'))"; break; fi
  tid=$(grep -o 'print-setup/paperback/[A-Z0-9]*' "scripts/paperback/out/$bid-pilot.log" | head -1 | sed 's#.*/##')
  if [ $rc -ne 0 ] || [ -z "$tid" ]; then
    echo "PILOT FAIL rc=$rc tid=${tid:-none}"
    fail=$((fail+1)); consec=$((consec+1))
  else
    cleanup_chrome; sleep 10
    timeout 1200 node scripts/paperback/pb-complete.mjs "$bid" "$tid" --go > "scripts/paperback/out/$bid-complete.log" 2>&1
    rc2=$?
    if grep -q 'PB SUBMITTED' "scripts/paperback/out/$bid-complete.log"; then
      echo "✅ 出版 $bid ($tid)"
      echo "$bid" >> "$PUB"
      okc=$((okc+1)); consec=0
    else
      echo "COMPLETE FAIL rc=$rc2 ($tid) — 下書きは保持(後日 pb-complete で再試行可)"
      echo "$bid $tid" >> scripts/paperback/pb-drafts-pending.txt
      fail=$((fail+1)); consec=$((consec+1))
    fi
  fi
  if [ $consec -ge 3 ]; then echo "!!! 連続${consec}失敗 — 中断(環境確認要)"; break; fi
  cleanup_chrome
  sleep 30
done <<< "$LIST"
cleanup_chrome
echo "BATCH DONE ok=$okc fail=$fail 残=$(node -e "const p=require('./scripts/paperback/plan.json');const fs=require('fs');const done=new Set(fs.readFileSync('$PUB','utf8').split(/\r?\n/).filter(Boolean));console.log(p.filter(b=>b.ready&&b.asin&&b.publish_status==='published'&&!done.has(b.book_id)).length)")"
