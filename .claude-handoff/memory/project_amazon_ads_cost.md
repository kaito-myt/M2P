---
name: project-amazon-ads-cost
description: Amazon Ads(広告費)の公式API自動計上 — 実装済、承認後にenv設定で稼働
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-08-26T09:34:40.108Z
---

**F-090 Amazon Ads 広告費の自動計上 — 実装＆本番デプロイ済(2026-08-26)**。運営者要望「広告費もコスト計上したい・公式APIで」。

- **DB**: `ad_spend` テーブル(prod作成済, `schema.prisma` model AdSpend)。profile_id×ads_date で一意、spend_jpy/impressions/clicks/sales_jpy/orders、year_month で月次集計。
- **取得**: `apps/worker/src/tasks/ads-spend-fetch.ts`(`ads.spend.fetch`)＋`ads-spend/amazon-ads-client.ts`(OAuth: refresh→access token, Reporting API v3, Sponsored Products日次)。**直近~30日を毎回upsert**(遅延attribution反映)。creds未設定なら `skipped: not_connected` で安全にno-op。
- **cron**: `ADS_SPEND_FETCH_CRON='0 19 * * *'`(UTC=JST04:00)、runner/crontab登録済。
- **P&L連携**: `apps/web/lib/cost-meter-core.ts` が **当月コスト=token_usage(AI従量)＋ad_spend(広告費)** で合算→当月純利益・ROASに自動算入。
- **env(packages/contracts/src/env.ts)**: `AMAZON_ADS_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _PROFILE_ID / _REGION`(日本=`fe`)。**Railway A2P-Worker にこの5つを設定すれば稼働開始**(コード追加不要)。
- **運営者の保留作業**: Amazon Advertising API アクセス申請(承認制)→LwAでClient ID/Secret→OAuth同意でrefresh token→profile ID取得。承認待ち中。承認後、OAuth手順はアシスタントが用意しrefresh token取得を支援する。

関連: [[project-kdp-sales]] [[project-home-dashboard]] [[reference-model-assignment-routing]]
