import { describe, expect, it } from 'vitest';

import {
  applyHeadingFixes,
  appendInternalLinks,
  routeByJudgeScore,
  NOTE_JUDGE_PASS_THRESHOLD,
  NOTE_JUDGE_REWRITE_THRESHOLD,
  NoteSeoOutputSchema,
  EDITORIAL_SECTION_KEYS,
  EDITORIAL_SECTION_HEADINGS,
  parseEditorialPolicy,
  composeEditorialPolicy,
  emptyEditorialSections,
  EDITORIAL_POLICY_MAX,
  NoteAccountContextSchema,
} from '../src/agents/anp.js';

describe('applyHeadingFixes (F-ANP-42)', () => {
  const body = ['# タイトル', '', '## 馬場の見方', '本文です。', '', '### 上がり3F', '本文です。'].join('\n');

  it('見出し行だけを完全一致で置換する', () => {
    const out = applyHeadingFixes(body, [{ original: '馬場の見方', improved: '馬場バイアスの見方(当日)' }]);
    expect(out).toContain('## 馬場バイアスの見方(当日)');
    expect(out).toContain('### 上がり3F');
    expect(out).toContain('本文です。');
  });

  it('本文中に同じ文字列があっても本文は書き換えない', () => {
    const b = ['## 見送り', '見送り はここでは本文の語です。'].join('\n');
    const out = applyHeadingFixes(b, [{ original: '見送り', improved: '見送り基準' }]);
    expect(out.split('\n')[0]).toBe('## 見送り基準');
    expect(out.split('\n')[1]).toBe('見送り はここでは本文の語です。');
  });

  it('空配列・同一文字列・未一致は no-op', () => {
    expect(applyHeadingFixes(body, [])).toBe(body);
    expect(applyHeadingFixes(body, [{ original: '馬場の見方', improved: '馬場の見方' }])).toBe(body);
    expect(applyHeadingFixes(body, [{ original: '無い見出し', improved: 'X' }])).toBe(body);
  });
});

describe('appendInternalLinks (F-ANP-42)', () => {
  it('末尾に関連記事ブロックを足す', () => {
    const out = appendInternalLinks('本文', ['https://note.com/x/n/n1']);
    expect(out).toContain('## あわせて読みたい');
    expect(out).toContain('https://note.com/x/n/n1');
  });

  it('既に本文にある URL・空配列は足さない', () => {
    expect(appendInternalLinks('本文', [])).toBe('本文');
    const withUrl = '本文 https://note.com/x/n/n1';
    expect(appendInternalLinks(withUrl, ['https://note.com/x/n/n1'])).toBe(withUrl);
  });
});

describe('routeByJudgeScore (F-ANP-44)', () => {
  it('85 以上は公開へ', () => {
    expect(routeByJudgeScore(NOTE_JUDGE_PASS_THRESHOLD, 0, 1)).toBe('ready');
    expect(routeByJudgeScore(92, 1, 1)).toBe('ready');
  });

  it('70〜84 は校閲へ、69 以下は構成からやり直し', () => {
    expect(routeByJudgeScore(84, 0, 1)).toBe('editor');
    expect(routeByJudgeScore(NOTE_JUDGE_REWRITE_THRESHOLD, 0, 1)).toBe('editor');
    expect(routeByJudgeScore(69, 0, 1)).toBe('writer');
    expect(routeByJudgeScore(10, 0, 1)).toBe('writer');
  });

  it('差し戻し上限に達したら人手へ', () => {
    expect(routeByJudgeScore(84, 1, 1)).toBe('needs_human_review');
    expect(routeByJudgeScore(40, 1, 1)).toBe('needs_human_review');
  });
});

describe('記事の方針に SEO 区分がある (運営者要望 2026-09-24)', () => {
  it('区分キーと見出しに seo が含まれる', () => {
    expect(EDITORIAL_SECTION_KEYS).toContain('seo');
    expect(EDITORIAL_SECTION_HEADINGS.seo).toBe('SEO対策');
    expect(emptyEditorialSections().seo).toBe('');
  });

  it('compose → parse で SEO 区分が往復する', () => {
    const sections = { ...emptyEditorialSections(), themes: '・副業', seo: '・狙う語: 副業 AI 初心者' };
    const text = composeEditorialPolicy(sections);
    expect(text).toContain('【SEO対策】');
    expect(parseEditorialPolicy(text).seo).toContain('副業 AI 初心者');
  });

  it('旧形式のラベル行も SEO に振り分ける', () => {
    expect(parseEditorialPolicy('・【キーワード】副業 AI 初心者').seo).toContain('副業 AI 初心者');
  });
});

describe('NoteSeoOutputSchema', () => {
  const base = {
    title: '馬場バイアスの当日判定|1〜3Rの上がり3F',
    lead: 'この記事では当日の馬場バイアスの判定手順を紹介します。'.repeat(2),
    primary_keyword: '馬場バイアス 当日 判定',
    keywords: ['馬場状態', '上がり3F'],
    hashtags: ['競馬', '競馬予想'],
    eyecatch_copy: '3R後まで買い急がない',
  };

  it('必須項目が揃えば通り、既定値が入る', () => {
    const parsed = NoteSeoOutputSchema.parse(base);
    expect(parsed.hashtags).toHaveLength(2);
    expect(parsed.headings).toEqual([]);
    expect(parsed.internal_links).toEqual([]);
    expect(parsed.title_alternatives).toEqual([]);
  });

  it('ハッシュタグは 5 個まで / キャッチは 24 字まで', () => {
    expect(NoteSeoOutputSchema.safeParse({ ...base, hashtags: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
    expect(NoteSeoOutputSchema.safeParse({ ...base, eyecatch_copy: 'あ'.repeat(25) }).success).toBe(false);
  });
});

describe('editorial_policy の長さ上限 (2026-09-24 の本番障害)', () => {
  it('7 区分をフルに書いた方針 (実データ 4,400 字超) が各エージェント入力を通る', () => {
    // 上限 3000 のままだと note.theme.generate / note.account.profile / anp.promo が
    // ZodError(too_big) で失敗し、テーマの日次自動生成が連日止まっていた。
    const policy = 'あ'.repeat(4500);
    expect(NoteAccountContextSchema.safeParse({ niche: '競馬', editorial_policy: policy }).success).toBe(true);
    expect(EDITORIAL_POLICY_MAX).toBeGreaterThanOrEqual(10000);
  });

  it('上限を超える方針は弾く (無制限にはしない)', () => {
    const tooLong = 'あ'.repeat(EDITORIAL_POLICY_MAX + 1);
    expect(NoteAccountContextSchema.safeParse({ niche: '競馬', editorial_policy: tooLong }).success).toBe(false);
  });
});
