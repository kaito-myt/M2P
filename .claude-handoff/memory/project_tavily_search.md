---
name: project-tavily-search
description: テーマ生成が遅い主因(Anthropic純正web_searchの無上限エージェントループ)とTavily事前検索化(2026-08-28)
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-08-28T09:14:54.057Z
---

**テーマ生成(`pipeline.theme.generate` = Marketer F-001)が3〜7分かかり時々~5分でタイムアウト失敗していた主因**: Marketerが「Amazon売れ筋/競合を候補ごとに調べろ」という指示のもと、Anthropic純正 `web_search_20250305` server tool を **`max_uses`上限なし**でエージェント的に何度も回していたため。実測(本番jobs): 79s/271s/341s/419s、320sと314sで failed。**Tavilyは完全にスタブ**(`TavilyWebSearch.search()`が`ConfigError('tavily_not_implemented')`を投げるだけ)で、どのエージェントからも未使用、`api_credentials`にも行なし・env未設定だった。

**対応 (2026-08-28)**: MarketerのリサーチをTavily事前検索＋通常LLM補完(server tool無し=高速)に切替。
- `packages/agents/src/tools/web-search.ts` — `TavilyWebSearch.search()` を実装(`POST https://api.tavily.com/search`, `Authorization: Bearer`, 15sタイムアウト, DI fetch)。
- `packages/agents/src/marketer/tavily-research.ts` (新規) — `researchMarketWithTavily()`が2クエリ(売れ筋/人気)を叩き根拠ブロックを整形。**失敗/キー未設定はnullを返し例外を投げない**。
- `packages/agents/src/lib/get-tavily-key.ts` (新規) — キー解決 DB`api_credentials(provider='tavily')`→env`TAVILY_API_KEY`。未設定はnull(例外にしない)。
- `marketer/theme.ts` — Tavilyでリサーチ成功時は`factoryDeps.disableServerTools=true`で素のAISdkClient(高速)を使い、根拠をuserMessageに注入。null時は従来のAnthropic純正web_searchにフォールバック。
- `lib/llm-client-factory.ts` — `disableServerTools?`追加(marketer+anthropicでもserver tool無しクライアントを返す)。
- `lib/agent-sdk-client.ts` — `WEB_SEARCH_TOOL`に`max_uses:5`追加(フォールバック/他web_search役割=cover_art_direction/promo_strategist/growth_scoutの暴走上限化)。
- 設定UIでTavilyキーを保存/テスト可能に: `api-credentials-core.ts`の`providerSchema`に`'tavily'`追加(以前は3社のみでUIにtavily行はあるのに保存が弾かれていた)。`api-credentials.ts`のテスト接続をTavily用(POST /search)に特別処理。

**キー設定**: ①設定→APIキー→Tavily→貼付→接続テスト(DB保存・ワーカー再起動不要、`getTavilyApiKey`がDBを都度読む)、または②Railway A2P-Workerのenv `TAVILY_API_KEY`。未設定でもmax_uses上限付きAnthropic純正で動作継続。**2026-08-28にキー設定完了・実測検証済**(下記)。プロバイダ非依存(Gemini/GPTでもWebリサーチ可)。設計=docs/03 §A-03, docs/05 §6.3.1。関連 [[reference-model-assignment-routing]]。

**実測(2026-08-28, count=6, genre=money)**: **161秒で完了・LLM呼出1回のみ・リトライ0・失敗なし**(token_usage: sonnet-4-6, in=7125/out=8744)。入力7125トークン=Tavily根拠ブロックのみ注入(純正web_searchなら検索結果で数万tokになる)→**Tavily経路が使われた証拠**。**注意: 私は事前に「数十秒」と過大予告したが実際は約2.7分**。web_searchのエージェント的ループと~5分タイムアウト失敗は解消したが、残り時間の主因は**LLMが6候補の詳細(reasoning1000字/recommendation600字等の重い出力8744tok)を書く生成時間**で、これが新たな下限。さらに速くするなら候補の冗長度削減/count削減/より速いモデルへのmarketerルーティングが必要(いずれも品質トレードオフ)。

**注意(別件・未対応)**: セッション時点で `packages/agents/src/writer/{chapter,outline}.ts` のトークン定数(chapter=24000/outline=16384)が未コミット変更されているがテスト(chapter.test/outline.test)は旧値(16384/8192)期待のまま失敗中。Tavily作業とは無関係の別の作業途中。
