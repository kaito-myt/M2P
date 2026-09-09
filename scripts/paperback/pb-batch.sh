#!/usr/bin/env bash
# 全書籍ペーパーバックバッチ (docs/05 §5.3.15b)。2フェーズ方式:
#   PHASE=draft : pilot のみ = 下書き作成(原稿+表紙アップロード=Amazon側変換をトリガー)。速い。
#   PHASE=publish: pb-drafts-pending.txt の各下書きを pb-complete --go で出版。
#                  ※アップロードから数時間後に実行すると原稿がサーバー側で変換済みになり、
#                    プレビューアー承認ゲートを通過できる(新規直後は変換未完了で必ず失敗する)。
#   PHASE=full  : 従来通り pilot→complete を1冊ずつ(参考・非推奨)。
#   nohup bash scripts/paperback/pb-env.sh bash scripts/paperback/pb-batch.sh draft > scripts/paperback/pb-batch.log 2>&1 &
set -uo pipefail
cd /c/DEV/M2P
PHASE="${1:-draft}"
LOCK=scripts/paperback/.batch.lock
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then echo "既にバッチ稼働中 pid=$(cat "$LOCK")"; exit 0; fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
PUB=scripts/paperback/pb-published.txt; touch "$PUB"
DRAFTED=scripts/paperback/pb-drafted.txt; touch "$DRAFTED"
PENDING=scripts/paperback/pb-drafts-pending.txt; touch "$PENDING"

cleanup_chrome() {
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*kdp-userdata*' } | ForEach-Object { taskkill /F /T /PID \$_.ProcessId 2>&1 | Out-Null }" 2>/dev/null || true
  rm -f scripts/.kdp-userdata/SingletonLock scripts/.kdp-userdata/SingletonCookie scripts/.kdp-userdata/SingletonSocket 2>/dev/null || true
}

if [ "$PHASE" = "publish" ]; then
  # 下書き出版フェーズ: pending の各行(bookId titleId)を pb-complete --go
  okc=0; fail=0
  while read -r bid tid; do
    [ -z "$bid" ] && continue
    grep -q "^$bid\$" "$PUB" && continue
    echo "=== PUBLISH $bid ($tid) $(date '+%m/%d %H:%M') ==="
    cleanup_chrome; sleep 5
    timeout 1500 node scripts/paperback/pb-complete.mjs "$bid" "$tid" --go > "scripts/paperback/out/$bid-pub.log" 2>&1
    if grep -q 'PB SUBMITTED' "scripts/paperback/out/$bid-pub.log"; then
      echo "✅ 出版 $bid"; echo "$bid" >> "$PUB"; okc=$((okc+1))
    else
      echo "出版NG $bid ($(grep -oE 'PB RESULT: \w+|変換未完了' "scripts/paperback/out/$bid-pub.log" | head -1)) — 下書き保持"
      fail=$((fail+1))
    fi
    cleanup_chrome; sleep 20
  done < <(sort -u "$PENDING")
  cleanup_chrome
  echo "PUBLISH DONE ok=$okc fail=$fail"
  exit 0
fi

# draft / full フェーズ
LIST=$(node -e "const p=require('./scripts/paperback/plan.json');for(const b of p){if(b.ready&&b.asin&&b.publish_status==='published')console.log(b.book_id+' '+b.asin)}")
total=0; okc=0; fail=0; consec=0
while read -r bid asin; do
  [ -z "$bid" ] && continue
  grep -q "^$bid\$" "$PUB" && continue
  grep -q "^$bid\$" "$DRAFTED" && continue
  [ -f "scripts/paperback/out/$bid-pb-cover.pdf" ] || { echo "SKIP(no cover) $bid"; continue; }
  total=$((total+1))
  echo "=== [$total] $bid $asin $(date '+%m/%d %H:%M') ==="
  cleanup_chrome
  timeout 1500 node scripts/paperback/pb-pilot.mjs "$bid" "$asin" > "scripts/paperback/out/$bid-pilot.log" 2>&1
  rc=$?
  if [ $rc -eq 4 ]; then echo "!!! CREATION_LIMIT — 本日はここまで ($(date '+%H:%M'))"; break; fi
  tid=$(grep -o 'print-setup/paperback/[A-Z0-9]*' "scripts/paperback/out/$bid-pilot.log" | head -1 | sed 's#.*/##')
  if [ $rc -ne 0 ] || [ -z "$tid" ]; then
    echo "PILOT FAIL rc=$rc tid=${tid:-none}"; fail=$((fail+1)); consec=$((consec+1))
  else
    echo "$bid $tid" >> "$PENDING"; echo "$bid" >> "$DRAFTED"; consec=0
    echo "📝 下書き作成 $bid ($tid)"
    if [ "$PHASE" = "full" ]; then
      cleanup_chrome; sleep 10
      timeout 1500 node scripts/paperback/pb-complete.mjs "$bid" "$tid" --go > "scripts/paperback/out/$bid-complete.log" 2>&1
      if grep -q 'PB SUBMITTED' "scripts/paperback/out/$bid-complete.log"; then echo "✅ 出版 $bid"; echo "$bid" >> "$PUB"; okc=$((okc+1)); fi
    else
      okc=$((okc+1))
    fi
  fi
  if [ $consec -ge 3 ]; then echo "!!! 連続${consec}失敗(下書き作成できず) — 中断(環境確認要)"; break; fi
  cleanup_chrome
  sleep 20
done <<< "$LIST"
cleanup_chrome
echo "BATCH DONE phase=$PHASE 下書き作成=$okc fail=$fail"
