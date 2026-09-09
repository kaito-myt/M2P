---
name: project-line-auth-relay
description: LINE双方向認証リレー(OTP通知&返信入力)＋売上取得のサーバ自動再ログイン＋販売中→出版済み同期
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-20T02:38:01.820Z
---

**LINE Messaging API による双方向認証リレー**（2026-07-27 出荷・本番疎通確認済み）。KDPログインのOTPを、通知＋返信でLINE上完結。旧LINE Notifyは終了のため Messaging API(公式アカウント)を使用。

- **DB**: `kdp_auth_requests`(id/purpose/status pending→fulfilled→consumed/prompt/code/expires_at…)。本番CREATE済。
- **webhook**: `/api/line/webhook`（署名検証 verifyLineSignature＋許可userのみ、6桁抽出→最新pendingをfulfill＋返信）。middleware matcherに `api/line` 除外追加。core=`apps/web/lib/line-webhook-core.ts`＋`line-client.ts`。
- **env(web+worker両方に設定済)**: `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_ALLOWED_USER_ID`(=push先兼許可user, U始まり)。任意: `AMAZON_EMAIL` / `AMAZON_PASSWORD`。
- **ローカル出版ツール**: OTP画面検出→pending作成→LINE push→返信poll→自動入力。タイムアウト/認証失敗で最大3ラウンド再送。
- **worker売上取得**: セッション切れ検知→ヘッドレス再ログイン(email/pass=env, OTP=LINEリレー)→storageState再暗号化保存(accounts.kdp_session_state_enc)→DL再試行。CAPTCHA(データセンターIP)時は手動フォールバック。`kdp-login-refresh.ts` + `lib/line-auth-relay.ts`。デプロイ済。
- **重要バグ修正(2026-07-29, commit 9514404)**: `refreshKdpSession`が「アカウント選択ページ(アカウントの切り替えタイル)」を処理しておらず、max_auth_age=0の再認証がemail/pass/OTPどれも出ないこの画面で40回=208秒タイムアウト→OTPのLINE通知すら未発火で毎回`login_failed`だった。backfillの`passReauth`実証済みロジックを移植:①AMAZON_EMAIL一致タイル自動クリック(無ければ@含む最初のタイル)②パスワードをclick→clear→type(delay:25)③OTP送信に`#cvf-submit-otp-button`/remember-meに`#auth-remember-me`追加。テスト15/15パス。
- **販売中→出版済み同期**: worker cron `kdp.publish.status.sync`(6h)。本棚をヘッドレス読取→submitted本がLiveなら published化(readBookStatus/mapStatusLabel)。live検出は検証済、draft/in_review等ラベルは未検証。

**[F-086根本対応 2026-08-20] セッション切れ通知の真因と自己回復の全面適用**: 運営者が「KDP売上取得:セッション切れを検知…」LINEが頻繁と苦情。**実データ診断で判明**: sales.fetchは既に完全自己回復(直近3週間OTP要求ゼロ=デバイス信頼cookieでemail/passのみ通過、sales_fetch_runs全done、Railwayデータセンターipでも再ログイン成功中)。真のスパム源は`kdp.publish.status.sync`で、READ-ONLY設計ゆえ切れ検知→再ログインせず通知して諦めるだけ(＋submitted→published昇格も黙って停止)だった。**修正**:①status.syncに自己回復を`refreshSession`でDI注入(切れ検知→1巡1度だけrefreshKdpSession本棚着地→新セッションをDB書き戻し→同じ本を再読込して継続)。②sales.fetchは「検知/試みます」予告通知を**廃止**し、自己回復失敗時のみ通知。③`kdpSessionAlertGate()`(app_settings.kdp_session_alert_at, 24hクールダウン, lib/kdp-session-alert.ts)を失敗通知に適用。→**結論: セッションは自動再ログインで自己維持、手動再取得は原則不要**(住宅IPプロキシkdp_proxyは現在disabled/heartbeat陳腐化=未使用だが、AmazonがCAPTCHAにエスカレートした時の予備)。テスト: status-sync 16/16, sales-fetch 9/9緑。

TOTP注意: 認証アプリの6桁は30秒で失効→通知後おおむね1分以内に返信要。関連: [[project-kdp-publish-assist]] [[project-kdp-sales]] [[reference-kdp-publish-authwall]]
