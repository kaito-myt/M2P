import { describe, expect, it } from 'vitest';

import { classifyNicheGenre } from '@a2p/contracts/note-genre';
import { NOTE_EYECATCH_LAYOUTS, pickNoteEyecatchLayout, schemeForNiche } from '@a2p/output-image';

import { buildPrompt } from '../src/anp/eyecatch.js';
import { EYECATCH_BANNED_MOTIFS, EYECATCH_STYLES, pickEyecatchStyle } from '../src/anp/eyecatch-style.js';

describe('pickEyecatchStyle (F-ANP-14b)', () => {
  it('同じ記事 id なら常に同じ画風 (再生成しても揺れない)', () => {
    const a = pickEyecatchStyle('art-123');
    const b = pickEyecatchStyle('art-123');
    expect(a.key).toBe(b.key);
  });

  it('記事が違えば画風が散る (10 件で 3 種類以上)', () => {
    const keys = new Set(Array.from({ length: 10 }, (_, i) => pickEyecatchStyle(`cmub${i}xyz`).key));
    expect(keys.size).toBeGreaterThanOrEqual(3);
  });

  it('直近で使った画風は避ける', () => {
    const first = pickEyecatchStyle('art-777');
    const second = pickEyecatchStyle('art-777', [first.key]);
    expect(second.key).not.toBe(first.key);
    const third = pickEyecatchStyle('art-777', [first.key, second.key]);
    expect([first.key, second.key]).not.toContain(third.key);
  });

  it('全部の画風を避けた場合でも必ず 1 つ返す', () => {
    const all = EYECATCH_STYLES.map((s) => s.key);
    expect(all).toContain(pickEyecatchStyle('art-1', all).key);
  });
});

describe('buildPrompt (F-ANP-14b)', () => {
  const input = { noteArticleId: 'art-1', title: '1番人気を買う日と切る日', hook: 'オッズの歪みを見る', niche: '競馬予想' };
  const layout = NOTE_EYECATCH_LAYOUTS[0]!;

  it('画風レシピと禁止モチーフを必ず含める', () => {
    const style = pickEyecatchStyle(input.noteArticleId);
    const prompt = buildPrompt(input, style, layout);
    expect(prompt).toContain(style.medium);
    expect(prompt).toContain(style.composition);
    expect(prompt).toContain(style.palette);
    for (const banned of EYECATCH_BANNED_MOTIFS) expect(prompt).toContain(banned);
    expect(prompt).toContain(input.title);
    expect(prompt).toContain(input.niche);
  });

  it('記事の方針があればトーンとして注入し、無ければ行ごと出さない', () => {
    const style = EYECATCH_STYLES[0]!;
    expect(buildPrompt({ ...input, editorialPolicy: '・淡々と、煽らない' }, style, layout)).toContain(
      '淡々と、煽らない',
    );
    expect(buildPrompt(input, style, layout)).not.toContain('【媒体のトーン】');
  });

  it('画風が違えばプロンプトも変わる', () => {
    const p1 = buildPrompt(input, EYECATCH_STYLES[0]!, layout);
    const p2 = buildPrompt(input, EYECATCH_STYLES[1]!, layout);
    expect(p1).not.toBe(p2);
  });

  /**
   * [F-ANP-52] 版面とプロンプトが食い違うと、主題がパネルの下に埋まって消える。
   * 「どこを塗りつぶすか」は 1 箇所 (NOTE_EYECATCH_LAYOUTS) で持ち、両方がそれを見る。
   */
  it('版面ごとに「絵と文字をどう置くか」の指示が入る', () => {
    for (const l of NOTE_EYECATCH_LAYOUTS) {
      expect(buildPrompt(input, EYECATCH_STYLES[0]!, l)).toContain(l.textPlacement);
    }
    const bottom = buildPrompt(input, EYECATCH_STYLES[0]!, NOTE_EYECATCH_LAYOUTS[0]!);
    const side = buildPrompt(input, EYECATCH_STYLES[0]!, NOTE_EYECATCH_LAYOUTS[1]!);
    expect(bottom).not.toBe(side);
    // 合成側と同じ版面が選ばれること (同じ記事 id で決定的)。
    expect(pickNoteEyecatchLayout(input.noteArticleId).key).toBe(
      pickNoteEyecatchLayout(input.noteArticleId).key,
    );
  });

  it('毎回出てくる「それっぽい事務用品」への逃げ道を名指しで塞ぐ', () => {
    const prompt = buildPrompt(input, EYECATCH_STYLES[0]!, layout);
    for (const motif of ['クリップボード', '円グラフ', 'ノートPC', 'フラットレイ']) {
      expect(prompt).toContain(motif);
    }
    expect(prompt).toContain('**描くモノは 1 個だけ**');
  });

  /**
   * [F-ANP-55] 画像モデルに**文字ごと**描かせる 1 パス方式に変えた。
   * コピーがプロンプトに verbatim で入っていなければ、そもそも何も描かれない。
   */
  describe('1 パス生成 (文字ごと描かせる)', () => {
    it('コピーと補足がそのままプロンプトに入る', () => {
      const prompt = buildPrompt(
        { ...input, eyecatchCopy: '回収率は実購入額で決める', eyecatchSub: '見送りは0円で記録' },
        EYECATCH_STYLES[0]!,
        layout,
      );
      expect(prompt).toContain('「回収率は実購入額で決める」');
      expect(prompt).toContain('「見送りは0円で記録」');
      expect(prompt).toContain('一字一句そのまま');
    });

    it('コピーが無ければ「文字を描かない」に倒れる', () => {
      const prompt = buildPrompt(
        { ...input, eyecatchCopy: null, eyecatchSub: null },
        EYECATCH_STYLES[0]!,
        layout,
      );
      expect(prompt).toContain('【文字は描かない】');
      expect(prompt).not.toContain('【文字の描き方');
    });

    it('ジャンルごとに書体の作法が切り替わる', () => {
      const gamble = buildPrompt(
        { ...input, niche: '競馬予想', eyecatchCopy: 'テスト' },
        EYECATCH_STYLES[0]!,
        layout,
      );
      const money = buildPrompt(
        { ...input, niche: '副業×AI活用', eyecatchCopy: 'テスト' },
        EYECATCH_STYLES[0]!,
        layout,
      );
      expect(gamble).toContain(classifyNicheGenre('競馬予想').typography);
      expect(money).toContain(classifyNicheGenre('副業×AI活用').typography);
      expect(gamble).not.toBe(money);
    });

    it('アカウント固有の画作り指示はジャンル既定を上書きする', () => {
      const custom = '**モノクロの報道写真**にする。装飾は一切入れない。';
      const prompt = buildPrompt(
        { ...input, niche: '競馬予想', eyecatchCopy: 'テスト', accountArtDirection: custom },
        EYECATCH_STYLES[0]!,
        layout,
      );
      expect(prompt).toContain(custom);
      expect(prompt).not.toContain(classifyNicheGenre('競馬予想').art);
    });

    it('配色は文字と帯の色として渡る (アカウントで統一するため)', () => {
      const scheme = schemeForNiche('競馬予想');
      const prompt = buildPrompt(
        { ...input, niche: '競馬予想', eyecatchCopy: 'テスト' },
        EYECATCH_STYLES[0]!,
        layout,
      );
      expect(prompt).toContain(scheme.main);
      expect(prompt).toContain(scheme.accent);
    });
  });
});

/**
 * F-ANP-56 の回帰テスト (2026-10-14 の実測から)。
 *
 * アカウント指定を「ジャンルの作法」の位置に置くだけでは効かなかった。
 * 後続の【文字と帯の色】が「ここは厳密に守る」、【絵の画風】が具体的な既定値を出すため、
 * モデルは後に書かれた強い既定に従い、リサーチが「実写風・曇天・低彩度・芝の深緑」と
 * 決めた競馬アカウントに**黒地×金の装飾文字**が生成された。
 */
/** テスト用の薄いラッパ (画風/版面は固定して、注入の有無だけを見る)。 */
function buildPromptForTest(input: Parameters<typeof buildPrompt>[0]): string {
  return buildPrompt(input, pickEyecatchStyle('fixed-seed'), NOTE_EYECATCH_LAYOUTS[0]!);
}

describe('buildPrompt — アカウント指定が既定より優先されること', () => {
  const base = {
    noteArticleId: 'a1',
    title: '穴馬は継続騎乗でも据え置き',
    hook: '13,597頭の比較',
    niche: '競馬予想',
    eyecatchCopy: '継続騎乗の穴馬は据え置き',
  };

  it('アカウント指定があるとき、既定の色と画風は「指定が無い項目だけ」に格下げされる', () => {
    const art = '実写風。曇天の芝コースを低い位置から。色は芝の深緑 #2F4F3A を基調に低彩度。';
    const withArt = buildPromptForTest({ ...base, accountArtDirection: art });

    // アカウント指定が最優先として出る
    expect(withArt).toContain('**これが最優先**');
    expect(withArt).toContain('#2F4F3A');
    // 既定側は「指定が無い項目だけ」に格下げされ、「厳密に守る」は消える
    expect(withArt).not.toContain('ここは厳密に守る');
    expect(withArt).toContain('上のアカウント指定に書かれていない項目だけ適用する');
  });

  it('アカウント指定が無いときは従来どおり既定を厳密に守らせる', () => {
    const noArt = buildPromptForTest(base);
    expect(noArt).toContain('ここは厳密に守る');
    expect(noArt).not.toContain('**これが最優先**');
  });

  it('コピーの装飾規則が画像プロンプトに入る (装飾文字の禁止が効くように)', () => {
    const out = buildPromptForTest({
      ...base,
      accountCopyRules: ['装飾文字・縁取り3重・虹色グラデーションは使わない', '数字は1枚に1つだけ'],
    });
    expect(out).toContain('このアカウントの文字の作法');
    expect(out).toContain('縁取り3重');
    expect(out).toContain('数字は1枚に1つだけ');
  });

  it('コピー規則が無ければその節は出さない', () => {
    expect(buildPromptForTest(base)).not.toContain('このアカウントの文字の作法');
  });
});
