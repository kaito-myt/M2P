import { describe, expect, it, vi } from 'vitest';

import {
  NOTE_PUBLISH_STATUS_SYNC_TASK_NAME,
  runNotePublishStatusSync,
  type NotePublishStatusSyncPrisma,
} from '../src/tasks/note-publish-status-sync.js';
import type { NotePublishPort } from '../src/tasks/note-publish/playwright-note-publish-port.js';

interface ArticleRow {
  id: string;
  note_url: string | null;
  title: string;
  publish_status: string;
}

function buildPrisma(args: {
  accounts: Array<{ id: string; display_name: string; session_state_enc: string | null }>;
  articlesByAccount: Record<string, ArticleRow[]>;
}) {
  const accountUpdates: Array<{ id: string; status: string }> = [];
  const articleUpdates: Array<{ id: string; publish_status: string }> = [];
  const prisma: NotePublishStatusSyncPrisma = {
    noteAccount: {
      findMany: async () => args.accounts,
      update: async ({ where, data }) => {
        accountUpdates.push({ id: where.id, status: data.status });
        return { id: where.id };
      },
    },
    noteArticle: {
      findMany: async ({ where }) =>
        (args.articlesByAccount[where.note_account_id] ?? []).filter((a) => a.publish_status === 'published'),
      update: async ({ where, data }) => {
        articleUpdates.push({ id: where.id, publish_status: data.publish_status });
        return { id: where.id };
      },
    },
  };
  return { prisma, accountUpdates, articleUpdates };
}

describe('note.publish.status.sync', () => {
  it('published 記事が live なら何も変更しない', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      accounts: [{ id: 'acc1', display_name: 'テストアカウント', session_state_enc: 'enc' }],
      articlesByAccount: {
        acc1: [{ id: 'art1', note_url: 'https://note.com/h/n/n1', title: 'T1', publish_status: 'published' }],
      },
    });
    const publishPort: NotePublishPort = {
      publishOne: vi.fn(),
      checkPublished: vi.fn().mockResolvedValue({ ok: true, status: 'live' }),
    };
    const res = await runNotePublishStatusSync({ prisma, publishPort, decryptSession: () => '{}' });
    expect(res).toEqual({ checked: 1, unlisted: 0 });
    expect(articleUpdates).toEqual([]);
  });

  it('unlisted 検知で publish_status を更新する', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      accounts: [{ id: 'acc1', display_name: 'テストアカウント', session_state_enc: 'enc' }],
      articlesByAccount: {
        acc1: [{ id: 'art1', note_url: 'https://note.com/h/n/n1', title: 'T1', publish_status: 'published' }],
      },
    });
    const publishPort: NotePublishPort = {
      publishOne: vi.fn(),
      checkPublished: vi.fn().mockResolvedValue({ ok: true, status: 'unlisted' }),
    };
    const res = await runNotePublishStatusSync({ prisma, publishPort, decryptSession: () => '{}' });
    expect(res).toEqual({ checked: 1, unlisted: 1 });
    expect(articleUpdates).toEqual([{ id: 'art1', publish_status: 'unlisted' }]);
  });

  it('not_logged_in を検知したらアカウントを paused にして LINE 通知し、そのアカウントの走査を打ち切る', async () => {
    const { prisma, accountUpdates, articleUpdates } = buildPrisma({
      accounts: [{ id: 'acc1', display_name: 'テストアカウント', session_state_enc: 'enc' }],
      articlesByAccount: {
        acc1: [
          { id: 'art1', note_url: 'https://note.com/h/n/n1', title: 'T1', publish_status: 'published' },
          { id: 'art2', note_url: 'https://note.com/h/n/n2', title: 'T2', publish_status: 'published' },
        ],
      },
    });
    const publishPort: NotePublishPort = {
      publishOne: vi.fn(),
      checkPublished: vi.fn().mockResolvedValue({ ok: false, reason: 'not_logged_in', message: 'x' }),
    };
    const notify = vi.fn().mockResolvedValue(true);
    const res = await runNotePublishStatusSync({ prisma, publishPort, decryptSession: () => '{}', notify });
    expect(res.checked).toBe(1); // 1件目で打ち切り
    expect(accountUpdates).toEqual([{ id: 'acc1', status: 'paused' }]);
    expect(articleUpdates).toEqual([]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('セッションが失効'));
  });

  it('セッション未設定アカウントはスキップ', async () => {
    const { prisma } = buildPrisma({ accounts: [], articlesByAccount: {} });
    const publishPort: NotePublishPort = { publishOne: vi.fn(), checkPublished: vi.fn() };
    const res = await runNotePublishStatusSync({ prisma, publishPort });
    expect(res).toEqual({ checked: 0, unlisted: 0 });
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(NOTE_PUBLISH_STATUS_SYNC_TASK_NAME).toBe('note.publish.status.sync');
  });
});
