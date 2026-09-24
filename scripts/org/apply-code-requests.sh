#!/usr/bin/env bash
# F-098b: CEO が起票したコード変更要求をローカルで実装する (ブランチに作るだけ・main へはマージしない)。
#   bash scripts/org/apply-code-requests.sh            # 一番上の 1 件を実装
#   bash scripts/org/apply-code-requests.sh --dry      # 渡すプロンプトだけ表示
#   bash scripts/org/apply-code-requests.sh --count=3  # 3 件まとめて
set -uo pipefail
cd /c/DEV/M2P
exec bash scripts/paperback/pb-env.sh node scripts/org/apply-code-requests.mjs "$@"
