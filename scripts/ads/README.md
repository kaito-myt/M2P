# scripts/ads — Amazon Advertising API 接続ヘルパー

`ads.spend.fetch` (worker) が Amazon Advertising API から広告費・パフォーマンスを取得できるように
するための、運営者(人間)がローカル PC で一度だけ実行する OAuth ヘルパー。

## 前提 (Amazon Advertising Console 側の準備)

1. https://advertising.amazon.com/API/docs の手順で **LwA セキュリティプロファイル** を作成し、
   Client ID / Client Secret を発行する。
2. セキュリティプロファイルの「許可された返信 URL」に、本スクリプトの既定ポートに合わせて
   `http://localhost:8787/callback` を追加する（`--port` を変えた場合はそのポートに合わせる）。
   `https://` のみ許可という記載のページもあるが `localhost` / `127.0.0.1` の `http://` は
   開発用に許可される（許可されない場合は下記「ローカルでコールバックを受け取れない場合」を参照）。
3. 対象の Amazon Ads アカウントで、KDP の出版アカウントに紐づく広告アカウント（プロファイル）に
   アクセスできることを確認する。

## 使い方

```bash
node scripts/ads/amazon-ads-oauth.mjs --client-id=amzn1.application-oa2-client.xxxx \
  --client-secret=xxxxxxxx [--region=fe] [--port=8787]
```

- `--region`: `na` | `eu` | `fe`（既定 `fe` = 日本 / Far East）。
- `--port`: ローカルコールバックサーバのポート（既定 `8787`）。

流れ:

1. 認可 URL が表示される（自動で開かない）。表示された URL をブラウザで開き、
   Amazon Ads アカウントでログイン・許可する。
2. スクリプトが `http://localhost:<port>/callback` で待ち受けており、認可コードを自動受信する。
3. 認可コード → `refresh_token` の交換を自動実行する（region 別トークン URL が失敗した場合は
   `api.amazon.com` へ自動フォールバック）。
4. `GET /v2/profiles` で広告アカウント（プロファイル）一覧を表示する
   （`profileId` / `countryCode` / `currencyCode` / `accountInfo.type` / `accountInfo.subType` /
   `accountInfo.name`）。KDP 著者アカウントは `subType` が `KDP_AUTHOR` になる想定
   （実データで確認できたら本 README と docs/05 を更新すること）。
5. プロファイルが 1 件ならそれを自動選択、複数ある場合は一覧を表示して停止するので、
   `--profile-id=<profileId>` を指定して再実行し対象を確定する。
6. 最後に、Railway の `A2P-Worker` サービスに設定すべき 5 つの env を `KEY=VALUE` 形式で表示する:
   - `AMAZON_ADS_CLIENT_ID`
   - `AMAZON_ADS_CLIENT_SECRET`
   - `AMAZON_ADS_REFRESH_TOKEN`
   - `AMAZON_ADS_PROFILE_ID`
   - `AMAZON_ADS_REGION`

   `--railway-set` を付けて実行すると、`railway variables --service A2P-Worker --set ...` を
   自動実行して反映する（Railway CLI がログイン済み・プロジェクトにリンク済みであること。
   本スクリプトは自動実行しない設計 — 実行するかどうかは運営者の判断）。

## ローカルでコールバックを受け取れない場合

別マシン/ブラウザで認可した、あるいは LwA が `http://localhost` のリダイレクトを拒否した場合は、
以下のいずれかで手動投入できる:

- `--redirect-url="http://localhost:8787/callback?code=...&state=..."`
  （認可後にブラウザが遷移した URL 全体をそのまま貼り付ける）
- `--code=<認可コード>`（URL の `code` パラメータだけを貼り付ける）

いずれの場合もローカルサーバは起動せず、指定された値をそのまま使ってトークン交換に進む。

## 反映後の確認

env 設定後、worker を再起動すると `ads.spend.fetch`（毎日 04:00 JST cron、または `/ads` の
「今すぐ取得」ボタン）が有効化される。`/ads` 画面の接続状態が「接続済み」になり、
最終取得日時・KPI・キャンペーン別・書籍別の集計が表示されるようになる。

## 秘密情報の扱い

- 本スクリプトは `client_secret` / `access_token` / `refresh_token` をログに**全表示しない**
  （先頭数文字 + `…` でマスクする）。最終的な env 一覧の出力にはそのまま値が含まれるため、
  ターミナル出力の共有・保存には注意すること。
- `.env.local` 等のファイルに秘密情報を書き込む処理は行わない（表示するのみ、設定は運営者/
  `--railway-set` 経由の Railway CLI が行う）。
