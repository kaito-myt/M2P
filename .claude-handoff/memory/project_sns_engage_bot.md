---
name: project_sns_engage_bot
description: IG自動フォローbot(F-077)稼働＋TikTok自動化は断念(bot検知)、手動ワンタップUIへ(F-083)
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-19T15:22:07.471Z
---

**TikTok自動化は断念(2026-08-20, F-083)**: ログインはCDP経由(実Chrome→`scripts/sns-capture-cdp.mjs`でCookie吸い出し)で解決したが、**headless PlaywrightのTikTok閲覧はbot検知で空ページ**(body160字)、ステルス(`--disable-blink-features=AutomationControlled`+webdriverマスク)で一時描画OKも**連続アクセスでブロック率上昇**(住宅IP 2/4→ほぼ全ブロック)、DC IP(worker)は即ブロック＋アカウント凍結リスク→**TikTokは手動ToDoに確定**。TikTokセッションはDB未保存で bot は `no_session` スキップ。**手動グロースToDoワンタップUI(F-083)**: /org で `growth_manual` を「[✓済] ハンドル+理由 [開く→]」行表示、開く=アプリ直表示→フォロー→✓で `result_json.completed` 永続(`toggleGrowthTarget` SA)。`resolveGrowthUrl`/`extractGrowthTargets`(apps/web/lib/org-view.ts)テスト付。

**F-077 IG/TikTok ブラウザ自動フォローbot**（2026-08-18, 運営者が凍結リスク受容の上で承認）。IGは稼働、TikTokは上記により未使用。

**セッション取り込み**（運営者ローカル=住宅IPで1回）:
- `node scripts/sns-capture-session.mjs instagram|tiktok` → ヘッドフルでログイン→ storageState を `scripts/.sns-session-<ch>.json`(gitignore)に自動保存。
- 担当が worker鍵で暗号化して DB `promotion_channel_settings.browser_session_enc` に保存: `WORKER_API_CRED_KEY=<railway worker key> DATABASE_URL=<public> node scripts/sns-store-session.mjs <ch>`。
- **重要**: ローカル `apps/web/.env.local` の API_CRED_KEY と **worker(Railway)の API_CRED_KEY は別物**。必ず worker の鍵で暗号化すること（sha256 fp: local=83e2d9db, worker=e4711479）。
- IG: 取り込み済み＆worker復号確認済み。TikTok: 試行回数制限で未完了→**Googleログイン(kaito.myt@gmail.com)推奨**。TikTok のログインCookieは sessionid/sid_tt/sessionid_ss のいずれか。

**bot**: worker `promotion.sns.engage`（cron `0 3,9 * * *`=JST 12/18時, 1日2回）。`sns_engage_enabled`(app_settings, 既定OFF=キルスイッチ)ON かつ browser_session_enc 有りのチャンネルで、`growth_scout` が特定した実在アカウントを復号セッション＋(住宅プロキシ resolveKdpProxy 経由可)で自動フォロー。ガード: 保守的ランプアップ `dailyCap`(5→8→12→15, Xより低い)＋1回最大4件＋ジッター＋`promotion_sns_engagements`(channel,action,handle 一意)で二重防止＋アクションブロック/ログイン誘導検知で即停止&LINE通知(検知時は他chもその回停止)。
- セレクタ実IGセッション検証済: フォロー=`getByRole('button',{name:/^(フォロー|Follow)$/})`、既フォロー=`/^(フォロー中|Following)$/`。実クリックでフォロー反映を確認(リロード後 フォロー中)。クリック直後は再描画で状態未確定なので done 扱いで記録。
- コード: `apps/worker/src/tasks/promotion-sns-engage.ts` + `promotion-sns-engage/{engage-port,playwright-engage-port}.ts`。関連 [[project_promotion_features]] [[reference_model_assignment_routing]]。
