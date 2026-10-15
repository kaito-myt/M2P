import { describe, expect, it, vi } from 'vitest';

import {
  followDailyCap,
  likeDailyCap,
  pickNoteTargets,
} from '../src/tasks/note-engage/note-engage-port.js';
import { runNoteEngage, type NoteEngagePrisma } from '../src/tasks/note-engage.js';

describe('followDailyCap / likeDailyCap (note ランプアップ)', () => {
  it('follow は初日3→5→8→巡航10で段階上昇する', () => {
    expect(followDailyCap(0)).toBe(3);
    expect(followDailyCap(1)).toBe(3);
    expect(followDailyCap(3)).toBe(5);
    expect(followDailyCap(7)).toBe(8);
    expect(followDailyCap(20)).toBe(10);
  });

  it('like は follow より多めに段階上昇する(初日5→8→12→巡航15)', () => {
    expect(likeDailyCap(0)).toBe(5);
    expect(likeDailyCap(3)).toBe(8);
    expect(likeDailyCap(7)).toBe(12);
    expect(likeDailyCap(20)).toBe(15);
  });
});

describe('pickNoteTargets', () => {
  it('follow/like のみ / note.com URL 有 / 重複除外 / action 別上限まで', () => {
    const actions = [
      { action_type: 'follow', target_handle: '@a', target_url: 'https://note.com/a' },
      { action_type: 'comment', target_handle: '@x', target_url: 'https://note.com/x' }, // comment → 除外
      { action_type: 'like', target_handle: '@b', target_url: 'https://note.com/b/n/n1' },
      { action_type: 'follow', target_handle: '@a', target_url: 'https://note.com/a' }, // 重複 → 除外
      { action_type: 'follow', target_handle: '@c', target_url: 'https://example.com/c' }, // note外 → 除外
      { action_type: 'follow', target_handle: '@d', target_url: 'https://note.com/d' },
    ];
    const targets = pickNoteTargets(actions, new Set(), 10, 10);
    expect(targets.map((t) => `${t.action}:${t.handle}`)).toEqual([
      'follow:@a',
      'like:@b',
      'follow:@d',
    ]);
  });

  it('既エンゲージ(action:handle キー)は除外し、action 別上限で切る', () => {
    const actions = [
      { action_type: 'follow', target_handle: '@a', target_url: 'https://note.com/a' }, // 既follow → 除外
      { action_type: 'follow', target_handle: '@b', target_url: 'https://note.com/b' },
      { action_type: 'follow', target_handle: '@c', target_url: 'https://note.com/c' },
      { action_type: 'like', target_handle: '@a', target_url: 'https://note.com/a/n/n1' }, // 同handleでもlikeは別
    ];
    const engaged = new Set(['follow:@a']);
    const targets = pickNoteTargets(actions, engaged, 1, 5);
    // follow は上限1(=@b のみ)、like:@a は follow:@a と別キーなので採用。
    expect(targets.map((t) => `${t.action}:${t.handle}`)).toEqual(['follow:@b', 'like:@a']);
  });
});

describe('runNoteEngage', () => {
  function baseAppSettings(note_engage_enabled: boolean) {
    return { findUnique: vi.fn().mockResolvedValue({ note_engage_enabled }) };
  }

  it('note_engage_enabled=false なら no-op(enabled=false)', async () => {
    const prisma: NoteEngagePrisma = {
      appSettings: baseAppSettings(false),
      noteAccount: { findMany: vi.fn(), update: vi.fn() },
      promotionSnsEngagement: { findMany: vi.fn(), count: vi.fn(), upsert: vi.fn() },
      noteAuthRequest: { findFirst: vi.fn(), create: vi.fn() },
    };
    const res = await runNoteEngage(
      {},
      { prisma, lineConfigured: () => false, resolveProxy: async () => null, generate: vi.fn() },
    );
    expect(res.enabled).toBe(false);
    expect(prisma.noteAccount.findMany).not.toHaveBeenCalled();
  });

  it('active セッション有りアカウントが無ければ skip(落とさない)', async () => {
    const prisma: NoteEngagePrisma = {
      appSettings: baseAppSettings(true),
      noteAccount: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
      promotionSnsEngagement: { findMany: vi.fn(), count: vi.fn(), upsert: vi.fn() },
      noteAuthRequest: { findFirst: vi.fn(), create: vi.fn() },
    };
    const res = await runNoteEngage(
      {},
      { prisma, lineConfigured: () => false, resolveProxy: async () => null, generate: vi.fn() },
    );
    expect(res.enabled).toBe(true);
    expect(res.skipped).toContain('no_active_account_with_session');
  });

  it('復号セッションでフォロー&スキを実行し promotion_sns_engagements に記録する', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma: NoteEngagePrisma = {
      appSettings: baseAppSettings(true),
      noteAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'acc1', niche: '読書', display_name: '本の虫', target_reader: '20代社会人', session_state_enc: 'ENC' },
        ]),
        update: vi.fn(),
      },
      promotionSnsEngagement: {
        findMany: vi.fn().mockResolvedValue([]), // first row(ランプアップ) & engaged 除外の両方 空
        count: vi.fn().mockResolvedValue(0),
        upsert,
      },
      noteAuthRequest: { findFirst: vi.fn(), create: vi.fn() },
    };
    const res = await runNoteEngage(
      {},
      {
        prisma,
        lineConfigured: () => false,
        resolveProxy: async () => null,
        decryptSession: () => '{"cookies":[]}',
        generate: async () => ({
          channel: 'note',
          summary: '',
          actions: [
            { action_type: 'follow', platform: 'note', target_handle: '@a', target_url: 'https://note.com/a', target_desc: 'x', reason: '', priority: 'high' },
            { action_type: 'like', platform: 'note', target_handle: '@b', target_url: 'https://note.com/b/n/n1', target_desc: 'y', reason: '', priority: 'mid' },
          ],
          search_hashtags: [],
          notes: [],
        }),
        port: {
          engageAll: async ({ targets }) => ({
            outcomes: targets.map((t) => ({ action: t.action, handle: t.handle, url: t.url, status: 'done' as const })),
          }),
        },
      },
    );
    expect(res.enabled).toBe(true);
    const cell = res.per_account['acc1'];
    expect(cell).toBeDefined();
    expect(cell!.followed).toBe(1);
    expect(cell!.liked).toBe(1);
    // follow と like の2件が upsert される(channel='note')。
    expect(upsert).toHaveBeenCalledTimes(2);
    const channels = upsert.mock.calls.map((c) => (c[0] as { create: { channel: string; action_type: string } }).create);
    expect(channels).toEqual([
      { channel: 'note', action_type: 'follow', target_handle: '@a', target_url: 'https://note.com/a', status: 'done' },
      { channel: 'note', action_type: 'like', target_handle: '@b', target_url: 'https://note.com/b/n/n1', status: 'done' },
    ]);
  });

  it('セッション復号失敗は skip(エラーで落とさない)', async () => {
    const prisma: NoteEngagePrisma = {
      appSettings: baseAppSettings(true),
      noteAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'acc1', niche: '読書', display_name: '本の虫', target_reader: null, session_state_enc: 'BAD' },
        ]),
        update: vi.fn(),
      },
      promotionSnsEngagement: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        upsert: vi.fn(),
      },
      noteAuthRequest: { findFirst: vi.fn(), create: vi.fn() },
    };
    const res = await runNoteEngage(
      {},
      {
        prisma,
        lineConfigured: () => false,
        resolveProxy: async () => null,
        decryptSession: () => {
          throw new Error('bad key');
        },
        generate: async () => ({
          channel: 'note',
          summary: '',
          actions: [
            { action_type: 'follow', platform: 'note', target_handle: '@a', target_url: 'https://note.com/a', target_desc: 'x', reason: '', priority: 'high' },
          ],
          search_hashtags: [],
          notes: [],
        }),
        port: { engageAll: vi.fn() },
      },
    );
    expect(res.skipped).toContain('acc1:session_decrypt_failed');
  });

  it('F-ANP-21: session_expired 検知でアカウントを一時停止し note_auth_requests を作って通知する', async () => {
    const updateAccount = vi.fn().mockResolvedValue({});
    const createAuthRequest = vi.fn().mockResolvedValue({ id: 'req1' });
    const pushAlert = vi.fn().mockResolvedValue(true);
    const prisma: NoteEngagePrisma = {
      appSettings: baseAppSettings(true),
      noteAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'acc1', niche: '読書', display_name: '本の虫', target_reader: null, session_state_enc: 'ENC' },
        ]),
        update: updateAccount,
      },
      promotionSnsEngagement: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        upsert: vi.fn(),
      },
      noteAuthRequest: { findFirst: vi.fn().mockResolvedValue(null), create: createAuthRequest },
    };
    const res = await runNoteEngage(
      {},
      {
        prisma,
        lineConfigured: () => true,
        pushAlert,
        resolveProxy: async () => null,
        decryptSession: () => '{"cookies":[]}',
        generate: async () => ({
          channel: 'note',
          summary: '',
          actions: [
            { action_type: 'follow', platform: 'note', target_handle: '@a', target_url: 'https://note.com/a', target_desc: 'x', reason: '', priority: 'high' },
          ],
          search_hashtags: [],
          notes: [],
        }),
        port: { engageAll: async () => ({ outcomes: [], blocked: 'session_expired' }) },
      },
    );
    expect(res.per_account['acc1']?.blocked).toBe('session_expired');
    expect(updateAccount).toHaveBeenCalledWith({ where: { id: 'acc1' }, data: { status: 'paused' } });
    expect(createAuthRequest).toHaveBeenCalledTimes(1);
    expect(pushAlert).toHaveBeenCalledTimes(1);
    expect(pushAlert.mock.calls[0]?.[0]).toContain('note-session-capture.sh acc1');
  });
});

describe('note.engage の観測と鍵 (2026-10-15)', () => {
  it('cron 起動 (job_id 無し) でも観測用の Job 行を自分で作り、結果を書き戻す', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'job-self' });
    const update = vi.fn().mockResolvedValue({});
    const prisma: NoteEngagePrisma = {
      appSettings: { findUnique: vi.fn().mockResolvedValue({ note_engage_enabled: true }) },
      noteAccount: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
      promotionSnsEngagement: { findMany: vi.fn(), count: vi.fn(), upsert: vi.fn() },
      noteAuthRequest: { findFirst: vi.fn(), create: vi.fn() },
      job: { create, update },
    };
    await runNoteEngage({}, { prisma, lineConfigured: () => false, resolveProxy: async () => null, generate: vi.fn() });

    expect(create).toHaveBeenCalledTimes(1);
    const created = create.mock.calls[0]![0] as { data: { kind: string; status: string; payload_json: { trigger: string } } };
    expect(created.data.kind).toBe('note.engage');
    expect(created.data.status).toBe('running');
    expect(created.data.payload_json.trigger).toBe('cron');
    // 作った行に結果が入る (これが無いと定期実行の成否が UI に出ない)。
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-self' } }));
    const updated = update.mock.calls[0]![0] as { data: { status: string; result_json: { skipped: string[] } } };
    expect(updated.data.status).toBe('done');
    expect(updated.data.result_json.skipped).toContain('no_active_account_with_session');
  });

  it('job_id が渡されたときは Job 行を作らない (二重計上しない)', async () => {
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const prisma: NoteEngagePrisma = {
      appSettings: { findUnique: vi.fn().mockResolvedValue({ note_engage_enabled: true }) },
      noteAccount: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
      promotionSnsEngagement: { findMany: vi.fn(), count: vi.fn(), upsert: vi.fn() },
      noteAuthRequest: { findFirst: vi.fn(), create: vi.fn() },
      job: { create, update },
    };
    await runNoteEngage(
      { job_id: 'job-given' },
      { prisma, lineConfigured: () => false, resolveProxy: async () => null, generate: vi.fn() },
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-given' } }));
  });

  it('セッションは ANP が書いた鍵 (KDP_CRED_KEY) で復号する', async () => {
    // 2026-10-15: ここが API_CRED_KEY だったため本番の 2 アカウントが毎回
    // session_decrypt_failed になり、F-091 は一度も動いていなかった。
    process.env.KDP_CRED_KEY = 'a'.repeat(64);
    const { encryptKdpCredentials } = await import('@a2p/crypto');
    const enc = encryptKdpCredentials(JSON.stringify({ cookies: [] }));
    const prisma: NoteEngagePrisma = {
      appSettings: { findUnique: vi.fn().mockResolvedValue({ note_engage_enabled: true }) },
      noteAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'acc1', niche: '読書', display_name: '本の虫', target_reader: '20代', session_state_enc: enc },
        ]),
        update: vi.fn(),
      },
      promotionSnsEngagement: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), upsert: vi.fn() },
      noteAuthRequest: { findFirst: vi.fn(), create: vi.fn() },
    };
    const res = await runNoteEngage(
      {},
      {
        prisma,
        lineConfigured: () => false,
        resolveProxy: async () => null,
        // decryptSession は渡さない = 既定の復号経路を検証する。
        generate: async () => ({ channel: 'note', summary: '', actions: [], search_hashtags: [], notes: [] }),
        port: { engageAll: async () => ({ outcomes: [] }) },
      },
    );
    expect(res.skipped).not.toContain('acc1:session_decrypt_failed');
  });
});
