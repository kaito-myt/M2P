---
name: reference-pipeline-stuck-books
description: 書籍パイプライン停止/滞留の診断パターン（未投入export・stale status・ジャンル刻印）
metadata: 
  node_type: memory
  type: reference
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-09-02T06:36:53.469Z
---

書籍が「中途半端」に見える／進行状況・承認タブに滞留する時の診断ポイント（2026-08-21 実例で確認）:

**① 未投入ジョブ (graphile_job_id=null)**: `public.jobs` に行はあるが `graphile_job_id IS NULL` = **workerへ未投入で永久滞留**。次工程が走らず `books.status` が古い工程のまま固着する。例: exportがこれで止まり status='thumbnail' のままサムネ承認タブに残った。**修正**: `SELECT graphile_worker.add_job('<kind>', json_build_object('book_id',$1,'job_id',$2)::json, max_attempts=>2)`（job_idは既存public.jobs行のid）＋`DELETE FROM book_locks WHERE book_id=`（孤児ロック解放）。→次回worker処理でstatus更新。関連: [[project-line-auth-relay]]の孤児ロック問題。

**② status不整合**: `books.status` と実ジョブ進捗がズレることがある（judgeがdoneでもstatus=thumbnail等）。真の状態は `jobs` の kind/status 履歴で判断すること。

**③ ジャンル全件practical問題**: `books`のジャンル表示は `theme_candidates.genre`(値=36ジャンルslug)由来。テーマ生成は**アカウントの genre_policy.primary_genre をそのままテーマに刻印**するため、内容が競馬/小説/NISA等でも practical になりがち。表示は`@a2p/contracts genreLabel`で全slug対応（バグではない）。**内容準拠の振り直しはLLM分類でtheme_candidates.genreをUPDATE**（2026-08-21実施: 106テーマ中100更新）。根本対策(未実施)=生成後に内容からgenre再判定。

**④ judging で無言停止 (2026-09-01 発見・修正済)**: 80点未満の再キック editor/writer.chapter が `payload が不正です` で即 exhausted(max_attempts=2)し、本は `judging` のまま・public.jobs の editor 行は `queued gj=NULL`。真因=judge が所見を1件の `feedback.body` に詰め **max(2000) 超過**(実測 2014〜2118字)。修正=`toFeedbackItems` で≤1900字に分割(worker `pipeline-book-judge.ts`, docs/05 §5.3.8)。見分け方: graphile `last_error='pipeline.book.editor payload が不正です'`。復旧=judge を再投入(修正コードで再キックし直す)。

**⑥ デプロイ残骸凍結 (2026-09-02 発見・恒久対策済)**: `railway up` は実行中ジョブを worker ごと殺す。public.jobs は `running` のまま残り、graphile の再試行はタスクの CAS(queued/failed→running) に弾かれ**空振りで消滅**→本がジョブ無しで無言凍結(実測: 1回のデプロイで editor 6本)。見分け方=「stale running 行があるのに同 kind×book の graphile ジョブが無い」。**恒久対策= org.ops.watch に自己修復を実装**(`defaultRepairOrphan`: queued に戻し保存 payload で同一 job_id 再投入、6時間毎)。即時修復は `scripts/.stage/repair-orphans.cjs`。**デプロイは編集/審査の実行中が少ないタイミングで**。

**⑤ Anthropic クレジット枯渇時の待避**: 失敗ジョブは attempts を消費し exhausted→再投入が要る。枯渇を検知したら **pending の pipeline.book.* を `run_at=now()+6h` で保留**(attempts温存)し、回復後に `run_at=now()` で解放する。判定は 1 token の Messages API probe(HTTP 400 "credit balance is too low")。

**DBメモ**: `graphile_worker.jobs` はVIEW(DELETE不可、payloadカラム無し=`payload_json`はpublic.jobs側)。停止一括復旧は最終done工程→次工程マップで再投入(過去 scratchpad recover-all-stuck.mjs)。pg接続=`createRequire('C:/DEV/M2P/node_modules/.pnpm/pg@8.21.0/node_modules/pg/')`＋DATABASE_PUBLIC_url(旧A2P scratchpad pgvars.json)。ANTHROPIC_API_KEY等はローカル.env.localに無くRailway `railway variables --service A2P --kv`から取得。

関連: [[project-home-dashboard]] [[reference-model-assignment-routing]]
