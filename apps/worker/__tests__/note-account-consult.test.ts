/**
 * F-ANP-04 — `note.account.consult` worker タスクの単体テスト (prisma/consult を DI で差し替え)。
 */
import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';

import {
  NOTE_ACCOUNT_CONSULT_TASK_NAME,
  deriveConsultTitle,
  runNoteAccountConsult,
  type NoteAccountConsultDeps,
  type NoteAccountConsultPrisma,
} from '../src/tasks/note-account-consult.js';

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

interface MsgRecord {
  id: string;
  consultation_id: string;
  role: string;
  content: string;
  status: string;
  created_at: Date;
  research_json?: unknown;
}

function buildPrisma(args: {
  jobs: Array<{ id: string; status: string }>;
  consultations: Array<{ id: string; title: string; brief_draft_json: unknown }>;
  messages: MsgRecord[];
}) {
  const jobs = [...args.jobs];
  const messages = [...args.messages];
  const consultUpdates: Array<Record<string, unknown>> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  let seq = 100;

  const prisma: NoteAccountConsultPrisma = {
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
        jobUpdates.push({ where, data });
        const j = jobs.find((x) => x.id === where.id);
        if (j && data.status) j.status = data.status;
        return { id: where.id };
      },
    },
    noteAccountConsultation: {
      findUnique: async ({ where }) => args.consultations.find((c) => c.id === where.id) ?? null,
      update: async ({ where, data }) => {
        consultUpdates.push({ where, data });
        return { id: where.id };
      },
    },
    noteAccountConsultationMessage: {
      findUnique: async ({ where }) => {
        const m = messages.find((x) => x.id === where.id);
        return m
          ? {
              id: m.id,
              consultation_id: m.consultation_id,
              role: m.role,
              content: m.content,
              status: m.status,
              created_at: m.created_at,
            }
          : null;
      },
      findMany: async ({ where }) =>
        messages
          .filter(
            (m) =>
              m.consultation_id === where.consultation_id &&
              m.status === where.status &&
              m.created_at < where.created_at.lt,
          )
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
          .map((m) => ({ role: m.role, content: m.content })),
      updateMany: async ({ where, data }) => {
        const matched = messages.filter((m) => m.id === where.id && where.status.in.includes(m.status));
        for (const m of matched) m.status = data.status;
        return { count: matched.length };
      },
      update: async ({ where, data }) => {
        const m = messages.find((x) => x.id === where.id);
        if (m && data.status) m.status = data.status;
        return { id: where.id };
      },
      create: async ({ data }) => {
        const created: MsgRecord = {
          id: `m-${seq++}`,
          consultation_id: data.consultation_id,
          role: data.role,
          content: data.content,
          status: data.status,
          created_at: new Date(),
          research_json: data.research_json,
        };
        messages.push(created);
        return created;
      },
    },
  };
  return { prisma, jobs, messages, consultUpdates, jobUpdates };
}

// 各テストで新しいオブジェクトを作る (prisma スタブがレコードを直接 mutate するため)。
const base = () => ({
  jobs: [{ id: 'job-1', status: 'queued' }],
  consultations: [{ id: 'c-1', title: '', brief_draft_json: { idea: '副業' } }],
  messages: [
    { id: 'm-1', consultation_id: 'c-1', role: 'operator', content: '副業で始めたい', status: 'done', created_at: new Date('2026-09-21T00:00:00Z') },
    { id: 'm-2', consultation_id: 'c-1', role: 'advisor', content: 'どの読者?', status: 'done', created_at: new Date('2026-09-21T00:01:00Z') },
    { id: 'm-3', consultation_id: 'c-1', role: 'operator', content: '30代会社員', status: 'pending', created_at: new Date('2026-09-21T00:02:00Z') },
  ],
});

type ConsultFn = NonNullable<NoteAccountConsultDeps['consult']>;

function consultStub() {
  return vi.fn<ConsultFn>(async () => ({
    output: {
      reply: '30代会社員なら時短系が有望です',
      brief_draft: { idea: '副業', target_reader_hint: '30代会社員' },
      ready_to_design: true,
      suggested_questions: ['この方向で決めます'],
    },
    research: [{ query: 'q', title: 't', url: 'https://example.com/1' }],
  }));
}

describe(NOTE_ACCOUNT_CONSULT_TASK_NAME, () => {
  it('payload が不正なら ValidationError', async () => {
    await expect(runNoteAccountConsult({ consultation_id: 'c-1' })).rejects.toThrow(ValidationError);
  });

  it('Job が無ければ NotFoundError', async () => {
    const { prisma } = buildPrisma({ ...base(), jobs: [] });
    await expect(
      runNoteAccountConsult(
        { consultation_id: 'c-1', message_id: 'm-3', job_id: 'job-x' },
        { prisma, logger: makeLogger(), consult: consultStub() } as NoteAccountConsultDeps,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('Job が done なら何もしない (冪等)', async () => {
    const { prisma } = buildPrisma({ ...base(), jobs: [{ id: 'job-1', status: 'done' }] });
    const consult = consultStub();
    await runNoteAccountConsult(
      { consultation_id: 'c-1', message_id: 'm-3', job_id: 'job-1' },
      { prisma, logger: makeLogger(), consult } as NoteAccountConsultDeps,
    );
    expect(consult).not.toHaveBeenCalled();
  });

  it('履歴 (当該メッセージより前の done) と草案を渡して返答を保存し、相談と Job を更新する', async () => {
    const { prisma, messages, consultUpdates, jobs } = buildPrisma(base());
    const consult = consultStub();
    await runNoteAccountConsult(
      { consultation_id: 'c-1', message_id: 'm-3', job_id: 'job-1' },
      { prisma, logger: makeLogger(), consult } as NoteAccountConsultDeps,
    );

    expect(consult).toHaveBeenCalledTimes(1);
    const arg = consult.mock.calls[0]![0];
    expect(arg.message).toBe('30代会社員');
    expect(arg.history).toEqual([
      { role: 'operator', content: '副業で始めたい' },
      { role: 'advisor', content: 'どの読者?' },
    ]);
    expect(arg.briefDraft).toEqual({ idea: '副業' });

    const advisor = messages.find((m) => m.role === 'advisor' && m.content.includes('時短系'));
    expect(advisor?.status).toBe('done');
    expect((advisor?.research_json as { research: unknown[] }).research).toHaveLength(1);
    expect(messages.find((m) => m.id === 'm-3')?.status).toBe('done');

    expect(consultUpdates).toHaveLength(1);
    expect(consultUpdates[0]!.data).toMatchObject({
      title: '30代会社員',
      ready_to_design: true,
      brief_draft_json: { idea: '副業', target_reader_hint: '30代会社員' },
    });
    expect(jobs[0]!.status).toBe('done');
  });

  it('既に done のメッセージ (二重投入) はスキップして Job を done にする', async () => {
    const b = base();
    const { prisma, jobs } = buildPrisma({
      ...b,
      messages: b.messages.map((m) => (m.id === 'm-3' ? { ...m, status: 'done' } : m)),
    });
    const consult = consultStub();
    await runNoteAccountConsult(
      { consultation_id: 'c-1', message_id: 'm-3', job_id: 'job-1' },
      { prisma, logger: makeLogger(), consult } as NoteAccountConsultDeps,
    );
    expect(consult).not.toHaveBeenCalled();
    expect(jobs[0]!.status).toBe('done');
  });

  it('AI 失敗時はメッセージと Job を failed にして rethrow', async () => {
    const { prisma, messages, jobs } = buildPrisma(base());
    const consult = vi.fn<ConsultFn>(async () => {
      throw new Error('llm down');
    });
    await expect(
      runNoteAccountConsult(
        { consultation_id: 'c-1', message_id: 'm-3', job_id: 'job-1' },
        { prisma, logger: makeLogger(), consult } as NoteAccountConsultDeps,
      ),
    ).rejects.toThrow('llm down');
    expect(messages.find((m) => m.id === 'm-3')?.status).toBe('failed');
    expect(jobs[0]!.status).toBe('failed');
  });
});

describe('deriveConsultTitle', () => {
  it('40 字で切って … を付ける', () => {
    const long = 'あ'.repeat(60);
    expect(deriveConsultTitle(long)).toBe(`${'あ'.repeat(40)}…`);
    expect(deriveConsultTitle('  短い\n題  ')).toBe('短い 題');
  });
});
