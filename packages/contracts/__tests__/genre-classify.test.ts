import { describe, expect, it } from 'vitest';

import { classifyGenre, isFiction, isKnownGenre, resolveCandidateGenre } from '../src/genres.js';

/**
 * 2026-10-14 の実障害に対する回帰テスト。
 * `mapCandidateToRow` が genre 未指定の候補に一律 'practical' を刻んでいたため、
 * 本番の theme_candidates は practical 70 件が実態と無関係な実用書扱いになっていた。
 * 下のタイトル/フックはすべて **本番データの実物**。
 */
describe('classifyGenre (本番で誤分類されていた実データ)', () => {
  it('競馬・競輪本を gambling と判定する', () => {
    const actual = [
      '回収率120%への道：血統×ペース×AIで「負けない馬券」を組み立てる完全戦略',
      'オッズ×血統×馬場バイアス 三角データ競馬予想術',
      '最強競馬予想術 コース替わりで獲る夏重賞',
      '最強競馬予想術 ハンデ重賞の歪みを獲る',
      '小倉競馬場 芝1200m スペシャリスト養成講座',
      'バンクで決まる競輪 全43場攻略バイブル',
      '回収率で考える競輪 期待値とオッズで勝ち越す買い方',
    ];
    for (const title of actual) expect(classifyGenre({ title }), title).toBe('gambling');
  });

  it('小説をフィクションと判定する (タイトル単体では分からないのでフックを使う)', () => {
    const g1 = classifyGenre({
      title: '海の底で、あなたの名前を呼ぶ',
      context: '本屋大賞の近年受賞作に共通するのは、社会の片隅に取り残された人間の切実さである',
    });
    expect(g1).toBe('novel');
    expect(isFiction(g1)).toBe(true);

    for (const [title, context] of [
      ['ファンダムの神殿', '2026年本屋大賞受賞の『イン・ザ・メガチャーチ』がファンダム経済を多視点で描き'],
      ['界隈（かいわい）の子どもたち', '多視点×現代の「推し」経済×家族崩壊の複合テーマ。2026年本屋大賞受賞作'],
      ['最後のオーケストラ', '本屋大賞2017年受賞作『蜜蜂と遠雷』が音楽×青春×群像劇で'],
    ] as const) {
      expect(isFiction(classifyGenre({ title, context })), title).toBe(true);
    }
  });

  it('ラノベを light_novel と判定する', () => {
    for (const title of [
      '百鬼夜行ラブコメディ ―平安陰陽師・安倍晴明、現代の女子高生に転生する―',
      '復讐は今夜、王子のスマホから ―転生ハムレットの証拠固め―',
      '末娘は沈黙で王国を救う ―転生コーディリア、老王リアの破滅を止める―',
    ]) {
      expect(classifyGenre({ title }), title).toBe('light_novel');
    }
  });

  it('実用書を小説に誤分類しない', () => {
    const practicalish = [
      ['「疲れが抜けない」を卒業する 自律神経リセット大全', 'health'],
      ['40代・50代からの「睡眠負債」完全返済プログラム', 'health'],
      ['40代・50代のための「やめる」健康習慣', 'health'],
      ['医者が教えない「血糖値の真実」　食後15分の新習慣で、疲れ・肥満・老化が一気に消える', 'health'],
      ['新NISA 2026 完全対応ガイド', 'money'],
      ['ChatGPT仕事術「時短テンプレ」100', 'ai_tech'],
      ['超雑談力の作り方 人見知りでも初対面で信頼される会話の型', 'communication'],
      ['話し方より「聞き方」で人生が変わる', 'communication'],
      ['話し相手に「また会いたい」と思わせる人の、小さな言葉の選び方', 'communication'],
      ['凡人のためのKindle出版1冊目', 'side_business'],
      ['スマホ脳リセット 集中力が戻る7日間プログラム', 'habit'],
      ['一流の習慣100 ── 「やめる」だけで人生が変わる逆張り習慣術', 'habit'],
      ['60代から「捨てる」と豊かになる お金・モノ・人間関係の断捨離術', 'lifestyle'],
      ['人間関係は「距離」で9割決まる', 'relationship'],
      ['一流の経営者ほどスニーカーを履かない', 'business'],
    ] as const;
    for (const [title, expected] of practicalish) {
      const g = classifyGenre({ title });
      expect(isFiction(g), `${title} -> ${g}`).toBe(false);
      expect(g, title).toBe(expected);
    }
  });

  it('長文フックはノンフィクションのジャンル語照合に使わない', () => {
    // フックは市場分析の長文でジャンル語を無関係に多数含む。これを混ぜると
    // 「聞き方」の本が health に、会話術の本が side_business に落ちていた。
    const g = classifyGenre({
      title: '話し方より「聞き方」で人生が変わる',
      context:
        '競合は「超雑談力」など。老後資金や健康、副業に悩む読者も多く、疲れを感じる職場で…',
    });
    expect(g).toBe('communication');
  });

  it('判定できない文章では null を返す (誤ったジャンルを刻まない)', () => {
    expect(classifyGenre({ title: 'よくわからない本' })).toBeNull();
    // 業界用語だけのタイトルは判定できない (「千直」= 新潟芝1000m直線)。
    // 無理に当てずに null を返し、既定の practical に倒すのが設計意図。
    expect(classifyGenre({ title: '千直の教科書' })).toBeNull();
    expect(classifyGenre({ title: '' })).toBeNull();
    expect(classifyGenre({ title: null })).toBeNull();
    // タイトルが空ならフックがあっても判定しない (フックだけでは本の主題が決まらない)。
    expect(classifyGenre({ title: null, context: '本屋大賞の受賞作のような物語' })).toBeNull();
  });

  it('返す slug は必ずカタログに載っている', () => {
    for (const title of ['競馬の期待値', '英会話の学び直し', 'ホラー怪談の夜の小説', '子育ての教科書']) {
      const g = classifyGenre({ title });
      expect(g === null || isKnownGenre(g), `${title} -> ${g}`).toBe(true);
    }
  });
});

describe('resolveCandidateGenre (保存時のジャンル決定)', () => {
  it('明示指定が最優先', () => {
    expect(resolveCandidateGenre({ explicit: 'mystery', declared: 'business', title: '競馬' })).toBe(
      'mystery',
    );
  });

  it('明示が無ければ Marketer の申告を使う', () => {
    expect(resolveCandidateGenre({ explicit: null, declared: 'light_novel', title: '競馬' })).toBe(
      'light_novel',
    );
  });

  it('カタログ外の申告は無視して推定に落ちる', () => {
    expect(
      resolveCandidateGenre({ explicit: null, declared: 'ラノベ', title: '異世界転生の物語' }),
    ).toBe('light_novel');
  });

  it('推定もできなければ practical (DB は NOT NULL なので必ず値が要る)', () => {
    expect(resolveCandidateGenre({ explicit: null, declared: null, title: '謎の本' })).toBe(
      'practical',
    );
  });

  it('本番の事故シナリオ: 全部 null でも競馬本は gambling になる', () => {
    expect(
      resolveCandidateGenre({
        explicit: null,
        declared: null,
        title: '最強競馬予想術 期待値で買う馬券',
        context: 'オッズの歪みを突く',
      }),
    ).toBe('gambling');
  });
});
