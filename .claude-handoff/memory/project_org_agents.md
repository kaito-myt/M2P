---
name: project_org_agents
description: Org-agents (AI company) P1+P2+P3 built & deployed — CEO + 6 managers + workers run the whole KDP business via the company ToDo backlog (plan→execute→promote→self-heal→budget-guard)
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-26T06:56:25.170Z
---

docs/06 defines a full-company AI org that runs the whole KDP business: CEO → 6 本部長 → 担当者, all coordinating through a company-wide ToDo backlog (`org_tasks`). Divisions: production/publishing/analytics/promotion/sysops/finance.

**P1 shipped & deployed to prod (2026-07-09):** the "経営神経系" — CEO + managers propose tasks; execution by workers is P2.

- DB: `org_objectives` (title, body_json, budget_jpy, budget_allocation_json), `org_tasks` (division, book_id, owner/assignee_role, kind, status, priority, depends_on, cost_jpy, result_json) + `token_usage.org_task_id` + `AppSettings.org_auto_plan_enabled`/`org_plan_cron`. Migration `20260709000000_add_org_agents` applied to prod.
- Contracts: `@a2p/contracts/org` (DIVISIONS, DIVISION_KINDS, HUMAN_KINDS, CeoPlanOutputSchema, ManagerPlanOutputSchema, buildBudgetLines/groupBy*).
- Agents: `packages/agents/src/org/{ceo,manager}.ts` — `planObjective`, `planDivisionTasks`. Roles `ceo`+`{editorial,publish,analytics,promo,ops,finance}_mgr` added to AgentRole. prompts+model_assignments seeded to prod via `packages/db/apply-org-roles.ts` (ceo/editorial/publish/analytics/promo=opus-4-7, ops/finance=sonnet-4-6).
- Worker: `org.plan` (CEO tick) in `apps/worker/src/tasks/org-plan.ts`; daily cron gated by `org_auto_plan_enabled` (default off, 05:00 JST) + manual run. Registered in runner buildTaskList + crontab buildCronItemsWithSettings.
- Web: `/org` dashboard + `/org/tasks` kanban + `app/actions/org.ts` (runOrgPlan/approve/complete/cancel) + "経営（組織）" sidebar section.

Task-status rule: human kinds (create_account/connect_account/publish_kdp) → `needs_human`; else → `approved` (auto-approved).

**P2 shipped & deployed to prod (2026-07-10):** the execution layer.

- `org.execute.dispatch` (`apps/worker/src/tasks/org-execute.ts`): picks `approved`+deps-satisfied+due org_tasks, runs by kind, sets done+result_json, confirms cost via `token_usage.org_task_id`→`org_tasks.cost_jpy`, chains improvement ToDos (proposed). Guardrails: max 8/run, 3 follow-ups/analysis, CAS approved→in_progress. Conditional 15-min cron via `AppSettings.org_auto_execute_enabled` (default off) + manual "承認済タスクを実行" button.
- Dispatch map: analytics analyze_sales/report→`sales_analyst`, research_market→`market_analyst`; publishing prepare_metadata/set_price→`metadata_worker` (draft into result_json only, KdpMetadata untouched); production plan_book→enqueue `pipeline.theme.generate`, write→enqueue `pipeline.book.kickoff` iff `theme_id` set else blocked.
- New worker roles `sales_analyst`/`market_analyst`/`metadata_worker` (AISdkClient structured, sonnet-4-6), seeded to prod via `apply-org-workers.ts`. New agents `packages/agents/src/org/{sales-analyst,market-analyst,metadata-worker}.ts`.
- contracts/org: `DISPATCHABLE_KINDS`, `depsSatisfied`, `priorityRank`, `DIVISION_DEFAULT_{KIND,ASSIGNEE}`, worker I/O schemas; `theme_id`/`account_id` on ManagerTaskDraft + org_tasks columns. Migration `20260710000000_org_execute_dispatch` (theme_id/account_id + org_auto_execute_enabled/org_execute_cron) applied to prod.
- **Intentionally left human (P2):** the 4 pipeline gates (outline/content/cover approval, KDP publish). write/edit/design_cover/qa mid-steps run inside the self-advancing pipeline, so dispatcher only *launches* (write=kickoff).

**P3 shipped & deployed to prod (2026-07-11):** promotion+ops+finance integration.

- dispatch (`org-execute.ts`) new handlers: promotion `create_content`→enqueue `pipeline.book.promotion.generate` (v1 promoter plan+posts), `publish_post`→enqueue `promotion.dispatch`, `analyze_promo`→`promo_analyst` + follow-ups; sysops `recover_job`→re-enqueue most-advanced failed `pipeline.book.*` job for the book; finance `cost_report`/`budget_review`→aggregate token_usage by division/book (`org-finance-lib.ts` computeCostAggregate) → `cost_accountant` narrative + follow-ups.
- New cron worker tasks: `org.ops.watch` (`org-ops-watch.ts`, 10-min) scans failed(<24h)/stuck(running>30min) pipeline jobs → `recover_job`(approved, retries<3) or `triage_error`(needs_human); dedup per book, max 10/run. `org.finance.tick` (`org-finance-tick.ts`, hourly) → `detectBudgetBreaches` vs objective allocation/budget + monthly_cost_red_jpy → 1 `enforce_limit`(needs_human) if breach, dedup vs open enforce_limit.
- contracts/org: `DISPATCHABLE_KINDS` += create_content/publish_post/analyze_promo/recover_job/cost_report/budget_review; `HUMAN_KINDS` += enforce_limit/triage_error; `detectBudgetBreaches`; `PromoAnalysisOutput`/`CostReportOutput` schemas. New agents `promo_analyst`/`cost_accountant` (AISdkClient sonnet-4-6), seeded via `apply-org-p3.ts`. AppSettings `org_ops_watch_enabled/cron`+`org_finance_tick_enabled/cron`; migration `20260711000000_org_p3_promo_ops_finance`.
- web: `/org/tasks` "運用監視を実行"/"予算ガードを実行" buttons (`runOrgOpsWatch`/`runOrgFinanceTick`, generic `run-org-tick-buttons.tsx`); summarizeResult renders promotion/recover/cost-report results.
- **Intentionally left human (P3):** enforce_limit (freeze/reallocate) + triage_error (unknown job failure) = needs_human. Pipeline 4 gates + KDP publish/account still human.

**P4 increment 1 shipped & deployed to prod (2026-07-12):** multi-account strategy planner.

- New `promotion_accounts` table (channel×account ledger: niche/target_reader/bio/posting_policy/status pending|connected|archived). migration `20260712000000_org_p4_promotion_accounts`.
- New dispatch kind `plan_accounts` (promotion, dispatchable) → `account_strategist` agent (AISdkClient sonnet-4-6, seed `apply-org-p4.ts`) analyzes genre/target gaps vs connected channels + ledger → for each recommended niche account: inserts `promotion_accounts`(pending) + raises `create_account`(needs_human, assignee=human) WITH full creation spec (handle_suggestion/bio/posting_policy) in instruction; dedup by channel+normalized niche. contracts: `AccountStrategyOutput` schema. web: summarizeResult 'account_strategy_planned'.
- **HARD FIXED CONSTRAINT (user asked for autonomous SNS account creation; explained + refused):** org does NOT auto-create SNS/KDP accounts — ToS forbids automated signup + phone/KYC/CAPTCHA + ban risk. Account CREATION stays human (connect-once). org only plans the account STRATEGY + fills the create spec + (once connected) posts autonomously. This is non-negotiable design (docs/06 §10). Do not build auto-signup.

**P4 increment 2 shipped & deployed to prod (2026-07-13):** multi-account posting routing.

- `promotion_posts.account_id` (→promotion_accounts, SetNull) + connection fields on promotion_accounts (token_enc/mask/handle). migration `20260713000000_org_p4_post_account_routing`.
- `pickAccountForChannel(channel, genre, accounts)` in `@a2p/contracts/promotion/channels` (niche-match-first, else first connected, else null).
- `promotion.posts.generate` routes each post to a connected ledger account (queries book genre + connected accounts). `promotion.post.publish`: if post.account_id → resolve token/handle/config from that account (fail if not connected); else channel-default (backward compat). channel-level auto_enabled master switch preserved.
- web: `/org/accounts` page (list by pending/connected/archived + connect form) + `connectPromotionAccount`/`archivePromotionAccount` actions + `promotion-accounts-core.ts` (encrypt token, promote to connected; blog=owned needs no token; audit never logs token). Link from /org/tasks.
- Flow now end-to-end: plan_accounts → create_account(human) → operator connects once at /org/accounts → org auto-routes + posts.

**P4 increment 3 shipped & deployed to prod (2026-07-13):** KDP publish pre-screening (gated, default-OFF).

- `evaluateKdpPublishReadiness(input, thresholds)` in `@a2p/contracts/org` (deterministic guardrail: book done + not published + no blocking comments + quality_score>=min + metadata complete & price in band → eligible + reasons[]).
- worker `org.kdp.screen` (`org-kdp-screen.ts`): screens publish_kdp org_tasks, writes result_json.kdp_readiness (advisory always). Gate `AppSettings.org_kdp_auto_publish_enabled`(default false) ON → eligible needs_human tasks advanced to `approved` (=cleared for publish); NEVER publishes. cron `org_kdp_screen_cron`(hourly:30) conditional on gate + web manual button. thresholds: org_kdp_min_quality(70)/min_price(250)/max_price(1250). migration `20260713100000_org_p4_kdp_screen`.
- web: `/org/tasks` "KDP公開審査を実行" button + summarizeResult kdp_readiness. 
- **kdp.submit is still a Phase-3 placeholder (no real Playwright submit)** — so even with gate ON, nothing publishes externally; screen only marks books cleared. Real KDP auto-publish (Playwright + 2FA) is deferred/out-of-scope-autonomous (ToS + real creds).

**P4 increment 4 shipped & deployed to prod (2026-07-13):** winning-pattern learning.

- `computeWinningPatterns(books: BookPerf[])` in `@a2p/contracts/org` (deterministic: top_genres by royalty, underexposed_genres = inventory-but-0-sales, insights[]).
- new `org_playbook` singleton table (patterns_json). migration `20260713200000_org_p4_playbook`.
- `org.plan` (buildCompanySnapshot): computes patterns from Book.genre×SalesRecord, upserts org_playbook (accumulate), attaches to `CompanySnapshot.winning_patterns`; ceo.ts buildCeoUserMessage adds 【勝ちパターン(学習)】 section → CEO decisions informed by what sells.
- web: `/org` dashboard "勝ちパターン（学習）" card (genre badges + insights). Reads org_playbook.
- Safe: deterministic, no model-config/external-publish changes. Addresses docs §13 "意思決定の質".

**⚠️ IMPORTANT deploy lesson (fixed a59acf4):** In `'use server'` files EVERY exported function must be `async` — `tsc` passes but `next build` fails ("Server Actions must be async functions"), silently breaking web auto-deploy. This had broken web deploys since P3 (runOrgOpsWatch/runOrgFinanceTick non-async). Always run `pnpm --filter @a2p/web build` (not just typecheck) before pushing web changes.

**P4 increment 5 shipped & deployed to prod (2026-07-13):** bakeoff model optimization per org role.

- contracts: `ORG_BAKEOFF_ROLES` (ceo+mgrs+analysts+workers), `orgBakeoffSampleInput(role)` (representative fixed inputs), `computeBakeoffRecommendation(results, current)` (quality-first, cost tiebreak, is_change vs current). `optimize_model` kind (sysops, HUMAN_KINDS).
- worker: extended `bakeoff.run` — `org_optimize` input flag → on done enqueue `org.bakeoff.recommend` (passes helpers.addJob). New `org.bakeoff.recommend` (`org-bakeoff-recommend.ts`): loads BakeoffResult rows + current ModelAssignment → computeBakeoffRecommendation → if is_change creates `optimize_model`(needs_human) proposal org_task with evidence; else no task.
- web: `/org` "モデル最適化（bakeoff）" control (role select → launch) + `launchOrgModelBakeoff` action + `org-bakeoff-core.ts` (builds candidates = current + catalog is_current, max 4, creates BakeoffRun org_optimize:true + enqueues bakeoff.run). summarizeResult model_optimization_proposal.
- flow: /org launch → bakeoff.run → org.bakeoff.recommend → needs_human proposal → operator switches via existing model-assignment UI. **Model change NOT auto-applied** (proposal only; sensitive config). No migration (reuses BakeoffRun/BakeoffResult F-053 tables).

**2026-07-25 レビュー & 修正（ユーザー「経営系がちゃんと実装されてない」指摘）:** コードは P1〜P4 全実装済で健全だが、実運用が死んでいた3点を修正 — (1) **自律運転cronが全部OFFかつ有効化UIが無い**(prod: org_auto_*_enabled=全false, org_objectives=0=CEOが一度も自律計画せず)→経営ダッシュボードに有効化UI追加(このセッションで実装)。(2) **モデルIDが旧式**(org13ロールが opus-4-7/sonnet-4-6)→**opus-4-8 / sonnet-5 へ更新(prod適用済 2026-07-25)**。(3) **承認ループが詰まる**(改善ToDoがproposed生成・blocked/needs_humanが盤面から進められない)→非human follow-upを直接approved化＋盤面に再実行/承認ボタン追加(このセッションで実装)。加えて [[pipeline-settings]] のゲート自動パスにより org 起票の書籍がoutline/content/cover人手ゲートを自動通過可能に。**注意: cronフラグは worker 起動時に crontab へ読み込まれるため、有効化後は worker 再起動が必要。**

**P4 増分7 shipped & deployed to prod (2026-08-04):** CEO対話チャット＋ToDo自動承認トグル＋plan_book越境ガード（docs/06 §増分7）.
- **plan_book越境ガード(不具合修正)**: 制作本部長がSNS販促指示をplan_bookで起票→`handlePlanBook`が instruction をそのまま `pipeline.theme.generate` に渡し「SNS指示から出版テーマを作る」誤動作。対策=(a) `org-execute.ts` `handlePlanBook` に `looksLikePromotionDirective` ガード（該当時 blocked、テーマ生成せず）、(b) `editorial_mgr` prompt v2（plan_book=新規書籍コンセプト専用と明記、DB active）、(c) 既存誤起票を canceled 化。manager.ts は cross-division kind は除外するが kind↔intent 不一致は防げていなかったのが根因。
- **ToDo自動承認トグル**: `AppSettings.org_auto_approve_tasks`(Boolean, 既定true=従来完全自律)。OFF時は org-plan/org-execute の非human起票を `approved`でなく`proposed`で留め /org/tasks で `approveOrgTask` 承認待ち。UI=/org「自律運用設定」に単独トグル（`org-automation-core.ts`に追加）。
- **CEO対話チャット**: 運営者⇔CEO。DB=`org_ceo_messages`(role operator|ceo, status, result_json; raw SQL migration prod適用)。contracts=`CeoChatOutputSchema`(reply/directive_summary/new_tasks[]), AgentRole `ceo_chat`。agent=`packages/agents/src/org/ceo-chat.ts` `chatWithCeo`, prompt+model_assignment role=`ceo_chat`(opus-4-8) DB seed。worker=`org.ceo.chat`(`org-ceo-chat.ts`, runner登録): pending operatorメッセージ処理→snapshot+履歴でCEO応答→new_tasksをkind∈division検証で org_tasks 起票(自動承認トグル準拠)→CEO返答保存。web=`sendCeoMessage` SA+`GET /api/org/ceo/messages`(ポーリング)+`components/org/ceo-chat.tsx`(/org上部)。org.plan が直近14日 operator メッセージを CEO snapshot.notes(最優先申し送り)に取り込む。**prod end-to-end 疎通確認済**(競馬新刊plan_book起票+directive_summary生成)。

**2026-08-10 重複制作事故の恒久対策（ユーザー「KDPに競馬本が複数出版＋低品質」指摘）:** 自律運用(org)の `write` が
**既出テーマ（特にJulyに低品質で取り下げた競馬シリーズ6テーマ）を再起票**し、8/2 に同一6テーマから重複本が生成・
一部KDP再入稿された。根因=`handleWrite`/`pipeline.book.kickoff` に「同一テーマに既存本があれば作らない」ガードが無かった。
対策: (1) **block-on-any 重複制作ガード二段**（`handleWrite`入口=`book.findMany(where theme_id)` あれば `book_kickoff_skipped`、
`pipeline.book.kickoff` choke-point=`book.findFirst(where theme_id)` あれば Job=done skipped）。**取り下げ済(retracted)本があるテーマも
「制作済み」扱いで自律再制作しない**（運営者の取り下げ判断を尊重、作り直しは人間の明示操作のみ）。docs/05 §5.3.1 / docs/06。
(2) 退役: 競馬6テーマ `theme_candidates.status='rejected'`。(3) DB是正: 重複本6冊の org_tasks 41件 canceled・予約投稿12件 canceled・
孤児ジョブ5件 failed・スタック5冊 retracted・重賞(Aug)出版フラグ解除。**KDP実本棚の重複listing取り下げは別途（破壊的=[[reference_kdp_bookshelf_automation]] で明示許可+セッション要）。** テスト: pipeline-book-kickoff/org-execute 各dedupテスト追加、worker tsc/vitest green、A2P-Worker再デプロイ。

**F-089 shipped & deployed to prod (2026-08-22): CEOがエージェントのプロンプトを会話で書き換える（運営者要望「A2Pで入力した指示が通るように／CEOとの会話だけで完結したい」）.**
- 根因: 従来「追加指示」は戦略生成時に一度だけLLMへ渡り**永続化されず**、日次生成は凍結 `strategy_json` を読むのみ＝運営者方針が効き続けない。
- 実装: `CeoChatOutputSchema` に `prompt_edits:[{role,instruction}]`(max5,任意) 追加。新エージェント **`prompt_editor`**(`packages/agents/src/org/prompt-editor.ts`, role追加, I/O=`PromptEditorInput/Output` in contracts/org, seed `apply-prompt-editor.ts`=anthropic/claude-opus-4-8) が対象の現行本文を**プレースホルダ厳守で最小改訂**。worker `org-ceo-chat.ts` `applyCeoPromptEdit`: 現行active取得(genre=null優先)→改訂→検証(空/無変更/プレースホルダ欠落なら中止)→`$transaction`(prompt_proposals auto_approved decided_by=ceo rollback+7d＋旧activeをarchived＋新版active created_by=`ceo:<msgId>`＋AuditLog action=prompt.approve)。CEO返信に「✅/⚠️ role を vN に更新」追記。**ガード: ceo/ceo_chat/prompt_editor自身は改訂不可**。`ceo_chat` prompt を v2 化(能力告知, `apply-ceo-chat-v2.ts`)。
- **prod end-to-end 検証済**: CEOチャットに「content_creatorを毎回実在の名作紹介に」指示→content_creator **v4→v5**(created_by=ceo:...)、プレースホルダ保持、v4 archived、proposal/audit記録、CEOが会話で報告。＝運営者は今後 **/org のCEOチャットだけで各エージェントの方針を恒久変更できる**。
- 注意/TODO: `prompt_proposals` に Optimizer 由来の **pending 13件が承認待ち滞留**（別件、未処理）。将来 CEO に「溜まった提案を確認して反映して」を委ねる導線を検討。web `/prompts` は現状**閲覧専用**（本文直接編集UIは無く、変更口は提案承認 or CEO改訂 or apply-*スクリプト）。

**2026-08-25 CEO対話を"優秀な経営パートナー"化 (ceo_chat v2→v3)（ユーザー「CEOが優秀でない・経営力/分析が稚拙・100%Yesで自分の意見が無い・議論しながら事業を伸ばしたい」）:** 旧プロンプトは CEO を「オーナーの意図を実現する実行者」としか定義せず、独自見解/反論/数値分析/議論リードの指示がゼロだったのが根因。`apply-ceo-chat-v3.ts`(prod適用済, model=opus-4-8)で **経営者スタンス5原則**を明記=①必ず自分の見解を持ち反射同意しない ②非効率/時期尚早/前提誤りなら遠慮なく反対＋代替案(おべっか禁止) ③売上/コスト/冊数/単位経済/ボトルネックを数字で分析(精神論禁止) ④黒字化(現状ほぼ未黒字)を最優先軸に自分から論点提起 ⑤返答末尾は「決めてほしい選択肢」か「次の一手」で締める。new_tasks は「妥当と判断した施策のみ」起票(反対なら空＋reply理由)。`ceo-chat.ts buildCeoChatUserMessage` の reply 要件も同趣旨に更新(worker再デプロイ済)。prompt_edits 等の機能節は v2 から維持。**計画側 `ceo`(planObjective)の分析プロンプトは未強化(必要なら次)**。

**P4 remaining (external-dependent, not built):** real KDP auto-submit (Phase 3 kdp.submit Playwright + 2FA — real Amazon creds/ToS)は**2026-08-03に実装・実出版成功済**だが2026-08-12以降 kdp.submit ゾンビジョブで停止中→復旧作業へ([[project-kdp-publish-assist]])。SNS engagement read-port (→promo_analyst — real IG/TikTok API approval), market_analyst web_search. See [[project_phase2_state]].
