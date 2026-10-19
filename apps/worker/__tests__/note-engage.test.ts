import { describe, expect, it, vi } from 'vitest';
import type { GrowthScoutOutput } from '@a2p/contracts/agents/growth-scout';

import {
  PER_RUN_FOLLOW,
  PER_RUN_LIKE,
  allocateRunQuotas,
  canRunScout,
  engageDay,
  engageUsageToday,
  classifyBlock,
  engageDaysSinceStart,
  judgeCurrentUser,
  readEngageState,
  buildHarvestQueries,
  harvestToTargets,
  rotateAccounts,
  followDailyCap,
  likeDailyCap,
  pickNoteTargets,
} from '../src/tasks/note-engage/note-engage-port.js';
import { runNoteEngage, type NoteEngagePrisma } from '../src/tasks/note-engage.js';

describe('followDailyCap / likeDailyCap (note ランプアップ, アカウント1つあたり)', () => {
  it('follow は初日10→20→35→巡航50で段階上昇する', () => {
    expect(followDailyCap(0)).toBe(10);
    expect(followDailyCap(1)).toBe(10);
    expect(followDailyCap(3)).toBe(20);
    expect(followDailyCap(7)).toBe(35);
    expect(followDailyCap(20)).toBe(50);
  });

  it('like は follow より多めに段階上昇する(初日15→30→55→巡航80)', () => {
    expect(likeDailyCap(0)).toBe(15);
    expect(likeDailyCap(3)).toBe(30);
    expect(likeDailyCap(7)).toBe(55);
    expect(likeDailyCap(20)).toBe(80);
  });

  it('日数に対して単調非減少で、初日から巡航値にはならない', () => {
    for (const fn of [followDailyCap, likeDailyCap]) {
      let prev = 0;
      for (let d = 0; d < 30; d += 1) {
        expect(fn(d)).toBeGreaterThanOrEqual(prev);
        prev = fn(d);
      }
      expect(fn(0)).toBeLessThan(fn(30));
    }
  });
});

describe('rotateAccounts / allocateRunQuotas (アカウント横断飢餓の防止)', () => {
  it('日替わりで先頭が入れ替わり、同日内は同じ順序', () => {
    const accs = ['a', 'b'];
    const d0 = new Date('2026-10-19T01:00:00Z');
    const d0b = new Date('2026-10-19T13:00:00Z');
    const d1 = new Date('2026-10-20T01:00:00Z');
    expect(rotateAccounts(accs, d0)).toEqual(rotateAccounts(accs, d0b));
    expect(rotateAccounts(accs, d0)[0]).not.toBe(rotateAccounts(accs, d1)[0]);
    expect(rotateAccounts([], d0)).toEqual([]);
  });

  it('先頭が合算枠を食い切っていても 2 番目の枠は 0 にならない', () => {
    const q = allocateRunQuotas({
      followCaps: [50, 50],
      likeCaps: [80, 80],
      followUsed: 50,
      likeUsed: 80,
    });
    expect(q).toHaveLength(2);
    expect(q[1]!.follow).toBeGreaterThan(0);
    expect(q[1]!.like).toBeGreaterThan(0);
    expect(q[0]).toEqual(q[1]);
  });

  it('端数 1 件のときも、日替わり回転で両アカウントが交互に枠を得る', () => {
    const q = allocateRunQuotas({ followCaps: [5, 5], likeCaps: [5, 5], followUsed: 9, likeUsed: 9 });
    expect(q.map((x) => x.follow)).toEqual([1, 0]);
    const got: Record<string, number> = { a: 0, b: 0 };
    for (const day of ['2026-10-19', '2026-10-20']) {
      const order = rotateAccounts(['a', 'b'], new Date(day + 'T01:00:00Z'));
      order.forEach((id, i) => {
        got[id] = (got[id] ?? 0) + q[i]!.follow;
      });
    }
    expect(got).toEqual({ a: 1, b: 1 });
  });

  it('予算が尽きていれば 0、1回上限で頭打ち', () => {
    expect(allocateRunQuotas({ followCaps: [10, 10], likeCaps: [10, 10], followUsed: 20, likeUsed: 20 })).toEqual([
      { follow: 0, like: 0 },
      { follow: 0, like: 0 },
    ]);
    const q = allocateRunQuotas({ followCaps: [50], likeCaps: [80], followUsed: 0, likeUsed: 0 });
    expect(q[0]).toEqual({ follow: PER_RUN_FOLLOW, like: PER_RUN_LIKE });
  });
});

describe('buildHarvestQueries / harvestToTargets', () => {
  it('niche / target_reader から検索語を作る(重複なし・最大4)', () => {
    expect(buildHarvestQueries('競馬予想', null)).toEqual(['競馬予想']);
    const q = buildHarvestQueries('副業×AI活用', '30代会社員 副業初心者');
    expect(q).toContain('副業×AI活用');
    expect(q).toContain('副業');
    expect(q.length).toBeLessThanOrEqual(4);
    expect(new Set(q).size).toBe(q.length);
    expect(buildHarvestQueries('', null)).toEqual([]);
  });

  it('自分自身・既エンゲージ・重複を除外し、上限を適用する', () => {
    const cards = [
      { urlname: 'me', articleId: 'n1' },
      { urlname: 'alice', articleId: 'n2' },
      { urlname: 'alice', articleId: 'n3' },
      { urlname: 'bob', articleId: 'n4' },
      { urlname: 'carol', articleId: 'n5' },
      { urlname: 'bad name', articleId: 'n6' },
    ];
    const engaged = new Set(['follow:@bob']);
    const t = harvestToTargets(cards, engaged, ['@Me'], 2, 3);
    expect(t.filter((x) => x.action === 'follow').map((x) => x.handle)).toEqual(['@alice', '@carol']);
    expect(t.filter((x) => x.action === 'like').map((x) => x.handle)).toEqual(['@alice/n/n2', '@alice/n/n3', '@bob/n/n4']);
    expect(t.some((x) => x.handle.toLowerCase().startsWith('@me'))).toBe(false);
    expect(t.find((x) => x.handle === '@alice')!.url).toBe('https://note.com/alice');
    expect(t.find((x) => x.handle === '@alice/n/n2')!.url).toBe('https://note.com/alice/n/n2');
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

describe('アカウント別ランプアップ / scout 上限 / セッション判定の純関数', () => {
  it('起点が無いアカウントは 0 日目から、起点があれば経過日数', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(engageDaysSinceStart({}, now)).toBe(0);
    expect(engageDaysSinceStart({ engage_ramp_started_at: '2026-10-15T12:00:00Z' }, now)).toBe(4);
    expect(engageDaysSinceStart({ engage_ramp_started_at: 'garbage' }, now)).toBe(0);
    expect(readEngageState({ engage_ramp_started_at: '2026-10-15T00:00:00Z', other: 1 })).toEqual({
      engage_ramp_started_at: '2026-10-15T00:00:00Z',
    });
  });

  it('allocateRunQuotas は自分のキャップを超えて配らない (初日アカに巡航値を渡さない)', () => {
    const q = allocateRunQuotas({ followCaps: [3, 50], likeCaps: [3, 80], followUsed: 0, likeUsed: 0 });
    expect(q[0]).toEqual({ follow: 3, like: 3 });
    expect(q[1]).toEqual({ follow: PER_RUN_FOLLOW, like: PER_RUN_LIKE });
  });

  it('scout は 1 アカウント 1 UTC 日に 1 回まで', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(canRunScout({}, now)).toBe(true);
    expect(canRunScout({ engage_scout_date: '2026-10-19' }, now)).toBe(false); // JST 21:00 = 10-19
    expect(canRunScout({ engage_scout_date: '2026-10-18' }, now)).toBe(true);
  });

  it('ブロック理由の分類: セッション/レート制限/環境', () => {
    expect(classifyBlock('session_expired')).toBe('session');
    expect(classifyBlock('action_blocked')).toBe('rate_limit');
    expect(classifyBlock('playwright_unavailable:x')).toBe('technical');
    expect(classifyBlock('context_error:x')).toBe('technical');
    expect(classifyBlock('session_check_failed:500')).toBe('technical');
  });

  it('current_user: 明示的な未ログインだけ expired。JSON でない/形が想定外は unknown (paused にしない)', () => {
    expect(judgeCurrentUser(200, { data: { id: 123, urlname: 'x' } })).toBe('ok');
    expect(judgeCurrentUser(200, { data: { urlname: 'x' } })).toBe('ok');
    expect(judgeCurrentUser(200, { data: {} })).toBe('expired');
    expect(judgeCurrentUser(200, { data: null })).toBe('expired');
    expect(judgeCurrentUser(401, null)).toBe('expired');
    expect(judgeCurrentUser(403, '<html>')).toBe('expired');
    // WAF / Cloudflare の 200 HTML (json() が失敗して null) / data キー無し / 形変更
    expect(judgeCurrentUser(200, null)).toBe('unknown');
    expect(judgeCurrentUser(200, {})).toBe('unknown');
    expect(judgeCurrentUser(200, { data: { foo: 1 } })).toBe('unknown');
    expect(judgeCurrentUser(500, null)).toBe('unknown');
  });

  it('allocateRunQuotas: caps が分かれていても day-0 アカの1日合計は自分のキャップを超えない', () => {
    // 副業=成熟(50)、競馬=day0(10)。8 回の cron を、使用数を積み上げながら再現する。
    let usage = [0, 0];
    let channel = 0;
    for (let run = 0; run < 8; run += 1) {
      const q = allocateRunQuotas({ followCaps: [50, 10], likeCaps: [80, 15], followUsage: usage, likeUsage: [0, 0], followUsed: channel, likeUsed: 0 });
      usage = [usage[0]! + q[0]!.follow, usage[1]! + q[1]!.follow];
      channel += q[0]!.follow + q[1]!.follow;
    }
    expect(usage[1]).toBeLessThanOrEqual(10);
    expect(usage[1]).toBeGreaterThan(0);
    expect(usage[0]).toBeLessThanOrEqual(50);
  });

  it('allocateRunQuotas: 他アカウントが消費してもアカウント自身の残りは減らない(飢えない)', () => {
    const q = allocateRunQuotas({ followCaps: [50, 50], likeCaps: [80, 80], followUsage: [50, 0], likeUsage: [80, 0], followUsed: 50, likeUsed: 80 });
    expect(q[0]).toEqual({ follow: 0, like: 0 });
    expect(q[1]!.follow).toBe(PER_RUN_FOLLOW);
  });

  it('engage_usage は同じ JST 日のときだけ有効、scout の「1日」も JST 日', () => {
    const now = new Date('2026-10-19T12:00:00Z'); // JST 10-19 21:00
    expect(engageUsageToday({ engage_usage: { day: '2026-10-19', follow: 7, like: 9 } }, now)).toEqual({ follow: 7, like: 9 });
    expect(engageUsageToday({ engage_usage: { day: '2026-10-18', follow: 7, like: 9 } }, now)).toEqual({ follow: 0, like: 0 });
    // UTC 23:17 (= JST 翌日 8:17) は新しい運用日
    expect(engageDay(new Date('2026-10-19T23:17:00Z'))).toBe('2026-10-20');
    expect(readEngageState({ engage_usage: { day: 'd', follow: 1, like: 2 } }).engage_usage).toEqual({ day: 'd', follow: 1, like: 2 });
  });
});

describe('note.engage の収穫・枠・skipped (2026-10-19)', () => {
  type T = Array<{ action: 'follow' | 'like'; handle: string; url: string }>;
  const sc = (n: number): GrowthScoutOutput => ({
    channel: 'note',
    summary: '',
    actions: Array.from({ length: n }, (_, i) => ({
      action_type: 'follow' as const, platform: 'note', target_handle: `@s${i}`, target_url: `https://note.com/s${i}`, target_desc: 'x', reason: '', priority: 'high' as const,
    })),
    search_hashtags: [],
    notes: [],
  });
  const doneAll = async ({ targets }: { targets: T }) => ({
    outcomes: targets.map((t) => ({ action: t.action, handle: t.handle, url: t.url, status: 'done' as const })),
  });
  /** harvestAndEngage のテスト用: cards から selectTargets → 全 done。 */
  const session =
    (cardsFor: (queries: string[]) => Array<{ urlname: string; articleId: string }>, extra: Partial<{ blocked: string; pageOpened: boolean }> = {}) =>
    async (a: { queries: string[]; selectTargets: (c: Array<{ urlname: string; articleId: string }>) => T }) => {
      const cards = cardsFor(a.queries);
      const targets = a.selectTargets(cards);
      return {
        outcomes: targets.map((t) => ({ action: t.action, handle: t.handle, url: t.url, status: 'done' as const })),
        blocked: extra.blocked,
        harvest: { pageOpened: extra.pageOpened ?? true, cards: cards.length, selected: targets.length },
      };
    };
  function mkPrisma(accounts: unknown[], counts = { follow: 0, like: 0 }) {
    return {
      appSettings: { findUnique: vi.fn().mockResolvedValue({ note_engage_enabled: true }) },
      noteAccount: { findMany: vi.fn().mockResolvedValue(accounts), update: vi.fn().mockResolvedValue({}) },
      promotionSnsEngagement: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockImplementation(async (a: { where: { action_type: string } }) =>
          a.where.action_type === 'follow' ? counts.follow : counts.like,
        ),
        upsert: vi.fn().mockResolvedValue({}),
      },
      noteAuthRequest: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'r' }) },
    } as unknown as NoteEngagePrisma;
  }
  const accs = () => [
    { id: 'acc1', niche: '副業×AI活用', display_name: 'A', target_reader: null, handle: 'a_self', settings_json: {}, session_state_enc: 'E' },
    { id: 'acc2', niche: '競馬予想', display_name: 'B', target_reader: null, handle: 'b_self', settings_json: {}, session_state_enc: 'E' },
  ];
  const base = { lineConfigured: () => false, resolveProxy: async () => null, decryptSession: () => '{"cookies":[]}' };
  const many = (prefix: string) => () => Array.from({ length: 30 }, (_, i) => ({ urlname: prefix + i, articleId: 'n' + i }));

  it('2 アカウントで回したとき 2 番目のフォロー枠が 0 にならず、収穫が取れれば growth_scout は呼ばれない', async () => {
    const generate = vi.fn();
    const harvestAndEngage = vi.fn(session((q) => many(q[0] === '競馬予想' ? 'h' : 'k')()));
    // 稼働初日 (キャップ 10/15 per account): 先頭が1アカウント分を食い切った状況。
    const res = await runNoteEngage({}, {
      ...base,
      prisma: mkPrisma(accs(), { follow: 10, like: 15 }),
      generate,
      port: { engageAll: doneAll, harvestAndEngage },
    });
    expect(generate).not.toHaveBeenCalled();
    expect(harvestAndEngage).toHaveBeenCalledTimes(2); // アカウントあたりブラウザセッション 1 回
    expect(res.per_account['acc1']!.followed).toBeGreaterThan(0);
    expect(res.per_account['acc2']!.followed).toBeGreaterThan(0);
  });

  it('ランプアップはアカウント単位: 起点を持つアカウントだけ段が上がる', async () => {
    const a = accs();
    a[0]!.settings_json = { engage_ramp_started_at: '2026-10-01T00:00:00Z' }; // 十分古い
    const res = await runNoteEngage({}, {
      ...base,
      now: () => new Date('2026-10-19T12:00:00Z'),
      prisma: mkPrisma(a),
      generate: vi.fn(),
      port: { engageAll: doneAll, harvestAndEngage: session(many('k')) },
    });
    expect(res.per_account['acc1']!.follow_cap).toBe(50);
    expect(res.per_account['acc2']!.follow_cap).toBe(10); // 起点なし = 初日
  });

  it('初めて成功したら engage_ramp_started_at を settings_json に書く(他キーは保持)', async () => {
    const a = accs().slice(0, 1);
    a[0]!.settings_json = { auto_theme_enabled: true } as never;
    const prisma = mkPrisma(a);
    await runNoteEngage({}, {
      ...base,
      now: () => new Date('2026-10-19T12:00:00Z'),
      prisma,
      generate: vi.fn(),
      port: { engageAll: doneAll, harvestAndEngage: session(many('k')) },
    });
    expect(prisma.noteAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc1' },
      data: {
        settings_json: {
          auto_theme_enabled: true,
          engage_usage: { day: '2026-10-19', follow: expect.any(Number), like: expect.any(Number) },
          engage_ramp_started_at: '2026-10-19T12:00:00.000Z',
        },
      },
    });
  });

  it('収穫が 0 件(ページは開けた)のときだけ growth_scout にフォールバックし、その日の2回目は呼ばない', async () => {
    const generate = vi.fn(async () => sc(2));
    const mk = (settings: unknown) => {
      const a = accs().slice(0, 1);
      a[0]!.settings_json = settings as never;
      return a;
    };
    const run = (settings: unknown) =>
      runNoteEngage({}, {
        ...base,
        now: () => new Date('2026-10-19T12:00:00Z'),
        prisma: mkPrisma(mk(settings)),
        generate,
        port: { engageAll: doneAll, harvestAndEngage: session(() => []) },
      });
    const first = await run({});
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first.per_account['acc1']!.followed).toBe(2);

    const second = await run({ engage_scout_date: '2026-10-19' }); // JST 日付
    expect(generate).toHaveBeenCalledTimes(1); // 増えない
    expect(second.skipped).toContain('acc1:scout_daily_limit');
  });

  it('ページが読めていない(pageOpened=false) / 例外のときは growth_scout を呼ばない', async () => {
    const generate = vi.fn();
    const unreadable = await runNoteEngage({}, {
      ...base,
      prisma: mkPrisma(accs().slice(0, 1)),
      generate,
      port: { engageAll: vi.fn(), harvestAndEngage: session(() => [], { pageOpened: false }) },
    });
    expect(unreadable.skipped).toContain('acc1:harvest_unreadable');

    const thrown = await runNoteEngage({}, {
      ...base,
      prisma: mkPrisma(accs().slice(0, 1)),
      generate,
      port: {
        engageAll: vi.fn(),
        harvestAndEngage: async () => {
          throw new Error('browser slot not available');
        },
      },
    });
    expect(thrown.skipped).toContain('acc1:browser_unavailable');
    expect(generate).not.toHaveBeenCalled();
  });

  it('スロット待ち例外は他のアカウントを止めない(タスク全体は落ちない)', async () => {
    let n = 0;
    const res = await runNoteEngage({}, {
      ...base,
      prisma: mkPrisma(accs()),
      generate: vi.fn(),
      port: {
        engageAll: doneAll,
        harvestAndEngage: async (a) => {
          n += 1;
          if (n === 1) throw new Error('slot');
          return session(many('z'))(a);
        },
      },
    });
    expect(Object.values(res.per_account).filter((c) => c.followed > 0)).toHaveLength(1);
    expect(res.skipped.some((s) => s.endsWith(':browser_unavailable'))).toBe(true);
  });

  it('収穫もフォールバックも空なら harvest_empty_fallback_empty を skipped に積む', async () => {
    const res = await runNoteEngage({}, {
      ...base,
      prisma: mkPrisma(accs().slice(0, 1)),
      generate: async () => sc(0),
      port: { engageAll: vi.fn(), harvestAndEngage: session(() => []) },
    });
    expect(res.skipped).toContain('acc1:harvest_empty_fallback_empty');
  });

  it('枠切れのときは cap_exhausted を skipped に積み、割当枠も結果に残す。収穫も scout も呼ばない', async () => {
    const generate = vi.fn();
    const harvestAndEngage = vi.fn();
    const res = await runNoteEngage({}, {
      ...base,
      prisma: mkPrisma(accs().slice(0, 1), { follow: 999, like: 999 }),
      generate,
      port: { engageAll: vi.fn(), harvestAndEngage },
    });
    expect(res.skipped).toContain('acc1:cap_exhausted');
    expect(res.per_account['acc1']!.follow_quota).toBe(0);
    expect(generate).not.toHaveBeenCalled();
    expect(harvestAndEngage).not.toHaveBeenCalled();
  });

  it('セッション切れ検知でアカウントを止め、growth_scout を呼ばない', async () => {
    const prisma = mkPrisma(accs().slice(0, 1));
    const generate = vi.fn();
    const res = await runNoteEngage({}, {
      ...base,
      prisma,
      generate,
      pushAlert: vi.fn().mockResolvedValue(true),
      port: { engageAll: vi.fn(), harvestAndEngage: session(() => [], { blocked: 'session_expired', pageOpened: false }) },
    });
    expect(res.per_account['acc1']!.blocked).toBe('session_expired');
    expect(prisma.noteAccount.update).toHaveBeenCalledWith({ where: { id: 'acc1' }, data: { status: 'paused' } });
    expect(generate).not.toHaveBeenCalled();
  });

  it('環境要因のブロック(playwright_unavailable 等)は LINE を送らず、レート制限は送って他アカウントも止める', async () => {
    const pushAlert = vi.fn().mockResolvedValue(true);
    const tech = await runNoteEngage({}, {
      ...base,
      lineConfigured: () => true,
      pushAlert,
      prisma: mkPrisma(accs()),
      generate: vi.fn(),
      port: { engageAll: vi.fn(), harvestAndEngage: session(() => [], { blocked: 'playwright_unavailable:x', pageOpened: false }) },
    });
    expect(pushAlert).not.toHaveBeenCalled();
    expect(Object.keys(tech.per_account)).toHaveLength(2); // 続行した

    const rate = await runNoteEngage({}, {
      ...base,
      lineConfigured: () => true,
      pushAlert,
      prisma: mkPrisma(accs()),
      generate: vi.fn(),
      port: { engageAll: vi.fn(), harvestAndEngage: session(() => [], { blocked: 'action_blocked' }) },
    });
    expect(pushAlert).toHaveBeenCalledTimes(1);
    expect(pushAlert.mock.calls[0]![0]).toContain('この回は中止');
    expect(Object.keys(rate.per_account)).toHaveLength(1); // 止めた
  });

  it('自分自身は status 無条件の全アカウントから除外する(paused の相方の記事を引かない)', async () => {
    const a = accs().slice(0, 1);
    const prisma = mkPrisma(a);
    // 2 回目以降の findMany (handle 全件) には paused の相方も含める。
    (prisma.noteAccount.findMany as ReturnType<typeof vi.fn>).mockImplementation(async (args: { where?: { handle?: unknown } }) =>
      args.where?.handle ? [...a, { id: 'acc2', handle: 'partner' }] : a,
    );
    let seen: T = [];
    await runNoteEngage({}, {
      ...base,
      prisma,
      generate: vi.fn(),
      port: {
        engageAll: doneAll,
        harvestAndEngage: async (x) => {
          const r = await session(() => [{ urlname: 'partner', articleId: 'n1' }, { urlname: 'other', articleId: 'n2' }])(x);
          seen = x.selectTargets([{ urlname: 'partner', articleId: 'n1' }, { urlname: 'other', articleId: 'n2' }]);
          return r;
        },
      },
    });
    expect(seen.some((t) => t.handle.includes('partner'))).toBe(false);
    expect(seen.some((t) => t.handle.includes('other'))).toBe(true);
  });
});
