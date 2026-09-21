/**
 * ANP 各エージェント共通: アカウント文脈のプロンプト整形 (docs/11-anp-design.md §3.1 F-ANP-07)。
 * `editorial_policy` (記事の方針・トンマナ) が設定されていれば、ユーザーメッセージ末尾に
 * 「【記事の方針・トンマナ】」ブロックとして付ける。未設定なら空配列 (プロンプトは変わらない)。
 */
import type { NoteAccountContext } from '@a2p/contracts/agents/anp';

export function editorialPolicyLines(account: Pick<NoteAccountContext, 'editorial_policy'>): string[] {
  const policy = account.editorial_policy?.trim();
  if (!policy) return [];
  return [
    '',
    '【記事の方針・トンマナ (運営者設定・必ず守る)】',
    policy,
  ];
}
