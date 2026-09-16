---
name: reference-rekick-freeze
description: judge 再キック後に本が running/judging のまま無言凍結するパターン(dedupe ガードが初回 done Job を見て次工程を enqueue しない)と 2026-09-16 の修正・復旧手順
metadata: 
  node_type: memory
  type: reference
  originSessionId: 80ff9c8a-2155-4f98-a6c0-5becb68318b9
  modified: 2026-09-16T02:38:29.844Z
---

**症状 (2026-09-16 発見、本番 17 冊が 8/31〜9/4 から放置)**: `books.status` が `running`(12冊) / `judging`(3冊) のまま、
最終 job は editor done / writer.chapter done で、次工程 (thumbnail/judge/editor) の Job 行が無い。graphile にも無い。

**原因**: judge 不合格 (score<80) → editor / writer.chapter 再キックは通るが、その完了時の「二重 enqueue 防止」が
`status in (queued, running, **done**)` で初回パイプラインの done Job を拾い「既にある」と判断 → 何も enqueue しない。
- editor 完了 → thumbnail.text が done 済 → 何もせず `running` 固定
- writer.chapter 完了 → (Chapter 行は初回で全章分あるので件数判定は即「最終章」) → editor done 済 → 何もせず `judging` 固定

**修正 (worker `pipeline-book-editor.ts` / `pipeline-book-writer-chapter.ts`, web `approveBookContent` SA, docs/05 §5.3.4/5.3.5/5.3.8)**:
- editor: thumbnail.text が done なら thumbnail を飛ばして `pipeline.book.judge` を直接 enqueue (自 Job の `payload_json.retry_count` を引継ぎ, Book.status='judging')。
- writer.chapter: `retry_count>0` かつ親 Job あり = 再キック → 同じ親を持つ兄弟 Job の未完了数 (自分を先に done にしてから数える) が 0 の章が editor を enqueue。重複ガードは `created_at > 自分の created_at` の editor のみ。editor payload に retry_count/feedback を引継ぐ。

**復旧手順 (凍結済みの本)**: scratchpad `unfreeze.cjs` 相当 — running×editor最終×thumbnail done → judge 再投入 (retry_count は editor payload から, 無ければ 1)、judging×writer.chapter最終 → editor 再投入 (retry_count/feedback は chapter payload から)、旧 done 本 (done_at/export あり) が ops-watch 修復で再校閲され running になった残骸 → published なら status='done' 復元、未出版なら export 再投入。
public.jobs は `insert into jobs (id, kind, book_id, status, payload_json, created_at)` (id は cuid 風の任意文字列可) + `graphile_worker.add_job(kind, json, max_attempts=>2)`。

**見分け方 SQL**: `select b.id,b.status,(select kind from jobs where book_id=b.id order by created_at desc limit 1) from books b where status in ('running','judging') and updated_at < now()-interval '1 day'`。

関連: [[reference-pipeline-stuck-books]] (④ 再キック payload 障害の続き)
