#!/usr/bin/env bash
# F-097: 「Kindle を出した本は必ずペーパーバックも出す」ためのローカル自動実行。
#
#   bash scripts/paperback/pb-env.sh bash scripts/paperback/pb-auto.sh [draft|publish|all] [--limit=N]
#   (nohup で回す場合)
#   nohup bash scripts/paperback/pb-env.sh bash scripts/paperback/pb-auto.sh all > scripts/paperback/pb-auto.log 2>&1 &
#
# 旧 pb-batch.sh との違い:
#   - 対象を **DB のキュー** (`books.pb_publish_queued` / `pb_publish_status`) から取る
#     (旧: 静的な plan.json + テキスト台帳 → 新刊が永久に対象外になっていた)。
#   - 各ステップの結果を DB に書き戻す (pb-state.cjs)。テキストはログとしてのみ残す。
#   - 表紙 PDF が無ければ自動生成する (旧: 無ければ SKIP していた)。
#
# 既定は **KDP が作成数制限を返すまで** 回す (運営者指示 2026-09-24)。
#   - docs/05 §5.3.15b の実測では、ペーパーバックの下書き作成は Kindle の「1 日 5 冊」枠を
#     共有しない (同日に Kindle 5 冊 + ペーパーバック 10 冊を作っても creation_limit は出なかった)。
#   - それでも上限に当たったら pb-pilot.mjs が rc=4 を返すので、その時点で打ち切って 20h の
#     クールダウンを置く (翌日 sweep → 再開)。
#   - 環境異常でむやみに叩き続けないよう、連続 3 失敗でも打ち切る。
#   - `--limit=N` を渡せば従来どおり冊数で止められる。
# 原稿は Amazon 側の変換完了 (数時間) を待たないと出版できないため、publish フェーズは
# 下書き作成から 3 時間以上経ったものだけを対象にする。
set -uo pipefail
cd /c/DEV/M2P

PHASE="${1:-all}"
# 既定 0 = 冊数で止めない (KDP の制限メッセージ or 連続失敗まで回す)。
LIMIT="0"
for a in "$@"; do case "$a" in --limit=*) LIMIT="${a#--limit=}";; esac; done
# pb-state.cjs には実数を渡す必要があるので、0 のときは十分大きい値にする。
QUEUE_LIMIT="$LIMIT"
[ "$QUEUE_LIMIT" = "0" ] && QUEUE_LIMIT=500

OUT=scripts/paperback/out
mkdir -p "$OUT"
LOCK=scripts/paperback/.auto.lock
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "既に稼働中 pid=$(cat "$LOCK")"; exit 0
fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT

cleanup_chrome() {
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*kdp-userdata*' } | ForEach-Object { taskkill /F /T /PID \$_.ProcessId 2>&1 | Out-Null }" 2>/dev/null || true
  rm -f scripts/.kdp-userdata/SingletonLock scripts/.kdp-userdata/SingletonCookie scripts/.kdp-userdata/SingletonSocket 2>/dev/null || true
}

state() { node scripts/paperback/pb-state.cjs "$@"; }

echo "=== pb-auto 開始 phase=$PHASE limit=$(if [ "$LIMIT" = "0" ]; then echo '制限まで'; else echo "$LIMIT"; fi) $(date '+%m/%d %H:%M') ==="
state stats

# ---------------------------------------------------------------------------
# draft フェーズ: 下書き作成 (原稿/表紙アップロード = Amazon 側の変換をトリガー)
# ---------------------------------------------------------------------------
if [ "$PHASE" = "draft" ] || [ "$PHASE" = "all" ]; then
  # plan.json を DB から作り直す (新刊のページ数・背幅・表紙キーを取り込む)
  echo "--- plan 再計算"
  node scripts/paperback/pb-plan.cjs > "$OUT/pb-plan.log" 2>&1 || echo "plan 生成に失敗 (既存 plan.json を使う)"

  okc=0; fail=0; consec=0
  while read -r bid asin; do
    [ -z "$bid" ] && continue
    echo "=== DRAFT $bid ($asin) $(date '+%m/%d %H:%M') ==="

    # plan.json に ready で載っていない本 (余白 NG・頁数レンジ外など) は飛ばす
    ready=$(node -e "const p=require('./scripts/paperback/plan.json');const b=p.find(x=>x.book_id==='$bid');console.log(b&&b.ready?'1':'0')" 2>/dev/null || echo 0)
    if [ "$ready" != "1" ]; then
      reason=$(node -e "const p=require('./scripts/paperback/plan.json');const b=p.find(x=>x.book_id==='$bid');console.log(b?((b.gutter_ok===false&&'ノド余白NG')||(b.range_ok===false&&'頁数レンジ外')||(!b.cover_key&&'表紙なし')||b.error||'plan not ready'):'plan に無い')" 2>/dev/null || echo 'plan not ready')
      echo "SKIP(plan) $bid: $reason"
      state failed "$bid" "plan: $reason" --cooldown-hours=168
      continue
    fi

    # 表紙 (巻き表紙 PDF) が無ければ作る
    if [ ! -f "$OUT/$bid-pb-cover.pdf" ]; then
      echo "表紙 PDF を生成"
      if ! node scripts/paperback/build-wrap-cover.mjs "$bid" > "$OUT/$bid-cover.log" 2>&1; then
        echo "表紙生成 NG $bid"; state failed "$bid" "cover build failed" --cooldown-hours=24; fail=$((fail+1)); continue
      fi
    fi

    cleanup_chrome; sleep 5
    timeout 1500 node scripts/paperback/pb-pilot.mjs "$bid" "$asin" > "$OUT/$bid-pilot.log" 2>&1
    rc=$?
    if [ $rc -eq 4 ]; then
      echo "!!! CREATION_LIMIT — 本日はここまで ($(date '+%H:%M'))"
      state failed "$bid" "KDP creation limit" --cooldown-hours=20
      break
    fi
    tid=$(grep -o 'print-setup/paperback/[A-Z0-9]*' "$OUT/$bid-pilot.log" | head -1 | sed 's#.*/##')
    if [ $rc -ne 0 ] || [ -z "$tid" ]; then
      echo "下書き作成 NG rc=$rc tid=${tid:-none}"
      state failed "$bid" "pilot rc=$rc" --cooldown-hours=20
      fail=$((fail+1)); consec=$((consec+1))
    else
      state drafted "$bid" "$tid"
      echo "📝 下書き作成 $bid ($tid)"
      okc=$((okc+1)); consec=0
    fi
    if [ $consec -ge 3 ]; then echo "!!! 連続 $consec 失敗 — 中断 (環境確認要)"; break; fi
    cleanup_chrome; sleep 20
  done < <(state queue --limit="$QUEUE_LIMIT")
  echo "DRAFT DONE ok=$okc fail=$fail"
fi

# ---------------------------------------------------------------------------
# publish フェーズ: 変換済みの下書きを出版
# ---------------------------------------------------------------------------
if [ "$PHASE" = "publish" ] || [ "$PHASE" = "all" ]; then
  okc=0; fail=0
  while read -r bid tid; do
    [ -z "$bid" ] && continue
    echo "=== PUBLISH $bid ($tid) $(date '+%m/%d %H:%M') ==="
    cleanup_chrome; sleep 5
    timeout 1500 node scripts/paperback/pb-complete.mjs "$bid" "$tid" --go > "$OUT/$bid-pub.log" 2>&1
    if grep -q 'PB SUBMITTED' "$OUT/$bid-pub.log"; then
      state published "$bid"
      echo "✅ 出版 $bid"; okc=$((okc+1))
    else
      why=$(grep -oE 'PB RESULT: \w+|変換未完了' "$OUT/$bid-pub.log" | head -1)
      echo "出版 NG $bid (${why:-unknown}) — 下書きは保持して再試行"
      # 変換未完了なら数時間後に再試行すればよいので下書きのまま cooldown だけ置く
      state failed "$bid" "complete: ${why:-unknown}" --cooldown-hours=6
      fail=$((fail+1))
    fi
    cleanup_chrome; sleep 20
  done < <(state pending --hours=3)
  echo "PUBLISH DONE ok=$okc fail=$fail"
fi

cleanup_chrome
state stats
echo "=== pb-auto 終了 $(date '+%m/%d %H:%M') ==="
