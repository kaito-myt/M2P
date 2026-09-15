@echo off
REM Windows タスクスケジューラから日次出版ルーティンを起動するラッパ。
REM KDP は scripts/.kdp-userdata の実Chromeを使うためローカル実行が必須(Railwayでは動かない)。
cd /d C:\DEV\M2P
"C:\Program Files\Git\bin\bash.exe" -lc "bash scripts/paperback/pb-env.sh bash scripts/daily-publish.sh" >> C:\DEV\M2P\scripts\daily-publish-task.log 2>&1
