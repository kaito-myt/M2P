import { describe, expect, it, vi } from 'vitest';

import {
  buildNoteStorageState,
  NOTE_AUTH_COOKIE,
  parseNoteCookies,
  toCookieHeader,
  verifyNoteSession,
} from '../note-session-link';

describe('parseNoteCookies', () => {
  it('Cookie ヘッダ形式 (name=value; ...) を許可リストで抜き出す', () => {
    const c = parseNoteCookies('Cookie: _ga=abc; note_gql_auth_token=TOKEN1; _note_session_v5=SESS; foo=bar');
    expect(c).toEqual({ note_gql_auth_token: 'TOKEN1', _note_session_v5: 'SESS' });
  });
  it('DevTools テーブル (name\tvalue\tdomain...) を 1 行 1 件で読む', () => {
    const c = parseNoteCookies('note_gql_auth_token\tTOKEN2\t.note.com\t/\n_note_session_v5\tSESS2\t.note.com\t/\n_ga\tx\t.note.com');
    expect(c).toEqual({ note_gql_auth_token: 'TOKEN2', _note_session_v5: 'SESS2' });
  });
  it('トークン値だけなら note_gql_auth_token として扱う', () => {
    expect(parseNoteCookies('  eyJhbGciOi.abc.def  ')).toEqual({ [NOTE_AUTH_COOKIE]: 'eyJhbGciOi.abc.def' });
  });
  it('空入力は空', () => {
    expect(parseNoteCookies('')).toEqual({});
  });
});

describe('buildNoteStorageState / toCookieHeader', () => {
  it('Playwright storageState 形式 (.note.com, httpOnly, secure) を組み立てる', () => {
    const st = buildNoteStorageState({ note_gql_auth_token: 'T', 'XSRF-TOKEN': 'X' });
    expect(st.origins).toEqual([]);
    expect(st.cookies).toHaveLength(2);
    expect(st.cookies[0]).toMatchObject({ name: 'note_gql_auth_token', domain: '.note.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' });
    expect(st.cookies[1]!.httpOnly).toBe(false);
    expect(toCookieHeader({ a: '1', b: '2' })).toBe('a=1; b=2');
  });
});

describe('verifyNoteSession', () => {
  it('200 + urlname で ok', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: 12, urlname: 'my_acc', nickname: 'わたし' } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await verifyNoteSession({ note_gql_auth_token: 'T' }, fetchImpl);
    expect(r).toEqual({ ok: true, urlname: 'my_acc', nickname: 'わたし', userId: '12' });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((call[1] as RequestInit).headers).toMatchObject({ cookie: 'note_gql_auth_token=T' });
  });
  it('401 は unauthorized', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"data":"認証に失敗しました"}', { status: 401 })) as unknown as typeof fetch;
    const r = await verifyNoteSession({ note_gql_auth_token: 'bad' }, fetchImpl);
    expect(r).toMatchObject({ ok: false, reason: 'unauthorized' });
  });
  it('ネットワーク失敗は network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const r = await verifyNoteSession({ note_gql_auth_token: 'T' }, fetchImpl);
    expect(r).toMatchObject({ ok: false, reason: 'network' });
  });
});
