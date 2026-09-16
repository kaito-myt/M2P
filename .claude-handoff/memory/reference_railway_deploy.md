---
name: reference-railway-deploy
description: Railway デプロイは `railway up --service X --detach` を使う。`redeploy --from-source` は Git 連携が無いため新コードを反映しない
metadata:
  type: reference
---

**`railway redeploy --service X --from-source --yes` は新コードを反映しない**(2026-09-15 実測)。
このプロジェクトは GitHub 連携ではなく CLI アップロードでデプロイしているため、`--from-source` は
「configured source」が存在せず、実質は既存イメージの再起動になる。exit 0 で成功したように見えるが
`railway deployment list` に新規デプロイが増えず、ワーカーの登録タスク一覧も古いまま。

**正しい手順**: `railway up --service <A2P|A2P-Worker|ANP> --detach`(リポジトリルートで実行)。
Indexing→Uploading→Build が走り、`deployment list` に新しい SUCCESS 行が増える。
確認は worker なら `railway logs` の `runner starting ... tasks=[...]` に新タスク名があるか。

**Why:** Phase 1/2 で `redeploy --from-source` を3回使い、いずれも反映されていなかった。
`note.theme.generate` を投入しても attempts=0 のまま拾われず、ログの登録タスク一覧に無いことで発覚。

**How to apply:** デプロイは必ず `railway up`。デプロイ後は `deployment list` で新規行を確認する。

**追記 (2026-09-16, C:\DEV\M2P 本機)**: このフォルダは `railway link` されていないため、素の `railway up` /
`railway deployment list` / `railway logs` は全て「No linked project found」で**何もせず exit 0** になる。
必ず `export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env.local | cut -d= -f2-)` を先に通す (pb-env.sh と同じ)。
デプロイ後は `railway deployment list --service X` で新しい SUCCESS 行を確認する。
