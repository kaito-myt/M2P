import { describe, expect, it, vi } from 'vitest';

import type { NoteSeoOutput } from '@a2p/contracts/agents/anp';

import {
  runNoteSeoStep,
  type NoteSeoStepDeps,
  type NoteSeoStepPrisma,
} from '../src/tasks/lib/note-seo-step.js';
import { readSeoHashtags } from '../src/tasks/pipeline-note-publish.js';

const SEO: NoteSeoOutput = {
  title: '馬場バイアスの当日判定|1〜3Rの上がり3F',
  title_alternatives: ['別案1'],
  lead: '当日の馬場バイアスは 1〜3R の上がり 3F だけで決めません。',
  primary_keyword: '馬場バイアス 当日 判定',
  keywords: ['上がり3F', '含水率'],
  hashtags: ['競馬', '競馬予想', '馬券'],
  headings: [{ original: '馬場の見方', improved: '馬場バイアスの見方(当日)' }],
  eyecatch_copy: '3R後まで買い急がない',
  eyecatch_sub: '上がり3Fと馬場発表で判断',
  eyecatch_alt: '競馬新聞とストップウォッチ',
  internal_links: ['https://note.com/x/n/n1'],
  rationale: 'キーワードを前半に',
};

function buildPrisma(body: string | null, paid?: { paywall_line_pos: number }) {
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const prisma: NoteSeoStepPrisma = {
    noteArticle: {
      findUnique: async () =>
        body === null
          ? { body_md: null, lead: null, paid: false, paywall_line_pos: null }
          : {
              body_md: body,
              lead: 'リード',
              paid: Boolean(paid),
              paywall_line_pos: paid ? paid.paywall_line_pos : null,
            },
      findMany: async (args) => {
        const select = args.select as Record<string, true>;
        if (select.note_url) return [{ title: '過去記事', note_url: 'https://note.com/x/n/n1' }];
        return [{ title: '直近タイトル' }];
      },
      update: async (args) => {
        updates.push(args as { where: { id: string }; data: Record<string, unknown> });
        return null;
      },
    },
  };
  return { prisma, updates };
}

const INPUT = {
  noteArticleId: 'art1',
  jobId: 'job1',
  noteAccountId: 'acc1',
  currentTitle: '仮題',
  hook: 'フック',
  account: { niche: '競馬予想', tone: 'です・ます', target_reader: '初心者', editorial_policy: '【SEO対策】・狙う語' },
};

describe('runNoteSeoStep (F-ANP-42)', () => {
  it('タイトル/リード/見出し/内部リンク/seo_json を反映し、アイキャッチのコピーを返す', async () => {
    const { prisma, updates } = buildPrisma('# T\n\n## 馬場の見方\n本文');
    const generateSeo = vi.fn().mockResolvedValue(SEO);

    const res = await runNoteSeoStep(prisma, INPUT, { generateSeo });

    expect(res.applied).toBe(true);
    expect(res.title).toBe(SEO.title);
    expect(res.eyecatchCopy).toBe('3R後まで買い急がない');
    expect(res.eyecatchSub).toBe('上がり3Fと馬場発表で判断');

    const data = updates[0]!.data;
    expect(data.title).toBe(SEO.title);
    expect(data.lead).toBe(SEO.lead);
    expect(String(data.body_md)).toContain('## 馬場バイアスの見方(当日)');
    expect(String(data.body_md)).toContain('https://note.com/x/n/n1');
    expect(data.eyecatch_copy).toBe('3R後まで買い急がない');
    expect((data.seo_json as { hashtags: string[] }).hashtags).toEqual(['競馬', '競馬予想', '馬券']);
  });

  it('内部リンク候補を SEO エージェントに渡す', async () => {
    const { prisma } = buildPrisma('本文');
    const generateSeo = vi.fn().mockResolvedValue({ ...SEO, headings: [], internal_links: [] });
    await runNoteSeoStep(prisma, INPUT, { generateSeo });
    expect(generateSeo).toHaveBeenCalledWith(
      expect.objectContaining({
        current_title: '仮題',
        published: [{ title: '過去記事', note_url: 'https://note.com/x/n/n1' }],
        recent_titles: ['直近タイトル'],
      }),
    );
  });

  it('有料記事は見出し置換で有料ラインがズレないように位置を再計算する', async () => {
    // 無料部分に「## 見方」(4 文字) があり、「## 馬場バイアスの見方」(11 文字) に伸びるケース。
    const free = ['# T', '', '## 見方', '無料の本文。', ''].join('\n');
    const restBody = ['## 有料', '有料の本文。'].join('\n');
    const { prisma, updates } = buildPrisma(free + restBody, { paywall_line_pos: [...free].length });
    const generateSeo = vi.fn().mockResolvedValue({
      ...SEO,
      headings: [{ original: '見方', improved: '馬場バイアスの見方' }],
      internal_links: [],
    });

    await runNoteSeoStep(prisma, INPUT, { generateSeo });

    const data = updates[0]!.data;
    const nextBody = String(data.body_md);
    const pos = data.paywall_line_pos as number;
    // 再計算後の位置で切ると、無料部分に有料本文が混ざらない。
    const freeAfter = [...nextBody].slice(0, pos).join('');
    expect(freeAfter).toContain('## 馬場バイアスの見方');
    expect(freeAfter).not.toContain('有料の本文');
    expect([...nextBody].slice(pos).join('')).toContain('有料の本文');
  });

  it('無料記事では paywall_line_pos を触らない', async () => {
    const { prisma, updates } = buildPrisma(['## 見方', '本文'].join('\n'));
    const generateSeo = vi.fn().mockResolvedValue({ ...SEO, internal_links: [] });
    await runNoteSeoStep(prisma, INPUT, { generateSeo });
    expect(updates[0]!.data).not.toHaveProperty('paywall_line_pos');
  });

  it('本文がまだ無ければ何もしない', async () => {
    const { prisma, updates } = buildPrisma(null);
    const generateSeo = vi.fn();
    const res = await runNoteSeoStep(prisma, INPUT, { generateSeo });
    expect(res.applied).toBe(false);
    expect(res.title).toBe('仮題');
    expect(generateSeo).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('SEO が失敗しても記事は従来どおり進む (ベストエフォート)', async () => {
    const { prisma, updates } = buildPrisma('本文');
    const generateSeo = vi.fn().mockRejectedValue(new Error('anp.seo.invalid_output'));
    const warn = vi.fn();

    const res = await runNoteSeoStep(prisma, INPUT, {
      generateSeo,
      logger: { warn } as unknown as NoteSeoStepDeps['logger'],
    });

    expect(res).toMatchObject({ applied: false, title: '仮題', eyecatchCopy: null });
    expect(updates).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });
});

describe('readSeoHashtags (F-ANP-42)', () => {
  it('# を外し重複を除いて最大 5 個', () => {
    expect(readSeoHashtags({ hashtags: ['#競馬', '競馬', ' 馬券 ', 'a', 'b', 'c', 'd'] })).toEqual([
      '競馬',
      '馬券',
      'a',
      'b',
      'c',
    ]);
  });

  it('未設定・型崩れは空配列', () => {
    expect(readSeoHashtags(null)).toEqual([]);
    expect(readSeoHashtags({})).toEqual([]);
    expect(readSeoHashtags({ hashtags: 'x' })).toEqual([]);
    expect(readSeoHashtags({ hashtags: [1, {}, ''] })).toEqual([]);
  });
});
