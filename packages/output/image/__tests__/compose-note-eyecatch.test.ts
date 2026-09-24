import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  accentForNiche,
  composeNoteEyecatch,
  defaultEyecatchAlt,
  NOTE_EYECATCH_HEIGHT,
  NOTE_EYECATCH_WIDTH,
} from '../src/compose-note-eyecatch.js';

async function flatBg(): Promise<Buffer> {
  return sharp({
    create: { width: 1536, height: 1024, channels: 3, background: '#6b7a8f' },
  })
    .jpeg()
    .toBuffer();
}

describe('composeNoteEyecatch (F-ANP-41)', () => {
  it('note 推奨サイズの JPEG を返す', async () => {
    const out = await composeNoteEyecatch(await flatBg(), {
      copy: '複勝だけで回収率112%',
      sub: '1年分の収支を券種別につけ直した',
      badge: '競馬予想',
    });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(NOTE_EYECATCH_WIDTH);
    expect(meta.height).toBe(NOTE_EYECATCH_HEIGHT);
  });

  it('サブ・バッジが無くても合成できる', async () => {
    const out = await composeNoteEyecatch(await flatBg(), { copy: '見送りも戦略' });
    expect((await sharp(out).metadata()).width).toBe(NOTE_EYECATCH_WIDTH);
  });

  it('長いコピーでも落ちない (自動縮小)', async () => {
    const out = await composeNoteEyecatch(await flatBg(), {
      copy: '複勝だけで回収率112%になった理由と、買わない日の決め方',
      sub: 'あ'.repeat(30),
      badge: '競馬予想',
    });
    expect((await sharp(out).metadata()).height).toBe(NOTE_EYECATCH_HEIGHT);
  });

  it('コピーが空なら例外 (文字なし画像は呼び出し側で分岐する)', async () => {
    await expect(composeNoteEyecatch(await flatBg(), { copy: '   ' })).rejects.toThrow(/copy is required/);
  });
});

describe('accentForNiche / defaultEyecatchAlt', () => {
  it('同じニッチなら常に同じ色・違うニッチで色が散る', () => {
    expect(accentForNiche('競馬予想')).toBe(accentForNiche('競馬予想'));
    const colors = new Set(['競馬予想', '副業×AI活用', '料理', '英語学習', '子育て'].map(accentForNiche));
    expect(colors.size).toBeGreaterThanOrEqual(2);
    expect(accentForNiche(null)).toMatch(/^#/);
  });

  it('alt はニッチとタイトルを含み 120 字以内', () => {
    const alt = defaultEyecatchAlt('回収率の話', '競馬予想');
    expect(alt).toContain('競馬予想');
    expect(alt).toContain('回収率の話');
    expect(alt.length).toBeLessThanOrEqual(120);
  });
});
