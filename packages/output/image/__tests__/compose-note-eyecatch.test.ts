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
  fitSub,
  contrastRatio,
  pickNoteEyecatchLayout,
  DARK_SCHEMES,
  LIGHT_SCHEMES,
  GENRE_LAYOUTS,
  schemeForNiche,
  subSizeFor,
  NOTE_EYECATCH_HEIGHT,
  NOTE_EYECATCH_LAYOUTS,
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
  // [2026-10-13] 運営者提示の参考サムネはどれも文字が画面の 1/3 以上を占めていたので、
  // 以前の 100/80/70 から一回り大きくした。
  it('主役の文字サイズは文字数で決まる (6字以内=128 / 7〜12字=104 / 13字以上=84)', () => {
    expect(copySizeForLength('見送りも戦略')).toBe(128);
    // 半角数字も 1 文字として数える (「回収率112%」= 7 文字 → 104)。
    expect(copySizeForLength('回収率112%')).toBe(104);
    expect(copySizeForLength('買わない日を作る')).toBe(104);
    expect(copySizeForLength('外枠は即消ししない')).toBe(104);
    expect(copySizeForLength('外枠は即消ししない、人気別の複勝率')).toBe(84);
    // 空白は字数に数えない (「回収率 112%」と「回収率112%」を同じ扱いにする)。
    expect(copySizeForLength('回収率 112%')).toBe(copySizeForLength('回収率112%'));
  });

  it('補足は主役を食わない大きさ・ただし 48 を下回らない', () => {
    expect(subSizeFor(128)).toBe(67);
    expect(subSizeFor(104)).toBe(54);
    expect(subSizeFor(84)).toBe(48);
    expect(subSizeFor(56)).toBe(48);
  });

  it('fitCopy は 2 行以内に収め、56px を下回らない', () => {
    const { bold } = loadFonts();
    const width = NOTE_EYECATCH_WIDTH - 128;
    const short = fitCopy(bold, '見送りも戦略', width);
    expect(short.size).toBe(128);
    expect(short.lines).toHaveLength(1);

    const long = fitCopy(bold, '外枠は即消ししない、過去5年の人気別複勝率', width);
    expect(long.lines.length).toBeLessThanOrEqual(2);
    expect(long.size).toBeGreaterThanOrEqual(56);

    const absurd = fitCopy(bold, 'あ'.repeat(60), width);
    expect(absurd.size).toBeGreaterThanOrEqual(56);
  });

  /**
   * 貪欲な折り返しは幅の限界まで詰めるので「最初の1万円は校正でつく / る」のように
   * 2 行目に 1 文字だけ残っていた (2026-10-13 の実測)。行数が決まった後に割り直す。
   */
  it('2 行になるときは行の長さを揃える (2 行目に 1 文字だけ残さない)', () => {
    const { bold } = loadFonts();
    const { lines } = fitCopy(bold, '最初の1万円は校正でつくる', 880, 2);
    expect(lines).toHaveLength(2);
    const shortest = Math.min(...lines.map((l) => Array.from(l).length));
    const longest = Math.max(...lines.map((l) => Array.from(l).length));
    expect(longest - shortest).toBeLessThanOrEqual(2);
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

  /**
   * [2026-10-13] 版面が不透明パネルになったので、可読性は「絵の明るさを測って
   * スクリムを濃くする」のではなく **配色そのもの**で保証される。守るべき不変条件は
   * 「どの配色でも地と文字のコントラストが 4.5 以上」。
   */
  it('どの配色でも地と文字のコントラストが 4.5 以上', () => {
    for (const s of [...LIGHT_SCHEMES, ...DARK_SCHEMES]) {
      expect(contrastRatio(s.base, s.main)).toBeGreaterThanOrEqual(4.5);
      // マーカー (accent) の上に乗る文字も読めること。
      expect(
        Math.max(contrastRatio(s.accent, s.main), contrastRatio(s.accent, s.onAccent)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('真っ白な絵が来てもキャッチコピーの地はパネル色で塗り潰される', async () => {
    const white = await sharp({
      create: { width: 1280, height: 670, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const scheme = DARK_SCHEMES[0]!;
    const out = await composeNoteEyecatch(
      white,
      { copy: '買い足し0円', sub: '月の上限と収支で休む判断' },
      { scheme },
    );
    // 文字が乗る帯の **右側 (文字が届かない範囲)** を測る。
    const region = await sharp(out).extract({ left: 1000, top: 560, width: 200, height: 80 }).toBuffer();
    const stats = await sharp(region).stats();
    const [r, g, b] = stats.channels;
    expect(contrastWithWhite(r!.mean, g!.mean, b!.mean)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * [F-ANP-52] 版面を「全面グラデーションのスクリム」から「不透明なベタ色パネル」に変えた。
 * 旧実装は下 60% にぼかし + 不透明度 0.78〜0.94 のスクリムを掛けており、絵が濁って死んでいた。
 * 新実装は **絵に一切加工をしない**ので、パネルの外は元の色がそのまま残る。
 */
describe('色面パネルの版面 (F-ANP-52)', () => {
  const BRIGHT = { r: 240, g: 200, b: 60 };

  async function brightBg(): Promise<Buffer> {
    return sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#f0c83c' },
    })
      .png()
      .toBuffer();
  }

  async function pixel(buf: Buffer, left: number, top: number) {
    const region = await sharp(buf).extract({ left, top, width: 24, height: 24 }).toBuffer();
    const [r, g, b] = (await sharp(region).stats()).channels;
    return { r: r!.mean, g: g!.mean, b: b!.mean };
  }

  function near(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, tol = 14) {
    return Math.abs(a.r - b.r) < tol && Math.abs(a.g - b.g) < tol && Math.abs(a.b - b.b) < tol;
  }

  it('記事 id から版面を決定的に選ぶ', () => {
    expect(pickNoteEyecatchLayout('article-1').key).toBe(pickNoteEyecatchLayout('article-1').key);
  });

  /**
   * [F-ANP-54] ジャンルごとに「売れている型」が違う。競馬系は絵の上に極太文字 (full_bleed)、
   * 副業系は色ボックスや明るい帯。ジャンルで許可した版面しか出てはいけない。
   */
  it('ジャンルごとに許可された版面だけが出る', () => {
    for (const [niche, genre] of [
      ['競馬予想', 'gamble'],
      ['副業×AI活用', 'money'],
      ['家庭菜園', 'default'],
    ] as const) {
      const allowed = new Set<string>(GENRE_LAYOUTS[genre]);
      const seen = new Set<string>();
      for (let i = 0; i < 40; i += 1) {
        const key = pickNoteEyecatchLayout(`a${String(i)}`, niche).key;
        expect(allowed.has(key)).toBe(true);
        seen.add(key);
      }
      // 1 種類に固定されず、ちゃんと回っていること。
      expect(seen.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('競馬系は暗い配色・副業系は明るい配色になる', () => {
    expect(DARK_SCHEMES.map((x) => x.key)).toContain(schemeForNiche('競馬予想').key);
    expect(LIGHT_SCHEMES.map((x) => x.key)).toContain(schemeForNiche('副業×AI活用').key);
    expect(LIGHT_SCHEMES.map((x) => x.key)).toContain(schemeForNiche('家庭菜園').key);
  });

  it('競馬系の全版面・副業系の全版面が落ちずに合成できる', async () => {
    const bg = await brightBg();
    for (const niche of ['競馬予想', '副業×AI活用']) {
      for (const layout of NOTE_EYECATCH_LAYOUTS) {
        const out = await composeNoteEyecatch(
          bg,
          { copy: '最初の1万円をつくる', sub: '会社員が27分で試した', badge: niche },
          { scheme: schemeForNiche(niche), layout },
        );
        expect((await sharp(out).metadata()).width).toBe(NOTE_EYECATCH_WIDTH);
      }
    }
  });

  it('下帯: 絵の部分は加工されず元の色が残り、帯はベース色のベタ塗り', async () => {
    const scheme = NOTE_EYECATCH_SCHEMES[0]!;
    const out = await composeNoteEyecatch(
      await brightBg(),
      { copy: '買わない日を作る', sub: '見送り18件の判断基準', badge: '競馬予想' },
      { scheme, layout: NOTE_EYECATCH_LAYOUTS[0]! },
    );
    // 絵の領域 (右上) — 旧実装ではスクリムで暗く濁っていた。
    expect(near(await pixel(out, 1180, 180), BRIGHT)).toBe(true);
    // 帯の領域 (右下・文字が届かない範囲) — ベース色そのもの。
    expect(near(await pixel(out, 1180, 600), hexToRgb(scheme.base))).toBe(true);
  });

  it('左パネル: 左はベース色のベタ塗り、右は絵がそのまま', async () => {
    const scheme = NOTE_EYECATCH_SCHEMES[0]!;
    const out = await composeNoteEyecatch(
      await brightBg(),
      { copy: '買わない日を作る', sub: '見送り18件の判断基準', badge: '競馬予想' },
      { scheme, layout: NOTE_EYECATCH_LAYOUTS[1]! },
    );
    expect(near(await pixel(out, 600, 620), hexToRgb(scheme.base))).toBe(true);
    expect(near(await pixel(out, 1180, 335), BRIGHT)).toBe(true);
  });

  it('補足は必ず 1 行に収める (2 行目に 2 文字だけ残さない)', () => {
    const { regular } = loadFonts();
    // 左パネルの文字幅 (1280*0.56 - 64 - 44 = 609px) に 60px では入らない長さ。
    const fitted = fitSub(regular, '分類・命名は人が最終確認', 609, 60);
    expect(fitted.lines).toHaveLength(1);
    expect(fitted.size).toBeLessThan(60);
    expect(fitted.size).toBeGreaterThanOrEqual(44);
    // 余裕があるときは縮めない。
    expect(fitSub(regular, '初心者向け', 609, 60).size).toBe(60);
  });
});

/**
 * [2026-10-13] 実生成で「求人票の条件 / はAIに任せない」「画像整理は最後 / に人が確かめる」の
 * ように行頭が助詞になっていた。形態素解析は持ち込まず、2 つの悪い切り方だけを嫌う。
 */
describe('日本語の折り返し', () => {
  it('行頭が助詞にならないように割る', async () => {
    const { balanceWrap } = await import('../src/text-layout.js');
    const { bold } = loadFonts();
    const lines = balanceWrap(bold, '求人票の条件はAIに任せない', 60, 460, 2);
    expect(lines).not.toBeNull();
    expect('はがをにでとものへやかばねよ').not.toContain(Array.from(lines![1]!)[0]!);
  });

  it('ひらがな同士の間で割らない', async () => {
    const { balanceWrap } = await import('../src/text-layout.js');
    const { bold } = loadFonts();
    // 幅に余裕があるときの話。候補が 1 つしか無ければペナルティでは避けられない
    // (ハード制約ではなくコストなので、収まる割り方が他に無ければそれを選ぶ)。
    const lines = balanceWrap(bold, '勝負は3着までで決める', 80, 600, 2);
    expect(lines).not.toBeNull();
    const prev = Array.from(lines![0]!).at(-1)!;
    const next = Array.from(lines![1]!)[0]!;
    expect(/[\u3040-\u309f]/.test(prev) && /[\u3040-\u309f]/.test(next)).toBe(false);
  });
});

describe('行数を減らせるなら少し縮める (2026-10-13 実測)', () => {
  it('「同競馬場経験は加点する」が 3 行に割れず 2 行に収まる', () => {
    const { bold } = loadFonts();
    // 左パネルの文字幅。104px だと 5 字ずつで 3 行になり「同競馬 / 場経験は / 加点する」と
    // 語の途中で折れていた。100px なら 6 字入るので 2 行で済む。
    const { size, lines } = fitCopy(bold, '同競馬場経験は加点する', 609, 3);
    expect(lines).toHaveLength(2);
    expect(size).toBeGreaterThanOrEqual(96);
  });

  it('大きく縮めないと減らせない場合は行を増やしたままにする', () => {
    const { bold } = loadFonts();
    // 1 行にするには半分以下まで縮める必要があるので、2 行のまま大きく出す。
    const { size, lines } = fitCopy(bold, '最初の1万円は校正でつくる', 880, 2);
    expect(lines).toHaveLength(2);
    expect(size).toBeGreaterThanOrEqual(80);
  });
});
