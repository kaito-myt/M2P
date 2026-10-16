/**
 * F-ANP-56 (2026-10-14): 週次リサーチの成果が各エージェントのプロンプトへ届くこと。
 *
 * 競馬アカウントのリサーチが「note 公式の競馬トピックに並ぶのは例外なく
 * 『開催日＋レース名』始まり。条件語始まりの当アカウント 20 本は競馬面に
 * 乗っていない」という決定的な知見を出したのに、それが `findings` にしか無く
 * `anp.seo` へ渡っていなかったため、再生成されたタイトルも条件語始まりのままだった。
 */
import { describe, expect, it } from 'vitest';

import type { NoteAccountResearch } from '@a2p/contracts/agents/anp';

import { accountResearchLines } from '../src/anp/account-context.js';

const research: NoteAccountResearch = {
  angles: [{ angle: '観点A', queries: ['q'] }],
  findings: [
    {
      finding: 'note 公式の競馬トピックに並ぶ記事は例外なく「開催日＋レース名」始まりだった',
      implication: 'タイトル前半を開催日＋競馬場に変える',
      sources: [],
    },
    { finding: '2つ目の知見', sources: [] },
    { finding: '3つ目の知見', sources: [] },
    { finding: '4つ目の知見', sources: [] },
    { finding: '5つ目の知見', sources: [] },
    { finding: '6つ目の知見 (上限を超えるので載らない)', sources: [] },
  ],
  winning_patterns: ['冒頭に回収率の実績を数字で出す'],
  art_direction: '実写風・低彩度',
  copy_rules: ['数字は1枚に1つだけ'],
  topics_to_pursue: ['金曜の週末予想'],
  topics_to_avoid: ['必勝を謳う記事'],
  editorial_policy_suggestion: '根拠を先に出す',
  summary: '総括',
  art_direction_evidence: [],
  rival_eyecatches: null,
  preferred_style_keys: [],
};

describe('accountResearchLines', () => {
  it('知見・勝ち型・コピー規則が入る (タイトル決定に効かせる経路)', () => {
    const text = accountResearchLines({ research }, ['copy', 'patterns', 'findings']).join('\n');
    expect(text).toContain('開催日＋レース名');
    expect(text).toContain('タイトル前半を開催日＋競馬場に変える');
    expect(text).toContain('冒頭に回収率の実績を数字で出す');
    expect(text).toContain('数字は1枚に1つだけ');
  });

  it('知見は件数を切ってプロンプトを膨らませない', () => {
    const text = accountResearchLines({ research }, ['findings']).join('\n');
    expect(text).not.toContain('6つ目の知見');
  });

  it('題材は狙う/避けるを分けて出す', () => {
    const text = accountResearchLines({ research }, ['topics']).join('\n');
    expect(text).toContain('金曜の週末予想');
    expect(text).toContain('必勝を謳う記事');
    expect(text).toContain('避ける題材');
  });

  it('要求していない種別は出さない (エージェントごとに要るものが違う)', () => {
    const onlyCopy = accountResearchLines({ research }, ['copy']).join('\n');
    expect(onlyCopy).toContain('数字は1枚に1つだけ');
    expect(onlyCopy).not.toContain('金曜の週末予想');
    expect(onlyCopy).not.toContain('開催日＋レース名');
  });

  it('リサーチが無ければ何も足さない', () => {
    expect(accountResearchLines({}, ['copy', 'patterns', 'findings', 'topics'])).toEqual([]);
  });

  it('空の項目は見出しごと出さない', () => {
    const empty: NoteAccountResearch = {
      ...research,
      findings: [],
      winning_patterns: [],
      copy_rules: [],
      topics_to_pursue: [],
      topics_to_avoid: [],
    };
    expect(accountResearchLines({ research: empty }, ['copy', 'patterns', 'findings', 'topics'])).toEqual([]);
  });
});
