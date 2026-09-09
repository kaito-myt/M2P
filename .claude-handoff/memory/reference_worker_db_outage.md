---
name: reference_worker_db_outage
description: 2026-08-30〜09-01 Railway worker が postgres.railway.internal に到達不能になりパイプライン/売上取得/状態同期が全停止した障害と復旧手順・二重投入の教訓
metadata: 
  node_type: memory
  type: reference
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-09-01T07:26:33.434Z
---

# Worker→Postgres 私設ネットワーク断 (2026-08-30 08:00Z 頃〜 09-01 06:35Z 復旧)

**症状**: A2P-Worker の全 Prisma 呼び出しが `Can't reach database server at postgres.railway.internal:5432`。
graphile 自身の接続(長寿命)は生きていたのでジョブは拾うが、タスク内の Prisma で即失敗→retry 消費。
sales.fetch / kdp.publish.status.sync / batch_plan.dispatcher / pipeline.book.* 全滅。
**public.jobs にはエラーが書けない**(書込み自体が Prisma)ので、症状は graphile `last_error` と `railway logs` にしか出ない。
「6時間ジョブ完了ゼロ」+ public.jobs にエラー無し、が見分け方。

**復旧**: `railway redeploy --service A2P-Worker -y` で再起動→私設DNS/接続が張り直され即復旧。Postgres 自体は正常
(DATABASE_PUBLIC_URL からのローカル接続は終始OK)。`railway redeploy` は無出力で成功するので
`railway deployment list --service A2P-Worker` の先頭が BUILDING→SUCCESS になるのを確認する。

**後始末 (再発時のチェックリスト)**:
1. `sales_fetch_runs` の `status='running'` 孤児行を `failed` にする(次回 cron が拾い直す)。
2. 障害中に exhausted(attempts>=max) した graphile pipeline.book.* ジョブは**残骸**。復旧後に
   **まだ retryable な古いジョブ**(例: marketer att=24/25)が残っていると**前工程を再実行して本を壊す**。
   → 再投入した本の古いジョブ(id < 再投入開始id)は `graphile_worker._private_jobs` から DELETE。
3. 8月の `app_settings.monthly_budget_exceeded=true` が月替わり後も残る(自動リセット無し)。手動 false。

**二重投入事故の教訓**: 「クレジット回復を待って自動再投入する bash 監視」を TaskStop で止めても、
**Windows では子 node が生き残って投入を完了する**。手動投入と 1 分差で 43 冊が 2 回キューに入った。
→ 監視ループの子プロセス投入と手動投入を併用しない。二重は `(kind,book_id)` で group し
burst 窓(先頭 created_at+4分)内の 2 件目以降を削除で除去。**public.jobs.created_at は tz 無し**なので
UTC リテラル比較は 9 時間ずれる — DB 相対窓で比較する。

関連: [[project_kdp_publish_assist]] [[reference_pipeline_stuck_books]] [[reference_model_assignment_routing]]
