#!/usr/bin/env bash
# BOOTH主力厳選バッチ(方針B): 売れ筋+主力の下書きを7項目自動入力で作成。
# 運営者は各下書きで「作品ファイルUP + 公開で保存」の2操作のみ。
set -uo pipefail
cd /c/DEV/M2P
MAP=scripts/booth/booth-map.txt; : > "$MAP"
echo "cmrin7t5m002gqs0vwxpoum5e https://manage.booth.pm/items/8815667/edit" >> "$MAP"  # 清少納言(smoke-test済)
echo "cmtd0qmtx0032nt0vpt22lfdg https://manage.booth.pm/items/8807268/edit" >> "$MAP"  # 話し相手に(完成済)

# 新規作成(8冊) — id
NEW=(
  cmrin7t5b002cqs0vz7regxgl   # シャイニング・プリンス光源氏
  cmrin7t63002mqs0vt7yxc5ub   # ラノベ古事記
  cmqzabimj005umw0vuaj5hm6y   # 貯金カレンダー
  cmrxkwtcx004qmk0vjfk8brss   # 血糖値 食べる順番
  cmtd0rry3004ynt0vpxgdxzjx   # 手書きメモ
  cmtd0rru8004unt0vztk1vhim   # 長生きリスク
  cmtd0qmzy003cnt0vardl5m0q   # 60代 断捨離
  cmtd0rjl3003wnt0vo2yfq11l   # 睡眠負債
)
# 既存下書き完成(2冊) — id=URL
declare -A REUSE=(
  [cmtd0rrqw004qnt0v1d3ceiao]=https://manage.booth.pm/items/8807242/edit
  [cmtd0qmx00038nt0vyou0r9na]=https://manage.booth.pm/items/8807249/edit
)

ok=0; fail=0
# 実行: mapはbooth-submitのPAIR出力を集約
for id in "${NEW[@]}"; do
  out=$(node scripts/booth/booth-submit.mjs "$id" 2>&1); echo "$out" | tail -6
  p=$(echo "$out" | grep '^PAIR ' | tail -1)
  if [ -n "$p" ]; then echo "$p" | sed 's/^PAIR //' >> "$MAP"; ok=$((ok+1)); else fail=$((fail+1)); fi
  sleep 3
done
for id in "${!REUSE[@]}"; do
  out=$(BOOTH_ITEM_URL="${REUSE[$id]}" node scripts/booth/booth-submit.mjs "$id" 2>&1); echo "$out" | tail -6
  p=$(echo "$out" | grep '^PAIR ' | tail -1)
  if [ -n "$p" ]; then echo "$p" | sed 's/^PAIR //' >> "$MAP"; ok=$((ok+1)); else fail=$((fail+1)); fi
  sleep 3
done
echo "===== BOOTH FLAGSHIP DONE ok=$ok fail=$fail ====="
echo "--- 下書きマップ ---"; cat "$MAP"
