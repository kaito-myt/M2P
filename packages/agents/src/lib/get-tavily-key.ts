/**
 * Tavily API キー取得ヘルパ (docs/03 §R-04)。
 *
 * `getApiKey` は LLM プロバイダ (anthropic/openai/google) 専用で Tavily を扱わないため、
 * Tavily 用に独立した resolver を用意する。解決順序は getApiKey と同じ思想:
 *   1. DB (`ApiCredential` provider='tavily') を復号
 *   2. env `TAVILY_API_KEY`
 *   3. どちらも無ければ null (呼出側は Anthropic 純正 web_search にフォールバックする)
 *
 * getApiKey と違い「未設定は例外にせず null を返す」— Tavily はあくまで高速化の
 * 主検索であり、無ければ純正検索に落とすだけで機能は止めないため。
 */
import { decryptApiKey } from '@a2p/crypto';
import { prisma } from '@a2p/db';

export interface GetTavilyKeyDeps {
  apiCredentialRepo?: {
    findUnique(args: { where: { provider: string } }): Promise<{ key_enc: string } | null>;
  };
  env?: NodeJS.ProcessEnv;
  decrypt?: (enc: string) => string;
}

/**
 * Tavily API キーを取得する。未設定なら null。
 * DB 復号に失敗した場合も (改ざん検知目的で throw する getApiKey と違い) null に落として
 * 純正検索フォールバックを許す。
 */
export async function getTavilyApiKey(deps: GetTavilyKeyDeps = {}): Promise<string | null> {
  const env = deps.env ?? process.env;
  const repo = deps.apiCredentialRepo ?? prisma.apiCredential;
  const decrypt = deps.decrypt ?? decryptApiKey;

  try {
    const row = await repo.findUnique({ where: { provider: 'tavily' } });
    if (row) {
      try {
        const plain = decrypt(row.key_enc);
        if (plain && plain.length > 0) return plain;
      } catch {
        // 復号失敗 → env フォールバックへ
      }
    }
  } catch {
    // DB 取得失敗 → env フォールバックへ
  }

  const fromEnv = env.TAVILY_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return null;
}
