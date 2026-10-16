/**
 * F-ANP-56 — anp.research (note アカウント別 週次リサーチ) エージェント単体テスト。
 *
 * 観点そのものをアカウントごとに決める 2 段構成なので、
 *  - 段階 1 (観点決定) の出力が段階 2 のプロンプトとレポートの angles に反映されること
 *  - 検索が使えない/失敗しても落ちずに続行すること
 *  - 観点決定が壊れてもリサーチ全体を止めないこと
 * を主に検証する。
 */
import { describe, expect, it, vi } from 'vitest';

import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type {
  NoteAccountConsultResearchItem,
  NoteAccountResearchInput,
} from '@a2p/contracts/agents/anp';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { researchNoteAccount } = await import('../../src/anp/research.js');
import type { ResearchNoteAccountDeps } from '../../src/anp/research.js';

const PLAN = JSON.stringify({
  angles: [
    {
      angle: '競馬 note で伸びている回収率の見せ方',
      why: '当アカウントの有料記事は回収率の提示が弱く離脱している',
      queries: ['note 競馬 回収率 有料記事 2026', '競馬 予想 note 人気'],
    },
  ],
});

const REPORT = JSON.stringify({
  findings: [
    {
      angle: '競馬 note で伸びている回収率の見せ方',
      finding: '単月の的中率ではなく回収率の推移グラフを冒頭に置く記事が伸びている',
      implication: '導入に回収率の推移を置き、根拠を先に見せる',
      sources: ['https://note.com/example/n/abc'],
    },
  ],
  winning_patterns: ['冒頭に回収率の実績を数字で出す', '買い目は無料、根拠を有料にする'],
  art_direction: 'ターフの緑と馬群のシルエットを遠景に、数字パネルを前面に置く。人物の顔は入れない。',
  copy_rules: ['数字を必ず1つ入れる (回収率/人気順)', '煽り表現は使わない'],
  topics_to_pursue: ['夏ローカルのハンデ重賞'],
  topics_to_avoid: ['絶対儲かる系の断定'],
  editorial_policy_suggestion: '根拠パートの先頭に回収率の推移を置く点を追記する',
  summary: '回収率の見せ方が勝敗を分けている。',
});

function makeClient(
  texts: string[],
  /** 呼び出しごとの出力トークン数。出力上限で切れた回を再現するのに使う。 */
  outputTokens: number[] = [],
): { client: LLMClient; calls: LLMCompleteArgs[] } {
  const calls: LLMCompleteArgs[] = [];
  let i = 0;
  const complete = async <T = string>(a: LLMCompleteArgs): Promise<LLMCompleteResult<T>> => {
    calls.push(a);
    const text = texts[Math.min(i, texts.length - 1)]!;
    const out = outputTokens[i] ?? 200;
    i += 1;
    return {
      text: text as unknown as T,
      usage: { inputTokens: 300, outputTokens: out },
      costJpy: 0,
      provider: 'anthropic',
      model: 'claude-opus-5',
    };
  };
  return {
    client: {
      complete: vi.fn(complete) as LLMClient['complete'],
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('unused');
      },
    },
    calls,
  };
}

function makeDeps(
  texts: string[],
  over: Partial<ResearchNoteAccountDeps> = {},
  outputTokens: number[] = [],
): { deps: ResearchNoteAccountDeps; calls: LLMCompleteArgs[] } {
  const { client, calls } = makeClient(texts, outputTokens);
  return {
    deps: {
      loadActivePrompt: (async () => ({
        template: '# anp.research システムプロンプト',
        version: 1,
        promptId: 'p1',
        genre: null,
      })) as unknown as ResearchNoteAccountDeps['loadActivePrompt'],
      createAgentClient: (async () => client) as unknown as ResearchNoteAccountDeps['createAgentClient'],
      resolveTavilyKey: async () => null,
      // F-ANP-57: 既定では競合サムネの収集を止める (テストが外部 fetch を踏まないように)。
      // この工程を検証するテストは個別に DI を差し替える。
      skipRivalEyecatches: true,
      ...over,
    },
    calls,
  };
}

const INPUT: NoteAccountResearchInput = {
  noteAccountId: 'acc-1',
  account: {
    niche: '競馬予想',
    target_reader: '週末だけ馬券を買う会社員',
    tone: '冷静・データ重視',
    editorial_policy: '断定しない。資金管理を必ず添える。',
  },
  recentArticles: [
    { title: '夏の新潟・回収率メモ', views: 820, likes: 12, sales_jpy: 3200, is_paid: true },
    { title: '今週の買い目', views: 140, likes: 2, is_paid: false },
  ],
  previous: null,
};

describe('researchNoteAccount', () => {
  it('観点を決めてからまとめ、成果を返す', async () => {
    const { deps } = makeDeps([PLAN, REPORT]);
    const { research } = await researchNoteAccount(INPUT, deps);

    expect(research.angles).toHaveLength(1);
    expect(research.angles[0]!.angle).toBe('競馬 note で伸びている回収率の見せ方');
    expect(research.angles[0]!.queries).toHaveLength(2);
    expect(research.art_direction).toContain('ターフの緑');
    expect(research.copy_rules).toContain('煽り表現は使わない');
    expect(research.topics_to_avoid).toContain('絶対儲かる系の断定');
    expect(research.editorial_policy_suggestion).not.toBe('');
  });

  it('観点は段階 1 の計画を正とする (まとめ段で言い換えられても追跡できる)', async () => {
    // まとめ段が別の angles を返しても、計画側で上書きする。
    const reportWithOtherAngles = JSON.stringify({
      ...JSON.parse(REPORT),
      angles: [{ angle: '勝手に言い換えた観点', queries: [] }],
    });
    const { deps } = makeDeps([PLAN, reportWithOtherAngles]);
    const { research } = await researchNoteAccount(INPUT, deps);
    expect(research.angles.map((a) => a.angle)).toEqual(['競馬 note で伸びている回収率の見せ方']);
  });

  it('アカウント情報・実績・前回結果がプロンプトに入る', async () => {
    const { deps, calls } = makeDeps([PLAN, REPORT]);
    await researchNoteAccount(
      {
        ...INPUT,
        previous: {
          angles: [],
          findings: [],
          winning_patterns: ['前回の勝ち型'],
          art_direction: '前回の画作り',
          copy_rules: [],
          topics_to_pursue: ['前回狙った題材'],
          topics_to_avoid: [],
          editorial_policy_suggestion: '',
          summary: '前回の総括',
          art_direction_evidence: [],
          rival_eyecatches: null,
          preferred_style_keys: [],
        },
      },
      deps,
    );
    const plan = String(calls[0]!.messages[1]!.content);
    expect(plan).toContain('競馬予想');
    expect(plan).toContain('週末だけ馬券を買う会社員');
    // 実績 (伸びた記事と伸びなかった記事の差) を観点決定の材料に渡す
    expect(plan).toContain('夏の新潟・回収率メモ');
    expect(plan).toContain('閲覧820');
    // 同じ知見を繰り返させない
    expect(plan).toContain('前回の勝ち型');
    expect(plan).toContain('前回の総括');
  });

  it('検索結果があれば根拠として渡し、無ければ推測を禁じる', async () => {
    const items: NoteAccountConsultResearchItem[] = [
      { query: 'q', title: '回収率の見せ方', url: 'https://note.com/x', snippet: '推移グラフ' },
    ];
    const withSearch = makeDeps([PLAN, REPORT], { search: async () => items });
    await researchNoteAccount(INPUT, withSearch.deps);
    const report = String(withSearch.calls[1]!.messages[1]!.content);
    expect(report).toContain('検索で得られた一次情報');
    expect(report).toContain('https://note.com/x');

    const noSearch = makeDeps([PLAN, REPORT]);
    await researchNoteAccount(INPUT, noSearch.deps);
    const report2 = String(noSearch.calls[1]!.messages[1]!.content);
    expect(report2).toContain('検索結果なし');
    expect(report2).toContain('外部トレンドを装った記述はしない');
  });

  it('Tavily キーが無ければ検索せずに続行する', async () => {
    const { deps } = makeDeps([PLAN, REPORT], { resolveTavilyKey: async () => null });
    const { items } = await researchNoteAccount(INPUT, deps);
    expect(items).toEqual([]);
  });

  it('検索が失敗しても落ちない (クエリ単位で捨てる)', async () => {
    const { deps } = makeDeps([PLAN, REPORT], {
      search: async () => {
        throw new Error('tavily 503');
      },
    });
    const { research, items } = await researchNoteAccount(INPUT, deps);
    expect(items).toEqual([]);
    expect(research.summary).not.toBe('');
  });

  it('観点決定が空振りしてもニッチ由来のクエリで検索する (外部情報ゼロにしない)', async () => {
    // 2026-10-14 本番の初回実行: 観点が 0 件返り、クエリが出ないため検索が走らず
    // 「外部情報ゼロ」のリサーチになっていた。空振り時はニッチから機械的にクエリを作る。
    const searched: string[] = [];
    const { deps } = makeDeps(['これは JSON ではない', 'これも JSON ではない', REPORT], {
      search: async (q: string) => {
        searched.push(q);
        return [];
      },
    });
    const { research } = await researchNoteAccount(INPUT, deps);
    expect(research.angles).toHaveLength(1);
    // 観点名はアカウントのニッチから派生する (アカウントごとに違う点は保つ)
    expect(research.angles[0]!.angle).toContain('競馬予想');
    expect(searched.some((q) => q.includes('競馬予想'))).toBe(true);
  });

  it('観点決定は空振りしたら作り直す', async () => {
    // 1 回目は壊れた JSON、2 回目は正常 → 計画を採用する (フォールバックに落ちない)。
    const { deps } = makeDeps(['壊れた応答', PLAN, REPORT]);
    const { research } = await researchNoteAccount(INPUT, deps);
    expect(research.angles[0]!.angle).toBe('競馬 note で伸びている回収率の見せ方');
  });

  it('まとめの JSON が壊れていれば AgentError', async () => {
    const { deps } = makeDeps([PLAN, 'JSON ではない応答']);
    await expect(researchNoteAccount(INPUT, deps)).rejects.toBeInstanceOf(AgentError);
  });

  it('観点とクエリの数には上限がある (コストの天井)', async () => {
    const hugePlan = JSON.stringify({
      angles: Array.from({ length: 9 }, (_, i) => ({
        angle: `観点${i}`,
        queries: Array.from({ length: 9 }, (_, j) => `q${i}-${j}`),
      })),
    });
    const searched: string[] = [];
    const { deps } = makeDeps([hugePlan, REPORT], {
      search: async (q: string) => {
        searched.push(q);
        return [];
      },
    });
    const { research } = await researchNoteAccount(INPUT, deps);
    expect(research.angles.length).toBeLessThanOrEqual(4);
    for (const a of research.angles) expect(a.queries.length).toBeLessThanOrEqual(5);
    expect(searched.length).toBeLessThanOrEqual(8);
  });
  // --- 2026-10-15: 出力上限で切れた回の扱い (本番で競馬アカウントが 8192/8192 で
  //     切れ、同じ依頼を 2 回投げて 2 回とも同じ所で切れていた) ---

  it('出力上限で切れたら、そう書いたエラーにする (原因が運営者から追える)', async () => {
    // 2 回とも上限で切れた場合 (本番で起きた形)。最後のエラーが運営者に残る。
    const { deps } = makeDeps([PLAN, '{"findings": [{"finding": "途中で切れ'], {}, [200, 16384, 16384]);
    await expect(researchNoteAccount(INPUT, deps)).rejects.toThrow(/出力が上限/);
  });

  it('切れたときの再試行は要求を小さくして投げる (同じ依頼では同じ所で切れる)', async () => {
    const truncated = '{"findings": [{"finding": "途中で切れ';
    // 1 回目のまとめは上限で切れ、2 回目は量を削って成功する。
    const { deps, calls } = makeDeps([PLAN, truncated, REPORT], {}, [200, 16384, 900]);
    const { research } = await researchNoteAccount(INPUT, deps);
    expect(research.art_direction).toContain('ターフの緑');

    // calls[0] = 観点決定, calls[1] = まとめ 1 回目, calls[2] = まとめ 2 回目
    const first = String(calls[1]!.messages.at(-1)!.content);
    const retry = String(calls[2]!.messages.at(-1)!.content);
    expect(first).not.toContain('前回の出力は長すぎて途中で切れた');
    expect(retry).toContain('前回の出力は長すぎて途中で切れた');
    expect(retry).toContain('findings は最も重要な 3 件まで');
  });

  it('形が違うだけ (切れていない) なら再試行に削減指示を足さない', async () => {
    // 上限に達していない失敗は量の問題ではないので、同じ依頼で投げ直すのが正しい。
    const { deps, calls } = makeDeps([PLAN, 'JSON ではない応答', REPORT], {}, [200, 120, 900]);
    await researchNoteAccount(INPUT, deps);
    expect(String(calls[2]!.messages.at(-1)!.content)).not.toContain('前回の出力は長すぎて途中で切れた');
  });
});

/**
 * F-ANP-57 — 画作りの根拠を「実物のサムネ」に縛る。
 *
 * 2026-10-16 運営者指摘「note のサムネ作成ちゃんと市場分析をしたうえで作成してる？」の調査で、
 * リサーチは Tavily のテキストしか見ていないのに art_direction (被写体・構図・色・質感) を
 * 書いていたことが判明した。本番の競馬アカウントは「曇天の芝・低彩度」になっていたが、
 * 同じリサーチが見つけた note 競馬面の実物は黒地×金×煽りで正反対だった。
 */
describe('researchNoteAccount — 競合サムネの実物観察 (F-ANP-57)', () => {
  const items: NoteAccountConsultResearchItem[] = [
    { query: 'q', title: 'note 競馬トピック', url: 'https://note.com/topic/keiba' },
  ];

  function shot(i: number) {
    return {
      articleUrl: `https://note.com/u${i}/n/n${i}`,
      title: `記事${i}`,
      imageUrl: `https://img.example/${i}.jpg`,
      image: Buffer.from(`img${i}`),
      mimeType: 'image/jpeg',
    };
  }

  const OBSERVATION = {
    shots: [
      {
        image_url: 'https://img.example/1.jpg',
        article_url: 'https://note.com/u1/n/n1',
        subject: '黒地に金の装飾文字とレース名',
        composition: '文字が画面の 7 割',
        colors: '黒地・金・赤の差し色',
        text: '12 字前後を 2 行、金の多重縁取り',
      },
    ],
    common_patterns: ['黒地に金の太字', '開催日とレース名を必ず入れる'],
    our_gap: '低彩度の実写に寄りすぎてタイムラインで埋もれている',
  };

  it('実物を見たら art_direction_evidence に URL が入り、観察がまとめ段に渡る', async () => {
    const { deps, calls } = makeDeps([PLAN, REPORT], {
      search: async () => items,
      skipRivalEyecatches: false,
      collectRivalEyecatches: (async () => [shot(1), shot(2)]) as never,
      observeRivalEyecatches: (async () => OBSERVATION) as never,
    });
    const { research, rivalShots } = await researchNoteAccount(INPUT, deps);

    expect(rivalShots).toBe(2);
    // 「見た」と言わせるのではなく、実際に取得できた画像の URL を正とする
    expect(research.art_direction_evidence).toEqual([
      'https://img.example/1.jpg',
      'https://img.example/2.jpg',
    ]);
    expect(research.rival_eyecatches?.common_patterns).toContain('黒地に金の太字');

    const report = String(calls[1]!.messages[1]!.content);
    expect(report).toContain('競合サムネの実物 1 枚を見た結果');
    expect(report).toContain('黒地に金の装飾文字');
    expect(report).toContain('観察に書かれている要素だけ');
  });

  it('1 枚も見られなかったら evidence は空で、まとめ段に art_direction を空にさせる', async () => {
    const { deps, calls } = makeDeps([PLAN, REPORT], {
      search: async () => items,
      skipRivalEyecatches: false,
      collectRivalEyecatches: (async () => []) as never,
    });
    const { research, rivalShots } = await researchNoteAccount(INPUT, deps);

    expect(rivalShots).toBe(0);
    expect(research.art_direction_evidence).toEqual([]);
    expect(research.rival_eyecatches).toBeNull();

    const report = String(calls[1]!.messages[1]!.content);
    expect(report).toContain('競合サムネの実物: 見られなかった');
    expect(report).toContain('art_direction は空文字で返すこと');
  });

  it('観察が落ちてもリサーチは完走する (ベストエフォート)', async () => {
    const { deps } = makeDeps([PLAN, REPORT], {
      search: async () => items,
      skipRivalEyecatches: false,
      collectRivalEyecatches: (async () => [shot(1)]) as never,
      observeRivalEyecatches: (async () => {
        throw new Error('vision down');
      }) as never,
    });
    const { research, rivalShots } = await researchNoteAccount(INPUT, deps);
    expect(rivalShots).toBe(0);
    expect(research.art_direction_evidence).toEqual([]);
    expect(research.findings.length).toBeGreaterThan(0);
  });

  it('収集が落ちてもリサーチは完走する', async () => {
    const { deps } = makeDeps([PLAN, REPORT], {
      search: async () => items,
      skipRivalEyecatches: false,
      collectRivalEyecatches: (async () => {
        throw new Error('ECONNRESET');
      }) as never,
    });
    const { research } = await researchNoteAccount(INPUT, deps);
    expect(research.art_direction_evidence).toEqual([]);
  });

  it('観点決定のプロンプトが note の一覧ページに当たるクエリを要求する', async () => {
    const { deps, calls } = makeDeps([PLAN, REPORT]);
    await researchNoteAccount(INPUT, deps);
    const plan = String(calls[0]!.messages[1]!.content);
    expect(plan).toContain('note 記事そのものが並んでいる一覧');
  });
});

/**
 * F-ANP-57 — 自分たちのサムネの実績 (画風別) がリサーチに届くこと。
 * 記録はしていたのに渡していなかったので、画風の選択は実績と無関係なくじ引きだった。
 */
describe('researchNoteAccount — 自分のサムネ実績', () => {
  it('画風別の平均閲覧/スキがまとめ段に入る', async () => {
    const { deps, calls } = makeDeps([PLAN, REPORT]);
    await researchNoteAccount(
      {
        ...INPUT,
        recentArticles: [
          { title: 'A', views: 40, likes: 1, eyecatch_style: 'retro_poster' },
          { title: 'B', views: 20, likes: 3, eyecatch_style: 'retro_poster' },
          { title: 'C', views: 2, likes: 0, eyecatch_style: 'flat_editorial' },
        ],
      },
      deps,
    );
    const report = String(calls[1]!.messages[1]!.content);
    expect(report).toContain('自分たちのサムネの実績 (画風別)');
    expect(report).toContain('retro_poster: 2 本 / 平均閲覧 30.0');
    expect(report).toContain('flat_editorial: 1 本 / 平均閲覧 2.0');
    // 平均閲覧の降順で並べる (勝っている画風が先)
    expect(report.indexOf('retro_poster')).toBeLessThan(report.indexOf('flat_editorial'));
  });

  it('選べる画風キーを見せて preferred_style_keys で絞らせる (F-ANP-57b)', async () => {
    const { deps, calls } = makeDeps([PLAN, REPORT]);
    await researchNoteAccount(INPUT, deps);
    const report = String(calls[1]!.messages[1]!.content);
    expect(report).toContain('このアカウントで選べる画風キー');
    // 競馬ジャンルの札だけが出る (明るい系は出さない)
    expect(report).toContain('night_track_photo');
    expect(report).not.toContain('kawaii_mascot');
    expect(report).toContain('preferred_style_keys');
  });

  it('画風キーが 1 件も無ければブロックを出さない (空の表を見せない)', async () => {
    const { deps, calls } = makeDeps([PLAN, REPORT]);
    await researchNoteAccount(INPUT, deps);
    const report = String(calls[1]!.messages[1]!.content);
    expect(report).not.toContain('自分たちのサムネの実績');
  });
});
