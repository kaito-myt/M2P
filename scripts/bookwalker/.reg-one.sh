#!/usr/bin/env bash
# 編集保存済みのBW書籍を「申請だけ」やり直す(日次ルーティン用)。
cd /c/DEV/M2P
node scripts/bookwalker/bw-fix-listing.mjs "$1" --register
