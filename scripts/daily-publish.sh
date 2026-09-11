#!/usr/bin/env bash
# 在庫を毎日きっちり売り場へ出すための日次ルーティン。
#   bash scripts/paperback/pb-env.sh bash scripts/daily-publish.sh
#
# 背景(2026-09-11): 144冊作って KDP で販売中はわずか30冊(21%)。
# 審査中47・未出版46・取下21 が眠っており、これが最大の機会損失だった。
# 各チャネルに日次上限があるため「毎日上限まで出す」以外に在庫を捌く道がない。
#   - KDP 新規作成 : 約5冊/日 (creation_limit。審査中が滞留すると更に絞られる)
#   - BOOK☆WALKER : 約3件/日 (POST /api/books/register が以降 403)
#   - ペーパーバック: KDP 電子とは別勘定(2026-09-09 実測)
# 上限に当たったら止まるだけで副作用は無いので、毎日流して構わない。
set -uo pipefail
cd /c/DEV/M2P
LOG=scripts/daily-publish.log
say() { echo "[$(date '+%m/%d %H:%M')] $*" | tee -a "$LOG"; }

say "===== 日次出版ルーティン開始 ====="

# 1) KDP 電子書籍 — まず枠を消費しない下書きresume、次に新規作成
say "--- KDP: 下書きresume(枠非消費) ---"
bash scripts/kdp-assist.sh auto --all 2>&1 | grep -E "対象書籍|下書きスロット|submitted|published|RESULT|見つかりません" | tee -a "$LOG"

say "--- KDP: 新規作成(5冊/日) ---"
bash scripts/kdp-assist.sh create --all --limit=5 2>&1 | grep -E "対象書籍|===|PUBLISHED|creation_limit|RESULT" | tee -a "$LOG"

# 2) BOOK☆WALKER — 却下分の再申請を上限まで(編集は保存済みなので register のみ)
say "--- BOOK☆WALKER: 却下分の再申請(3件/日) ---"
if [ -f scripts/bookwalker/retry-queue.txt ]; then
  n=0
  while read -r bwid; do
    [ -z "$bwid" ] && continue
    [ "$n" -ge 3 ] && break
    say "  再申請 $bwid"
    out=$(bash scripts/bookwalker/.reg-one.sh "$bwid" 2>&1 | tail -3)
    echo "$out" | tee -a "$LOG"
    echo "$out" | grep -q "403" && { say "  403到達 — 本日はここまで"; break; }
    n=$((n+1))
  done < scripts/bookwalker/retry-queue.txt
else
  say "  retry-queue.txt 無し — スキップ"
fi

# 3) ペーパーバック — 変換済み下書きを出版(KDP電子とは別枠)
say "--- ペーパーバック: 出版 ---"
bash scripts/paperback/pb-batch.sh publish 2>&1 | grep -E "PUBLISH|✅|出版NG|DONE" | tee -a "$LOG"

say "===== 完了 ====="
