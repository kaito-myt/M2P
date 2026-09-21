import { describe, expect, it } from 'vitest';

import {
  NoteAccountEditorialOutputSchema,
  classifyEditorialLine,
  composeEditorialPolicy,
  parseEditorialPolicy,
} from '../src/agents/anp.js';

const NL = String.fromCharCode(10);

describe('composeEditorialPolicy / parseEditorialPolicy (F-ANP-07b)', () => {
  it('round-trips sections with headings and skips empty ones', () => {
    const text = composeEditorialPolicy({ themes: '・副業の最初の1万円', format: '', style_rules: '・です・ます調', cta: '', quality: '1) 出典なし', other: '' });
    expect(text).toBe(['【主なテーマ】', '・副業の最初の1万円', '【文末表現・禁止事項】', '・です・ます調', '【品質判定項目】', '1) 出典なし'].join(NL));
    expect(parseEditorialPolicy(text)).toEqual({ themes: '・副業の最初の1万円', format: '', style_rules: '・です・ます調', cta: '', quality: '1) 出典なし', other: '' });
    expect(composeEditorialPolicy({})).toBe('');
    expect(parseEditorialPolicy(null)).toEqual({ themes: '', format: '', style_rules: '', cta: '', quality: '', other: '' });
  });

  it('keeps multi-line bodies under a heading', () => {
    const text = ['【記事のフォーマット】', '・冒頭で悩み', '・見出しは動詞', '', '【CTA】', '・末尾に導線'].join(NL);
    const s = parseEditorialPolicy(text);
    expect(s.format).toBe(['・冒頭で悩み', '・見出しは動詞'].join(NL));
    expect(s.cta).toBe('・末尾に導線');
  });

  it('classifies legacy bullet labels into sections', () => {
    expect(classifyEditorialLine('・【書くこと/書かないこと】競馬予想の考え方')).toBe('themes');
    expect(classifyEditorialLine('・【記事の型】冒頭で結論')).toBe('format');
    expect(classifyEditorialLine('・【有料記事の設計】無料:有料=7:3')).toBe('format');
    expect(classifyEditorialLine('・【語尾・人称・禁止表現】です・ます調')).toBe('style_rules');
    expect(classifyEditorialLine('・【CTA】記事末尾に3点セット')).toBe('cta');
    expect(classifyEditorialLine('・【品質判定の減点項目】①データの出典が無い')).toBe('quality');
    expect(classifyEditorialLine('・【免責】ギャンブル依存を助長しない')).toBe('other');
  });

  it('splits a legacy (heading-less) policy by bullet labels, joining continuation lines', () => {
    const legacy = [
      '・【書くこと/書かないこと】競馬予想の考え方を書く。',
      '  予想の的中自慢は書かない。',
      '・【記事の型】冒頭で結論→根拠→買い目。',
      '・【CTA】記事末尾に必ず3点セット。',
      '・【品質判定の減点項目】①出典が無い、②断定表現。',
    ].join(NL);
    const s = parseEditorialPolicy(legacy);
    expect(s.themes).toBe(['・【書くこと/書かないこと】競馬予想の考え方を書く。', '  予想の的中自慢は書かない。'].join(NL));
    expect(s.format).toBe('・【記事の型】冒頭で結論→根拠→買い目。');
    expect(s.cta).toBe('・【CTA】記事末尾に必ず3点セット。');
    expect(s.quality).toBe('・【品質判定の減点項目】①出典が無い、②断定表現。');
    expect(s.other).toBe('');
  });

  it('output schema requires sections and keeps legacy editorial_policy optional', () => {
    const ok = NoteAccountEditorialOutputSchema.safeParse({ target_reader: 'r', tone: 't', sections: { themes: 'a' } });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.sections.other).toBe('');
    expect(NoteAccountEditorialOutputSchema.safeParse({ target_reader: 'r', tone: 't', editorial_policy: 'x' }).success).toBe(false);
  });
});
