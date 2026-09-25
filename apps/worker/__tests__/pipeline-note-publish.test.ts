import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';

import {
  extractNoteHandle,
  PIPELINE_NOTE_PUBLISH_TASK_NAME,
  runPipelineNotePublish,
  type PipelineNotePublishPrisma,
} from '../src/tasks/pipeline-note-publish.js';
import type { NotePublishPort, NotePublishResult } from '../src/tasks/note-publish/playwright-note-publish-port.js';

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
}

interface JobRecord {
  id: string;
  status: string;
}
interface ArticleRecord {
  id: string;
  note_account_id: string;
  title: string;
  body_md: string | null;
  paid: boolean;
  price_jpy: number | null;
  paywall_line_pos: number | null;
  eyecatch_r2_key: string | null;
  note_url: string | null;
  status: string;
  publish_status?: string;
  published_at?: Date | null;
}
interface AccountRecord {
  id: string;
  display_name: string;
  session_state_enc: string | null;
  status: string;
  handle: string | null;
}

function buildPrisma(args: {
  jobs: JobRecord[];
  articles: ArticleRecord[];
  accounts: AccountRecord[];
  anpPublishDryRun?: boolean;
}) {
  const jobs = [...args.jobs];
  const articles = [...args.articles];
  const accounts = [...args.accounts];
  const articleUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const accountUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobCreates: Array<Record<string, unknown>> = [];

  const prisma: PipelineNotePublishPrisma = {
    appSettings: {
      findUnique: async () => ({ anp_publish_dry_run: args.anpPublishDryRun ?? false }),
    },
    job: {
      findUnique: async ({ where }) => {
        const j = jobs.find((x) => x.id === where.id);
        return j ? { status: j.status } : null;
      },
      updateMany: async ({ where, data }) => {
        const matched = jobs.filter((j) => j.id === where.id && where.status.in.includes(j.status));
        for (const j of matched) j.status = data.status;
        return { count: matched.length };
      },
      update: async ({ where, data }) => {
        const j = jobs.find((x) => x.id === where.id);
        if (j && data.status) j.status = data.status;
        return { id: where.id };
      },
      create: async ({ data }) => {
        const id = `child-job-${jobs.length + 1}`;
        jobs.push({ id, status: data.status });
        jobCreates.push(data as Record<string, unknown>);
        return { id };
      },
    },
    noteArticle: {
      findUnique: async ({ where }) => articles.find((a) => a.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const a = articles.find((x) => x.id === where.id);
        if (a) Object.assign(a, data);
        articleUpdates.push({ where, data: data as Record<string, unknown> });
        return { id: where.id };
      },
    },
    noteAccount: {
      findUnique: async ({ where }) => accounts.find((a) => a.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const a = accounts.find((x) => x.id === where.id);
        if (a) Object.assign(a, data);
        accountUpdates.push({ where, data: data as Record<string, unknown> });
        return { id: where.id };
      },
    },
    noteAuthRequest: {
      findFirst: async () => null,
      create: async () => ({ id: 'auth1' }),
    },
  };

  return { prisma, jobs, articles, accounts, articleUpdates, accountUpdates, jobCreates };
}

function makePort(result: NotePublishResult): NotePublishPort {
  return {
    publishOne: vi.fn().mockResolvedValue(result),
    checkPublished: vi.fn(),
    monetizeOne: vi.fn(),
  };
}

const BASE_ARTICLE: ArticleRecord = {
  id: 'art1',
  note_account_id: 'acc1',
  title: 'タイトル',
  body_md: '本文です。',
  paid: false,
  price_jpy: null,
  paywall_line_pos: null,
  eyecatch_r2_key: null,
  note_url: null,
  status: 'ready',
};
const BASE_ACCOUNT: AccountRecord = {
  id: 'acc1',
  display_name: 'テストアカウント',
  session_state_enc: 'enc',
  status: 'active',
  handle: null,
};

describe('pipeline.note.publish', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    await expect(runPipelineNotePublish({}, { publishPort: makePort({ ok: true, status: 'draft', noteUrl: 'x' }) })).rejects.toThrow(
      ValidationError,
    );
  });

  it('Job 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [], articles: [], accounts: [] });
    await expect(
      runPipelineNotePublish(
        { note_article_id: 'art1', job_id: 'job1' },
        { prisma, logger: makeLogger(), publishPort: makePort({ ok: true, status: 'draft', noteUrl: 'x' }) },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('article が ready でなければ job を done にして skip する', async () => {
    const { prisma, jobs } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE, status: 'writing' }],
      accounts: [{ ...BASE_ACCOUNT }],
    });
    const publishPort = makePort({ ok: true, status: 'draft', noteUrl: 'x' });
    const res = await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1' },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
      },
    );
    expect(res).toMatchObject({ ok: false, status: 'not_ready' });
    expect(jobs[0]!.status).toBe('done');
    expect(publishPort.publishOne).not.toHaveBeenCalled();
  });

  it('セッション未設定なら no_session', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT, session_state_enc: null }],
    });
    const publishPort = makePort({ ok: true, status: 'draft', noteUrl: 'x' });
    const res = await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1' },
      { prisma, logger: makeLogger(), publishPort, acquireLock: vi.fn(), releaseLock: vi.fn() },
    );
    expect(res).toMatchObject({ ok: false, status: 'no_session' });
  });

  it('dry_run 成功: publish_status=draft, note_url 保存, published への昇格なし', async () => {
    const { prisma, articles } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT }],
    });
    const publishPort = makePort({ ok: true, status: 'draft', noteUrl: 'https://editor.note.com/notes/nabc/edit/' });
    const res = await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: true },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify: vi.fn().mockResolvedValue(true),
      },
    );
    expect(res).toMatchObject({ ok: true, status: 'dry_run_ready' });
    expect(articles[0]!.publish_status).toBe('draft');
    expect(articles[0]!.note_url).toBe('https://editor.note.com/notes/nabc/edit/');
    expect(articles[0]!.status).toBe('ready'); // 未昇格
  });

  it('公開成功: status/publish_status/published_at/note_url を更新し LINE 通知', async () => {
    const { prisma, articles } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT }],
    });
    const publishPort = makePort({ ok: true, status: 'published', noteUrl: 'https://note.com/handle/n/nabc' });
    const notify = vi.fn().mockResolvedValue(true);
    const res = await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: false },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify,
      },
    );
    expect(res).toMatchObject({ ok: true, status: 'published' });
    expect(articles[0]!.status).toBe('published');
    expect(articles[0]!.publish_status).toBe('published');
    expect(articles[0]!.published_at).toBeInstanceOf(Date);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('note に公開しました'));
  });

  it('公開成功時: handle 未設定なら note_url から自動抽出して保存する (docs/11 §7 申し送り13)', async () => {
    const { prisma, accounts, accountUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT, handle: null }],
    });
    const publishPort = makePort({ ok: true, status: 'published', noteUrl: 'https://note.com/ai_lab/n/nabc' });
    await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: false },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify: vi.fn().mockResolvedValue(true),
      },
    );
    expect(accounts[0]!.handle).toBe('ai_lab');
    expect(accountUpdates.some((u) => u.data.handle === 'ai_lab')).toBe(true);
  });

  it('公開成功時: handle 設定済みなら上書きしない', async () => {
    const { prisma, accounts, accountUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT, handle: 'existing_handle' }],
    });
    const publishPort = makePort({ ok: true, status: 'published', noteUrl: 'https://note.com/other_handle/n/nabc' });
    await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: false },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify: vi.fn().mockResolvedValue(true),
      },
    );
    expect(accounts[0]!.handle).toBe('existing_handle');
    expect(accountUpdates.some((u) => 'handle' in u.data)).toBe(false);
  });

  it('公開成功時: addJob 注入済みなら promotion.note.article を job_key 付きで enqueue する (F-ANP-30)', async () => {
    const { prisma, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT }],
    });
    const publishPort = makePort({ ok: true, status: 'published', noteUrl: 'https://note.com/handle/n/nabc' });
    const addJob = vi.fn().mockResolvedValue(undefined);
    const res = await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: false },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify: vi.fn().mockResolvedValue(true),
        addJob,
      },
    );
    expect(res).toMatchObject({ ok: true, status: 'published' });
    expect(jobCreates).toEqual([{ kind: 'promotion.note.article', status: 'queued', payload_json: { note_article_id: 'art1' } }]);
    expect(addJob).toHaveBeenCalledWith(
      'promotion.note.article',
      { note_article_id: 'art1', job_id: 'child-job-2' },
      expect.objectContaining({ jobKey: 'anp-promo-art1' }),
    );
  });

  it('公開成功時: addJob 未注入なら promotion.note.article の Job も作らない', async () => {
    const { prisma, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT }],
    });
    const publishPort = makePort({ ok: true, status: 'published', noteUrl: 'https://note.com/handle/n/nabc' });
    const res = await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: false },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify: vi.fn().mockResolvedValue(true),
      },
    );
    expect(res).toMatchObject({ ok: true, status: 'published' });
    expect(jobCreates).toEqual([]);
  });

  it('公開成功時: addJob が失敗しても公開結果は ok:true/published のまま (無視して継続)', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT }],
    });
    const publishPort = makePort({ ok: true, status: 'published', noteUrl: 'https://note.com/handle/n/nabc' });
    const addJob = vi.fn().mockRejectedValue(new Error('queue down'));
    const res = await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: false },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify: vi.fn().mockResolvedValue(true),
        addJob,
      },
    );
    expect(res).toMatchObject({ ok: true, status: 'published' });
  });

  it('not_logged_in: アカウントを paused にし LINE 通知、記事は ready のまま', async () => {
    const { prisma, articles, accounts } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT }],
    });
    const publishPort = makePort({ ok: false, reason: 'not_logged_in', message: 'セッション失効' });
    const notify = vi.fn().mockResolvedValue(true);
    const res = await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1' },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify,
      },
    );
    expect(res).toMatchObject({ ok: false, reason: 'not_logged_in' });
    expect(accounts[0]!.status).toBe('paused');
    expect(articles[0]!.status).toBe('ready');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('セッションが失効'));
  });

  it('kyc_required: 記事は ready のまま、note_url は保存される', async () => {
    const { prisma, articles } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE, paid: true }],
      accounts: [{ ...BASE_ACCOUNT }],
    });
    const publishPort = makePort({
      ok: false,
      reason: 'kyc_required',
      message: '本人情報登録が必要です',
      noteUrl: 'https://editor.note.com/notes/nabc/edit/',
    });
    const res = await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: false },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify: vi.fn().mockResolvedValue(true),
      },
    );
    expect(res).toMatchObject({ ok: false, reason: 'kyc_required' });
    expect(articles[0]!.status).toBe('ready');
    expect(articles[0]!.note_url).toBe('https://editor.note.com/notes/nabc/edit/');
  });

  it('dry_run 省略時は安全側(true)で publishPort を呼ぶ', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT }],
      anpPublishDryRun: false,
    });
    const publishPort = makePort({ ok: true, status: 'draft', noteUrl: 'x' });
    await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1' },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
      },
    );
    expect(publishPort.publishOne).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('AppSettings.anp_publish_dry_run=true のときは dry_run:false 指定でも強制的に dry-run', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT }],
      anpPublishDryRun: true,
    });
    const publishPort = makePort({ ok: true, status: 'draft', noteUrl: 'x' });
    await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: false },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
      },
    );
    expect(publishPort.publishOne).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('dry_run:false かつ AppSettings.anp_publish_dry_run=false のときのみ実公開を許可する', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ ...BASE_ARTICLE }],
      accounts: [{ ...BASE_ACCOUNT }],
      anpPublishDryRun: false,
    });
    const publishPort = makePort({ ok: true, status: 'published', noteUrl: 'https://note.com/h/n/n1' });
    await runPipelineNotePublish(
      { note_article_id: 'art1', job_id: 'job1', dry_run: false },
      {
        prisma,
        logger: makeLogger(),
        publishPort,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
        decryptSession: () => '{}',
        notify: vi.fn().mockResolvedValue(true),
      },
    );
    expect(publishPort.publishOne).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(PIPELINE_NOTE_PUBLISH_TASK_NAME).toBe('pipeline.note.publish');
  });

  describe('extractNoteHandle', () => {
    it('note.com/<handle>/n/<id> から handle を抽出する', () => {
      expect(extractNoteHandle('https://note.com/ai_lab/n/nabc123')).toBe('ai_lab');
    });
    it('editor.note.com の下書き URL は抽出しない', () => {
      expect(extractNoteHandle('https://editor.note.com/notes/nabc/edit/')).toBeNull();
    });
    it('undefined は null を返す', () => {
      expect(extractNoteHandle(undefined)).toBeNull();
    });
  });
});
