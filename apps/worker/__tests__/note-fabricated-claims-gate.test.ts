/**
 * F-ANP-58 — 実データ源を持たないアカウントに、母集団の統計を所見とする記事を作らせない・売らせない。
 * 入力は全て本番の公開記事の原文 (packages/contracts/__tests__/fixtures/anp-fabricated-claims.ts)。
 * 企画 (generate / auto) / 有料ゲート (judge) / 後付け有料化 (monetize) の 3 層を通しで確認する。
 */
import { describe, expect, it, vi } from 'vitest';

import type { NoteJudgeOutput, NoteThemeOutput } from '@a2p/contracts/agents/anp';
import type { Logger } from '@a2p/contracts/logger';

import {
  AGGREGATION_CLAIM_TITLES,
  OWN_LOG_SENTENCES,
  POPULATION_STAT_SENTENCES,
  PROCEDURE_TITLES,
} from '@a2p/contracts/test-fixtures/anp-fabricated-claims';
import { runNoteThemeAuto, type NoteThemeAutoPrisma } from '../src/tasks/note-theme-auto.js';
import { runNoteThemeGenerate, type NoteThemeGeneratePrisma } from '../src/tasks/note-theme-generate.js';
import {
  resolveFinalPricing,
  runPipelineNoteJudge,
  type AddJobLike,
  type PipelineNoteJudgePrisma,
} from '../src/tasks/pipeline-note-judge.js';
import { runPipelineNoteMonetize, type PipelineNoteMonetizePrisma } from '../src/tasks/pipeline-note-monetize.js';
import type { NotePublishPort } from '../src/tasks/note-publish/playwright-note-publish-port.js';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() } as unknown as Logger;
}

const DATA_SOURCE = 'JRA-VAN 過去10年の全レース結果';

/** 集計を売る仮題と、手順・判断基準の仮題を混ぜた候補 (全て実際に発注された仮題)。 */
function mixedCandidates(): NoteThemeOutput {
  return {
    candidates: [...AGGREGATION_CLAIM_TITLES, ...PROCEDURE_TITLES].map((title) => ({
      title,
      hook: '読んで再現できる',
      recommend_paid: true,
      suggested_price: 680,
      genre: 'horse',
    })),
  };
}

// ---------------------------------------------------------------------------
// 企画で落とす — note.theme.generate
// ---------------------------------------------------------------------------

function buildGeneratePrisma(settingsJson: unknown) {
  const createMany: Array<{ data: Array<{ title: string }> }> = [];
  const jobUpdates: Array<{ data: Record<string, unknown> }> = [];
  const prisma: NoteThemeGeneratePrisma = {
    job: {
      findUnique: async () => ({ status: 'queued' }),
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => {
        jobUpdates.push({ data: data as Record<string, unknown> });
        return {};
      },
    },
    noteAccount: {
      // select したキーだけ返す (select 漏れで settings_json が届かない事故を見逃さない)。
      findUnique: async ({ select }) => {
        const found: Record<string, unknown> = { id: 'acc1', niche: '競馬予想', target_reader: null, tone: null, settings_json: settingsJson };
        const row: Record<string, unknown> = {};
        for (const k of Object.keys(select)) row[k] = found[k] ?? null;
        return row as never;
      },
    },
    noteTheme: {
      findMany: async () => [],
      createMany: async (args) => {
        createMany.push(args as never);
        return { count: args.data.length };
      },
    },
  };
  return { prisma, createMany, jobUpdates };
}

describe('F-ANP-58 企画: note.theme.generate', () => {
  it('データ源なし: 集計を売る仮題だけを落とし、落とした仮題と理由を result_json に残す', async () => {
    const { prisma, createMany, jobUpdates } = buildGeneratePrisma({});
    const generateThemes = vi.fn().mockResolvedValue(mixedCandidates());

    await runNoteThemeGenerate({ note_account_id: 'acc1', job_id: 'j1', count: 5 }, { prisma, logger: makeLogger(), generateThemes });

    expect(createMany[0]!.data.map((d) => d.title)).toEqual([...PROCEDURE_TITLES]);
    const result = jobUpdates.find((u) => u.data.status === 'done')!.data.result_json as {
      candidate_count: number;
      generated_count: number;
      dropped_aggregation_count: number;
      dropped_aggregation: Array<{ title: string; reasons: string[] }>;
      outcome?: string;
    };
    expect(result.candidate_count).toBe(PROCEDURE_TITLES.length);
    expect(result.generated_count).toBe(AGGREGATION_CLAIM_TITLES.length + PROCEDURE_TITLES.length);
    expect(result.dropped_aggregation_count).toBe(AGGREGATION_CLAIM_TITLES.length);
    expect(result.dropped_aggregation.map((d) => d.title)).toEqual([...AGGREGATION_CLAIM_TITLES]);
    expect(result.dropped_aggregation.every((d) => d.reasons.length > 0)).toBe(true);
    expect(result.outcome).toBeUndefined();
  });

  it('データ源あり (宣言済み): 何も落とさず、エージェントにも宣言が届く', async () => {
    const { prisma, createMany } = buildGeneratePrisma({ data_source: DATA_SOURCE });
    const generateThemes = vi.fn().mockResolvedValue(mixedCandidates());

    await runNoteThemeGenerate({ note_account_id: 'acc1', job_id: 'j1', count: 5 }, { prisma, logger: makeLogger(), generateThemes });

    expect(createMany[0]!.data).toHaveLength(AGGREGATION_CLAIM_TITLES.length + PROCEDURE_TITLES.length);
    expect(generateThemes).toHaveBeenCalledWith(expect.objectContaining({ account: expect.objectContaining({ data_source: DATA_SOURCE }) }));
  });

  it('全件が落ちても黙って 0 件にしない: createMany せず、理由つきで done にする', async () => {
    const { prisma, createMany, jobUpdates } = buildGeneratePrisma(null);
    const generateThemes = vi.fn().mockResolvedValue({
      candidates: AGGREGATION_CLAIM_TITLES.map((title) => ({ title, hook: 'h', recommend_paid: true, genre: 'horse' })),
    } satisfies NoteThemeOutput);

    await runNoteThemeGenerate({ note_account_id: 'acc1', job_id: 'j1', count: 5 }, { prisma, logger: makeLogger(), generateThemes });

    expect(createMany).toHaveLength(0);
    const done = jobUpdates.find((u) => u.data.status === 'done')!;
    expect(done.data.result_json).toMatchObject({
      candidate_count: 0,
      outcome: 'all_dropped_aggregation_without_data_source',
      dropped_aggregation_count: AGGREGATION_CLAIM_TITLES.length,
    });
  });
});

// ---------------------------------------------------------------------------
// 企画で落とす — note.theme.auto (無人運転の主経路)
// ---------------------------------------------------------------------------

describe('F-ANP-58 企画: note.theme.auto', () => {
  function buildAutoPrisma(settingsJson: unknown) {
    const themeCreates: Array<{ title: string }> = [];
    const jobUpdates: Array<{ data: Record<string, unknown> }> = [];
    const prisma: NoteThemeAutoPrisma = {
      appSettings: { findUnique: async () => ({ anp_auto_theme_enabled: true, anp_themes_per_day: 20, anp_autopass_enabled: false }) },
      noteAccount: {
        findMany: async () => [{ id: 'acc1', niche: '競馬予想', target_reader: null, tone: null, settings_json: settingsJson }],
      },
      noteTheme: {
        findMany: async () => [],
        create: async ({ data }: { data: { title: string; note_account_id: string; recommend_paid: boolean; suggested_price: number | null } }) => {
          themeCreates.push({ title: data.title });
          return { id: `t${themeCreates.length}`, note_account_id: data.note_account_id, title: data.title, recommend_paid: data.recommend_paid, suggested_price: data.suggested_price };
        },
        updateMany: async () => ({ count: 1 }),
      },
      noteArticle: { create: async () => ({ id: 'a' }) },
      job: {
        create: async () => ({ id: 'gen1' }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          jobUpdates.push({ data: data as Record<string, unknown> });
          return {};
        },
      },
    } as unknown as NoteThemeAutoPrisma;
    return { prisma, themeCreates, jobUpdates };
  }

  it('データ源なし: 集計を売る仮題を NoteTheme にしない。結果とジョブに落とした仮題が残る', async () => {
    const { prisma, themeCreates, jobUpdates } = buildAutoPrisma({});
    const result = await runNoteThemeAuto({ prisma, logger: makeLogger(), generateThemes: async () => mixedCandidates() });

    expect(themeCreates.map((t) => t.title)).toEqual([...PROCEDURE_TITLES]);
    expect(result.accounts[0]!.dropped_aggregation?.map((d) => d.title)).toEqual([...AGGREGATION_CLAIM_TITLES]);
    const done = jobUpdates.find((u) => u.data.status === 'done')!;
    expect(done.data.result_json).toMatchObject({ dropped_aggregation_count: AGGREGATION_CLAIM_TITLES.length });
  });

  it('データ源あり: 全件通す', async () => {
    const { prisma, themeCreates } = buildAutoPrisma({ data_source: DATA_SOURCE });
    await runNoteThemeAuto({ prisma, logger: makeLogger(), generateThemes: async () => mixedCandidates() });
    expect(themeCreates).toHaveLength(AGGREGATION_CLAIM_TITLES.length + PROCEDURE_TITLES.length);
  });
});

// ---------------------------------------------------------------------------
// 有料にしない — pipeline.note.judge
// ---------------------------------------------------------------------------

const PASS: NoteJudgeOutput = {
  score_total: 90,
  score_breakdown: { hook_strength: 90, readability: 90, paid_conversion: 90, search_inflow: 90 },
  judge_comments: {},
  recommend_paid: true,
  suggested_price_jpy: 680,
};

/** 本番で有料販売されていた型の本文 (母集団の統計を所見として書いている)。 */
const FABRICATED_BODY = [
  'まず結論です。',
  POPULATION_STAT_SENTENCES[0]!,
  POPULATION_STAT_SENTENCES[1]!,
  '次に確認の手順を見ます。',
].join('\n\n');

/** 同じく本番の、著者自身の作業ログだけで組んだ本文。 */
const OWN_LOG_BODY = ['まず結論です。', ...OWN_LOG_SENTENCES].join('\n\n');

async function runJudge(settingsJson: unknown, bodyMd: string) {
  const articleUpdates: Array<Record<string, unknown>> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const prisma = {
    job: {
      findUnique: async () => ({ status: 'queued' }),
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        jobUpdates.push(data);
        return {};
      },
      create: async () => ({ id: 'child' }),
    },
    noteArticle: {
      findUnique: async () => ({
        id: 'art1',
        note_account_id: 'acc1',
        title: '競馬の見送り基準',
        lead: 'リード文',
        body_md: bodyMd,
        paid: true,
        price_jpy: 680,
        paywall_line_pos: 120,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        articleUpdates.push(data);
        return {};
      },
    },
    tokenUsage: { findMany: async () => [] },
    noteAccount: {
      findUnique: async () => ({ id: 'acc1', niche: '競馬予想', target_reader: null, settings_json: settingsJson }),
    },
  } as unknown as PipelineNoteJudgePrisma;
  await runPipelineNoteJudge({ note_article_id: 'art1', job_id: 'job1', retry_count: 0 }, vi.fn() as unknown as AddJobLike, {
    prisma,
    logger: makeLogger(),
    judgeArticle: vi.fn().mockResolvedValue(PASS),
    acquireLock: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn().mockResolvedValue(undefined),
  });
  return { article: articleUpdates[0]!, job: jobUpdates.find((u) => u.status === 'done')! };
}

describe('F-ANP-58 有料にしない: pipeline.note.judge', () => {
  it('データ源なし + 母集団の統計を所見に書いた記事: 有料許可アカウントでも paid=false。理由が result_json に残る', async () => {
    const { article, job } = await runJudge({ paid_publish_enabled: true }, FABRICATED_BODY);
    expect(article).toMatchObject({ status: 'ready', paid: false, price_jpy: 680, paywall_line_pos: null });
    expect(job.result_json).toMatchObject({
      population_stat_without_data_source: true,
      paid_blocked_reason: 'population_stat_without_data_source',
    });
    const hits = (job.result_json as { population_stat_hits: Array<{ sentence: string; reason: string }> }).population_stat_hits;
    expect(hits.map((h) => h.sentence)).toEqual([POPULATION_STAT_SENTENCES[0], POPULATION_STAT_SENTENCES[1]]);
  });

  it('「架空」と開示した記事も、開示のない記事と同じく有料にしない (開示語で弾かない)', async () => {
    const disclosed = ['まず結論です。', POPULATION_STAT_SENTENCES[8]!, POPULATION_STAT_SENTENCES[9]!].join('\n\n');
    const { article } = await runJudge({ paid_publish_enabled: true }, disclosed);
    expect(article).toMatchObject({ paid: false });
  });

  it('データ源を宣言していれば有料のまま通る', async () => {
    const { article, job } = await runJudge({ paid_publish_enabled: true, data_source: DATA_SOURCE }, FABRICATED_BODY);
    expect(article).toMatchObject({ status: 'ready', paid: true, price_jpy: 680, paywall_line_pos: 120 });
    expect(job.result_json).not.toHaveProperty('population_stat_without_data_source');
  });

  it('著者自身の作業ログだけの記事は、データ源が無くても有料のまま (巻き込まない)', async () => {
    const { article } = await runJudge({ paid_publish_enabled: true }, OWN_LOG_BODY);
    expect(article).toMatchObject({ status: 'ready', paid: true, price_jpy: 680, paywall_line_pos: 120 });
  });

  it('resolveFinalPricing: ゲートは paid の判断より先に効き、価格の提案は消さない', () => {
    const judged = PASS;
    const article = { paid: true, price_jpy: 500, paywall_line_pos: 100 };
    expect(resolveFinalPricing(article, judged, true, null)).toEqual({ paid: true, price_jpy: 680 });
    expect(
      resolveFinalPricing(article, judged, true, { claims: true, hits: [{ sentence: 's', reason: 'r' }] }),
    ).toEqual({ paid: false, price_jpy: 680, blockedReason: 'population_stat_without_data_source' });
  });
});

// ---------------------------------------------------------------------------
// 後付けの有料化も拒否 — pipeline.note.monetize
// ---------------------------------------------------------------------------

describe('F-ANP-58 後付け有料化: pipeline.note.monetize', () => {
  async function runMonetize(settingsJson: unknown, bodyMd: string) {
    const jobUpdates: Array<Record<string, unknown>> = [];
    const articleUpdates: Array<Record<string, unknown>> = [];
    const monetizeCalls: unknown[] = [];
    const prisma = {
      appSettings: { findUnique: async () => ({ anp_publish_dry_run: false }) },
      job: {
        findUnique: async () => ({ status: 'queued' }),
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          jobUpdates.push(data);
          return {};
        },
      },
      noteArticle: {
        findUnique: async () => ({
          id: 'a1',
          note_account_id: 'acc1',
          title: '競馬の見送り基準',
          body_md: bodyMd,
          paid: false,
          price_jpy: 480,
          paywall_line_pos: null,
          note_url: 'https://note.com/x/n/n1234abcd',
          status: 'published',
          publish_status: 'published',
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          articleUpdates.push(data);
          return {};
        },
      },
      noteAccount: {
        findUnique: async () => ({
          id: 'acc1',
          display_name: '馬券術',
          session_state_enc: 'enc',
          monetization_policy_json: { free_ratio: 0.3 },
          settings_json: settingsJson,
        }),
        update: async () => ({}),
      },
      noteAuthRequest: { findFirst: async () => null, create: async () => ({ id: 'r' }) },
    } as unknown as PipelineNoteMonetizePrisma;
    const publishPort = {
      monetizeOne: async (a: unknown) => {
        monetizeCalls.push(a);
        return { ok: true, status: 'monetized', noteUrl: 'u' };
      },
    } as unknown as NotePublishPort;
    const res = await runPipelineNoteMonetize(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      {
        prisma,
        publishPort,
        logger: makeLogger(),
        acquireLock: async () => ({}) as never,
        releaseLock: async () => ({}) as never,
        decryptSession: () => 's',
        notify: async () => true,
      },
    );
    return { res, jobUpdates, articleUpdates, monetizeCalls };
  }

  const paragraphs = (...ps: string[]) => ['# 導入', ...ps.flatMap((p, i) => [`## 章${i + 1}`, p])].join('\n\n');

  it('データ源なし + 母集団の統計: 明示的な理由で終わり、note には触れず、記事も変えない', async () => {
    const { res, jobUpdates, articleUpdates, monetizeCalls } = await runMonetize(
      { paid_publish_enabled: true },
      paragraphs(POPULATION_STAT_SENTENCES[0]!, POPULATION_STAT_SENTENCES[1]!, '手順です。', 'まとめです。'),
    );
    expect(res).toMatchObject({ ok: false, status: 'population_stat_without_data_source' });
    expect(monetizeCalls).toHaveLength(0);
    expect(articleUpdates).toHaveLength(0);
    expect(jobUpdates.at(-1)).toMatchObject({ status: 'done', result_json: { status: 'population_stat_without_data_source' } });
  });

  it('データ源あり: 有料化に進む', async () => {
    const { res, monetizeCalls } = await runMonetize(
      { paid_publish_enabled: true, data_source: DATA_SOURCE },
      paragraphs(POPULATION_STAT_SENTENCES[0]!, POPULATION_STAT_SENTENCES[1]!, '手順です。', 'まとめです。'),
    );
    expect(res).toMatchObject({ ok: true, status: 'monetized' });
    expect(monetizeCalls).toHaveLength(1);
  });

  it('著者自身の作業ログだけの記事は、データ源が無くても有料化できる', async () => {
    const { res } = await runMonetize({ paid_publish_enabled: true }, paragraphs(...OWN_LOG_SENTENCES.slice(0, 4)));
    expect(res).toMatchObject({ ok: true, status: 'monetized' });
  });
});
