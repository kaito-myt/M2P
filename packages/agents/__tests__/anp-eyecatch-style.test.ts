import { describe, expect, it } from 'vitest';

import { NOTE_EYECATCH_LAYOUTS, pickNoteEyecatchLayout } from '@a2p/output-image';

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
  it('版面ごとに「隠れる領域に描くな」という指示が入る', () => {
    for (const l of NOTE_EYECATCH_LAYOUTS) {
      expect(buildPrompt(input, EYECATCH_STYLES[0]!, l)).toContain(l.subjectHint);
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
    expect(prompt).toContain('描くモノは **1 個だけ**');
  });
});
