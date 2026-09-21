/**
 * ANP 各エージェント共通: アカウント文脈のプロンプト整形 (docs/11-anp-design.md §3.1 F-ANP-07)。
 * `editorial_policy` (記事の方針・トンマナ) が設定されていれば、ユーザーメッセージ末尾に
 * 「【記事の方針・トンマナ】」ブロックとして付ける。未設定なら空配列 (プロンプトは変わらない)。
 */
import type { NoteAccountContext } from '@a2p/contracts/agents/anp';

/**
 * F-ANP-08: 収益化方針 (アカウント設定) をテーマ生成プロンプトに注入する行。
 * `count` を渡すと「候補のうち約 N 件を有料に」と具体数で指示する。未設定項目は出さない。
 */
export function monetizationLines(account: Pick<NoteAccountContext, 'monetization'>, count?: number): string[] {
  const m = account.monetization;
  if (!m) return [];
  const lines: string[] = [];
  if (m.paid_ratio !== undefined) {
    const pct = Math.round(m.paid_ratio * 100);
    const n = count !== undefined ? Math.round(count * m.paid_ratio) : undefined;
    lines.push(
      `- 有料記事の目安比率: ${pct}%` +
        (n !== undefined ? ` (候補 ${count} 件のうち約 ${n} 件を recommend_paid=true にし、残りは無料記事として設計する)` : ''),
    );
  }
  if (m.price_band && (m.price_band[0] > 0 || m.price_band[1] > 0)) {
    lines.push(`- 有料記事の価格帯: ¥${m.price_band[0].toLocaleString('ja-JP')}〜¥${m.price_band[1].toLocaleString('ja-JP')} (suggested_price はこの範囲で)`);
  }
  lines.push(`- 有料記事の無料公開部分の目安: 本文の約 ${Math.round(m.free_ratio * 100)}% を無料で読ませ、続きを有料にする`);
  lines.push(`- メンバーシップ (定期購読): ${m.membership ? 'あり (メンバー向け限定記事も候補に含めてよい)' : 'なし'}`);
  return ['', '【収益化方針 (運営者設定)】', ...lines];
}

export function editorialPolicyLines(account: Pick<NoteAccountContext, 'editorial_policy'>): string[] {
  const policy = account.editorial_policy?.trim();
  if (!policy) return [];
  return [
    '',
    '【記事の方針・トンマナ (運営者設定・必ず守る)】',
    policy,
  ];
}
