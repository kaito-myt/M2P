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

describe('NaN 座標でテキストが途中で消える問題 (2026-09-25 実測)', () => {
  it('「10点出品・7日間の反応を記録」が NaN 無しで描画される', async () => {
    // opentype.js に文字列をまとめて渡すと累積 advance が小数になった箇所で NaN 座標を吐き、
    // librsvg がそれ以降を黙って捨てていた (サムネ上で「10⊥」だけになる)。
    const { loadFonts, linePathLeft } = await import('../src/text-layout.js');
    const { regular } = loadFonts();
    const d = linePathLeft(regular, '10点出品・7日間の反応を記録', 30, 64, 616);
    expect(d).not.toContain('NaN');
    expect(d.length).toBeGreaterThan(5000);
  });

  it('合成しても落ちない (サブコピー全体が入る)', async () => {
    const out = await composeNoteEyecatch(await flatBg(), {
      copy: '売上0円でも閲覧84回',
      sub: '10点出品・7日間の反応を記録',
      badge: '副業×AI活用',
    });
    expect((await sharp(out).metadata()).width).toBe(NOTE_EYECATCH_WIDTH);
  });
});

describe('フォントに無い文字 (矢印・記号) の豆腐対策 (2026-09-25 実測)', () => {
  it('→ はベクターで描き、豆腐にも欠落にもしない', async () => {
    const { loadFonts, linePathLeft, advanceWidth } = await import('../src/text-layout.js');
    const { bold } = loadFonts();
    // 同梱の Noto Sans JP サブセットに → は無い (グリフ index 0)。
    expect(bold.charToGlyphIndex('→')).toBe(0);
    const withArrow = linePathLeft(bold, '13%→27%', 60, 0, 100);
    const without = linePathLeft(bold, '13%27%', 60, 0, 100);
    expect(withArrow.length).toBeGreaterThan(without.length);
    expect(withArrow).not.toContain('NaN');
    // 送り幅も矢印分だけ広い (レイアウトがずれない)。
    expect(advanceWidth(bold, '13%→27%', 60)).toBeGreaterThan(advanceWidth(bold, '13%27%', 60));
  });

  it('丸数字などは代替文字に置き換える', async () => {
    const { loadFonts, linePathLeft } = await import('../src/text-layout.js');
    const { bold } = loadFonts();
    const d = linePathLeft(bold, '①案', 40, 0, 100);
    expect(d).not.toContain('NaN');
    expect(d.length).toBeGreaterThan(100);
  });

  it('矢印入りのコピーを合成できる', async () => {
    const out = await composeNoteEyecatch(await flatBg(), {
      copy: '返信率約13%→約27%',
      sub: '提案文を直した前後15件ずつの記録',
      badge: '副業×AI活用',
    });
    expect((await sharp(out).metadata()).width).toBe(NOTE_EYECATCH_WIDTH);
  });
});
