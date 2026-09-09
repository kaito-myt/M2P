#!/usr/bin/env bash
# BWバッチが死んでいて未申請本が残っていれば再起動する(ロックファイルで二重起動防止)。cronから定期実行。
#   bash scripts/paperback/pb-env.sh bash scripts/bookwalker/bw-keeper.sh
set -uo pipefail
cd /c/DEV/M2P
LOCK="scripts/bookwalker/.batch.lock"
# 稼働中なら何もしない
if [ -f "$LOCK" ]; then
  PID=$(cat "$LOCK" 2>/dev/null)
  if kill -0 "$PID" 2>/dev/null; then echo "batch稼働中(pid=$PID) — 何もしない"; exit 0; fi
  rm -f "$LOCK"
fi
# 全ready本のうち未申請が残っているか
REMAIN=$(node -e "
const fs=require('fs');
const plan=require('C:/DEV/M2P/scripts/paperback/plan.json').filter(x=>x.ready).map(x=>x.book_id);
const applied=new Set(fs.readFileSync('C:/DEV/M2P/scripts/bookwalker/bw-applied.txt','utf8').split(/\r?\n/).filter(Boolean));
const rem=plan.filter(id=>!applied.has(id) && fs.existsSync('C:/DEV/M2P/scripts/bookwalker/out/'+id+'.epub') && fs.existsSync('C:/DEV/M2P/scripts/bookwalker/out/'+id+'-cover.jpg'));
console.log(rem.length);
")
echo "未申請残=$REMAIN applied=$(wc -l < scripts/bookwalker/bw-applied.txt)"
if [ "$REMAIN" -gt 0 ]; then
  # 残留chrome掃除してから再起動
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*bw-userdata2*' } | ForEach-Object { taskkill /F /T /PID \$_.ProcessId 2>&1 | Out-Null }" >/dev/null 2>&1
  rm -f scripts/.bw-userdata2/Singleton* 2>/dev/null
  echo "batch再起動(残$REMAIN冊)"
  nohup bash scripts/bookwalker/bw-batch.sh --submit >> scripts/bookwalker/bw-keep.log 2>&1 &
  echo "started pid=$!"
else
  echo "全冊申請済み — keeper完了"
fi
