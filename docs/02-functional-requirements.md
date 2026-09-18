# 02. 機能要件

> 本ドキュメントは `functional-requirements` ハーネスエージェントが生成・更新する。
> 構造の指示は `.claude/agents/functional-requirements.md` を参照。
> 起点ドキュメント: `docs/01-business-requirements.md`（業務要件、確定済み）
> 後続: `docs/03-tech-selection.md`, `docs/04-ui-design.md`, `docs/05-program-design.md` 等が本ドキュメントの機能 ID を参照する。

---

## 0. 本ドキュメントの読み方

- 各機能には `F-001`, `F-002`, … の連番 ID を付与する。**後段で機能が削除されても ID は欠番として残し**、安定参照を維持する。
- 優先度: `P0` = MVP 必須 / `P1` = 同フェーズ内で重要だが代替手段あり / `P2` = 価値はあるが後送り可。
- 対応フェーズ: CLAUDE.md の Phased Roadmap に準拠（Phase 1=MVP / Phase 2=品質ループ / Phase 3=KDP 自動入稿 / Phase 4=他チャネル拡張）。
- 関連エージェント: ランタイムエージェント（Marketer / Writer / Editor / Thumbnail Designer / Quality Judge / Prompt Optimizer）のいずれか、または「N/A（インフラ/UI/ジョブ）」。

---

## 1. 機能一覧

### 1.1 ランタイムエージェント機能

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-001 | マーケター: テーマ候補生成 (Web Search 利用) | Marketer | P0 | Phase 1 |
| F-002 | マーケター: アカウント別の長期出版プラン提案 | Marketer | P1 | Phase 1 |
| F-003 | ライター: アウトライン（章立て）生成 | Writer | P0 | Phase 1 |
| F-004 | ライター: 本文章単位執筆 | Writer | P0 | Phase 1 |
| F-005 | エディター: 校閲・体裁統一 | Editor | P0 | Phase 1 |
| F-006 | サムネイルデザイナー: カバーテキスト案生成 | Thumbnail Designer | P0 | Phase 1 |
| F-007 | サムネイルデザイナー: カバー画像生成（OpenAI gpt-image-1） | Thumbnail Designer | P0 | Phase 1 |
| F-008 | クオリティジャッジ: 完成原稿スコアリング (0–100) | Quality Judge | P0 | Phase 2 |
| F-009 | プロンプトオプティマイザ: 10 冊ごとの改訂提案生成 | Prompt Optimizer | P0 | Phase 2 |

### 1.2 出版パイプライン・出力機能

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-010 | 書籍ジョブの作成・キック | N/A (Job) | P0 | Phase 1 |
| F-011 | 並列ジョブ実行（同時 3〜5 冊） | N/A (Job) | P0 | Phase 1 |
| F-012 | Word (.docx) 出力 | N/A (Output) | P0 | Phase 1 |
| F-013 | PDF 出力（@react-pdf/renderer） | N/A (Output) | P0 | Phase 1 |
| F-014 | カバー PNG 出力（KDP 寸法準拠） | N/A (Output) | P0 | Phase 1 |
| F-015 | 生成成果物の R2 永続化 | N/A (Storage) | P0 | Phase 1 |
| F-016 | パイプライン途中失敗時のリトライ・部分再開 | N/A (Job) | P1 | Phase 1 |

### 1.3 一括操作・承認 UI 機能

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-017 | テーマ候補のバルク採用/却下 | Marketer | P0 | Phase 1 |
| F-018 | アウトラインのバルク承認/差戻し | Writer | P0 | Phase 1 |
| F-019 | サムネ候補のバルク採用/再生成依頼 | Thumbnail Designer | P0 | Phase 1 |
| F-020 | KDP 入稿チェックリスト一括処理（Phase 1-2 は手動転記支援） | N/A (UI) | P1 | Phase 1 |
| F-021 | 夜間バッチ計画 UI（N 冊分の夜セット） | N/A (UI) | P0 | Phase 1 |

### 1.4 マルチプロバイダ・モデル管理

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-022 | 役割×ジャンル単位のモデル割当（model_assignments） | 全エージェント | P0 | Phase 1 |
| F-023 | UI からの役割別モデル切替（Anthropic / OpenAI / Gemini） | 全エージェント | P0 | Phase 1 |
| F-024 | モデル単価カタログの日次自動取得バッチ | N/A (Job) | P0 | Phase 1 |
| F-025 | モデル単価カタログのダッシュボード表示 | N/A (UI) | P0 | Phase 1 |
| F-026 | モデル切替前後のコスト/品質 A/B 比較ビュー | N/A (UI) | P1 | Phase 2 |
| F-051 | UI からの AI プロバイダ API キー設定・暗号化保存 | N/A (UI + Settings) | P0 | Phase 1 |
| F-052 | API キー接続テスト（プロバイダ models.list で疎通検証） | N/A (UI) | P0 | Phase 1 |

### 1.5 プロンプト管理機能

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-027 | DB ベースの動的プロンプトテンプレート（役割×ジャンル） | 全エージェント | P0 | Phase 1 |
| F-028 | プロンプトのバージョン履歴管理 | N/A | P0 | Phase 1 |
| F-029 | プロンプト改訂提案の運営者承認 UI | Prompt Optimizer | P0 | Phase 2 |
| F-030 | プロンプト自動承認ルール（5 冊連続スコア改善で自動採用） | Prompt Optimizer | P0 | Phase 2 |
| F-031 | プロンプト A/B 配信（バージョン併走） | 全エージェント | P1 | Phase 2 |

### 1.6 コスト・トークン監視

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-032 | 全 LLM/画像 API 呼び出しのトークン使用量記録 | N/A | P0 | Phase 1 |
| F-033 | 書籍 × プロバイダ × モデル粒度のコスト集計 | N/A | P0 | Phase 1 |
| F-034 | 1 冊あたり 500 円超過アラート | N/A | P0 | Phase 1 |
| F-035 | 月次コストダッシュボード（プロバイダ別/モデル別/役割別） | N/A | P0 | Phase 1 |
| F-036 | 月次コスト上限（5 万円）への到達予測アラート | N/A | P1 | Phase 1 |

### 1.7 売上・レビュー測定

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-037 | 売上・レビューの手動入力 UI | N/A | P0 | Phase 1 |
| F-038 | 売上・レビューの Amazon 自動取得 | N/A | P0 | Phase 2 |
| F-039 | 書籍別 KPI ダッシュボード（売上/順位/レビュー星） | N/A | P0 | Phase 1 |

### 1.8 KDP 入稿支援・自動化

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-040 | KDP 入稿用メタデータ（タイトル/紹介文/カテゴリ/キーワード）生成 | Marketer | P0 | Phase 1 |
| F-041 | KDP 自動入稿（Playwright、2FA は push-and-wait） | N/A (Worker) | P0 | Phase 3 |
| F-042 | KDP 入稿後の ASIN 取り込み・書籍メタ更新 | N/A | P0 | Phase 3 |

### 1.9 認証・運用基盤

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-043 | シングルユーザー認証（NextAuth Credentials、env パスワード） | N/A | P0 | Phase 1 |
| F-044 | KDP アカウント（ペンネーム）の登録・編集 | N/A | P0 | Phase 1 |
| F-045 | ジョブ実行ログの閲覧 UI | N/A | P1 | Phase 1 |
| F-046 | 失敗ジョブのリトライ操作 UI | N/A | P1 | Phase 1 |

### 1.10 将来拡張（Phase 4 以降）

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-047 | note 記事への変換・自動投稿 | Writer | P2 | Phase 4 |
| F-048 | 複数 KDP アカウント運用 | 全 | P2 | Phase 4 |

### 1.11 修正コメント・一括修正

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-049 | AI 出力への修正コメント記録 | N/A (UI) | P0 | Phase 1 |
| F-050 | 修正コメントの一括適用（ユーザートリガー） | Writer / Editor / Thumbnail Designer | P0 | Phase 1 |

### 1.12 販促・SNS 自動運用 / 生産の拡張（docs/05 販促付録・docs/07 準拠）

> 出版後の販促自動運用および生産パイプラインの拡張として後発で実装済み。ID は **docs/05「販促付録 F-052〜F-063」** の採番に従う（§1 本文の F 採番とは別系列。詳細仕様は docs/05・役割一覧は docs/07）。

| ID | 機能名 | 関連エージェント | 優先度 | フェーズ |
|---|---|---|---|---|
| F-001拡張 | テーマ生成のジャンルを 3→29 種に拡張（`packages/contracts/src/genres.ts` が単一真実源、エージェントには日本語ラベル `genreLabel` を注入） | Marketer | P1 | Phase 1 |
| F-007拡張 | カバー画像生成の既定モデルを `gpt-image-2` に切替（env `OPENAI_IMAGE_MODEL` で上書き可、日本語描画品質向上） | Thumbnail Designer | P1 | Phase 1 |
| F-058 | IG 販促画像をデザイン販促クリエイティブに刷新（実表紙＋帯コピー見出し＋KU 無料バッジ＋CTA、`composePromoCreative`） | N/A (Output) | P1 | Phase 2 |
| F-061 | SNS 投稿の日次自動見直し（`content_optimizer` が戦略chの直近 scheduled 投稿を非破壊で推敲、`promotion.review.daily` cron） | content_optimizer | P1 | Phase 2 |
| F-061前提 | 投稿失敗の人間可読化（`explainPromotionError` が生エラーを日本語見出し＋対処手順に翻訳、生ログは details 保持） | N/A (UI) | P1 | Phase 2 |
| F-062 | 週次コスト分析＋承認実行（`cost_optimizer` が直近30日を役割×モデルで集計し改善案＋推定削減額、安全・可逆な施策のみ承認実行、`cost.optimize.weekly` cron） | cost_optimizer | P1 | Phase 2 |
| F-063 | TikTok 投稿（Content Posting API 直叩き、多エージェント台本＋動画レンダ、アプリ内 OAuth 接続、下書き投稿） | tiktok_scenario/creator/editor/proofreader/marketer | P1 | Phase 2 |
| F-058拡張 | IG/TikTok 公開投稿を **Zernio(getlate) 中継**へ移行（`ZERNIO_API_KEY` があれば `defaultResolvePort` が IG/TikTok を Zernio 最優先。TikTok 自前APIは「個人/社内利用不可」で恒久却下されたため審査済みパートナー経由で公開。**IG・TikTok とも本番公開検証済み 2026-08-06**、TikTok は 9:16 mp4 を PUBLIC で公開。受入: `zernio post published` ログ＋`promotion_posts.status='posted'`） | N/A (Publish) | P1 | Phase 2 |
| F-060改善 | TikTok 動画のシーン数上限 `MAX_SCENES=6`（シーン数=gpt-image 生成回数。無制限だと 11シーン→約12分・高コスト。scenario/editor プロンプト指示＋コードでハード間引き、末尾CTA温存） | tiktok_scenario/editor | P1 | Phase 2 |
| F-064拡張 | SNS投稿を市場リサーチベースに（`promo_strategist`(web検索)の販促プレイブックを**生成器 promoter/content_creator の入力に接続**＝生成段階で反映。従来は後段optimizerのみ参照。`promotion.playbook.refresh` を週次cron化＝これまで未定期実行だった研究を鮮度維持） | promo_strategist/promoter/content_creator | P1 | Phase 2 |
| F-052/F-058 | 接続フォームの自動補完ガード（資格情報欄 read-only-until-focus）＋接続テストを手段別（x / tiktok / instagram / webhook）に整理（`probeChannelAuth`） | N/A (UI) | P1 | Phase 2 |
| F-072 | **販促「実績」トラッキング（2026-08-10）** — 投稿済みSNSの実エンゲージメント（impression/like/repost/reply）を取得し `promotion_posts` に保存。まず X（`GET /2/tweets?tweet.fields=public_metrics`, 保存済み tweet ID + OAuth1 で取得）。worker `promotion.metrics.fetch`（日次cron・常時ON）。**背景**: 従来は実測をどこにも保存しておらず、戦略(promo_analyst)は「投稿件数」しか見ておらず反応を最適化できなかった（＝実績なしで戦略盲目）。IG/TikTokは投稿ID未保存＋公式インサイト要のため後続。受入: X投稿の public_metrics が DB に反映される（APIプランが読み取り不可なら skip_reason 記録）。 | N/A (metrics) | P1 | Phase 2 |
| F-052改善 | **投稿量の抑制（質重視, 2026-08-10）** — 1書籍あたり SNS 投稿を先頭 `MAX_SNS_POSTS_PER_BOOK`(=3) に制限＋間隔を `SNS_INTERVAL_DAYS`(=2) に拡大。新規アカウントへの無闇な大量投稿(実測で各1日約16件・反応ゼロ)を是正。 | N/A (policy) | P1 | Phase 2 |
| F-073 | **SNSグロース（フォロワー育成）計測＋組織アラートループ（2026-08-12）** — 販促本部の自己監視。(1) `promotion.metrics.fetch` を拡張し **X `GET /2/users/me?user.fields=public_metrics`** でフォロワー数を日次スナップショット→ `promotion_growth_snapshots` に蓄積。(2) worker `org.promo.tick`（日次cron・常時ON、`0 16 * * *`＝JST 01:00, metrics.fetch の1h後）が実エンゲージメント要約(直近14日・平均インプレッション/いいね)＋フォロワー推移を **決定的に**評価し、`reach_critical`（サンプル≥10かつ平均インプレッション<50）/`growth_stalled`（スパン≥5日でフォロワー増減≤0）/`cold_start`（フォロワー<100）のいずれかで **promotion本部に `growth_alert`(needs_human) を1件起票＋LINEで運営者へプッシュ**。財務の `enforce_limit` と同型。**背景**: 反応ゼロを組織自身が検知して運営者にエスカレーションする神経系が販促に欠けていた（毎回運営者が指摘していた）。**実測(2026-08-12)**: X 直近100投稿の平均インプレッション=1・最大9・総いいね1＝到達ほぼゼロ（＝投稿の質でなく**到達/フォロワー不足**が根本）。ユーザー方針=「投稿だけでなく様々な方法でフォロワーを長期的に伸ばす」。**重複防止**: 開いている growth_alert があれば再起票しない。受入: 実測が危機水準のとき growth_alert が起票され LINE 通知が飛ぶ。 | S-018/019 | P1 | Phase 2 |
| F-079 | **本文品質: ページターナー執筆＋読者なりきりレビュー（2026-08-17, CONTENT-1）** — 運営者指摘「本文が読者を惹きつける内容になっていない／レビュアーが読者になり切ってレビューしていない」。実態: Writer は"明快・正確・構成"重視で"読み進めたくなる"指示が無く、Judge は6軸ルーブリック採点のみで読者体験を評価していなかった。**修正(DBプロンプトのみ・即時反映)**: (a) `writer` に「読み進めたくなる文章」節を追加（各節冒頭1〜2文で掴む/好奇心ギャップ/絵が浮かぶ具体/リズム/次への引き）。(b) `judge` に「あなたは"想定読者そのもの"として冒頭から読み、続きを読みたくなるか・退屈しないか・冒頭で掴まれるかを最優先で問う。退屈/説明的すぎ/フック弱は benefit_clarity・genre_fit を大きく減点し、overall に"どこで読む手が止まるか"を必ず書く」を追加。→ 退屈な原稿は低スコア化し既存のリビジョンループが改稿を促す。次回以降の生成に反映。 | N/A (prompt) | P2 | Phase 2 |
| F-078 | **戦略準拠の強化: 話題一致ハッシュタグ＋グロース使命（2026-08-17）** — 運営者指摘「戦略通りに投稿していない／これではフォロワーが増えない」。実態調査で、投稿は柱・トーンには沿うが**ハッシュタグが core 2個（#読書記録等）に固定**され、戦略の `rotating` 層（#貯金/#競馬/#話し方…）を全く使っていなかった＝競馬投稿が競馬層に一切リーチせず発見されない。**修正(a)**: `pickTopicHashtags(body, core, rotating)`（contracts）で **core常時＋本文の話題に合致する rotating タグ**を選び付与（キーワード辞書＋部分一致、X は重み内で採用）。`promotion.content.generate` に組込み。**修正(b) 使命の明示**: content_creator/content_optimizer/promoter の DBプロンプト冒頭に「唯一の使命＝フォロワーを増やす（伸びなければ失敗）／戦略厳密準拠／フォローしたくなる価値／想定読者に一点集中／冒頭フック」の mandate を注入。テスト付。 | S-018/019 | P2 | Phase 2 |
| F-089 | **CEO によるエージェントプロンプト改訂（会話起点）＋M2Pポータル刷新（2026-08-22）** — (a) 運営者要望「A2Pで入力した指示がしっかり通るようにしてほしい／CEOエージェントに他エージェントのプロンプト書き換え権限を持たせ、CEOとの会話だけで完結したい」。調査で判明した根因: 従来「追加指示」は戦略生成時に一度だけLLMへ渡り**永続保存されず**、日次生成・継続ループは凍結された `strategy_json` を読むのみで運営者方針が再反映されない（＝指示が効き続けない）。**対策=CEOチャット(`ceo_chat`)にプロンプト改訂能力を付与**: CEO出力に `prompt_edits[{role,instruction}]`(最大5) を追加 → worker `org.ceo.chat` が対象 role の現行 active プロンプトを取得し、新設 **`prompt_editor`** エージェントが**プレースホルダを厳守したまま最小改訂** → 旧版 archived＋新版 active＋`prompt_proposals`(auto_approved,decided_by=ceo,7日ロールバック)＋`AuditLog` を1トランザクションで適用 → CEOが「✅ content_creator を v5 に更新」と返信。**受入基準**: 運営者がCEOチャットで方針を伝える→対象roleのactiveプロンプトが新版に置換→以後の生成に反映→旧版保持でロールバック可→`{placeholder}` は全保持(欠落時は中止)→`ceo`/`ceo_chat`/`prompt_editor` 自身は改訂対象外(保護)→全変更が監査記録。(b) **M2PポータルUI全面刷新**: 淡色フラット→ダーク"管制室"ルック(オーロラ背景/ガラスパネル/ツールカードのホバーグロー)。公式ロゴ・ファビコン適用。**常設メニューバー新設**(ツール/経営ダッシュボード[全ツール横断P&Lの雛形]/設定)。ヒーロー文言を「"稼ぐ"をAIで自動化する」に刷新。ツールは別タブ表示。詳細は docs/10。 | S-org/S-002 | P1 | Phase 2 |
| F-088 | **M2Pポータル導線＋ホーム画面の実データ再実装（2026-08-20）** — (a) 運営者指摘「A2Pからツール選択ポータルへ戻る導線がない」。A2Pヘッダー右に **「M2Pポータル」リンク**（`LayoutGrid`アイコン、`NEXT_PUBLIC_PORTAL_URL`／未設定時 localhost:3002）を追加。プラットフォーム上位（apps/portal）へ戻れるように。(b) 運営指摘「ホーム画面が全然機能してない／必要な項目が揃っているか疑問」。従来 S-002 は Quality 以外プレースホルダだった → **運営者目線（儲かっているか/AI会社は動いているか/自分がやることは何か）で全面再実装**。当月純利益ヒーロー（黒字/赤字色分け）＋売上MoM＋コスト/予算＋出版累計＋品質、自律運用6トグルの現在ON/OFF＋現在の方針、進行中ジョブのライブ表示、要対応カード（実カウント＋実リンク、0件ミュート）、最近の本/パイプライン内訳/未読アラート、SNSフォロワー成長を実データ接続。詳細は docs/04 §S-002。(c) ヘッダー小修正3点: ①ヘッダー右の無反応「設定」プレースホルダを**実ユーザーメニュー**(username＋設定リンク＋**ログアウト**。従来アプリにログアウト導線が皆無だった)に置換(`components/layout/user-menu.tsx`＋`app/actions/auth.ts` logout server action)。②メニューの死にタブ「KDP自動入稿」(`enabled:false`・実ページ無し・認証ウォールで完全自動不可)を撤去。③サイドバー下部「実行中ジョブ」の常時"—"プレースホルダを実接続(`/api/jobs/running`を10秒ポーリングしrunning件数表示)。(d) 書籍ライブラリ小修正: ①ジャンルが全件「実用書」問題—表示バグではなく、テーマ生成が**アカウント既定ジャンル(practical)を全テーマに刻印**していたのが原因(内容と乖離: 競馬/小説/NISA等も practical化)。**全書籍の実タイトルをLLM分類し `theme_candidates.genre` を内容準拠へ振り直し**(106テーマ中100更新: gambling26/side_business13/lifestyle12/light_novel9/money8/self_help7/ai_tech6…)。表示は `genreLabel`(36ジャンル)フォールバックで対応済。②ライブラリ表の改行崩れ(アカウント/ジャンル/日時/コスト列)を `whitespace-nowrap`＋見出し折返し禁止＋`tabular-nums`で是正。③サムネ承認に1冊滞留=`status='thumbnail'`固着。真因は **export の public.jobs 行が `graphile_job_id=null`(worker未投入)** で判定停止していたため。exportをgraphileへ手動投入→done化→タブ空に。 | S-002/S-009 | P1 | Phase 2 |
| F-087 | **書籍パイプライン停止の復旧＋動画BGM/テロップ位置＋UI崩れ是正（2026-08-20）** — (a) **書籍が editor で停止**: 運営者指摘「進行が止まってる書籍がある」。調査で5冊が `pipeline.book.editor` で8日間停止。根因2つ: ①`model_assignments` の **editor/marketer が廃止済み `google/gemini-2.5-flash` を参照**(Google「新規ユーザー提供終了」)＝以前のGemini枠枯渇と同種のサイレント停止 → `anthropic/claude-sonnet-4-6` へ再割当。②editor出力の**JSONパース破綻**: モデルが本文引用に未エスケープの `"` を使い(例 `なぜ"かわいそう"という`)文字列が途中終端 → `packages/agents/src/editor` の JSON サニタイザに「文字列値内の未エスケープ`"`を復旧」(次の非空白が構造文字/終端の時だけ閉じ引用と判定)を追加。実際の失敗rawText3件で実証。→ 停止5冊を editor 再投入し復旧。※worker再起動時に app `jobs` が `running` のまま残り book_locks が孤児化して停止し続ける潜在課題あり(locks-sweep は graphile 側のみ)。(b) **TikTok/IGリール動画**: テロップが `placement:'bottom'`(Veoは y=h*0.66)で **TikTok/IGが投稿説明文・UIを重ねる下部と衝突** → スライド/Veoとも**上部セーフゾーンへ移動**。**BGM追加**: `video-render` に BGM ミックス(ffmpeg amix・音量0.12・ループ・fade)を実装。既定は権利クリーンな合成アンビエント(Cメジャードローン)、`PROMO_BGM_URL` で運営者提供のロイヤリティフリー曲に差し替え可、`PROMO_BGM_ENABLED='0'` で無効化。(c) **UI崩れ是正**: 全50画面・38テーブル監査。ヒートマップ桁溢れ(`formatJpyCompact`)、多列表の日時折れ(`whitespace-nowrap`)、`truncate`のtd直付け不具合(内側span化)、長文セルの`line-clamp`/`break-words`、数値列`tabular-nums`等を一括是正。 | S-017/018/019 | P2 | Phase 2 |
| F-086 | **KDPセッション切れ通知の連投防止＋通知の根本解決＋SNSコンテンツを一流マーケター多様化（2026-08-20）** — (a) 運営者指摘「『KDP売上取得: セッション切れを検知…』が頻繁に届く」。**調査結果**: 実データ上 `sales.fetch` は**既に完全に自己回復している**（session_expired→`refreshKdpSession` 自動再ログイン成功→DL成功→done。直近3週間 OTP 要求ゼロ＝デバイス信頼cookieで email/password のみ通過。sales_fetch_runs は全て done）。真のスパム源は `kdp.publish.status.sync`(6h) で、これは READ-ONLY 設計ゆえ**セッション切れを検知しても再ログインせず通知して諦めるだけ**だった（＋submitted→published 昇格が黙って停止）。**根本修正**: (1) `kdp.publish.status.sync` に **自己回復(自動再ログイン)を注入**(`refreshSession` DI: セッション切れ検知時に1度だけ `refreshKdpSession`(本棚着地・住宅proxyあれば経由)→新セッションでDBへ書き戻し＆同じ本を再読込して走査継続)。sales.fetch と同型に自己回復するため6h毎の切れ通知が消え、本棚同期も安定。(2) `sales.fetch` は自己回復が常態のため「検知/試みます」の**予告通知を廃止**し、**自己回復に失敗した時だけ**通知(＝人手が必要なときのみシステムが喋る)。(3) 予防線として `kdpSessionAlertGate()`(`app_settings.kdp_session_alert_at`基準・**24hに1回だけ通知**・判定不能時は安全側で通知)を残置し失敗通知に適用。→ 結論: セッションは自動再ログインで自己維持され**手動再取得は原則不要**(住宅IPプロキシは Amazon が CAPTCHA へエスカレートした場合の予備)。(b) 運営者指摘「投稿が本の宣伝ばかりでアカウント育成が見られない/一流マーケターが稼働してるか」。原因はF-080の是正が振れ過ぎ、content_creator v3で**全投稿が良書紹介=宣伝的な単調botに**なっていたこと。**修正**: content_creator **v4「一流SNSマーケター」** に刷新—共感/実用/エンゲージ誘発/人格/良書推薦の**多様な型を必ず散らし、本は3〜4投稿に1回(最大1/4)だけ・宣伝ではなく信頼できる推薦として**。few-shot例(x/ig/tiktok)も"本なし育成中心＋1つ良書推薦"に多様化。実測: 再生成でXは育成型中心＋読書ライフの人格が出る形に転換(前=全投稿本紹介)。Veo `durationSeconds` は数値必須(APIは文字列を400拒否)に修正。 | S-018/019 | P2 | Phase 2 |
| F-085 | **固定/従量原価の計上＋自動最新化（2026-08-20）** — 運営者指摘「計上コストにX API利用料が入っていない」。実態: `token_usage` は**AI従量のみ**で、X API・Zernio・Railway・LINE 等のサブスク/インフラ原価が未計上→黒字化判定が甘い。**修正**: `recurring_costs` テーブル(label/category/monthly_jpy/currency/amount_usd/auto_source/active)を追加し実費を計上。調査で判明した2026料金でseed: X API=従量($0.015/write,$0.005/read, Basic$200/月は6月廃止), Railway=Pro$20+従量($30見積), Zernio=最初の2アカウント無料(IG+TikTokで$0), LINE=¥0(200通/月無料)。**販促強化ループ(F-081)の損益計算を「売上 −(AI従量原価 + 固定費)」に修正**し /org・LINE に黒字/赤字を明示。**自動最新化** `recurring.cost.refresh`(月次 `0 20 1 * *`): `auto_source='fx'`=USD建てを最新FX(app_settings.latest_fx_rate)で再換算, `='x_usage'`=X API実使用量(当月のX投稿+フォロー/いいね数+検索回数)から月額推定, `=null`=手動固定。合計が10%以上動けばLINE通知。決定的な `estimateXMonthlyUsd` 等テスト付。 | S-org | P2 | Phase 2 |
| F-084 | **TikTok/IGリール動画: Veo 3.1ハイブリッド＋IGリール流用（2026-08-20）** — (a) **IGリール流用**: `promotion.video.generate` が生成したTikTok動画(mp4)を、同一 `media_key` で instagram の予約投稿(Reel)にも複製(2hずらし)。Zernio(getlate)ポートは動画メディア(.mp4)なら IG も `type:'video'`(Reel)で投稿。→ 1本の動画がTikTok＋IG両方に。(b) **Veo 3.1ハイブリッド(コスト最適)**: マスタスイッチ `video_use_veo_enabled`(既定OFF)ON時、動画の**冒頭フック(scene0)のみ Veo 3.1(fast既定)で実写級クリップ生成**、残りは従来の画像スライド(gpt-image+Ken Burns+テロップ+TTS)。運営者選択=ハイブリッド(1本≈$1-2)。Veoは Gemini API `predictLongRunning`(veo-3.1-fast/lite/standard, 9:16, 8秒)を非同期ポーリングで生成→R2。冒頭クリップは9:16クロップ＋ffmpeg drawtext(Noto Bold)テロップ＋TTS合成。Veo生成失敗時は画像スライドへ自動フォールバック。コストは token_usage(role='veo_video')に記録。`generateVeoClip`/`buildVeoHookPrompt`/`wrapCaption` はテスト付。 | S-018/019 | P2 | Phase 2 |
| F-083 | **手動グロースToDoのワンタップUI＋TikTok自動化の断念（2026-08-20）** — TikTok自動フォローを実地検証した結果、**TikTokはbot検知が極めて厳格**(ログインはCDP経由=実Chromeで解決できたが、headless Playwrightでの閲覧は中身空ページを返す/ステルス対策後も連続アクセスでブロック率が上昇、データセンターIPでは即ブロック＋アカウント凍結リスク)で、**信頼できる自動化は不可**と判断。方針: **IG/Xは自動、TikTok(＋note/IGの一部)は手動ToDoで確実に**。手動の作業コストを最小化するため、`growth_manual` ToDoを**ワンタップUI**に刷新: `result_json.actions` を「[✓済] ハンドル＋理由 [開く→]」の行で表示、「開く」がアプリで対象プロフィール/投稿を直接表示→フォロー/いいね→チェックで進捗保存(`result_json.completed` に永続、`toggleGrowthTarget` SA)。「残りをまとめて開く」も可。`resolveGrowthUrl`/`extractGrowthTargets` はテスト付。TikTok自動化のコード資産(CDP取り込み`scripts/sns-capture-cdp.mjs`＋channel対応port)は将来の住宅IPプロキシ運用に備え残置(既定では未使用=セッションをDB保存しないため bot は TikTok をスキップ)。 | S-org | P2 | Phase 2 |
| F-082 | **全社ToDo自動承認モード（滞留承認スイープ）（2026-08-19）** — `org_auto_approve_tasks`(既定ON)は従来「タスク起票時」だけ非人手kindを approved にしていたため、何らかの事情で `proposed` のまま残った ToDo が滞留し得た。本追加で **org.plan の各ティック冒頭に継続スイープ**を入れ、自動承認モードON時は滞留中の `proposed`（`create_account`/`growth_manual` 等の needs_human kind は除外）を一括 `approved` へ前進させる。これにより「提案中で止まる」ToDoが無くなり、AI組織が真に自走し続ける。UIトグル「ToDo 自動承認」（/org）で ON/OFF。決定的・best-effort（失敗しても計画本体は継続）。 | S-org | P2 | Phase 2 |
| F-081 | **販促強化の継続AIループ（2026-08-19）** — 運営者方針「必ず黒字化」。`org.promo.tick`(受動アラート)に対し、本ループは**能動的に販促を強化し続ける**。worker `promotion.growth.loop`（毎日 `0 21 * * *`=JST 06:00, マスタスイッチ `promo_growth_loop_enabled` 既定OFF）が実測を決定的に評価し、安全・可逆な強化アクションを **AIサブタスクの再起動**として自動実行: 予約価値投稿が薄い/到達が弱いチャンネル → `promotion.content.generate`（content_creator=AIで良書紹介を再生成）、プレイブックが陳腐化/到達が弱い → `promotion.playbook.refresh`（web_searchリサーチ更新）。エンゲージ engine がOFFなら**推奨のみ**（自動ONはせずキルスイッチ尊重）。実行内容＋「フォロワー/当月ロイヤリティ」の黒字化フレーミングを org_task(kind=`growth_loop`, approved) と LINE に記録。暴走防止: 1回上限（再生成5/リサーチ3）。決定的な `decideGrowthActions` はテスト付。 | S-018/019 | P2 | Phase 2 |
| F-080 | **良書紹介アカウントへのコンテンツ転換（2026-08-18）** — 運営者指摘「良本紹介アカウントとして育てる指示に反し、投稿が本に触れない一般論のまま」。原因は content_creator プロンプトの絶対ルール「本の売り込み・URLを入れない」が**本の紹介自体まで禁止**していたこと＋戦略 `strategy_json` の各柱 `example_post`（few-shot）が全て「本に触れないtips」で、few-shotがシステムプロンプトを上書きしていたこと。**修正**: (a) content_creator を **v3「読書案内人／目利きの書店員」** に刷新（毎投稿でフック→『書名』著者→刺さる中身→誰に効くか、実在の定番・名著のみ、ハルシネーション厳禁、他社の良書も歓迎、宣伝臭NG）。(b) X/IG/TikTok/note 全チャンネルの各柱 example_post を**実在の良書紹介の見本に全書換**（few-shotを意図に一致させた）。実測: 再生成でXの6/6投稿が実在良書（『反応しない練習』『GIVE&TAKE』『お金の大学』『優駿』等）を著者名付き・正しい帰属で紹介する形に転換したことを確認。プロンプトはDBのため即時反映（デプロイ不要）。 | S-018/019 | P2 | Phase 2 |
| F-097 | **SNS投稿へのキャラクター性注入（2026-09-18）** — 運営者要望「投稿もSNSのキャラクター性が出るように」。従来は tone_of_voice と発信の柱だけで、フォロワーが「同じ人が書いている」と感じる一貫した人柄が投稿に出ていなかった。**実装**: `AccountStrategyProfile`(F-057) に任意の `character_sheet`(人物設定。名前/一人称/口癖3〜5個/日常/好み/価値観/弱み/NG、600〜900字)を追加、既定ペルソナ「ことは」(20代・読書女子)を `DEFAULT_PERSONA_CHARACTER_SHEET` として定義。`content_creator`(育成投稿)・`promoter`(販促文=x_posts/note_article/blog_outline)・`anp.promo`(note記事告知)の生成時に「【キャラクター設定】」としてユーザーメッセージへ渡し、「毎投稿に人柄が出る要素(口癖・日常の一コマ・率直な感情・自分の失敗談のいずれか)を最低1つ入れる。ただし本の紹介・価値提供が主役で、自分語りは全体の2〜3割まで」を指示。各役割の DB アクティブプロンプトにも「## キャラクター性」節を追記した新版を投入(`packages/db/apply-character-sheet.ts`)。`content_optimizer`(日次見直し)にも同じキャラクター設定を渡し、本文に人柄の要素が無ければ自然に補う改善指示を追加。受入基準: strategy_json に character_sheet が無いチャンネルでも既定ペルソナで動作(フォールバック)、運営者がチャンネル別にキャラクターを上書き設定可能。 | S-018/019 | P2 | Phase 2 |
| F-094 | **BOOK☆WALKER サーバー自動入稿（2026-09-04）** — 出版パイプラインに「BOOK☆WALKER入稿」タブ (`/bookwalker`) を追加し、KDP入稿と同型のキュー運用で Railway ワーカーが自動申請する。章Markdown→EPUB3(販売用+試し読み)をその場生成、採用表紙→1600px JPG、著者センター /books/new を headless Playwright で申請（信頼済みクリック2段/キーワード100字制限/EPUB検証40秒待ち）。ログインは reCAPTCHA のためサーバー不可 — ローカル手動ログイン後 `bw-session-push.sh` で storageState を暗号化保存し再利用、失効時は自動入稿を停止して LINE 通知。受入基準: キュー登録→30分cron(bw.submit.dispatch)が1冊ずつ bw.submit 実行→成功で bw_publish_status=submitted+LINE通知、二重申請なし（申請済み/販売中は dispatcher と task の両方で除外）。 | S-015 系 | P2 | Phase 4 |
| F-095 | **楽天Kobo入稿（2026-09-07 完全自動出版 実装済）** — `/kobo`。KWL (rakutenkwl.kobo.com) を CDP アタッチ手動ログイン→セッション再利用で、`scripts/kobo/kwl-submit.mjs` が言語/紹介文/ジャンル(「一般」)/価格/表紙/出版まで全自動。可否は API status で判定（UI「必須項目です」は false-negative）。ドラフト削除不可のため別作品で上書き。89冊出版済。詳細=docs/05 §F-095/F-096。 | S-015 系 | P3 | Phase 4 |
| F-096 | **Booth入稿（2026-09-07 半自動=方針B 実装済）** — `/booth`。完全自動は作品ファイルUP不可（モーダル空+reCAPTCHA enterprise）と確認。`scripts/booth/booth-submit.mjs` が商品名/紹介文/タグ/価格/年齢制限/代理購入/**カテゴリ**の7項目を自動入力し下書き保存。運営者は作品ファイルUP+公開の2操作のみ。主力バッチ=`booth-batch-flagship.sh`。詳細=docs/05 §F-095/F-096。 | S-015 系 | P3 | Phase 4 |
| F-093 | **栞ストアフロントの独自ブランド化（favicon分離＋専用サブドメイン, 2026-08-27）** — 運営者指摘「①『栞の本棚』検索の着地が A2P ツールになる ②アイコンが出ない ③ツールのfaviconまで栞になった」。1ドメイン `a2p.m2p.tools` に公開ストアフロント(栞)と管理ツール(A2P)が同居する構成に起因。**修正**: (a) **favicon分離** — ルート/既定 `app/icon.png`=A2Pロゴ(ツール継承)、`/blog`・`/shop` セグメントのみ `app/{blog,shop}/icon.png`=栞。※罠: `public/icon.png`(静的)が `app/icon.png`(メタデータ規約)を同一 `/icon.png` で上書きするため public 側を削除。route group `(app)/icon.png` は URL 透過で `/icon.png` に化け衝突するため使わない。(b) **検索の着地を修正** — `/blog`・`/shop`・`/blog/[slug]` に self-canonical、sitemap からリダイレクトするルート `/` を除外し `/shop`・`/blog` を最上位に。(c) **専用サブドメイン `shiori.m2p.tools`** — `app/page.tsx` が host∈`STOREFRONT_HOSTS`(既定 shiori.m2p.tools)ならルート`/`→`/blog`(認証問わず)。`lib/site.ts` の `STOREFRONT_URL`(=`NEXT_PUBLIC_STOREFRONT_URL`||`NEXT_PUBLIC_SITE_URL`)を canonical/sitemap/robots に使用。運営者作業=Railwayに `shiori.m2p.tools` カスタムドメイン追加＋Cloudflareに CNAME(a2pと同 target `fejfqglp.up.railway.app`)＋解決確認後に env `NEXT_PUBLIC_STOREFRONT_URL` 設定(順番厳守: DNS解決前に設定するとcanonicalが死URL化)。Google のfavicon/URL反映は数日〜数週(Search Console再インデックスで短縮)。 | S-052b | P2 | Phase 2 |
| F-092 | **栞ブログの良書紹介に実在書籍の表紙画像を自動挿入（2026-08-27）** — 運営者指摘「ブログの『Book Review』プレースホルダに本の表紙画像をはめ込みたい」。従来は書影が無く装丁風の擬似カバー(PseudoCover)のみだった。**実装**: 新エージェント `book_cover`(`packages/agents/src/book-cover`)が記事の紹介対象書籍を同定し実表紙 URL を解決、`blog_posts.cover_image_url` に保存、一覧(`/blog`)・詳細(`/blog/[slug]`)で書影表示（自社本=R2書影優先、無ければ cover_image_url、それも無ければ PseudoCover）。**解決フロー(誤書影を絶対に出さない設計)**: ① LLM(sonnet-5)で書名/著者を同定 → ② 書名の中核(`coreTitle`=副題を落とした先頭塊。副題込みだと Amazon 商品名と字句が食い違い照合が外れる)で「中核 著者」を **Amazon 書籍検索**(`/s?k=&i=stripbooks`, `data-asin`抽出) → ③ **NDL(国会図書館)OpenSearch** の書名一致書誌の ISBN も**常に**候補に足す(Amazon が関連書しか返さない長い和書名の保険) → ④ 各 ASIN の **`/dp/<ASIN>` 実商品名を取得し、中核書名を包含するときだけ採用**(=Amazon 自身の商品名で本人確認。短い書名『優駿』等は著者名の裏取りも必須) → ⑤ その書影を byte サイズで実在検証(欠品~43byte除外)。**是正の経緯**: 初版は「LLM が推測した ISBN を openBD の負の検証だけで採用」したため、**openBD 未収録書で幻覚 ISBN が別の本(平家物語→「ヒーロー!」等)の書影を6/12件掴む事故**が発生（運営者「全然違う本になってる」）。ISBN 当てずっぽうを廃し「Amazon 検索で実在 ASIN → その商品名で本人確認」を核に全面刷新して解消（12/12 実書影を確認）。すべて**非致命**（特定不能は null → PseudoCover）。公開時に自動解決＋既存記事は一回性スクリプト `apps/worker/src/scripts/backfill-blog-covers.ts` でバックフィル。token_usage は `role='book_cover'` で記録。 | S-052b | P2 | Phase 2 |
| F-091 | **note ブラウザ自動フォロー & スキ（2026-08-27）** — note もフォロー/スキ(いいね)の公式APIが無いため、IG/TikTok の F-077 を忠実に踏襲した Playwright ブラウザ自動化を実装。worker `note.engage`（1日2回 `0 4,10 * * *`=JST 13/19時）が、`note_engage_enabled`(既定**ON**=キルスイッチ, note は IG/TikTok より制限が緩く凍結リスクが低いため既定ON) が有効かつ `NoteAccount.status='active'` かつ `session_state_enc` 有りの各アカウントで、`growth_scout`(channel=note) が web_search で特定した note 上の実在アカウント/記事を、復号セッション(＋住宅プロキシがあれば経由)で自動フォロー＆スキする。**動線**: follow=プロフィール(`https://note.com/<urlname>`)を開き「フォロー」ボタン押下（既済みは「フォロー中」判定→already）／like=記事URLを開き aria-label「スキ」ボタン押下（既済みは aria-pressed/「取り消す」判定→already）。見つからなければ failed=skip（落とさない）。**ガード**: マスタスイッチ＋**保守的ランプアップ**（follow `followDailyCap`: 初日3→5→8→巡航10, like `likeDailyCap`: 初日5→8→12→巡航15, note チャンネル全体の24h合算キャップ）＋1回上限(follow6/like10)＋ジッター(人間的な間6〜16秒)＋既存 `promotion_sns_engagements`(channel='note', action_type='follow'\|'like', target_handle 一意)で二重防止＋**セッション切れ/アクションブロック検知で即停止＆LINE通知**（検知したら他アカウントもその回は停止）。決定的な `followDailyCap`/`likeDailyCap`/`pickNoteTargets`＋オーケストレーションは純ロジックとして分離しテスト可能。記録テーブルは新設せず F-077 の `promotion_sns_engagements` を流用。 | S-018/019 | P2 | Phase 2 |
| F-077 | **IG/TikTok ブラウザ自動フォロー（2026-08-18）** — IG/TikTok はフォロー/いいねの公式APIが無い（F-075で手動ToDo化していた）。運営者が承認（凍結リスク受容）したため**Playwrightによるブラウザ自動フォロー**を実装。運営者がローカル(住宅IP)で一度ログインしたセッション(storageState)を **`scripts/sns-capture-session.mjs`** で取り込み→worker鍵で暗号化して `promotion_channel_settings.browser_session_enc` に保存。worker `promotion.sns.engage`（1日2回 `0 3,9 * * *`）が、`sns_engage_enabled`(既定OFF) ON かつセッション有りのチャンネルで、`growth_scout` が特定した実在アカウントを復号セッション＋(住宅プロキシがあれば経由し)フォローする。**ガード**: マスタスイッチ＋**保守的ランプアップ**（`dailyCap`: 初日5→8→12→巡航15, IG/TikTokはXより低い）＋1回最大4件＋ジッター＋`promotion_sns_engagements`(channel,action,handle 一意)で二重防止＋**アクションブロック/ログイン誘導検知で即停止＆LINE通知**（検知したら他チャンネルもその回は停止）。セレクタ `getByRole('button',{name:/フォロー|Follow/})` は実IGセッションで検証済み。決定的な `dailyCap`/`pickFollowTargets`＋オーケストレーションはテスト付。TikTokはセッション取り込み待ち（試行制限のためGoogleログイン推奨）。 | S-018/019 | P2 | Phase 2 |
| F-076 | **X 能動エンゲージメント自動化（2026-08-17）** — 「投稿だけ」ではフォロワーが増えないため、X公式API(OAuth1)で**ニッチ検索→いいね＋著者フォロー**を能動実行。`promotion.x.engage`（worker, 1日3回 `0 1,7,13 * * *`）が `GET /2/tweets/search/recent` で読書ニッチの投稿を発見→`POST /2/users/:id/likes`＋`POST /2/users/:id/following`。**ガード**: マスタスイッチ `x_engage_enabled`(既定OFF)＋**ランプアップ**（`dailyCap`: 初日8→数日で15→22→巡航30, 運営者選択「積極」）＋1回最大6件＋ジッター＋大手(>3万フォロワー)除外＋`promotion_x_engagements`(action_type,target_id 一意)で二重防止＋**429/403検知で即停止＆LINE通知**。実測: X APIは現行(有料)ティアで search/follow/like いずれも200で叩けることを確認済み。決定的な `dailyCap`/`pickCandidates` はテスト付。IG/TikTokは公式APIに該当機能が無く別途Playwright(F-077予定)。 | S-018/019 | P2 | Phase 2 |
| F-075 | **手動グロースToDo生成（2026-08-15）** — IG/TikTok/note は**フォロー/いいねの公式APIが無く自動化不可**。新エージェント `growth_scout`（web_search, anthropic/opus）が、チャンネルごとに**実在の・フォロー/いいね/コメントすべき具体ターゲット**（@ハンドル・投稿URL・理由・優先度）を特定し、worker `promotion.growth.todo`（週次 `0 22 * * 1`・常時ON）が **needs_human の org_task（kind=`growth_manual`、チャンネル別に1件を upsert=重複防止）** として起票＋**LINE要約通知**。`/org` タスクボードは指示を開いて全文チェックリスト表示（`<details>` 展開）。運営者は「誰をフォロー・どの投稿にいいね」を見て手で実行。決定的な整形（`formatGrowthTodo`）＋テスト付。`GrowthScoutOutput` 契約は `@a2p/contracts/agents/growth-scout`。 | S-018/019 | P2 | Phase 2 |
| F-074 | **（後続）フォロワー育成の実施施策** — GROW-2 コンテンツ・ミックス是正（宣伝ブラスト→価値投稿主役化・総量実効削減）／GROW-3 安全なエンゲージメント施策（自アカのエンゲージャーへのお礼リプ・メンション対応, ToS順守レート制限）／GROW-4 ターゲット・フォロー/価値リプ（ニッチ層へ少量・人間的レート, **バンリスク高につき運営者quota明示制**）。GROW-1(F-073)の計測を前提に効果測定しながら段階実行。 | S-018/019 | P2 | Phase 2 |

合計機能数: **52**（F-001〜F-050, F-051, F-052）＋販促付録 F-052〜F-063（docs/05 採番）。

---

## 2. 機能詳細

凡例:
- **目的** … 業務要件 (docs/01) の参照節
- **入力 / 処理 / 出力** … システムの振る舞い
- **受け入れ基準** … テスト可能な文（E2E/単体テストで検証）
- **関連エージェント** … ランタイムエージェントの分担

---

### F-001 マーケター: テーマ候補生成 (Web Search 利用)

- **目的**: §3.1 G1/G6, §5.2 のフロー入口。属人化していたテーマ選定を自動化する。
- **入力**:
  - `account_id`（ペンネーム）
  - 対象ジャンル（実用書/ビジネス書/自己啓発から 1 つ以上）
  - 生成希望数 N（既定 10、上限 30）
  - 既出版書籍リスト（重複回避用、自動引当）
- **処理**:
  1. Anthropic `web_search_20250305` で Amazon ランキング/関連語/競合本レビューを取得
  2. ジャンル×アカウントの長期プラン（F-002）と整合する切り口を抽出
  3. 各テーマ候補について「想定読者・差別化要素・想定売上シグナル・参考競合 ASIN」を生成
- **出力**: テーマ候補 N 件のリスト（DB の `theme_candidates` テーブルに永続化、UI で一覧表示）
- **受け入れ基準**:
  - 候補は必ず N 件以上生成され、各候補に競合書 1 冊以上の URL が紐付く
  - 過去 90 日に出版済みの書籍タイトルと完全一致するテーマは生成されない
  - Web Search 呼び出しは `token_usage` に記録され、書籍 ID 未確定段階では `theme_session_id` で集計される
- **関連エージェント**: Marketer

---

### F-002 マーケター: アカウント別の長期出版プラン提案

- **目的**: §3.1 G6（ペンネーム別の長期戦略）。
- **入力**: `account_id`、対象期間（既定 3 ヶ月）、目標冊数
- **処理**: アカウントの既出版実績・売上トレンド・ジャンル方針を踏まえ、月別のシリーズ展開案を生成
- **出力**: `publishing_plans` レコード（月別テーマカテゴリ、シリーズ名候補、推奨ペース）
- **受け入れ基準**:
  - 期間内の総冊数は目標値 ±20% に収まる
  - 既存シリーズがある場合、最低 1 つの続編候補を含む
- **関連エージェント**: Marketer

---

### F-003 ライター: アウトライン（章立て）生成

- **目的**: §4.1 工程 2、§5.2 W→C2。
- **入力**: 採用されたテーマ ID、想定文字数（**既定 120,000 字 ≒ 200〜300 ページ相当**、2026-08-25 引き上げ。旧既定 50,000 字）、ジャンル
- **処理**:
  1. `prompts` テーブルから「Writer × ジャンル」テンプレ最新版を取得（F-027）
  2. 章数（**既定 14、7〜18 章の範囲**、章あたり 8,000〜9,000 字程度。2026-08-25 引き上げ。旧既定 7–10章）と各章の見出し・要旨・想定文字数を生成
  3. **実用書系（非小説）**は「はじめに / おわりに」を必ず含める。**小説（genre=novel）は前付けを付けず**プロローグ/第1話など本文（物語）から始める（実際の Kindle 慣習に合わせる）
- **出力**: アウトライン JSON（章×小見出しの階層）、UI で承認/編集可能
- **受け入れ基準**:
  - 章合計の想定文字数が指示の ±15% に収まる
  - 各章には小見出しが最低 2 つ存在する
  - 運営者が UI で編集してから「承認」した時点で `outlines.status = approved` となる
- **関連エージェント**: Writer

---

### F-004 ライター: 本文章単位執筆

- **目的**: §1.2 工程 3、§4.1。
- **入力**: 承認済みアウトライン（7–10 章前提、章あたり 5,000–7,500 字）、ジャンル別文体ガイド、過去章テキスト（一貫性維持用）
- **処理**:
  1. 章単位でジョブを分割し、worker で並列実行
  2. 各章で `prompts` の最新 Writer テンプレを使用
  3. 直前章の要約をコンテキストに渡し、文体・登場概念を一貫させる
- **出力**: 章ごとの本文 Markdown、`chapters.body_md` に保存
- **受け入れ基準**:
  - 章ごとの実文字数が想定の ±20% に収まる（5,000 字想定なら 4,000–6,000 字）
  - 書籍全体の実文字数が 45,000–55,000 字レンジに収まる（許容 ±15%）
  - **文体はジャンル種別で分岐する**（下記）。同一書籍内で文体が混在しない
  - 章執筆 1 件あたりの token_usage が記録され、書籍 ID と紐づく
- **ジャンル種別による書き分け（2026-08-23 追加）**: ジャンルは「実用書系」と「小説・フィクション系」に分かれ、書き方を分岐する（判定 = `packages/contracts/src/genres.ts` の `FICTION_GENRES`/`isFiction`。対象 = novel / light_novel / mystery / sf_fantasy / romance_fiction / historical_novel / horror）。
  - **実用書系**: 従来どおり「ですます」調で統一。`##` 小見出し・箇条書き・章冒頭導入/章末まとめ等の実用書フォーマットで書く。
  - **小説・フィクション系**: **「だ・である」調**（会話文は自然な口語）で統一する。`##` 小見出し・箇条書き・「ポイント/まとめ」等の実用書フォーマットは使わない。アウトラインの subheadings は「場面(シーン)の流れ」の内部メモとして扱い、本文には見出しとして出さず地の文・描写・会話で一続きに繋ぐ。「はじめに/おわりに」は付けず物語本文から始める。説明・要約に逃げず、情景・心情・五感・比喩・省略・余韻で「見せる」、文学的で詩的な文章にする。文体・表現指針は `FICTION_STYLE_DIRECTIVE` が `{genre_guidance}` 経由で Writer/Editor/Judge の全プロンプトに注入される。Editor は小説の「だ・である」調をですます調へ書き換えず、実用書フォーマットへ変換しない。
- **関連エージェント**: Writer, Editor（文体の維持）, Judge（ジャンル文脈での評価）

---

### F-005 エディター: 校閲・体裁統一

- **目的**: §1.2 工程 4、§4.1。
- **入力**: 全章の本文 Markdown
- **処理**:
  1. 誤字脱字・表記ゆれ（漢字/かな・送り仮名）を統一
  2. 章間の論理矛盾、定義の不整合を検出・修正
  3. 「AI 生成コンテンツ開示」セクションを巻末に挿入（§7.1 KDP 規約）
- **出力**: 校閲後の本文 Markdown（`books.final_md`）、差分レポート
- **受け入れ基準**:
  - 表記ゆれ検出ツールでの再チェックで指摘 0 件
  - 巻末に AI 開示文が必ず含まれる
  - 差分が UI で diff 表示できる
- **関連エージェント**: Editor

---

### F-006 サムネイルデザイナー: カバーテキスト案生成

- **目的**: §4.1 工程 6。
- **入力**: 書籍タイトル、サブタイトル候補、ジャンル
- **処理**: ジャンル別の意匠原則に従い、表紙に載せるタイトル/サブタイトル/帯文の組み合わせを 3〜5 案生成
- **出力**: `cover_text_proposals` レコード
- **受け入れ基準**: 3 案以上が必ず生成される
- **関連エージェント**: Thumbnail Designer

---

### F-007 サムネイルデザイナー: カバー画像生成（OpenAI gpt-image-1）

- **目的**: §4.1 工程 6。
- **入力**: 採用されたカバーテキスト案、ジャンル別意匠スタイル、KDP 推奨寸法 (2560×1600px 既定)
- **処理**:
  1. ジャンル別の画像プロンプト（DB）を取得
  2. `gpt-image-1` で画像を生成（既定 1〜3 候補）
  3. R2 に保存し URL を `covers` に記録
- **出力**: カバー PNG ファイル URL（R2）、`covers` レコード
- **受け入れ基準**:
  - 出力 PNG が KDP 推奨寸法を満たす
  - 第三者著作物/実在人物が含まれない（プロンプトで禁止指定）
  - 画像生成 API コールが `token_usage` に「画像生成枚数 × 単価」で記録される
- **関連エージェント**: Thumbnail Designer

---

### F-008 クオリティジャッジ: 完成原稿スコアリング (0–100)

- **目的**: §4.1 工程 5、§6.1 品質 KPI。
- **入力**: 校閲後本文、アウトライン、テーマ情報
- **処理**:
  1. 「読者ベネフィット明確性」「論理整合性」「文体一貫性」「日本語自然さ」「タイトル整合性」「ジャンル適合性」の 6 軸で採点
  2. 合計スコア（重み付け平均、0–100）と軸別コメントを返す
  3. **80 未満なら自動的に F-004（再執筆）または F-005（再校閲）をリトリガ**（既定 2 回まで）
- **出力**: `eval_results` レコード（スコア、軸別コメント、判定）
- **受け入れ基準**:
  - スコアが必ず 0–100 範囲
  - スコア 80 未満で再実行が 1 回以上発火する
  - 再実行 2 回でも 80 未満の場合、書籍ステータスが `needs_human_review` になり運営者通知される
- **関連エージェント**: Quality Judge

---

### F-009 プロンプトオプティマイザ: 10 冊ごとの改訂提案生成

- **目的**: §3.1 G4、§5.2 PO→C4→DB。
- **入力**: 直近 10 冊分の `eval_results` + 売上・レビュー（F-038 取得後）
- **処理**:
  1. 役割×ジャンル単位でスコア低下傾向・売上低下傾向を分析
  2. 該当する `prompts` の改訂版を生成（差分 + 改訂意図のレポート）
  3. `prompt_proposals` に保存し、運営者承認 UI（F-029）に表示
- **出力**: `prompt_proposals` レコード（旧版 ID, 新版テキスト, 改訂意図, 期待効果）
- **受け入れ基準**:
  - 10 冊出版ごとに自動起動される
  - 提案には必ず「改訂前との差分」「期待効果（スコア/売上）」「サンプル出力 1 件」が添付される
- **関連エージェント**: Prompt Optimizer

---

### F-010 書籍ジョブの作成・キック

- **目的**: §5.2 全体オーケストレーション。
- **入力**: 採用テーマ ID（複数可）、希望完了日時、役割別モデル設定（既定値で省略可）
- **処理**: `books` レコード作成 → `graphile-worker` に Marketer→Writer→Editor→Thumbnail→QualityJudge の DAG をエンキュー
- **出力**: `books.id`、`jobs` レコード一式
- **受け入れ基準**:
  - 1 リクエストで N 冊同時にキックでき、N 冊分の `books` が生成される
  - 各書籍ジョブはステータス（queued/running/done/failed）を持つ
  - **重複制作ガード（2026-08-10, block-on-any）**: 同一 `theme_id` に既に `Book` が1冊でも存在する場合（取り下げ済 `retracted` を含む）は新規作成せず skip する（batch/自律運用org/手動の全経路で「1テーマ=1書籍」を保証）。取り下げ済テーマの作り直しは人間の明示操作に限る（自律運用が勝手に再制作しない）。背景・詳細は docs/05 §5.3.1 / docs/06。
- **関連エージェント**: N/A（オーケストレーション）

---

### F-011 並列ジョブ実行（同時 3〜5 冊）

- **目的**: §3.3 並列スループット、§後続申し送り 1。
- **入力**: graphile-worker の concurrency 設定（既定 5）
- **処理**: worker は最大 N 冊分のパイプラインを並列実行。冊内の章ジョブも `chapter_concurrency`（既定 4）で並列化。
- **出力**: 並列実行されるジョブ群
- **受け入れ基準**:
  - 5 冊同時キックで、5 冊分が同時に `running` ステータスとなる
  - 1 晩 (10 時間) で 3〜5 冊が `done` になる（E2E テストはモック LLM で実時間検証）
  - 1 冊あたり実時間が 8–12 時間の範囲内（実 LLM 利用時、KPI: §6.1）
- **関連エージェント**: N/A

---

### F-012 Word (.docx) 出力

- **目的**: §4.1 工程 7、KDP 入稿用ファイル。
- **入力**: 校閲後 Markdown、書籍メタ（タイトル/著者）
- **処理**: `docx` パッケージで章見出し・本文を構造化変換し、KDP 推奨スタイルを適用
- **出力**: `.docx` ファイル → R2 保存（F-015）
- **構成（ジャンル分岐, 2026-08-04）**: 実際の Kindle 慣習に合わせ、**実用書系は「はじめに → 目次 → 本文」**（はじめに章の後に目次を配置）、**小説（genre=novel）は目次を付けず本文から開始**。`buildDocx(book, chapters, { isNovel })`／`buildPdf(..., { isNovel })` に export タスクが `theme.genre==='novel'` を渡す。
- **受け入れ基準**:
  - 章見出しが Word の Heading1 スタイルで出力される
  - 実用書はページ番号・目次が生成される（目次は「はじめに」の後）／小説は目次を付けない
- **関連エージェント**: N/A

---

### F-013 PDF 出力（@react-pdf/renderer）

- **目的**: §4.1 工程 7、KDP ペーパーバック入稿用。
- **入力**: 校閲後 Markdown、書籍メタ
- **処理**: `@react-pdf/renderer` でレイアウト生成（KDP ペーパーバックの天地ノド/裁ち落とし考慮）
- **出力**: `.pdf` ファイル → R2 保存
- **受け入れ基準**:
  - PDF にページ番号・章扉が含まれる
  - サイズが KDP 標準サイズ（既定 A5）に一致
- **関連エージェント**: N/A

---

### F-014 カバー PNG 出力（KDP 寸法準拠）

- **目的**: §4.1 工程 7。
- **入力**: 採用されたカバー画像（F-007 出力）
- **処理**: KDP 推奨寸法（電子書籍は 2560×1600、ペーパーバックは別途）にリサイズ・トリム
- **出力**: `.png` ファイル → R2 保存
- **受け入れ基準**: 出力 PNG の解像度・寸法が KDP ガイドライン許容範囲内
- **関連エージェント**: N/A

---

### F-015 生成成果物の R2 永続化

- **目的**: §7.2 R2 利用。
- **入力**: docx/pdf/png/中間 Markdown 等
- **処理**: 書籍 ID をプレフィックスとした R2 オブジェクトキーで保存。署名付き URL で UI から閲覧
- **出力**: `artifacts` レコード（URL/key/byte_size/checksum）
- **受け入れ基準**:
  - 同一書籍の成果物が `s3://bucket/books/{book_id}/...` 配下に集約される
  - UI から各成果物をダウンロード可能
- **関連エージェント**: N/A

---

### F-016 パイプライン途中失敗時のリトライ・部分再開

- **目的**: §6.1 信頼性 KPI（成功率 95%）。
- **入力**: 失敗した `jobs.id`
- **処理**: 失敗ステップから再実行。Marketer→Writer→Editor の各ステップは中間成果物（DB）が残っていれば再利用
- **出力**: 再実行された jobs と更新された books ステータス
- **受け入れ基準**:
  - Editor が失敗しても Writer 出力は破棄されない
  - 自動リトライは既定 3 回まで（指数バックオフ）。それ以上は人手承認待ち
- **関連エージェント**: N/A

---

### F-017 テーマ候補のバルク採用/却下

- **目的**: §3.3「N 冊一括操作」、§4.1 工程 1。
- **入力**: `theme_candidates.id` の配列、操作（accept/reject）
- **処理**: チェックボックスで複数選択 → 一括ステータス更新。accept 時は F-010 へ自動引き継ぎ可能
- **出力**: ステータス更新済みレコード、accept なら books ジョブ生成
- **受け入れ基準**:
  - 1 操作で 20 件以上を一括処理できる
  - accept 時に F-010 が連動起動するオプションがある
- **関連エージェント**: Marketer

---

### F-018 アウトラインのバルク承認/差戻し

- **目的**: §3.3、§4.1 工程 2。
- **入力**: `outlines.id` 配列、操作（approve/reject）
- **処理**: 一括承認は `outlines.status = approved` に。差戻しはコメント付きで Writer 再実行
- **出力**: ステータス更新、差戻し時は Writer ジョブ再キック
- **受け入れ基準**:
  - 1 操作で複数アウトラインの承認/差戻しが可能
  - 差戻し時のコメントが Writer のリトライプロンプトに含まれる
- **関連エージェント**: Writer

---

### F-019 サムネ候補のバルク採用/再生成依頼

- **目的**: §3.3、§4.1 工程 6。
- **入力**: `covers.id` 配列、操作（adopt/regenerate）
- **処理**: 採用すると `covers.status = adopted`、再生成は F-007 を別パラメータで再実行
- **出力**: ステータス更新、再生成時は Thumbnail ジョブ再キック
- **受け入れ基準**:
  - 候補をサムネイル一覧グリッドから複数選択して一括採用できる
- **関連エージェント**: Thumbnail Designer

---

### F-020 KDP 入稿チェックリスト一括処理（Phase 1-2 は手動転記支援）

- **目的**: §4.1 工程 8 を Phase 1-2 では手動運用するための支援。
- **入力**: 入稿対象 `books.id` 配列
- **処理**: 書籍ごとに KDP 入稿に必要な項目（タイトル/紹介文/カテゴリ/キーワード/価格/カバー URL/本文 URL）をテーブル表示。コピーボタン・チェックボックスで進捗管理。
- **出力**: `kdp_submission_progress` レコード（手動チェック状態）
- **受け入れ基準**: 各書籍のチェック状態が永続化され、ブラウザリロード後も残る
- **関連エージェント**: N/A

---

### F-021 夜間バッチ計画 UI（N 冊分の夜セット）

- **目的**: §2.2 利用シーン、§3.3「夜セット→朝完成」。
- **入力**: 採用テーマ N 件、開始予定時刻、希望並列度
- **処理**: 計画を `batch_plans` に保存し、開始時刻にスケジューラが F-010 を一括起動
- **出力**: バッチ計画レコード、実行後は冊単位の進捗
- **受け入れ基準**:
  - 計画作成時に「予測コスト合計」「予測完了時刻」が表示される
  - 開始時刻に実行が始まり、5 冊なら 5 並列で起動する
- **関連エージェント**: N/A

---

### F-022 役割×ジャンル単位のモデル割当（model_assignments）

- **目的**: §3.3 マルチプロバイダ対応、§後続申し送り 2。
- **入力**: 役割（writer/editor/marketer/judge/thumbnail/optimizer）、ジャンル（任意）、プロバイダ、モデル名
- **処理**: `model_assignments` にレコード保存。ランタイムは「役割＋ジャンル」キーで最新割当を引く
- **出力**: 設定レコード
- **受け入れ基準**:
  - ジャンル指定がない場合は role のみで引かれる（デフォルト割当）
  - 履歴が残り、過去の割当に戻せる
- **関連エージェント**: 全エージェント

---

### F-023 UI からの役割別モデル切替（Anthropic / OpenAI / Gemini）

- **目的**: §3.3、§後続申し送り 2。
- **入力**: モデルカタログ（F-024 取得済み）からの選択
- **処理**: ドロップダウンで役割×ジャンル×モデルを選択 → F-022 に保存。即時反映、以降のジョブから新モデルを使用
- **出力**: UI 反映と DB 保存
- **受け入れ基準**:
  - Anthropic / OpenAI / Gemini の全モデルが選択肢に並ぶ
  - 切替直後に「次回ジョブから適用されます」と明示される
  - 進行中ジョブは旧モデルで完走する
- **関連エージェント**: 全エージェント

---

### F-024 モデル単価カタログの日次自動取得バッチ

- **目的**: §3.3、§後続申し送り 3。
- **入力**: 各プロバイダの API/公式ページ
- **処理**:
  1. 毎日 04:00 JST に worker でバッチ起動
  2. Anthropic / OpenAI / Gemini それぞれの最新モデル一覧と入力/出力トークン単価を取得
  3. `model_catalog` に upsert（差分があれば履歴を残す）
  4. 単価変動が ±10% を超えた場合は通知
- **出力**: `model_catalog` レコード（provider, model, input_price_per_1k, output_price_per_1k, fetched_at, source）
- **受け入れ基準**:
  - 1 日 1 回のバッチが成功する
  - 取得失敗時にリトライ 3 回、それでも失敗なら運営者通知
  - 単価が CSV エクスポート可能
- **関連エージェント**: N/A

---

### F-025 モデル単価カタログのダッシュボード表示

- **目的**: §3.3、§後続申し送り 3。
- **入力**: `model_catalog`
- **処理**: プロバイダ別にテーブル表示。1 冊あたり予測コスト（入力 5,000 トークン × 出力 30,000 トークン想定）を併記
- **出力**: ダッシュボード UI
- **受け入れ基準**:
  - 全モデルの入出力単価が一覧できる
  - 並び替え（単価昇順/降順）、フィルタ（プロバイダ別）が可能
- **関連エージェント**: N/A

---

### F-026 モデル切替前後のコスト/品質 A/B 比較ビュー

- **目的**: §3.3「変更前後のコスト/品質差を比較できるダッシュボード」。
- **入力**: 期間 A・期間 B（モデル切替日を境界に自動分割可）、対象役割
- **処理**: 期間 A/B の平均 Quality Judge スコア、平均コスト、平均リードタイム、売上中央値を並列表示
- **出力**: 比較レポート UI
- **受け入れ基準**:
  - 期間 A/B に最低 5 冊以上含まれる場合のみ統計表示（少数時は注意メッセージ）
- **関連エージェント**: N/A

---

### F-027 DB ベースの動的プロンプトテンプレート（役割×ジャンル）

- **目的**: §4.3、§CLAUDE.md Hard Rule 4、§後続申し送り 6。
- **入力**: 役割、ジャンル
- **処理**: `prompts` テーブルから `role + genre + status=active` の最新バージョンを取得しエージェントの system prompt として渡す。プレースホルダ（{title}, {chapter_outline} 等）に動的バインド
- **出力**: 組み立て済みプロンプト文字列（ランタイム）
- **受け入れ基準**:
  - 同一役割×ジャンルに対し 1 つの active バージョンが存在する
  - active が無い場合はジャンル fallback → 役割 default の順で取得
- **関連エージェント**: 全エージェント

---

### F-028 プロンプトのバージョン履歴管理

- **目的**: §4.3、§後続申し送り 6。
- **入力**: 新プロンプト本文
- **処理**: `prompts` テーブルに新バージョンを追加（旧版は `status=archived`）。各バージョンに `created_by`（human/optimizer）、`activated_at` を記録
- **出力**: 履歴レコード
- **受け入れ基準**:
  - 全バージョンが時系列で UI 閲覧可能
  - 任意の旧バージョンを 1 クリックで active に戻せる
- **関連エージェント**: N/A

---

### F-029 プロンプト改訂提案の運営者承認 UI

- **目的**: §4.1 工程 10、§後続申し送り 6。
- **入力**: `prompt_proposals` レコード
- **処理**: 旧版 vs 提案の diff、改訂意図、期待効果、サンプル出力を表示。「承認」「却下」「編集して承認」ボタン
- **出力**: 承認なら `prompts` 新バージョン作成 + activate、却下なら proposal をクローズ
- **受け入れ基準**:
  - 承認操作 1 クリックでバージョン切替が完了する
  - 却下時にコメントを残せる（次回 Optimizer のヒントに使用）
- **関連エージェント**: Prompt Optimizer

---

### F-030 プロンプト自動承認ルール（5 冊連続スコア改善で自動採用）

- **目的**: §6.1 「自動学習」KPI、§後続申し送り 6。
- **入力**: `eval_results` の時系列、active プロンプトバージョン
- **処理**:
  1. プロンプト改訂後の直近 5 冊について Quality Judge スコアが旧版同条件比較で連続改善しているか判定
  2. 条件成立 → 自動承認（運営者には通知のみ、却下用 24 時間猶予）
  3. 条件不成立 → F-029 の手動承認待ち継続
- **出力**: 自動承認イベントと通知
- **受け入れ基準**:
  - 5 冊連続改善が観測された時のみ自動承認される
  - 24 時間以内に運営者が「ロールバック」操作可能
  - 自動承認/手動承認のいずれかは設定で切替可能（既定: 手動）
- **関連エージェント**: Prompt Optimizer

---

### F-031 プロンプト A/B 配信（バージョン併走）

- **目的**: Optimizer の効果検証高速化（Phase 2）。
- **入力**: 旧版 ID, 新版 ID, 配信比率（既定 50/50）
- **処理**: 次の N 冊について書籍ごとに乱数でどちらかを採用。`books.prompt_version_id` に記録
- **出力**: A/B 配信結果と Quality Judge スコア統計
- **受け入れ基準**: 最低 10 冊蓄積後に統計検定（簡易）の結果を表示
- **関連エージェント**: 全エージェント

---

### F-032 全 LLM/画像 API 呼び出しのトークン使用量記録

- **目的**: §CLAUDE.md Hard Rule 5、§後続申し送り 5。
- **入力**: API 呼び出しの入出力トークン、モデル、書籍 ID、役割
- **処理**: 呼び出しごとに `token_usage` へ INSERT。単価はその時点の `model_catalog` snapshot を保存（後の単価変動に左右されない）
- **出力**: `token_usage` レコード（`book_id`, `provider`, `model`, `role`, `input_tokens`, `output_tokens`, `image_count`, `unit_price_snapshot`, `cost_jpy`, `created_at`）
- **受け入れ基準**:
  - LLM 呼び出しが行われた直後に必ず 1 行追加される
  - book_id が未確定（テーマ生成段階等）でも `theme_session_id` などで集計できる
- **関連エージェント**: 全エージェント

---

### F-033 書籍 × プロバイダ × モデル粒度のコスト集計

- **目的**: §後続申し送り 5。
- **入力**: `token_usage`
- **処理**: 書籍 ID をキーに provider×model 別に SUM(cost_jpy) を集計。役割別/フェーズ別の内訳も保持
- **出力**: 書籍詳細画面のコスト内訳テーブル
- **受け入れ基準**:
  - 内訳合計が `token_usage` 直集計と一致する
  - 1 秒以内に集計結果が返る（インデックス利用）
- **関連エージェント**: N/A

---

### F-034 1 冊あたり 500 円超過アラート

- **目的**: §6.1 「1 冊あたり AI コスト 500 円以内」、§7.3、§後続申し送り 5。
- **入力**: 書籍進行中の累積 `token_usage.cost_jpy`
- **処理**: 各ジョブステップ完了時に閾値判定。500 円到達で運営者通知（UI バッジ + email/Push）、750 円到達でジョブを一時停止し承認待ち
- **出力**: 通知 + `books.cost_status` 更新
- **受け入れ基準**:
  - 500 円到達 1 分以内に通知が UI に出る
  - 750 円到達でジョブ停止 → 運営者が UI で「続行」または「中止」を選べる
- **関連エージェント**: N/A

---

### F-035 月次コストダッシュボード（プロバイダ別/モデル別/役割別）

- **目的**: §6.1、§後続申し送り 5。
- **入力**: 期間
- **処理**: 期間内 `token_usage` を集計し、プロバイダ別/モデル別/役割別の積み上げグラフと表を表示
- **出力**: ダッシュボード UI
- **受け入れ基準**:
  - 月次合計と冊数が表示される
  - CSV エクスポート可
- **関連エージェント**: N/A

---

### F-036 月次コスト上限（5 万円）への到達予測アラート

- **目的**: §7.3 月上限 5 万円。
- **入力**: 月初〜現在のコスト、残日数
- **処理**: 単純線形外挿で月末予測コストを算出。80% (4 万円) 到達でイエロー（予測警告）、95% (4.75 万円) 到達でオレンジ（停止検討アラート、運営者の判断を促す）、100% (5 万円) 到達でレッド通知。レッド時は新規ジョブキック不可（運営者強制続行で解除）
- **出力**: 通知 + ジョブキック制限フラグ
- **受け入れ基準**:
  - 月末予測が 40,000 円超で警告通知
  - 月末予測が 47,500 円超で停止検討アラート（運営者承認なしに次回バッチ計画は自動でホールド）
  - 月内実績が 50,000 円超でジョブ作成 API がエラー応答
- **関連エージェント**: N/A

---

### F-037 売上・レビューの手動入力 UI

- **目的**: §4.1 工程 9（Phase 1 手動）。
- **入力**: 書籍 ID、月、売上金額、レビュー件数、平均星
- **処理**: `sales_records` に保存
- **出力**: 月次レコード
- **受け入れ基準**: 1 書籍×1 ヶ月で 1 レコード。再入力で上書き
- **関連エージェント**: N/A

---

### F-038 売上・レビューの Amazon 自動取得

- **目的**: §4.1 工程 9（Phase 2 自動）。
- **入力**: KDP アカウント認証情報、対象 ASIN リスト
- **処理**: Playwright で KDP レポート画面・Amazon 公開ページから売上/順位/レビューを取得し `sales_records` 更新
- **出力**: 自動更新された `sales_records`
- **受け入れ基準**:
  - 日次で自動実行される
  - 2FA 発生時は push-and-wait で運営者承認を待つ
- **関連エージェント**: N/A
- **追加実装 [実装済み] サーバー完結の自動再ログイン (LINE OTP 中継)**: 保存済みセッション
  (`accounts.kdp_session_state_enc`) が失効し `session_expired` になった場合、`env AMAZON_EMAIL`/
  `AMAZON_PASSWORD` と LINE 双方向認証リレー (`LINE_CHANNEL_ACCESS_TOKEN`/`LINE_ALLOWED_USER_ID`、
  F-041 と共通) が設定済みなら、worker がヘッドレスで Amazon/KDP に再ログインし新セッションを
  保存 → レポート DL を再試行する（人手を介さずサーバー側だけで復旧）。2 段階認証コードは
  `kdp_auth_requests` 経由で運営者の LINE に中継し、運営者は 6 桁コードを返信するだけでよい。
  タイムアウトやコード不正時は最大 3 回まで再送してリトライする。
  **アカウント選択タイル通過**: `max_auth_age=0` の再認証は「アカウントの切り替え」画面から始まるため、
  保存メール一致のタイルをクリックしてパスワード画面へ進める（`clickAccountTile`）。
  **CAPTCHA 判定**: 可視要素 (`CAPTCHA_SELECTOR`) でのみ検知する。通常サインインの隠しマークアップに
  "captcha" 文字列が含まれ、HTML 文字列一致だと誤検知してパスワード段階に進めないため。
  **2026-08-01 の重要な発覚（上流訂正）**: 「データセンター IP からのログインは CAPTCHA で不可」という
  旧記述は **誤りだった**。実際の主因は **`AMAZON_PASSWORD` env が古い値（末尾記号欠落）** で、
  パスワード不一致→3 回失敗→パズル CAPTCHA という連鎖だった。**正しいパスワードなら Railway の
  データセンター IP のままログイン→OTP→本棚到達まで完走する**（2026-08-01 実証: sales.fetch が
  データセンター IP 直結で成功）。したがって **住宅 IP プロキシは必須ではない**（任意の補強に降格）。
  `AMAZON_EMAIL`/`AMAZON_PASSWORD` または LINE 中継が未設定の場合は本機能を一切実行せず、従来通り
  `session_expired` で失敗し手動対応を促す（後方互換）。

---

### F-039 書籍別 KPI ダッシュボード（売上/順位/レビュー星）

- **目的**: §6.2。
- **入力**: `sales_records`、`eval_results`、`token_usage`
- **処理**: 書籍ごとに「累計売上 / 累計コスト / Quality スコア / 平均星」を一覧表示。フィルタ（アカウント別/ジャンル別/期間別）
- **出力**: ダッシュボード UI
- **可視化 (2026-08-04 改修)**:
  - **売上推移チャート**: 月次積み上げ棒を **全ジャンル動的**（売上合計の多い順・ジャンル別色）に。旧実装は practical/business/self_help の 3 種固定で、競馬(gambling)/小説(novel)/money 等を全て practical に潰していた不具合を解消（`buildTrendChartFromAggregates` は segments=全ジャンル内訳を返す。トレンドとヒートマップは同じジャンル順・色 `genreColorMap`）。
  - **分析サマリ (SalesInsights)**: 既存 KPI に加え **直近月売上・前月比(MoM)・黒字(ROI>0)冊数・売上ゼロ冊数・売れ筋Top5・ジャンル別売上構成(%)** を表示（`buildSalesInsights`）。
  - **レイアウト**: 売上推移チャートとジャンル×月ヒートマップは、横並び 2 カラムをやめ **各横幅いっぱいで縦積み**（データ量が増えると横並びだと双方が窮屈になるため）。
  - **書籍別サムネ実画像表示**: KPI テーブルのサムネ列はプレースホルダ文字ではなく **採用カバーの実画像**を表示する。book_id しか手元に無いため配信ルート `GET /api/books/[id]/thumbnail`（採用カバー `covers.status='adopted'` の最新 r2_key を解決 → 15 分署名付き URL へ 302、認証必須・Cookie 前提の素の `<img>` で参照）を新設。
- **受け入れ基準**: 100 冊規模でも 2 秒以内に一覧表示。売上のある全ジャンルがチャート/ヒートマップ/構成比に表示される。採用カバーのある書籍はサムネ列に実画像が出る。
- **関連エージェント**: N/A

---

### F-040 KDP 入稿用メタデータ生成

- **目的**: §4.1 工程 8。
- **入力**: 完成書籍（タイトル/本文/カバー）
- **処理**: 紹介文・カテゴリ（KDP の 2 カテゴリ）・検索キーワード（7 個まで）・価格を生成
- **出力**: `kdp_metadata` レコード
- **受け入れ基準**:
  - 紹介文の文字数が KDP 上限内
  - 検索キーワードが 7 個以下
  - カテゴリは KDP 公式カテゴリツリーから選択される
- **関連エージェント**: Marketer

---

### F-041 KDP 自動入稿（入稿キュー登録 + ローカルアシスト出版ツール）

- **目的**: §4.1 工程 8。
- **キュー登録の対象外 (2026-09-16 修正)**: `publish_status` が `submitted`（入稿済み・KDP 審査中）または `published` の本は、
  「自動入稿キューに登録」「準備完了の本をまとめて入稿キューに登録」のどちらでも対象外（blocked 理由「既に入稿済み」）。
  従来は `submitted` が除外されておらず、一括登録で審査中の本まで再キューされ二重入稿の原因になっていた。
- **設計変更 [実装済み]**: 当初案 (Playwright 無人ジョブ + push-and-wait 2FA) は、Amazon KDP が
  入稿の都度インタラクティブな 2FA 再認証を要求するため実現不能と判断し不採用。代わりに
  Web UI の「自動入稿」ボタンは `books.kdp_publish_queued` を立てるだけの**キュー登録**を行い、
  実際の入稿はローカルのアシスト出版ツール (`scripts/kdp-publish.mjs`、運営者が対話的に
  ログインしながら実行) がキューを拾って行う。以下は当初案として記録のみ残す。
- **LINE 双方向認証リレー [実装済み]**: ローカルツールが再ログイン/OTP 入力を求められると
  `kdp_auth_requests` に pending 行を作り LINE push で運営者に通知する。運営者は LINE アプリに
  6 桁コードを返信するだけでよく、`POST /api/line/webhook` (Web 側) が署名検証のうえコードを
  受信して当該行に書き戻し、ローカルツールがポーリングして Amazon の入力欄へ自動入力する
  (メール承認画面を開く手間がなく、スマホ操作のみで完結)。
- **サーバー側自動入稿 [Phase 3, 2026-08-01 設計確定・実装] — `kdp.submit` worker タスク**:
  当初「入稿の都度 2FA 再認証を要求されるためサーバー無人化は不能」としていたが、F-038 の
  実証（2026-08-01）で **Railway のデータセンター IP から `max_auth_age=0` 再認証を
  正パスワード＋2 段階認証で通過できる**ことが判明したため、**サーバー側での自動入稿を実装する**。
  - **ブラウザ**: worker がヘッドレス Playwright で KDP を操作（`scripts/kdp-publish.mjs` の実証済
    ウィザードロジックを worker へ移植）。IP は既定 **Railway データセンター IP 直結**（住宅 IP
    プロキシは任意の補強で必須ではない — F-038 の訂正参照）。
  - **セッション**: `accounts.kdp_session_state_enc` を再利用。失効時は `refreshKdpSession`
    （F-038 と共通）で再ログインし新セッションを保存。
  - **2 段階認証（無人化の要）**: env `AMAZON_TOTP_SECRET`（Amazon 認証アプリの TOTP シード）が
    設定されていれば worker が **6 桁コードをサーバー生成**して自動入力する（完全無人）。未設定なら
    従来の **LINE 双方向認証リレー**にフォールバック（運営者が LINE で 6 桁返信）。
  - **作成上限の回避**: KDP の「1 日 5 冊」制限は**新規作成フロー**のみ消費する。既存の残置下書きを
    **resume して上書き**する方式（`scripts/kdp-publish.mjs --auto` と同じ）を用い、上限を消費せず入稿する。
    残置下書きが無く新規作成が必要で上限到達時は `blocked: creation_limit` として当該ジョブを保留し翌日再試行。
    **ペーパーバックはこの枠を共有しない（2026-09-09 実測）**: 同一 JST 日に Kindle 新規 CREATE 5 冊を出版した直後に
    ペーパーバック下書きを 10 冊作成しても `creation_limit` は一度も発生しなかった（計 15 件）。したがって
    **Kindle の新作出版とペーパーバック展開は同日に並行して実施してよい**（従来の「1 日 5 冊枠を共有」という
    運用前提は誤り）。上限のリセットは JST 深夜 0 時。詳細と証跡は `docs/05` §5.3.15b。
  - **ファイル**: 原稿 docx（`artifacts.kind='docx'`）・表紙（`covers` adopted）を R2 から取得してアップロード。
  - **自動運用**: `AppSettings.kdp_auto_submit_enabled=true` のとき dispatcher が `kdp_publish_queued=true`
    の本を `kdp.submit` へ enqueue（`org.kdp.screen` 合格→queue と連携）。監査用スクショは R2 に保存。
  - **【重要バグ修正 2026-08-12】screen→queue 連携の欠落**: 上記「合格→queue 連携」は仕様上あるべきだったが
    **実装が欠落**しており、`org.kdp.screen` は publish_kdp タスクを `approved` にするだけで
    `books.kdp_publish_queued` を一度も立てていなかった。結果、`kdp_auto_submit_enabled`/`org_kdp_auto_publish_enabled`
    が両方 ON でも dispatcher は対象ゼロ→**自動入稿が14日以上完全停止**（＝出版完了通知も来ない共通原因）。
    修正: `org.kdp.screen` が **eligible かつ `publish_status='unlisted'` かつ未キューの本に `kdp_publish_queued=true` を
    立てる**（published/submitted は二重出版防止で除外、冪等）。`OrgKdpScreenResult.queued` で件数を観測。回帰テスト付。
    **実機検証(2026-08-12)**: 修正後、screen が2冊をキュー→dispatcher→`kdp.submit` が **TOTP で完全無人**にウィザード
    (step1メタ→step2アップロード→KDP Select登録→step3価格→公開)を完走し `submitted` へ。14日ぶりに自動出版が復活。
  - **【PUB-2 出版完了通知 2026-08-12】**: 従来 `notification_kinds_json` に「出版完了」種別が無く、出版完了が運営者に
    一切通知されていなかった。`kdp.publish.status.sync`(6h毎)が submitted→published(LIVE)へ昇格させた本があれば、
    その書名一覧を **LINE で運営者へプッシュ**する（`isLineRelayConfigured()` 時のみ・ベストエフォート）。回帰テスト維持。
  - **【PUB-3 出版デイリーレポート 2026-08-14】**: 運営者から「出版の通知が来ない／失敗時は原因も報告して」と要望。
    従来 (a) 完了通知は LIVE 検知時のみ、(b) `creation_limit` 失敗は連投防止で**意図的に無通知**だったため、
    出版が進んでいるのか止まっているのか分からなかった。新タスク `kdp.publish.digest`(worker, 日次 `30 22 * * *`
    ＝JST 07:30, 常時ON)が **公開(LIVE)/審査待ち(submitted)/入稿キュー/作成上限で待機(creation_limit)** を
    1通にまとめて毎朝 **LINE 通知**する（完了ゼロの日でも状況が届く）。`summarizePublishDigest`/`formatDigestMessage`
    は決定的・テスト付。**KDP作成上限(1日5冊)** が主なボトルネックで、CREATE方式が枠を消費し翌日クールダウン明けに
    自動再試行するため、大量キュー時は数日かけて消化される（digestで日々可視化）。
- **入力**: `books.id`、`kdp_metadata`、成果物（docx/cover、R2）
- **処理**: Playwright で KDP にログイン → メタデータ入力 → 本文/カバーアップロード → 価格設定 → 「公開」（`dry_run` 時は保留）。2FA は TOTP 自動生成または LINE リレー。
- **出力**: 入稿ジョブ結果（`publish_status='submitted'`）、ASIN（F-042 が翌日取得）
- **受け入れ基準**:
  - 1 冊あたり 10 分以内に「公開」または「公開待ち（dry-run）」まで到達
  - TOTP 設定時は無人で完走。未設定時は LINE OTP を最大 10 分待機
  - 作成上限到達時は破壊せず保留し翌日再試行
  - エラー時はスクリーンショットを R2 に保存
- **関連エージェント**: N/A

---

### F-042 KDP 入稿後の ASIN 取り込み・書籍メタ更新

- **目的**: §4.1 工程 8 後処理。
- **入力**: 入稿済み書籍
- **処理**: KDP の Bookshelf を Playwright でスキャンし ASIN を `books.asin` に保存。以後 F-038 の自動取得対象になる
- **出力**: 更新済み `books` レコード
- **受け入れ基準**: 入稿翌日に ASIN が必ず取り込まれる（再試行込み）
- **関連エージェント**: N/A

**`books.publish_status` ライフサイクル**: `unlisted`（未対応）→ `submitted`（`scripts/kdp-publish.mjs` が入稿成功時にセット）→ `published`（KDP で実際に LIVE=販売中になった状態）。従来 `published` への遷移は運営者が UI (`PublishStatusControl`) で手動切替するのみだったが、`kdp.publish.status.sync` (worker cron、6 時間毎、`docs/05` §5.3.19) が `submitted` の本を保存済みセッションで READ-ONLY 巡回し、LIVE 検知で自動的に `published` に昇格させる（運営者の手動切替は引き続き可能・自動化と併存）。

---

### F-043 シングルユーザー認証（NextAuth Credentials、env パスワード）

- **目的**: §7.2、§CLAUDE.md Hard Rule 1。
- **入力**: ユーザー名、パスワード（env 配布の単一値）
- **処理**: NextAuth Credentials Provider でセッション発行。セッションは httpOnly Cookie
- **出力**: ログインセッション
- **受け入れ基準**:
  - パスワード誤入力 5 回でロック（15 分）
  - セッション期限は既定 30 日
- **関連エージェント**: N/A

---

### F-044 KDP アカウント（ペンネーム）の登録・編集

- **目的**: §2.3、§7.4。
- **入力**: ペンネーム、ジャンル方針、ターゲット読者像、KDP ログイン情報（暗号化保存、Phase 3 用）
- **処理**: `accounts` テーブルに保存。複数アカウント対応の構造を持つが Phase 1 は 1 件で運用
- **出力**: `accounts` レコード
- **受け入れ基準**:
  - KDP 認証情報は AES-256 で暗号化保存（鍵は env）
  - 平文表示は禁止（マスク表示のみ）
- **関連エージェント**: N/A

---

### F-045 ジョブ実行ログの閲覧 UI

- **目的**: §6.2 監視。
- **入力**: `jobs` レコード
- **処理**: ステータス・実行時間・エラーメッセージ・token_usage への参照を一覧表示
- **出力**: ログビュー UI
- **受け入れ基準**: 直近 1000 件まで表示、フィルタとページネーション
- **関連エージェント**: N/A

---

### F-046 失敗ジョブのリトライ操作 UI

- **目的**: §6.1 信頼性。
- **入力**: 失敗ジョブ ID
- **処理**: 1 クリックで F-016 を起動
- **出力**: 再実行された jobs
- **受け入れ基準**: リトライ操作が監査ログに残る
- **関連エージェント**: N/A

---

### F-047 note 記事への変換・自動投稿（Phase 4）

- **目的**: §4.2、Phase 4 拡張。
- **入力**: 完成書籍
- **処理**: 章単位で note 記事フォーマットに変換し、note への自動投稿（API or Playwright）
- **出力**: note URL
- **受け入れ基準**: Phase 4 設計時に詳細化
- **関連エージェント**: Writer

---

### F-048 複数 KDP アカウント運用（Phase 4）

- **目的**: §2.3、Phase 4 拡張。
- **入力**: 複数 `accounts`
- **処理**: アカウント切替 UI、アカウント別 KPI 集計
- **出力**: マルチアカウントダッシュボード
- **受け入れ基準**: Phase 4 設計時に詳細化
- **関連エージェント**: N/A

---

### F-049 AI 出力への修正コメント記録

- **目的**: §後続申し送り 7。朝レビュー時に運営者が複数冊・複数箇所にコメントを残し、運営者の任意タイミングのボタン押下で一括反映するワークフローの起点。30 分/冊 (§3.2 Q3) の操作時間制約を守る核機能。
- **入力**:
  - 対象種別 `target_kind`（`chapter` / `outline` / `cover` / `cover_text` / `metadata`）
  - 対象 ID `target_id`（chapter_id / cover_id / outline_id / kdp_metadata_id 等）
  - 対象範囲 `range_json`（章本文なら行番号レンジ・段落番号、サムネなら座標領域、全体指摘なら null）
  - コメント本文 `body`（自由記述）
  - 優先度 `priority`（`must` / `should` / `may`）
- **処理**:
  1. `revision_comments` テーブルに `status = pending` で保存
  2. 関連書籍に「修正待ち」バッジを立てる（`books.has_pending_comments = true` を導出）
  3. UI 上の対象出力（章ビュー・サムネビュー等）にコメント吹き出しをアンカー表示
- **出力**: `revision_comments` レコード、UI 上のインライン表示
- **受け入れ基準**:
  - 1 つの章/サムネに対し複数コメントを残せる
  - コメントは UI で **編集・削除・優先度変更** が可能
  - コメントが付いた書籍は一覧画面で「修正待ち」バッジが表示される
  - `must` 優先度のコメントが 1 件以上ある書籍は KDP 入稿（F-020/F-041）でブロックされる
- **関連エージェント**: N/A（UI 機能）

---

### F-050 修正コメントの一括適用（ユーザートリガー）

- **目的**: §後続申し送り 7。蓄積された修正コメントを **運営者の任意タイミング（ボタン押下）で** AI が一括反映する。自動スケジュール実行は採用せず、運営者が「コメントが揃った」と判断した時点でキックする。30 分/冊の操作時間制約を維持しつつ、品質改善ループを運営者の意思決定下に置く。
- **入力**:
  - 適用対象書籍 ID リスト（運営者が UI 上でチェック → 1 件以上）
  - または「対象書籍の全 pending コメント」ボタンによる包括選択
- **処理**:
  1. UI ボタン押下を受けて `revision_runs` レコードを作成し、対象 `revision_comments`（status = pending）の ID 一覧を紐付け
  2. 対象書籍ごとに対象種別 (`chapter` / `cover` / 等) でコメントをグループ化
  3. 該当の Writer / Editor / Thumbnail Designer エージェントを起動し、コメント本文を `Previous feedback` として system prompt または user message に注入して再生成
  4. 各コメントを処理後 `status = applied` または `status = not_applicable`（適用不可と判断した場合は `application_result_json.reason` に理由記録）に更新
  5. 適用結果を差分レポートとして保存（章本文は Markdown diff、サムネ画像は新旧 URL ペア、メタデータは前後 JSON）
  6. F-008（Quality Judge）で再採点（Phase 2 以降）
  7. F-032（token_usage）に修正適用時のコストを `role = 'revision'` で記録
- **出力**:
  - 修正後の章/サムネ/メタデータ等（既存レコードを新バージョンとして上書き、旧版は履歴保持）
  - `revision_runs.result_summary_json`（適用件数 / 適用不可件数 / 再生成成果物 ID）
  - 差分レポート（UI で diff 表示）
  - 実行中はダッシュボードに進捗バー（n/m コメント処理済）を表示し、完了時に通知（UI バッジ + メール）
- **受け入れ基準**:
  - 実行で全 pending コメントが処理される（必ず `applied` か `not_applicable` に遷移、pending のまま残るものはない）
  - 適用結果は UI で diff 表示できる（章本文の追加/削除行、サムネのビフォーアフター並列表示）
  - 適用失敗時は元の出力を破壊せずロールバック可能（章本文の旧版は `chapters` の履歴テーブルに退避）
  - F-032 に修正適用時のコストが記録される（`book_id` 紐付き、`role = 'revision'` 付与）
  - **自動スケジュール実行は提供しない**（運営者の明示的ボタン押下のみがトリガー）
  - 1 回の実行で複数書籍・複数種別を扱える（10 冊 × 平均 3 コメントを 1 回の実行で処理可能）
  - 実行中に別の実行をキックしようとした場合は「実行中のジョブがあります」と表示し重複起動を防ぐ（書籍単位の排他制御）
- **関連エージェント**: Writer / Editor / Thumbnail Designer

---

### F-051 UI からの AI プロバイダ API キー設定・暗号化保存

- **目的**: 運営者が `.env` を直接編集せず、UI 上で各プロバイダ (Anthropic / OpenAI / Google Gemini / Tavily) の API キーを設定・差し替え・無効化できるようにする。Phase 1 の初期セットアップを env 操作なしで完結させ、運用中の鍵ローテーションも UI 完結。
- **入力**:
  - プロバイダ識別子 (`anthropic` / `openai` / `google` / `tavily`)
  - API キー文字列（クライアント側からは `<input type="password">` で平文送信、TLS 必須）
- **処理**:
  1. SA で `getSessionOrThrow()` で認証チェック
  2. zod parse でプロバイダ識別子 + キー形式（プロバイダ別 prefix チェック、例: `sk-ant-*` / `sk-*` / `AI*` / `tvly-*`）を検証
  3. `@a2p/crypto` の AES-256-GCM (T-01-08) で暗号化、`api_credentials` テーブルに upsert（プロバイダごとに 1 行）
  4. `audit_log` に「API キー更新（プロバイダ X、更新者 operator）」を平文鍵を含まず記録
  5. revalidate で S-027 設定画面を再描画、UI 表示はマスク済 `sk-ant-…••••` 形式
- **出力**: `api_credentials` レコード、UI 上のマスク表示
- **受け入れ基準**:
  - API キーは復号して LLM クライアント呼出時のみ平文展開（メモリ滞留時間を最小化）、UI/ログ/エラーメッセージに平文露出しない
  - プロバイダ別 prefix 検証で typo を防ぐ（不正形式は ValidationError）
  - 暗号化済値は `KDP_CRED_KEY` と同じ暗号化鍵 (`@a2p/crypto`) を使用、`audit_log` に平文を残さない
  - キー削除 (`revokeApiCredential`) も SA で提供、削除後は env フォールバックに戻る
- **関連エージェント**: N/A (UI + Settings)
- **取得経路 (LLM クライアント側)**: `getApiKey(provider)` ヘルパで **DB 優先、env フォールバック**。DB に行があれば復号して返す、なければ env の `ANTHROPIC_API_KEY` 等を返す、両方なければ `ConfigError` を throw

### F-052 API キー接続テスト

- **目的**: F-051 で設定したキーが実際に動作するかを UI から即時検証。鍵タイポや権限不足を Phase 1 着手前に検出。
- **入力**:
  - プロバイダ識別子 (DB 保存済キーを使う) または平文キー (新規登録時の即時テスト用)
- **処理**:
  1. SA で `getSessionOrThrow()` 認証
  2. プロバイダ別に最軽量の API を叩く（Anthropic/OpenAI/Google: `models.list()`、Tavily: 最小クエリ）
  3. 成功なら `api_credentials.last_tested_at` を更新、失敗ならエラー詳細を返す（鍵長・権限・ネットワーク等の切り分け情報）
  4. テスト結果を S-027 上にバッジ表示（✅ OK / ⚠️ 失敗 + 理由）
- **出力**: テスト結果 `{ ok: boolean, latency_ms: number, models_available?: number, error?: string }`
- **受け入れ基準**:
  - 各プロバイダのテストが 10 秒以内に応答
  - 失敗時に「鍵不正」「権限不足」「ネットワーク不通」を区別したメッセージ
  - テスト呼出自体は `token_usage` に **記録しない**（実生成ではないため）
- **関連エージェント**: N/A (UI)

---

## 3. ユースケース

### UC-01 一晩で 5 冊一括生成（夜セット → 朝レビュー） — ハッピーパス

- **アクター**: 運営者
- **前提**:
  - F-001 で過去 3 日以内に生成済みのテーマ候補が 20 件以上残っている
  - F-022 で役割別モデルが設定済み（既定: Writer/Editor=Sonnet, Marketer/Optimizer=Opus）
  - 月次コスト残高が十分（F-036 イエロー未到達）
- **手順**:
  1. 21:00 ダッシュボードで F-017 を使い、テーマ候補から 5 件を一括採用
  2. F-021 で「開始時刻 22:00 / 並列度 5」のバッチ計画を保存
  3. 表示される予測コスト合計 500 円・予測完了時刻 06:00 を確認
  4. 22:00 に F-010/F-011 が自動起動 → 5 冊が並列で Marketer→Writer→Editor→Thumbnail を実行
  5. 各冊で F-008 (Quality Judge) がスコア >= 80 を確認、F-012/F-013/F-014 で出力ファイル生成
  6. 翌朝 07:00 運営者がダッシュボード確認 → 5 冊すべて `done`
  7. F-019 でサムネを一括採用、F-020 で KDP 入稿チェックリスト確認
- **結果**: 5 冊分の docx/pdf/png が R2 に保存され、KDP 入稿準備が完了。運営者操作時間は朝晩合計 30 分以内。
- **関連機能**: F-001, F-008, F-010〜F-015, F-017, F-019, F-020, F-021, F-022, F-032〜F-034, F-040

---

### UC-02 モデル切替（Writer を Claude Sonnet → Gemini に変更してコスト/品質を比較）

- **アクター**: 運営者
- **前提**:
  - 過去 30 日で 10 冊以上を Writer=Claude Sonnet 4.6 で出版済み
  - F-024 で Gemini 2.x の最新単価が `model_catalog` に取り込まれている
- **手順**:
  1. F-025 でカタログを開き、Gemini モデルの単価と Claude Sonnet を比較
  2. F-023 で「Writer × 全ジャンル」を Gemini に切替（次回ジョブから適用）
  3. UC-01 のフローで次の 10 冊を Gemini で出版
  4. F-026 を開き、切替前 10 冊（Sonnet）と切替後 10 冊（Gemini）の平均スコア・平均コスト・平均リードタイムを比較
  5. コストが下がったがスコアが 80 を割る冊が増えた場合、F-023 で Sonnet に戻す
- **結果**: 切替判断のための定量データが取得され、運営者が最適モデルを選択できる。
- **関連機能**: F-022, F-023, F-024, F-025, F-026, F-008, F-032〜F-035

---

### UC-03 プロンプト自動改訂サイクル（10 冊出版後の Optimizer 提案 → 承認）

- **アクター**: 運営者 + Prompt Optimizer エージェント
- **前提**:
  - 直近 10 冊が出版完了し、`eval_results` に蓄積済み
  - F-038 で売上データも取り込まれている（Phase 2 以降）
- **手順**:
  1. 10 冊目の出版完了をトリガに F-009 が自動起動
  2. Optimizer が役割×ジャンル別にスコア/売上低下傾向を分析、Writer テンプレに改訂案を生成
  3. F-029 の承認 UI に提案が表示される（旧版 diff、改訂意図、期待効果、サンプル出力）
  4. 運営者が「編集して承認」 → 微修正後に承認
  5. F-028 で新バージョンが `active` になり、以降のジョブで使用される
  6. （オプション）F-031 で旧版 50% / 新版 50% の A/B 配信を選択した場合、10 冊分の結果統計を後日確認
  7. 5 冊連続で新版がスコア改善 → F-030 により次回以降は自動承認モードに切替可能
- **結果**: 出版を重ねるごとにプロンプト品質が改善し、運営者の承認負荷も自動承認ルールで段階的に軽減される。
- **関連機能**: F-009, F-027, F-028, F-029, F-030, F-031, F-008, F-038

---

### UC-04 1 冊あたり 500 円超過アラート発火 → 運営者対応

- **アクター**: 運営者 + システム
- **前提**:
  - ジョブ進行中（例: Writer が長文章を執筆中）
  - F-022 で Writer に高単価モデル（例: Opus）が設定されている
- **手順**:
  1. Writer 章執筆中に累積コストが 500 円到達
  2. F-034 がトリガ → UI に赤バッジ表示、運営者にプッシュ通知
  3. 運営者がダッシュボードでコスト内訳（F-033）を確認
  4. 750 円到達でジョブが自動停止し承認待ちに
  5. 運営者の選択肢:
     - (a) F-046 で「中止」 → 書籍を `cancelled` に
     - (b) 「続行」 → Writer を完走させる
     - (c) F-023 で Writer を Sonnet に切替 → 「ステップから再開」（F-016）
  6. 後日 F-026 で「Opus 試行分」と「Sonnet 切替後分」のコスト/品質を比較
- **結果**: コスト暴走を未然に防ぎつつ、運営者がデータに基づいてモデル戦略を見直せる。
- **関連機能**: F-016, F-022, F-023, F-026, F-033, F-034, F-046

---

### UC-05 KDP 自動入稿（Phase 3）

- **アクター**: 運営者 + Playwright Worker
- **前提**:
  - Phase 3 機能が有効
  - F-044 で KDP 認証情報登録済み、2FA デバイスがオンライン
  - 入稿対象の書籍 5 冊が F-008 スコア >= 80 で `ready_to_publish` 状態
- **手順**:
  1. 運営者が F-020 の入稿チェックリストで 5 冊を選択 → 「自動入稿」ボタン
  2. F-041 が冊ごとに順次実行（KDP の同時セッションは 1 に制限）
  3. 2FA 要求発生 → 運営者スマホにプッシュ → 入力 → 続行
  4. 全冊が「公開待ち」状態まで到達。運営者が KDP 上で最終公開ボタンを押下（最終公開だけ手動）
  5. 翌日 F-042 が ASIN を取り込み `books.asin` を更新
  6. 以降は F-038 で売上・レビューが自動取得され、F-039 で KPI に反映
- **結果**: 入稿手間が大幅削減され、運営者の手作業は 2FA 承認と最終公開クリックのみに集約。
- **関連機能**: F-020, F-038, F-039, F-041, F-042, F-044

---

### UC-06 コメント → 一括修正サイクル（運営者トリガー）

- **アクター**: 運営者 + システム
- **前提**:
  - UC-01 で前夜に 5 冊生成済み（出力ファイルは揃っている）
  - 一部の章で「事例を増やしたい」「導入が冗長」等の懸念がある
  - F-049 / F-050 が有効（Phase 1 から）
- **手順**:
  1. 朝 07:00、運営者がダッシュボードで 5 冊の章を流し読みする
  2. 気になる章/サムネに F-049 でコメントを残す（複数冊・複数箇所、合計 10〜15 コメント、操作時間 15 分以内）
     - 例: 第 2 章 §3 に「事例を 1 つ追加して」(`should`)、表紙に「文字色をもう少し落ち着いた色に」(`should`)、第 5 章導入に「冗長なので 2 段落削減」(`must`) 等
  3. コメント記入を終えたら、運営者がダッシュボードで対象書籍を選択 → **「コメントを一括反映」ボタンを押下** (F-050 をユーザートリガーで起動)
  4. 即時実行 → Writer / Editor / Thumbnail Designer がコメントを反映、Phase 2 以降は Quality Judge (F-008) が再採点。実行中は進捗バーで監視可能、ブラウザを閉じても完了時にメール通知が届く
  5. 実行完了後 (例: 数十分〜1 時間) 運営者が差分レポートを確認 → 良ければ承認、悪化していれば追加コメントしてサイクルを継続
  6. `must` 優先度のコメントが残っている書籍は F-020 / F-041 で KDP 入稿不可となるため、すべて applied になるまで再ループ
- **結果**: 朝の操作時間を 15 分以内に抑えながら、AI 出力の品質を段階的に改善できる。30 分/冊 (Q3) の操作時間制約内で 100 冊/月のスループットと品質改善ループを両立。実行タイミングは運営者の判断に委ね、必要があれば寝る前にもう 1 ループ回せる柔軟性を持つ。
- **関連機能**: F-049, F-050, F-008, F-004, F-005, F-007, F-020, F-041

---

## 4. データ要件

> DB 設計の最終形は `docs/05-program-design.md` で確定する。本節は機能要件で必要となる「エンティティと主要属性」レベルに留める。

| エンティティ | 主要属性 | 用途 / 関連機能 |
|---|---|---|
| `accounts` | id, pen_name, genre_policy, target_reader, kdp_credentials_enc, created_at | F-044, F-002, F-041 |
| `publishing_plans` | id, account_id, period_from, period_to, plan_json | F-002 |
| `theme_candidates` | id, account_id, genre, title, hook, competitors_json, status, theme_session_id | F-001, F-017 |
| `books` | id, account_id, theme_id, title, subtitle, asin, status, prompt_version_ids_json, model_assignment_snapshot, cost_jpy_total, cost_status, created_at | F-010, F-016, F-033, F-042 |
| `outlines` | id, book_id, chapters_json, status, approved_at | F-003, F-018 |
| `chapters` | id, book_id, index, heading, body_md, status | F-004 |
| `covers` | id, book_id, image_url, prompt_used, status | F-006, F-007, F-019 |
| `kdp_metadata` | id, book_id, description, categories, keywords, price_jpy | F-040 |
| `kdp_submission_progress` | id, book_id, checklist_state_json, submitted_at | F-020, F-041 |
| `artifacts` | id, book_id, kind (docx/pdf/png/md), r2_key, byte_size, checksum, created_at | F-012〜F-015 |
| `jobs` | id, kind, book_id, status, payload_json, error, started_at, finished_at, retries | F-010, F-011, F-016, F-045, F-046 |
| `batch_plans` | id, planned_at, items_json, concurrency, status, predicted_cost_jpy | F-021 |
| `model_catalog` | id, provider, model, input_price_per_1k, output_price_per_1k, fetched_at, source, raw_json | F-024, F-025 |
| `model_assignments` | id, role, genre, provider, model, activated_at, status | F-022, F-023 |
| `prompts` | id, role, genre, version, body, placeholders_json, status (active/archived), created_by, activated_at | F-027, F-028, F-029, F-030 |
| `prompt_proposals` | id, source_prompt_id, proposed_body, diff, rationale, expected_effect, sample_output, status (pending/approved/rejected) | F-009, F-029 |
| `eval_results` | id, book_id, prompt_version_ids_json, score_total, score_breakdown_json, judged_at | F-008, F-009, F-030 |
| `token_usage` | id, book_id (nullable), theme_session_id (nullable), provider, model, role, input_tokens, output_tokens, image_count, unit_price_snapshot, cost_jpy, created_at | F-032, F-033, F-034, F-035 |
| `sales_records` | id, book_id, year_month, royalty_jpy, review_count, avg_stars, source (manual/auto) | F-037, F-038, F-039 |
| `alerts` | id, kind, severity, payload_json, resolved_at | F-034, F-036, F-024 |
| `audit_log` | id, actor, action, target, before_json, after_json, created_at | F-029, F-030, F-046 |
| `revision_comments` | id, book_id, target_kind (chapter/outline/cover/cover_text/metadata), target_id, range_json, body, priority (must/should/may), status (pending/applied/not_applicable), run_id (nullable), created_at, applied_at, application_result_json | F-049, F-050 |
| `revision_runs` | id, triggered_by (= 運営者ユーザー ID), triggered_at, started_at, finished_at, book_ids_json, comment_ids_json, status (queued/running/done/failed), result_summary_json | F-050 |
| `api_credentials` | id, provider (anthropic/openai/google/tavily, UNIQUE), key_enc (AES-256-GCM 暗号化), key_mask (`sk-ant-…••••` 表示用 8 文字 + マスク), set_at, set_by (運営者 ID), last_tested_at (nullable), last_test_result_json (nullable, `{ok, latency_ms, models_available?, error?}`) | F-051, F-052 |

主要な多重度:
- `accounts` 1 — N `books` — 1 `outlines` — N `chapters`
- `books` 1 — N `token_usage` 1 — 1 `model_catalog`（snapshot 取得元）
- `prompts` 1 — N `prompt_proposals`
- `books` 1 — N `eval_results`（リトライで複数）
- `books` 1 — N `revision_comments` N — 1 `revision_runs`（適用実行に帰属）

---

## 5. 非機能要件

### 5.1 性能

| 指標 | 目標 | 関連 |
|---|---|---|
| 1 冊あたりリードタイム（夜セット→朝完成） | **8〜12 時間以内**（実 LLM 利用時） | §6.1 BR, F-011 |
| 並列ジョブ実行数 | **書籍 3〜5 並列**（同時実行） | §3.3, F-011 |
| 章単位の並列実行数 | 1 冊内 **3〜4 章並列** | F-004 |
| ダッシュボード一覧表示 | 100 冊規模で **2 秒以内** | F-039 |
| コスト集計クエリ | **1 秒以内**（書籍詳細） | F-033 |
| モデル単価カタログ取得バッチ | 1 日 1 回、**3 分以内に完了** | F-024 |
| Quality Judge 採点 | 1 冊あたり **5 分以内** | F-008 |

### 5.2 可用性

- **24/7 不要**。個人運用のため、メンテナンス窓を運営者の都合で確保可能。
- 障害発生時の **目標復旧時間: 営業日 24 時間以内**（運営者本人対応、SLA なし）。
- ジョブ失敗時の **データロスト最小化**: 中間成果物（章本文・Outline 等）は DB に逐次保存し、ステップ単位で再開可能（F-016）。
- 月間予定停止時間: 上限を設けない（運営者運用判断）。

### 5.3 セキュリティ

- **シングルユーザー認証**: NextAuth Credentials。パスワードは env 配布の単一値、bcrypt で照合（F-043）。
- **API キーの取り扱い**:
  - Anthropic / OpenAI / Gemini / Cloudflare R2 のキーは **環境変数のみ**（`.env.local`, Railway 環境変数）。コード/DB には保存しない。
  - Hard Rule 6（CLAUDE.md）に従い、`.env.*` は git 管理外。
- **KDP 認証情報**:
  - `accounts.kdp_credentials_enc` に AES-256 で暗号化保存。鍵は env（`KDP_CRED_KEY`）に格納。
  - UI 上は常にマスク表示。平文取得は worker プロセス内のみ。
- **セッション**: httpOnly + Secure Cookie、既定 30 日。CSRF 対策は NextAuth 標準に従う。
- **監査ログ**: プロンプト承認・ジョブ中止・モデル切替等の運営者操作は `audit_log` に記録（F-029, F-030, F-046）。
- **AI 開示**: 生成原稿の巻末に KDP 規約準拠の AI 生成開示文を必ず挿入（F-005）。

### 5.4 監視・ログ

| 項目 | 内容 | 関連機能 |
|---|---|---|
| トークン使用量 | 全 LLM/画像 API 呼び出しを `token_usage` に記録（漏れたら CI で検出する型契約） | F-032 |
| コスト集計粒度 | 書籍 × プロバイダ × モデル × 役割 | F-033, F-035 |
| アラート種別 | 1 冊 500 円超過 / 1 冊 750 円停止 / 月次 80% (40,000 円) 到達 / 月次 95% (47,500 円) 到達 / 月次 100% (50,000 円) 到達 / モデル単価 ±10% 変動 / ジョブ失敗 3 連続 | F-034, F-036, F-024, F-016 |
| ジョブログ保管期間 | 直近 90 日（古いものは R2 にアーカイブ） | F-045 |
| 通知チャネル | UI バッジ + email（Phase 1）+ プッシュ通知（Phase 3 以降、KDP 2FA 用） | F-034, F-041 |

### 5.5 拡張性

- **マルチプロバイダ抽象化**: 役割→モデルの差し替えで他プロバイダを追加可能な抽象層を `tech-selection` で確定（F-022, F-023）。新規プロバイダの追加コストは「アダプタ実装 + カタログバッチの取得ロジック追加」のみ。
- **複数アカウント対応**: データモデルは `account_id` で分離されているため、Phase 4 で UI を追加するだけで複数 KDP アカウント運用に拡張可能（F-048）。
- **他チャネル出力**: 章単位の Markdown が中間成果物として残るため、note 記事生成（F-047）、Zenn、ブログ等への変換アダプタを追加可能。
- **プロンプト資産の SaaS 化**: `prompts` テーブルがバージョン管理されているため、将来テナント分離レイヤを追加することで SaaS 化も視野（§8 ステークホルダー注記）。

### 5.6 国際化・多言語

- **日本語ファースト**（CLAUDE.md Hard Rule 2）。UI・生成コンテンツとも日本語のみを Phase 1〜4 でサポート。
- 多言語化は対象外（§6 参照）。

---

## 6. 対象外（やらないこと）

CLAUDE.md Hard Rule および §4.2 スコープ外を機能要件としても明示する。

| 区分 | 対象外項目 | 理由 |
|---|---|---|
| アーキテクチャ | マルチテナント / 組織・チーム管理 | §2.3 単独運営者前提、Hard Rule 1 |
| 認証 | OAuth / SSO / MFA / 招待管理 | 単一ユーザー、env 配布パスワードで十分 |
| 課金 | サブスク・利用課金・Stripe 等 | 単独運営者の自家用途 |
| コラボレーション | リアルタイム共同編集・コメント機能・通知購読管理 | 利用者 1 名 |
| 流通 | 紙在庫管理 / 外部 EC 連携 / 倉庫管理 | §4.2 スコープ外 |
| マーケ自動化 | Amazon 広告自動運用 / SNS 自動投稿 | §4.2 スコープ外 |
| 著者ブランディング | プロフィールページ / 著者 SNS 連携 | §4.2 スコープ外 |
| 国際化 | 英語/中国語等の UI・生成 | §5.6 |
| エンタープライズ機能 | 監査用 SSO / SOC2 対応 / ロールベース権限 | 単独運営、§7.4 SLA なし |
| 商標自動チェック | 書名・カバーの商標衝突自動判定 | §7.1 将来課題 |
| Phase 1 時点の自動入稿 | KDP 自動入稿（Playwright） | Phase 3 で実装、それまで F-020 で支援 |
| Phase 1 時点の売上自動取得 | Amazon 売上 API 自動取得 | Phase 2 で実装、それまで F-037 手動入力 |

---

## Assumptions（業務要件で明示されなかった点に対する仮説）

> 後段（tech-selection / ui-design / program-design）で覆る可能性がある仮置き値。確定時は本文を更新する。

1. **1 冊あたり想定文字数**: **既定 120,000 字（約 200〜300 ページ相当。2026-08-25 引き上げ、旧 45,000–55,000 字）**。KDP の実用書/ビジネス書/自己啓発で十分な読み応え・情報量を担保するため。F-003/F-004 の章設計はこれを既定とする。上限 160,000 字。
2. **章数の既定**: **既定 14 章（7〜18 章の範囲、章あたり 8,000〜9,000 字程度。2026-08-25 引き上げ、旧 7–10 章）**。F-003 のアウトライン生成既定。章単位 max output tokens は 24,000、outline は 16,384。
3. **画像生成回数**: カバー 1 冊あたり既定 3 候補。多色展開や帯バリエーションは Phase 2 以降の選択肢。
4. **並列度の既定**: 書籍並列 5、章並列 4。Phase 1 で実コストとリードタイムを計測してチューニング。
5. **コスト計算の通貨換算**: USD → JPY は `model_catalog` 取得時の為替レート（外部 API）でスナップショット保存。為替変動の遡及調整はしない。
6. **通知チャネル**: Phase 1 は UI バッジ + email まで。プッシュ通知は Phase 3 で KDP 2FA と同時に導入。
7. **Quality Judge 採点軸**: F-008 に列挙した 6 軸は仮置き。Phase 2 開始前に Prompt Optimizer の改訂対象として再検討する。
8. **プロンプト自動承認のロールバック猶予**: 24 時間（F-030）。Phase 2 運用開始時に調整する。
9. **テーマ重複回避の検査範囲**: 過去 90 日（F-001）。アカウントごとの長期戦略次第で延長可能。
10. **note 記事化（F-047）の出力単位**: 「章 = 1 記事」を仮置き。Phase 4 検討時に再定義。

---

## トレーサビリティマトリクス（業務要件 → 機能要件）

`docs/01` 末尾「後続エージェントへの申し送り」7 項目の機能 ID マッピング:

| 申し送り | 対応機能 ID |
|---|---|
| 1. 並列実行 (3〜5 並列) | F-010, F-011（+ 非機能 §5.1） |
| 2. マルチプロバイダ抽象化（役割別 UI 切替） | F-022, F-023 |
| 3. モデル単価カタログ日次取得バッチ | F-024, F-025 |
| 4. N 冊一括操作 UI | F-017, F-018, F-019, F-020, F-021 |
| 5. 書籍 ID × プロバイダ × モデル単位のコスト追跡（1 冊 500 円超過 / 月次 5 万円） | F-032, F-033, F-034, F-035, F-036 |
| 6. Phase 2 自動承認ロジック（5 冊連続スコア改善） | F-008, F-009, F-029, F-030 |
| 7. AI 出力への人間修正コメントと運営者トリガーの一括修正 | F-049, F-050（+ UC-06） |

P0 機能 → ユースケース対応確認:

| P0 機能 ID | カバーするユースケース |
|---|---|
| F-001 | UC-01 |
| F-003〜F-007 | UC-01, UC-06 |
| F-008 | UC-01, UC-03, UC-06 |
| F-009 | UC-03 |
| F-010〜F-015 | UC-01 |
| F-017〜F-019 | UC-01 |
| F-021 | UC-01 |
| F-022〜F-025 | UC-02 |
| F-027〜F-030 | UC-03 |
| F-032〜F-035 | UC-01, UC-02, UC-04 |
| F-034 | UC-04 |
| F-037 | UC-01 後段（売上記録） |
| F-039 | UC-01, UC-02 |
| F-040 | UC-01 |
| F-041, F-042 | UC-05 |
| F-043, F-044 | 全 UC（前提） |
| F-049, F-050 | UC-06 |

すべての P0 機能が最低 1 ユースケースに紐付くことを確認済み。
