import { describe, expect, it } from 'vitest';

import { articleStageWhere, countArticleStages, isArticleStage, resolveArticleStage } from '../article-stage';

describe('resolveArticleStage', () => {
  it('パイプライン進行中は in_progress', () => {
    for (const status of ['queued', 'writing', 'editing', 'eyecatch', 'judging']) {
      expect(resolveArticleStage({ status, publish_status: 'draft' })).toBe('in_progress');
    }
  });
  it('ready / needs_human_review / 公開同期前は pre_publish', () => {
    expect(resolveArticleStage({ status: 'ready', publish_status: 'draft' })).toBe('pre_publish');
    expect(resolveArticleStage({ status: 'needs_human_review', publish_status: 'draft' })).toBe('pre_publish');
    expect(resolveArticleStage({ status: 'published', publish_status: 'draft' })).toBe('pre_publish');
  });
  it('note で公開中は status に関わらず published', () => {
    expect(resolveArticleStage({ status: 'published', publish_status: 'published' })).toBe('published');
    expect(resolveArticleStage({ status: 'ready', publish_status: 'published' })).toBe('published');
  });
  it('失敗/中止/非公開化は other', () => {
    expect(resolveArticleStage({ status: 'failed', publish_status: 'draft' })).toBe('other');
    expect(resolveArticleStage({ status: 'cancelled', publish_status: 'draft' })).toBe('other');
    expect(resolveArticleStage({ status: 'published', publish_status: 'unlisted' })).toBe('other');
  });
});

describe('articleStageWhere / countArticleStages / isArticleStage', () => {
  it('where は各段階に条件を返す', () => {
    expect(articleStageWhere('published')).toEqual({ publish_status: 'published' });
    expect(articleStageWhere('in_progress')).toMatchObject({ publish_status: { not: 'published' } });
    expect(articleStageWhere('pre_publish')).toMatchObject({ status: { in: ['ready', 'needs_human_review', 'published'] } });
    expect(articleStageWhere('other')).toHaveProperty('OR');
  });
  it('件数を段階別に数える', () => {
    const counts = countArticleStages([
      { status: 'writing', publish_status: 'draft' },
      { status: 'ready', publish_status: 'draft' },
      { status: 'published', publish_status: 'published' },
      { status: 'failed', publish_status: 'draft' },
      { status: 'judging', publish_status: 'draft' },
    ]);
    expect(counts).toEqual({ in_progress: 2, pre_publish: 1, published: 1, other: 1 });
  });
  it('isArticleStage', () => {
    expect(isArticleStage('published')).toBe(true);
    expect(isArticleStage('nope')).toBe(false);
  });
});
