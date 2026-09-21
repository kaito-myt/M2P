/**
 * F-ANP-05 — `note.account.profile` worker タスクの単体テスト (prisma/LLM/画像/R2 を DI で差し替え)。
 */
import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { NoteAccountProfileOutput } from '@a2p/contracts/agents/anp';

import {
  NOTE_ACCOUNT_PROFILE_TASK_NAME,
  profileKeyStamp,
  runNoteAccountProfile,
  type NoteAccountProfileDeps,
  type NoteAccountProfilePrisma,
} from '../src/tasks/note-account-profile.js';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() } as unknown as Logger;
}

function design() {
  return {
    display_name_candidates: ['a', 'b', 'c'],
    handle_candidates: ['a1', 'b1', 'c1'],
    bio: '設計案の bio',
    concept: '副業初心者に伴走する',
    target_reader: '会社員',
    tone: '親しみやすい',
    persona_type: 'person',
    character_sheet: 'たくみ 30代',
    content_pillars: [{ name: 'AI活用', description: '', example_titles: [] }],
    genre_policy: ['side_business'],
    monetization_policy: { free_ratio: 0.3, price_band: [300, 1000], membership: false, paid_line_strategy: '' },
    posting_cadence: { times_per_week: 3, time_of_day: '' },
    first_themes: [{ title: 't', hook: 'h' }],
    kpi_targets: { followers_30d: 1, articles_30d: 1, revenue_90d_jpy: 1 },
    avatar_prompt: '設計案の avatar prompt',
    header_prompt: '設計案の header prompt',
  };
}

function buildPrisma(args: { jobStatus?: string; withDesign?: boolean; bio?: string | null }) {
  const jobs = [{ id: 'job-1', status: args.jobStatus ?? 'queued' }];
  const accountUpdates: Array<Record<string, unknown>> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const prisma: NoteAccountProfilePrisma = {
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
        return {};
      },
    },
    noteAccount: {
      findUnique: async ({ where }) =>
        where.id === 'acc-1'
          ? {
              id: 'acc-1',
              display_name: '副業AIラボ',
              handle: 'ai_lab',
              niche: '副業×AI',
              target_reader: '会社員',
              tone: 'カジュアル',
              bio: args.bio ?? null,
              designs: args.withDesign ? [{ design_json: design() }] : [],
            }
          : null,
      update: async ({ where, data }) => {
        accountUpdates.push({ where, data });
        return {};
      },
    },
  };
  return { prisma, jobs, accountUpdates, jobUpdates };
}

const llmOutput: NoteAccountProfileOutput = {
  bio: 'AI で副業を始める会社員向けに、週末でできる手順を発信します。',
  bio_alternatives: ['別案1', '別案2'],
  avatar_prompt: 'LLM avatar prompt',
  header_prompt: 'LLM header prompt',
  persona_type: 'person',
};

function deps(p: NoteAccountProfilePrisma, extra: Partial<NoteAccountProfileDeps> = {}): NoteAccountProfileDeps {
  return {
    prisma: p,
    logger: makeLogger(),
    generateProfile: vi.fn(async () => llmOutput),
    generateImages: vi.fn(async () => ({ avatar: Buffer.from('png'), header: Buffer.from('jpg') })),
    uploadBuffer: vi.fn(async () => ({})),
    now: () => new Date('2026-09-21T07:30:00.000Z'),
    ...extra,
  };
}

describe(NOTE_ACCOUNT_PROFILE_TASK_NAME, () => {
  it('payload が不正なら ValidationError', async () => {
    await expect(runNoteAccountProfile({ note_account_id: 'acc-1', job_id: 'j', targets: [] })).rejects.toThrow(ValidationError);
  });

  it('アカウントが無ければ NotFoundError で Job が failed', async () => {
    const { prisma, jobs } = buildPrisma({});
    await expect(
      runNoteAccountProfile({ note_account_id: 'nope', job_id: 'job-1', targets: ['bio'] }, deps(prisma)),
    ).rejects.toThrow(NotFoundError);
    expect(jobs[0]!.status).toBe('failed');
  });

  it('bio のみ: LLM を呼び bio を保存、画像は生成しない', async () => {
    const { prisma, accountUpdates, jobUpdates } = buildPrisma({ withDesign: true });
    const d = deps(prisma);
    await runNoteAccountProfile({ note_account_id: 'acc-1', job_id: 'job-1', targets: ['bio'] }, d);
    expect(d.generateProfile).toHaveBeenCalledTimes(1);
    const input = (d.generateProfile as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({ display_name: '副業AIラボ', niche: '副業×AI', concept: '副業初心者に伴走する', persona_type: 'person' });
    expect(d.generateImages).not.toHaveBeenCalled();
    expect(accountUpdates[0]!.data).toMatchObject({ bio: llmOutput.bio });
    expect(accountUpdates[0]!.data).not.toHaveProperty('avatar_r2_key');
    const done = jobUpdates.find((u) => (u.data as { status?: string }).status === 'done')!;
    expect((done.data as { result_json: { bio_alternatives: string[]; used_llm: boolean } }).result_json).toMatchObject({
      bio_alternatives: ['別案1', '別案2'],
      used_llm: true,
    });
  });

  it('visuals のみ + 採用済み設計案あり: LLM を呼ばず設計案のプロンプトで画像を生成し R2 キーを保存', async () => {
    const { prisma, accountUpdates } = buildPrisma({ withDesign: true });
    const d = deps(prisma);
    await runNoteAccountProfile({ note_account_id: 'acc-1', job_id: 'job-1', targets: ['visuals'] }, d);
    expect(d.generateProfile).not.toHaveBeenCalled();
    expect(d.generateImages).toHaveBeenCalledWith({
      avatar_prompt: '設計案の avatar prompt',
      header_prompt: '設計案の header prompt',
      persona_type: 'person',
    });
    expect(d.uploadBuffer).toHaveBeenCalledTimes(2);
    expect(accountUpdates[0]!.data).toMatchObject({
      avatar_r2_key: 'anp/accounts/acc-1/avatar-20260921073000.png',
      header_r2_key: 'anp/accounts/acc-1/header-20260921073000.jpg',
    });
    expect(accountUpdates[0]!.data).not.toHaveProperty('bio');
  });

  it('visuals のみでも設計案が無ければ LLM でプロンプトを作る', async () => {
    const { prisma } = buildPrisma({ withDesign: false });
    const d = deps(prisma);
    await runNoteAccountProfile({ note_account_id: 'acc-1', job_id: 'job-1', targets: ['visuals'] }, d);
    expect(d.generateProfile).toHaveBeenCalledTimes(1);
    expect(d.generateImages).toHaveBeenCalledWith({ avatar_prompt: 'LLM avatar prompt', header_prompt: 'LLM header prompt', persona_type: 'person' });
  });

  it('追加指示があれば設計案があっても LLM を呼び、既存 bio を improve 対象として渡す', async () => {
    const { prisma } = buildPrisma({ withDesign: true, bio: '今の bio' });
    const d = deps(prisma);
    await runNoteAccountProfile(
      { note_account_id: 'acc-1', job_id: 'job-1', targets: ['visuals'], instruction: '青系で' },
      d,
    );
    const input = (d.generateProfile as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({ instruction: '青系で', existing_bio: '今の bio' });
  });

  it('参考画像 (F-ANP-06) があれば設計案があっても LLM を呼び、縮小済み画像を渡す', async () => {
    const { prisma } = buildPrisma({ withDesign: true });
    const d = deps(prisma, {
      loadReferenceImages: vi.fn(async (keys: string[]) => keys.map(() => ({ data: 'AAAA', mimeType: 'image/jpeg' }))),
    });
    await runNoteAccountProfile(
      { note_account_id: 'acc-1', job_id: 'job-1', targets: ['visuals'], reference_image_keys: ['anp/uploads/a.png', 'anp/uploads/b.png'] },
      d,
    );
    expect(d.loadReferenceImages).toHaveBeenCalledWith(['anp/uploads/a.png', 'anp/uploads/b.png']);
    expect(d.generateProfile).toHaveBeenCalledTimes(1);
    const input = (d.generateProfile as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { reference_images?: unknown[] };
    expect(input.reference_images).toHaveLength(2);
  });

  it('editorial (F-ANP-07): 方針生成を呼び target_reader/tone/editorial_policy を保存、画像/bio は触らない', async () => {
    const { prisma, accountUpdates } = buildPrisma({ withDesign: true, bio: '今の bio' });
    const generateEditorial = vi.fn(async () => ({
      target_reader: '30代会社員',
      tone: 'です・ます調',
      editorial_policy: '・冒頭で悩みを言い当てる',
      rationale: 'r',
    }));
    const d = deps(prisma, { generateEditorial });
    await runNoteAccountProfile(
      { note_account_id: 'acc-1', job_id: 'job-1', targets: ['editorial'], instruction: 'カジュアルに' },
      d,
    );
    expect(generateEditorial).toHaveBeenCalledTimes(1);
    const input = generateEditorial.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({ instruction: 'カジュアルに', existing_bio: '今の bio', concept: '副業初心者に伴走する' });
    expect(d.generateProfile).not.toHaveBeenCalled();
    expect(d.generateImages).not.toHaveBeenCalled();
    expect(accountUpdates[0]!.data).toMatchObject({ target_reader: '30代会社員', tone: 'です・ます調', editorial_policy: '・冒頭で悩みを言い当てる' });
  });

  it('Job が done なら何もしない (冪等)', async () => {
    const { prisma } = buildPrisma({ jobStatus: 'done' });
    const d = deps(prisma);
    await runNoteAccountProfile({ note_account_id: 'acc-1', job_id: 'job-1', targets: ['bio', 'visuals'] }, d);
    expect(d.generateProfile).not.toHaveBeenCalled();
  });

  it('画像生成失敗は Job を failed にして rethrow (note_accounts は更新しない)', async () => {
    const { prisma, jobs, accountUpdates } = buildPrisma({ withDesign: true });
    const d = deps(prisma, {
      generateImages: vi.fn(async () => {
        throw new Error('moderation_blocked');
      }),
    });
    await expect(
      runNoteAccountProfile({ note_account_id: 'acc-1', job_id: 'job-1', targets: ['visuals'] }, d),
    ).rejects.toThrow('moderation_blocked');
    expect(jobs[0]!.status).toBe('failed');
    expect(accountUpdates).toHaveLength(0);
  });
});

describe('profileKeyStamp', () => {
  it('英数字 14 桁', () => {
    expect(profileKeyStamp(new Date('2026-09-21T07:30:05.123Z'))).toBe('20260921073005');
  });
});
