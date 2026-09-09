/**
 * Marketer テーマ生成の「事前リサーチ」— Tavily で Amazon Kindle の売れ筋/競合を
 * 高速に調べ、プロンプトへ注入する根拠ブロックを組み立てる (docs/03 §R-04 / F-001)。
 *
 * 目的: Anthropic 純正 `web_search_20250305` のエージェント的ループ (3〜7 分・時々
 * タイムアウト) を、Tavily の単発 HTTP 検索 (数秒) に置き換える。ここで得た結果を
 * 通常の LLM 補完 (server tool 無し) に渡すことで、生成を数十秒に短縮する。
 *
 * 失敗方針: キー未設定・API エラー・タイムアウトのいずれでも **null を返す**
 * (例外を投げない)。呼出側 (theme.ts) は null のとき Anthropic 純正検索にフォールバックする。
 */
import { createLogger } from '@a2p/contracts/logger';

import { TavilyWebSearch } from '../tools/web-search.js';
import { getTavilyApiKey, type GetTavilyKeyDeps } from '../lib/get-tavily-key.js';

const log = createLogger('agents.marketer.tavily-research');

export interface TavilyResearchDeps {
  getTavilyKeyDeps?: GetTavilyKeyDeps;
  /** DI: Tavily キー解決を丸ごと差し替える (テスト用)。 */
  resolveKey?: () => Promise<string | null>;
  /** DI: fetch 差し替え (テスト用)。 */
  fetchImpl?: typeof fetch;
}

/** 1 クエリあたりの取得件数。 */
const PER_QUERY_RESULTS = 6;
/** 根拠ブロックに載せる最大件数 (重複除外後)。 */
const MAX_ITEMS = 10;

/**
 * genre ラベル + キーワードから Tavily 検索を実行し、プロンプト注入用の根拠テキストを返す。
 * @returns 整形済み根拠ブロック文字列。キー未設定/失敗時は null。
 */
export async function researchMarketWithTavily(
  args: { genreLabel: string; keywordOrBrief: string },
  deps: TavilyResearchDeps = {},
): Promise<string | null> {
  const resolveKey = deps.resolveKey ?? (() => getTavilyApiKey(deps.getTavilyKeyDeps));
  const apiKey = await resolveKey();
  if (!apiKey) return null;

  const client = new TavilyWebSearch(
    deps.fetchImpl ? { apiKey, fetchImpl: deps.fetchImpl } : { apiKey },
  );

  const g = args.genreLabel.trim();
  const kw = args.keywordOrBrief.trim();
  // 2 クエリ: (1) 売れ筋ランキング/ベストセラー観点、(2) キーワード直近の人気本観点。
  const queries = [
    `${g} ${kw} Amazon Kindle 売れ筋 ベストセラー 人気`,
    `${kw} 本 おすすめ 話題 ${g}`,
  ];

  try {
    const results = await Promise.all(
      queries.map((q) =>
        client
          .search({ query: q, maxResults: PER_QUERY_RESULTS })
          .catch((err: unknown) => {
            log.warn({ q, err: err instanceof Error ? err.message : String(err) }, 'tavily query failed');
            return null;
          }),
      ),
    );

    // 重複 URL を除外しつつ上位を集約。
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const r of results) {
      if (!r) continue;
      for (const item of r.items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        const snippet = (item.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
        lines.push(`- ${item.title}${snippet ? ` — ${snippet}` : ''}\n  (${item.url})`);
        if (lines.length >= MAX_ITEMS) break;
      }
      if (lines.length >= MAX_ITEMS) break;
    }

    if (lines.length === 0) return null;

    return [
      '【Web リサーチ結果（Tavily 検索・売れ筋/競合の実データ）】',
      '以下は現在の Amazon Kindle 等で観測された、このジャンル/キーワードの実在タイトル・傾向です。',
      'これを根拠に、需要があり競合と差別化できる企画を優先してレコメンドしてください。',
      '各 candidate の signals.bestseller_evidence には、下記から観測した売れ筋の類書を入れてください。',
      '',
      ...lines,
    ].join('\n');
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'tavily research failed — falling back to native web_search',
    );
    return null;
  }
}
