/**
 * F-052b — 所有ブログ PublisherPort の単体テスト。
 */
import { describe, expect, it, vi } from 'vitest';

import { createBlogPublisherPort } from '../src/tasks/promotion-post/blog-publisher-port.js';

type AnyArgs = Record<string, unknown>;

function makePrisma(createImpl: (a: AnyArgs) => Promise<{ slug: string }>) {
  return { blogPost: { create: vi.fn(createImpl) } };
}

// 完成本文 (1000字以上・骨子マーカーなし): 新しい skeleton ガードを通過する。
const COMPLETE_BODY = `# 副業の始め方\n\n${'副業を始める前に知っておきたい現実的な考え方を、実体験に近い具体例とともに丁寧に解説します。'.repeat(30)}`;

const input = {
  channel: 'blog' as const,
  title: '副業の始め方',
  body: COMPLETE_BODY,
  config: { token: null, handle: null, extra: {} },
};

describe('createBlogPublisherPort', () => {
  it('blog_posts に published で作成し、baseUrl 付き公開 URL を返す', async () => {
    const prisma = makePrisma(async (a) => ({ slug: (a.data as { slug: string }).slug }));
    const port = createBlogPublisherPort({
      prisma,
      baseUrl: 'https://app.test/',
      now: () => new Date('2026-07-08T00:00:00Z'),
      generateSlug: () => 'abc123',
      optimizeBlogSeo: null,
    });
    const res = await port.publish(input);
    expect(res).toEqual({ ok: true, externalUrl: 'https://app.test/blog/abc123' });
    const created = prisma.blogPost.create.mock.calls[0]![0].data as AnyArgs;
    expect(created).toMatchObject({ slug: 'abc123', title: '副業の始め方', status: 'published' });
  });

  it('baseUrl 未設定なら相対 URL を返す', async () => {
    const prisma = makePrisma(async (a) => ({ slug: (a.data as { slug: string }).slug }));
    const port = createBlogPublisherPort({ prisma, baseUrl: '', generateSlug: () => 'zzz', optimizeBlogSeo: null });
    const res = await port.publish(input);
    expect(res).toEqual({ ok: true, externalUrl: '/blog/zzz' });
  });

  it('空本文は invalid で失敗', async () => {
    const prisma = makePrisma(async () => ({ slug: 's' }));
    const port = createBlogPublisherPort({ prisma, optimizeBlogSeo: null });
    const res = await port.publish({ ...input, body: '   ' });
    expect(res.ok).toBe(false);
  });

  it('骨子マーカーを含む本文は公開せず invalid で skip する', async () => {
    const prisma = makePrisma(async (a) => ({ slug: (a.data as { slug: string }).slug }));
    const port = createBlogPublisherPort({ prisma, optimizeBlogSeo: null });
    // 十分に長くても「骨子」を含むなら未完成とみなす。
    const res = await port.publish({ ...input, body: `【ブログ告知記事 骨子】\n${COMPLETE_BODY}` });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid');
    expect(prisma.blogPost.create).not.toHaveBeenCalled();
  });

  it('1000字未満の短い本文は公開せず invalid で skip する', async () => {
    const prisma = makePrisma(async (a) => ({ slug: (a.data as { slug: string }).slug }));
    const port = createBlogPublisherPort({ prisma, optimizeBlogSeo: null });
    const res = await port.publish({ ...input, body: '# 見出し\n本文です。' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid');
    expect(prisma.blogPost.create).not.toHaveBeenCalled();
  });

  it('slug 衝突(P2002)なら別 slug で再試行する', async () => {
    let calls = 0;
    const slugs = ['dup', 'fresh'];
    const prisma = {
      blogPost: {
        create: vi.fn(async (a: AnyArgs) => {
          calls += 1;
          if (calls === 1) throw new Error('Unique constraint failed (P2002)');
          return { slug: (a.data as { slug: string }).slug };
        }),
      },
    };
    let i = 0;
    const port = createBlogPublisherPort({ prisma, baseUrl: '', generateSlug: () => slugs[i++]!, optimizeBlogSeo: null });
    const res = await port.publish(input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.externalUrl).toBe('/blog/fresh');
    expect(calls).toBe(2);
  });
});
