/**
 * アイキャッチ: 禁止モチーフは account art direction より強い (2026-10-19)。
 * 副業アカの art_direction が禁止モチーフを名指しで指定していた実データで固定する。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@a2p/db', () => ({ prisma: {} }));

import { classifyNicheGenre } from '@a2p/contracts/note-genre';
import { pickNoteEyecatchLayout, schemeForNiche } from '@a2p/output-image';

import {
  buildPrompt,
  generateNoteEyecatch,
  type GenerateNoteEyecatchInput,
} from '../../src/anp/eyecatch.js';
import {
  BANNED_MOTIFS,
  EYECATCH_BANNED_MOTIFS,
  pickEyecatchStyle,
  stripBannedMotifs,
} from '../../src/anp/eyecatch-style.js';
import { artDirectionBanLines } from '../../src/anp/research.js';

// 副業アカ (note-acc-1) の現行値 (抜粋)。
const SIDE_JOB_ART =
  '右の絵ゾーンには、ノートPCに向かうバストアップの会社員イラスト1名を置く。' +
  'その周囲に円形アイコン（右肩上がりのグラフ、書類、時計）を2〜3点だけ添える。' +
  '質感はフラットなベクター／デジタルイラスト。' +
  '人物が難しければ、ノートPC1台・コーヒーカップ1点・観葉植物1点の机まわりに差し替える。' +
  'モチーフは合計4点まで。';

// 競馬アカの現行値 (要旨)。
const KEIBA_ART =
  '右半分に実写風の疾走する鹿毛馬1頭と騎手1名を置く。左半分は文字専用にする。' +
  '文字は3〜4段で組む。配色は芝の緑と砂色、差し色は勝負服の水色・赤と緑の帽のみ。';

function prompt(input: Partial<GenerateNoteEyecatchInput>, niche = 'AI副業'): string {
  const full: GenerateNoteEyecatchInput = {
    noteArticleId: 'art-1',
    title: 'テスト',
    hook: 'フック',
    niche,
    eyecatchCopy: '月5万円',
    ...input,
  };
  return buildPrompt(
    full,
    pickEyecatchStyle('art-1', [], niche),
    pickNoteEyecatchLayout('art-1', niche),
    classifyNicheGenre(niche),
    schemeForNiche(niche),
  );
}

/** 禁止リスト節より前 (= 指示として読まれる部分) だけを返す。 */
function beforeBanList(p: string): string {
  return p.slice(0, p.indexOf('【禁止 (これらが写ると失敗)】'));
}

const okImage = async () => ({
  images: [Buffer.from('x')],
  costJpy: 0,
  usage: { imageCount: 1 },
});
const loggingDeps = { prisma: { tokenUsage: { create: vi.fn() } } as never };

describe('stripBannedMotifs', () => {
  it('禁止モチーフを含む文だけを落とし、当たったモチーフを返す', () => {
    const r = stripBannedMotifs(SIDE_JOB_ART);
    expect(r.dropped.length).toBeGreaterThanOrEqual(3);
    expect(r.kept).not.toMatch(/ノートPC|円形アイコン|観葉植物/);
    for (const d of r.dropped) expect(EYECATCH_BANNED_MOTIFS).toContain(d.motif);
  });

  it('禁止に当たらない競馬アカの指示は素通りする', () => {
    const r = stripBannedMotifs(KEIBA_ART);
    expect(r.dropped).toEqual([]);
    expect(r.kept).toBe(KEIBA_ART);
  });

  it('禁止リストの文言と検出パターンは同じ要素に持つ (WARN のラベルがずれない)', () => {
    expect(EYECATCH_BANNED_MOTIFS).toEqual(BANNED_MOTIFS.map((m) => m.text));
    const r = stripBannedMotifs('観葉植物を置く。');
    expect(r.dropped[0]!.motif).toContain('観葉植物');
    expect(stripBannedMotifs('ロゴを入れる。').dropped).toEqual([]);
  });

  it('回避・否定の文は落とさない (機能している指示を巻き込まない)', () => {
    const neg = KEIBA_ART + '観葉植物やマグカップのある机まわりは描かない。';
    expect(stripBannedMotifs(neg).dropped).toEqual([]);
    const p = prompt({ accountArtDirection: neg, accountArtDirectionGrounded: true }, '競馬予想');
    expect(p).toContain('これが最優先');
    expect(p).toContain('鹿毛馬');
  });

  it('正の指定 + 別件の否定 (AVOIDS 収録語) が同居する文は落とす', () => {
    for (const t of [
      'その周囲に円形アイコンを2〜3点だけ添え、背景には何も置かない。',
      '主役は会社員イラストを置き、文字と重ねることは避ける。',
    ]) {
      expect(stripBannedMotifs(t).dropped.length, t).toBe(1);
    }
  });

  it('列挙形の純粋な否定は巻き込まない', () => {
    expect(stripBannedMotifs('観葉植物、マグカップ、書類は描かない。').dropped).toEqual([]);
  });

  it('言い換え (円形を抜いたアイコン / サラリーマン / 主役はスマホ) も落とす', () => {
    for (const t of [
      'アイコンを 2〜3 点だけ添える。',
      '丸いアイコンを散らす。',
      'サラリーマンのイラストを置く。',
      'オフィスワーカーのイラストを置く。',
      'モニタにグラフを表示する。',
      '主役はスマホアプリの画面1点。',
      'ノートPCを画面中央に大きく1台だけ描く。',
    ]) {
      expect(stripBannedMotifs(t).dropped.length, t).toBe(1);
    }
  });

  it('無害な文 (雲が浮かぶ青空 / 右肩上がりを避ける規則でない文) は誤爆しない', () => {
    expect(stripBannedMotifs('雲が浮かぶ青空を背景にする。').dropped).toEqual([]);
    expect(stripBannedMotifs('グラデーションの空。').dropped).toEqual([]);
    expect(stripBannedMotifs('背景の隅にスマホを小さく写す。').dropped).toEqual([]);
    expect(stripBannedMotifs('スマホだけを主題にする。').dropped.length).toBe(1);
  });
});

describe('buildPrompt: 禁止モチーフは account art direction に勝つ', () => {
  it('実物を見た指示 (grounded) でも禁止モチーフ指定は指示部に現れない', () => {
    const p = beforeBanList(
      prompt({ accountArtDirection: SIDE_JOB_ART, accountArtDirectionGrounded: true }),
    );
    expect(p).not.toContain('ノートPC');
    expect(p).not.toContain('円形アイコン');
    expect(p).not.toContain('観葉植物');
  });

  it('未確認 (ungrounded) の補足にも同じ検閲がかかる', () => {
    const p = beforeBanList(
      prompt({ accountArtDirection: SIDE_JOB_ART, accountArtDirectionGrounded: false }),
    );
    expect(p).not.toContain('ノートPC');
  });

  it('copy rules は検閲しない (文字規則が誤爆で消えない)', () => {
    const rules = ['「右肩上がり」のような煽り表現は避ける', '文字の横にアイコンを置かない'];
    const p = prompt({ accountCopyRules: rules });
    for (const r of rules) expect(p).toContain(r);
  });

  it('副業アカの実 art_direction は全体を捨て、既定 (厳密な色・1 個だけ) に倒れる', () => {
    const p = prompt({ accountArtDirection: SIDE_JOB_ART, accountArtDirectionGrounded: true });
    expect(p).not.toContain('これが最優先');
    expect(p).not.toContain('モチーフは合計4点まで');
    expect(p).toContain('【文字と帯の色 (アカウント共通。ここは厳密に守る)】');
    expect(p).toContain('【絵の画風】');
    expect(p).toContain('描くモノは 1 個だけ');
    expect(p).toContain(classifyNicheGenre('AI副業').art);
  });

  it('競馬アカの指示に無害な一文が混ざっても最優先のまま残る', () => {
    const art = KEIBA_ART + '雲が浮かぶ青空を背景にする。';
    const p = prompt({ accountArtDirection: art, accountArtDirectionGrounded: true }, '競馬予想');
    expect(p).toContain('これが最優先');
    expect(p).toContain('雲が浮かぶ青空');
  });

  it('競馬アカの指示に禁止モチーフが 1 文混ざったら全体を捨ててジャンル既定に倒れる', () => {
    const art = KEIBA_ART + '机の上にノートPC1台とマグカップを置く。';
    const p = prompt({ accountArtDirection: art, accountArtDirectionGrounded: true }, '競馬予想');
    expect(p).not.toContain('これが最優先');
    expect(p).not.toContain('鹿毛馬');
  });

  it('競馬アカの指示は壊れず、最優先として入る', () => {
    const p = prompt(
      { accountArtDirection: KEIBA_ART, accountArtDirectionGrounded: true },
      '競馬予想',
    );
    expect(p).toContain(KEIBA_ART);
    expect(p).toContain('これが最優先');
  });

  it('全文が落ちたら account art 無しとして genre.art に倒れる', () => {
    const genre = classifyNicheGenre('AI副業');
    const p = prompt({
      accountArtDirection: 'ノートPCに向かう会社員。円形アイコンを浮かべる。',
      accountArtDirectionGrounded: true,
    });
    expect(p).not.toContain('これが最優先');
    expect(p).toContain(genre.art);
    expect(p).toContain('【絵の画風】');
    expect(p).toContain('描くモノは 1 個だけ');
  });

  it('account art があるとモチーフ数は指定に従い、既定の「1 個だけ」は併記されない', () => {
    const p = prompt(
      { accountArtDirection: KEIBA_ART, accountArtDirectionGrounded: true },
      '競馬予想',
    );
    expect(p).not.toContain('描くモノは 1 個だけ');
    expect(p).toContain('被写体の数と構成は【このアカウントの画作り】の指定に従う');
  });
});

describe('generateNoteEyecatch', () => {
  const base: GenerateNoteEyecatchInput = {
    noteArticleId: 'art-2',
    title: 'テスト',
    hook: 'フック',
    niche: 'AI副業',
    eyecatchCopy: null,
    accountArtDirection: SIDE_JOB_ART,
    accountArtDirectionGrounded: true,
  };

  it('禁止モチーフを落としたら WARN に文と当たったモチーフを残す', async () => {
    const warn = vi.fn();
    const generateImage = vi.fn(async (_a: { prompt: string }) => okImage());
    const result = await generateNoteEyecatch(base, {
      generateImage,
      uploadBuffer: vi.fn(async () => undefined),
      withImageLoggingDeps: loggingDeps,
      skipTextCheck: true,
      logger: { warn },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0]![0] as { dropped: Array<{ sentence: string; motif: string }> };
    expect(payload.dropped.some((d) => d.sentence.includes('ノートPC'))).toBe(true);
    expect(payload.dropped.every((d) => EYECATCH_BANNED_MOTIFS.includes(d.motif))).toBe(true);
    expect(result.droppedMotifs).toEqual(payload.dropped);
    const sent = generateImage.mock.calls[0]![0].prompt;
    expect(beforeBanList(sent)).not.toContain('ノートPC');
  });

  it('禁止に触れなければ WARN は出ない', async () => {
    const warn = vi.fn();
    await generateNoteEyecatch(
      { ...base, accountArtDirection: KEIBA_ART, niche: '競馬予想' },
      {
        generateImage: vi.fn(okImage),
        uploadBuffer: vi.fn(async () => undefined),
        withImageLoggingDeps: loggingDeps,
        skipTextCheck: true,
        logger: { warn },
      },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('openai の割当モデルが実際の images.generate 呼び出しに渡る', async () => {
    const generate = vi.fn(async (_a: { model: string }) => ({
      data: [{ b64_json: Buffer.from('x').toString('base64') }],
    }));
    await generateNoteEyecatch(
      { ...base, accountArtDirection: null },
      {
        loadModelAssignment: vi.fn(async () => ({
          provider: 'openai',
          model: 'gpt-image-1',
          reasoningEffort: null,
          id: 'a',
          genre: null,
        })),
        imageGenDeps: {
          getApiKey: async () => 'k',
          openaiFactory: () => ({ images: { generate } }),
        },
        uploadBuffer: vi.fn(async () => undefined),
        withImageLoggingDeps: loggingDeps,
        skipTextCheck: true,
      },
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0].model).toBe('gpt-image-1');
  });
});

describe('research: art_direction に書かせない', () => {
  it('禁止リストをそのまま埋め込み、会社員イラスト＋円形アイコンを名指しで禁じる', () => {
    const text = artDirectionBanLines().join('\n');
    for (const m of EYECATCH_BANNED_MOTIFS) expect(text).toContain(m);
    expect(text).toContain('フラットなベクターの会社員イラスト＋浮遊する円形アイコン');
    expect(text).toContain('観察に無い質感');
  });
});
