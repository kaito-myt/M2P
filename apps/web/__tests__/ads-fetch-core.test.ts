import { describe, expect, it, vi } from 'vitest';

import { triggerAdsFetchCore, type AdsFetchDeps } from '../lib/ads-fetch-core';

const SESSION = { user: { id: 'user-1', username: 'operator' } };

function makeDeps(overrides: Partial<AdsFetchDeps> = {}): AdsFetchDeps {
  return {
    auditLogRepo: { create: vi.fn(async () => ({})) },
    session: SESSION,
    enqueueJob: vi.fn(async () => 'job-123'),
    ...overrides,
  };
}

describe('triggerAdsFetchCore', () => {
  it('enqueues ads.spend.fetch and records an audit log', async () => {
    const deps = makeDeps();
    const result = await triggerAdsFetchCore(deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.job_id).toBe('job-123');
    expect(deps.enqueueJob).toHaveBeenCalledWith('ads.spend.fetch', { trigger: 'manual' });
    expect(deps.auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actor_id: 'user-1', action: 'ads.spend.fetch.trigger', target_id: 'job-123' }),
      }),
    );
  });

  it('returns a failure result when enqueueJob throws', async () => {
    const deps = makeDeps({ enqueueJob: vi.fn(async () => { throw new Error('boom'); }) });
    const result = await triggerAdsFetchCore(deps);
    expect(result.ok).toBe(false);
  });
});
