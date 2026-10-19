/**
 * ANP 各エージェント共通: アカウント文脈のプロンプト整形 (docs/11-anp-design.md §3.1 F-ANP-07)。
 * `editorial_policy` (記事の方針・トンマナ) が設定されていれば、ユーザーメッセージ末尾に
 * 「【記事の方針・トンマナ】」ブロックとして付ける。未設定なら空配列 (プロンプトは変わらない)。
 */
import type { NoteAccountContext } from '@a2p/contracts/agents/anp';

/** プロンプトに載せる知見の件数と 1 件あたりの文字数 (プロンプト肥大の天井)。 */
const FINDINGS_IN_PROMPT = 5;
const FINDING_CHARS = 240;

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

/**
 * F-ANP-58: 実データ源の宣言 (`settings_json.data_source`) をプロンプトへ注入する行。
 * 役割プロンプト本文は全アカウント共有なので、アカウントごとに変わる「データを持つか」はここから渡す。
 * データ源なしのアカウントには、母集団の統計を所見にしないよう明示する (プロンプトの規則を発動させる前提情報)。
 */
export function dataSourceLines(account: Pick<NoteAccountContext, 'data_source'>): string[] {
  const ds = account.data_source?.trim();
  if (ds) {
    return [
      '',
      `【実データ源 (運営者宣言): ${ds}】`,
      '率・件数・回収率などの統計は、この範囲のデータから実際に出したものだけを書く。期間・件数・条件を必ず併記する。',
    ];
  }
  return [
    '',
    '【実データ源: なし (運営者設定・必ず守る)】',
    'このアカウントはレース結果・販売実績・アンケートなどの集計できる実データを持っていない。',
    '- 母集団 (レース・人・商品の集まり) に対する率・標本数を、所見として企画も記述もしない',
    '  (回収率・複勝率・勝率・的中率・n=・サンプル数・「N年分を集計」「帯別の〜率」など)。',
    '- 具体性は、手順の工程数・判断基準の個数・著者自身が実測した時間/件数で満たす。',
    '- 架空の題材は入力素材としてなら使ってよいが、そこから出した率や件数を所見として書かない。',
  ];
}

/**
 * F-ANP-56: 週次リサーチ (`anp.research`) の成果をプロンプトへ注入する行。
 *
 * 役割プロンプト本文 (prompts テーブル) は**全アカウント共有**なので、アカウント固有の
 * 勝ち筋をそこに焼き込むと他アカウントに漏れる。必ずこの経路 (実行時注入) を通す。
 *
 * @param kinds 載せる項目。エージェントによって要るものが違うので選べるようにする
 *              (例: anp.seo はコピー規則、anp.theme は題材)。
 */
export function accountResearchLines(
  account: Pick<NoteAccountContext, 'research'>,
  kinds: ReadonlyArray<'patterns' | 'topics' | 'copy' | 'findings'> = [
    'patterns',
    'topics',
    'copy',
  ],
): string[] {
  const r = account.research;
  if (!r) return [];
  const want = new Set(kinds);
  const lines: string[] = [];

  if (want.has('patterns') && r.winning_patterns.length > 0) {
    lines.push('', '【今このアカウントで効いている記事の型 (週次リサーチ)】', ...r.winning_patterns.map((p) => `- ${p}`));
  }
  if (want.has('findings') && r.findings.length > 0) {
    // 知見は最大 10 件 × (600 + 600 字) まで入りうるのでプロンプトが膨らむ。
    // タイトル/構成の判断に効くのは上位数件なので、件数と長さを切る。
    //
    // 2026-10-14 の実測でこの経路が必要だと分かった: 競馬アカウントのリサーチが
    // 「note 公式の競馬トピックに並ぶのは例外なく『開催日＋レース名』始まり。
    //  条件語始まりの当アカウント 20 本は競馬面に乗っていない」という決定的な知見を
    // 出したのに、それが `findings` にしか無く `anp.seo` へ渡っていなかったため、
    // 再生成されたタイトルも条件語始まりのままだった。
    const top = r.findings.slice(0, FINDINGS_IN_PROMPT);
    lines.push(
      '',
      '【週次リサーチの知見 (タイトル・構成の判断材料)】',
      ...top.map((f) => {
        const body = f.finding.slice(0, FINDING_CHARS);
        const imp = f.implication ? ` → ${f.implication.slice(0, FINDING_CHARS)}` : '';
        return `- ${body}${imp}`;
      }),
    );
  }
  if (want.has('topics')) {
    if (r.topics_to_pursue.length > 0) {
      lines.push('', '【次に狙う題材 (週次リサーチ)】', ...r.topics_to_pursue.map((t) => `- ${t}`));
    }
    if (r.topics_to_avoid.length > 0) {
      lines.push(
        '',
        '【避ける題材 (週次リサーチ・飽和/規約リスク/読者が離れる)】',
        ...r.topics_to_avoid.map((t) => `- ${t}`),
      );
    }
  }
  if (want.has('copy') && r.copy_rules.length > 0) {
    lines.push('', '【コピーの作り方 (週次リサーチ)】', ...r.copy_rules.map((c) => `- ${c}`));
  }
  return lines;
}

/**
 * 運営者の追加指示を「最優先」として**プロンプトの最後**に置くブロック (2026-10-15)。
 *
 * 運営者指摘:
 *   「AIへの指示をしてから戦略を作りなおしているのにあんまり反映されない」
 *
 * 原因は配線ではなく**位置**だった。`anp.strategist` の 4 つのプロンプト
 * (設計案 / プロフィール素材 / 記事の方針 / 販促施策) はいずれも
 * 「【運営者からの追加指示 (必ず反映)】」を**前方**に置き、その**後ろ**に
 * 「要件:」として字数・構成・含める項目を細かく指示していた。
 * 後に書かれた具体的な既定が勝つため、追加指示は実質無視されていた。
 *
 * 2026-10-14 の ANP アイキャッチ (`art_direction` が既定の配色指示に負けた) と
 * 同日 A2P の writer プロンプト (「常に厳守」がフィクション方針を打ち消した) と
 * **まったく同じ構図**。教訓はそのとき既に書いてあった:
 * 「注入トークンを足しても強い既定より後ろに置いたら負ける。
 *   『誰が最優先か』を本文に明示して初めて効く。」
 *
 * **出力形式 (JSON) と媒体の字数上限は譲らない** — これはモデルの裁量ではなく
 * note 側の制約なので、追加指示で上書きされると保存時に弾かれる。
 */
export function operatorInstructionLines(instruction?: string | null): string[] {
  const text = typeof instruction === 'string' ? instruction.trim() : '';
  if (!text) return [];
  return [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '【運営者からの追加指示 — これが最優先】',
    text,
    '',
    '上の「要件」と矛盾する場合は、**この追加指示に従ってください**。',
    'ただし出力形式 (JSON) と字数上限は媒体側の制約なので必ず守ること。',
    '追加指示で触れられていない項目だけ、要件の既定をそのまま適用します。',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
  ];
}
