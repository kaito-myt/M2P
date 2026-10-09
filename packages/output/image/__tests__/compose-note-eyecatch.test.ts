import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  accentForNiche,
  composeNoteEyecatch,
  contrastWithWhite,
  hexToRgb,
  scrimAlphaForContrast,
  copySizeForLength,
  defaultEyecatchAlt,
  fitCopy,
  schemeForNiche,
  subSizeFor,
  NOTE_EYECATCH_HEIGHT,
  NOTE_EYECATCH_SCHEMES,
  NOTE_EYECATCH_WIDTH,
} from '../src/compose-note-eyecatch.js';
import { loadFonts } from '../src/text-layout.js';

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

/**
 * [F-ANP-49] 参考記事 (https://note.com/dandy_clam132/n/nd2fbe6c407eb) の作法。
 * 文字サイズは 2 種類だけ・長さで決める・40 以下にしない・配色は 3 色でアカウント固定。
 */
describe('サムネイル作法 (F-ANP-49)', () => {
  it('主役の文字サイズは文字数で決まる (6字以内=100 / 7〜12字=80 / 13字以上=70)', () => {
    expect(copySizeForLength('見送りも戦略')).toBe(100);
    // 半角数字も 1 文字として数える (「回収率112%」= 7 文字 → 80)。
    expect(copySizeForLength('回収率112%')).toBe(80);
    expect(copySizeForLength('買わない日を作る')).toBe(80);
    expect(copySizeForLength('外枠は即消ししない')).toBe(80);
    expect(copySizeForLength('外枠は即消ししない、人気別の複勝率')).toBe(70);
    // 空白は字数に数えない (「回収率 112%」と「回収率112%」を同じ扱いにする)。
    expect(copySizeForLength('回収率 112%')).toBe(copySizeForLength('回収率112%'));
  });

  it('補足は主役の 6 割・ただし 44 を下回らない (40 以下はスマホで読めない)', () => {
    expect(subSizeFor(100)).toBe(60);
    expect(subSizeFor(80)).toBe(48);
    expect(subSizeFor(70)).toBe(44);
    expect(subSizeFor(48)).toBe(44);
  });

  it('fitCopy は 2 行以内に収め、48px を下回らない', () => {
    const { bold } = loadFonts();
    const width = NOTE_EYECATCH_WIDTH - 128;
    const short = fitCopy(bold, '見送りも戦略', width);
    expect(short.size).toBe(100);
    expect(short.lines).toHaveLength(1);

    const long = fitCopy(bold, '外枠は即消ししない、過去5年の人気別複勝率', width);
    expect(long.lines.length).toBeLessThanOrEqual(2);
    expect(long.size).toBeGreaterThanOrEqual(48);

    const absurd = fitCopy(bold, 'あ'.repeat(60), width);
    expect(absurd.size).toBeGreaterThanOrEqual(48);
  });

  it('配色は 3 色構成でニッチごとに固定 (同じアカウントは常に同じ = 統一感)', () => {
    expect(NOTE_EYECATCH_SCHEMES).toHaveLength(5);
    expect(schemeForNiche('競馬予想').key).toBe(schemeForNiche('競馬予想').key);
    expect(schemeForNiche('競馬予想').accent).toBe(accentForNiche('競馬予想'));
    for (const s of NOTE_EYECATCH_SCHEMES) {
      expect(s.base).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.main).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.onAccent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('配色を指定しても note 推奨サイズの JPEG になる', async () => {
    const out = await composeNoteEyecatch(
      await flatBg(),
      { copy: '買わない日を作る', sub: '見送り18件の判断基準', badge: '競馬予想' },
      { scheme: schemeForNiche('競馬予想') },
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(NOTE_EYECATCH_WIDTH);
    expect(meta.height).toBe(NOTE_EYECATCH_HEIGHT);
  });
});

describe('スクリムのコントラスト保証 (2026-10-09)', () => {
  // 画像生成モデルは「下 1/3 は落ち着いた面に」と指示しても主役を置いてくることがあり、
  // 実際に馬のアップの上にキャッチコピーが乗って読めない画像が出ていた。
  // 絵の側の約束に頼らず、文字が乗る領域の輝度を測ってスクリムを濃くする。
  it('白に対するコントラスト比を正しく計算する', () => {
    expect(contrastWithWhite(255, 255, 255)).toBeCloseTo(1, 2);
    expect(contrastWithWhite(0, 0, 0)).toBeCloseTo(21, 0);
  });

  it('明るい背景ほど濃いスクリムを要求する', () => {
    const base = hexToRgb('#0b1020');
    const onWhite = scrimAlphaForContrast({ r: 255, g: 255, b: 255 }, base);
    const onMid = scrimAlphaForContrast({ r: 128, g: 128, b: 128 }, base);
    const onDark = scrimAlphaForContrast({ r: 10, g: 12, b: 20 }, base);
    expect(onWhite).toBeGreaterThan(onMid);
    expect(onMid).toBeGreaterThan(onDark);
    expect(onDark).toBe(0);
  });

  it('求めた不透明度を重ねると目標コントラストを満たす', () => {
    const base = hexToRgb('#0b1020');
    for (const bg of [
      { r: 255, g: 255, b: 255 },
      { r: 240, g: 200, b: 60 },
      { r: 128, g: 128, b: 128 },
    ]) {
      const a = scrimAlphaForContrast(bg, base, 4.5);
      const r = bg.r * (1 - a) + base.r * a;
      const g = bg.g * (1 - a) + base.g * a;
      const b = bg.b * (1 - a) + base.b * a;
      expect(contrastWithWhite(r, g, b)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('真っ白な背景でもキャッチコピー領域が暗くなる', async () => {
    const white = await sharp({
      create: { width: 1280, height: 670, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const out = await composeNoteEyecatch(white, { copy: '買い足し0円', sub: '月の上限と収支で休む判断' });
    // 文字が乗る帯の **右側 (文字が届かない範囲)** を測る。
    // 文字そのものを含めると白いグリフで平均が持ち上がり、地の明るさを測れない。
    // stats() は入力画像に対して計算されるので、領域は一度 buffer に焼いてから測る。
    const region = await sharp(out).extract({ left: 980, top: 470, width: 236, height: 150 }).toBuffer();
    const stats = await sharp(region).stats();
    const [r, g, b] = stats.channels;
    expect(contrastWithWhite(r!.mean, g!.mean, b!.mean)).toBeGreaterThanOrEqual(4.5);
  });
});
