---
name: project_sns_reboot
description: 2026-09-02 SNS成長診断→全面リブート実装済み(栞統一/断言型/頻度2/日/同一タグ廃止/制作実録=一次情報化)。根拠と残タスク(手動リネーム・P3計測)
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-09-02T02:52:02.574Z
---

**2026-09-02 SNS全面リブート実装済み**(ユーザー承認「プラン実装して」)。診断: フォロワー不振の主因は投稿品質でなく
①スパム判定(X 7.4投稿/日×同一タグ198回→平均表示3.5・IG時間25件上限・TikTok spam_risk) ②5媒体5名のブランド分裂
③三次情報のみ ④計測なし。レポート artifact「栞 SNS成長診断」に競合検証20件とギャップ分析。

**実装内容**:
- 頻度: `promotion-content-generate.ts` VALUE_SLOTS 3→2/日(09/20時)＋promoter プロンプトで x_posts 最大3本/冊 → 計7.4→2〜3/日
- ハッシュタグ: strategy_json core を `#栞の本棚`(ブランドタグ)のみに。rotating は本文一致で付く(pickTopicHashtags は
  ROTATING_TAG_KEYWORDS 未登録タグでも body.includes でマッチ=コード変更不要)
- アイデンティティ: x/instagram/note の display_name/bio/concept を「栞（AI×出版レーベル）」に統一。架空経歴(元書店員等)廃止
- コンテンツ: content_pillars を競合勝ち型で全面書換 — X=断言型140字完結(精神科医Tomy型)+制作実録+問いかけ、
  IG=カルーセル1悩み解決6枚構成(週3-5)、note=制作実録週1+月次実数公開(無料7割/有料=完全版のみ)。
  競馬・ラノベ・古典の柱は凍結(お金・習慣・仕事術に集中)。example_post が few-shot の実体=ここが生成品質を決める
- playbook_json も全面書換(do_this/hook_formulas/posting_times/cta)
- 旧scheduled value は content.generate 再実行で自動置換。promoバックログは1日1本/chに間引くポリシー

**残タスク**: ①各プラットフォーム上の表示名/bio変更は**運営者の手動作業**(システムは投稿のみ制御) ②P3計測=IG/TikTok/note の
メトリクス取得実装+全chフォロワースナップショット+promo_daily_review有効化(コード変更要・未着手) ③TikTokはspam_risk解除と
API承認が先(投稿経路が死んでいる)。

**Why**: 実証値(週3×6ヶ月=IG1万人、Tomy断言型39万、けんご30秒型53万、note実録型)への最短接続。
**How to apply**: 投稿品質の調整は strategy_json.content_pillars[].example_post と playbook_json を書き換え→
`promotion.content.generate` を {channel,count,days} で再enqueue(旧scheduled valueは自動削除・promoは温存)。

関連: [[project_growth_autonomy]] [[project_promo_quality]] [[project_sns_engage_bot]]
