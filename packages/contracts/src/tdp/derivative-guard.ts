/**
 * 3DP — 依拠性ガード (docs/12-3dp-design.md R-2)。
 *
 * BOOTH「AI生成作品への対応強化について」(2025-07-18) は
 *   ・特定の作品・作家への依拠性が高い商品の出品
 *   ・上記に準ずる商品を大量・連続的に出品する行為
 * を監視対象とし、商品の強制非公開 → ショップの強制非公開 → アカウント停止を
 * 段階的または即時に行うと明記している。別名義での再出品も同様。
 *
 * **生成してから気づいても credit は戻らず、出品してから気づいても手遅れ**なので、
 * 企画 (plan) の段階で止めるのがこのガードの本番。生成前・出品前にも同じ関数を通す。
 *
 * 設計方針:
 *  - **決定論的**。LLM に判定させない。同じ企画は毎回同じ結果になる必要がある
 *    (「前は通ったのに今日は弾かれた」が起きるとガードとして信用できない)。
 *  - **説明可能**。何に当たったかを理由として返し、UI に出す。
 *  - **迷ったら弾く**。3DP の扱う範囲 (汎用のプロップ・家具・小物・アクセサリ・テクスチャ) は
 *    そもそも特定作品に依拠する必要が無い。弾いて失うのは企画 1 件、通して失うのはアカウント。
 */
import { z } from 'zod';
import { computeSlots } from './hold';

/** 判定理由の種別。UI の文言と運用判断に使う。 */
export type DerivativeRiskKind =
  /** 「〜風」「〜っぽい」「〜系」等、既存の何かに寄せる意図が文面に出ている */
  | 'style_imitation'
  /** 二次創作・ファンアート・原作・公式などの語 */
  | 'fan_work_wording'
  /** 特定のアバター/作品への対応・互換をうたう (3DP の範囲外) */
  | 'specific_avatar_fit'
  /** 作家・権利者への言及 (「〜先生」「@ハンドル」など) */
  | 'creator_reference'
  /** 運営者が登録した禁止語 (作品名・ブランド名・キャラクター名) */
  | 'denylisted_term'
  /** 商標・ブランドを示す記号 (™ ® など) */
  | 'trademark_marker';

export interface DerivativeRisk {
  kind: DerivativeRiskKind;
  /** 当たった語句 (原文のまま)。UI でハイライトする。 */
  matched: string;
  /** 運営者向けの説明。 */
  reason: string;
}

export const DerivativeCheckResultSchema = z.object({
  /** 企画・生成・出品を進めてよいか。 */
  allowed: z.boolean(),
  risks: z.array(
    z.object({
      kind: z.string(),
      matched: z.string(),
      reason: z.string(),
    }),
  ),
  /** 判定に使った禁止語リストの件数 (監査用)。 */
  denylist_size: z.number().int().min(0),
  /** 判定時刻 (ISO)。企画が後から再判定されたときの差分を追えるようにする。 */
  checked_at: z.string(),
});
export type DerivativeCheckResult = z.infer<typeof DerivativeCheckResultSchema>;

/**
 * 「〜風」系の寄せる意図。**直前に 2 文字以上の語がある場合だけ**当てる
 * (「和風」「洋風」のような一般的な様式名を弾かないため、ひらがな 1 文字＋風 等は除外)。
 *
 * 一般的な様式語は許可する: 和風・洋風・北欧風・中華風 など。これらは特定作品ではなく
 * 広く使われる様式の呼称であり、弾くと作れるものが無くなる。
 */
const GENERIC_STYLE_WORDS = [
  '和風',
  '洋風',
  '北欧風',
  '中華風',
  '南国風',
  'レトロ風',
  'アンティーク風',
  '昭和風',
  '昭和レトロ風',
  'industrial風',
];

const STYLE_IMITATION_RE = /([\p{sc=Han}\p{sc=Katakana}\p{sc=Hiragana}A-Za-z0-9ー・]{2,20})(風|っぽい|系|テイスト|インスパイア|オマージュ|リスペクト)/gu;

const FAN_WORK_RE =
  /(二次創作|ファンアート|ファングッズ|原作|公式|版権|同人グッズ|キャラクター再現|そっくり|完全再現|模写)/g;

/**
 * 「◯◯専用/対応の△△」。△△ 側は小物・アクセサリまで広く取る
 * (「セレスティア対応アクセサリ」のような書き方で抜けさせない)。
 */
const SPECIFIC_FIT_RE =
  /([\p{sc=Han}\p{sc=Katakana}\p{sc=Hiragana}A-Za-z0-9ー・]{2,24})\s*(ちゃん|くん|さん)?\s*(専用|対応|用|向け)\s*(アバター|衣装|モデル|素体|アクセサリー|アクセサリ|小物|パーツ|装備|ボーン)/gu;

/**
 * 「◯◯対応」の ◯◯ がプラットフォーム・フォーマット・エンジン名なら依拠性ではない。
 * 「VRChat 対応アクセサリ」は作品への依拠ではなく動作環境の表示なので通す。
 */
const PLATFORM_TERMS = [
  'vrchat',
  'unity',
  'blender',
  'quest',
  'pc',
  'cluster',
  'resonite',
  'vrm',
  'mmd',
  'fbx',
  'glb',
  'unreal',
  'webxr',
  'android',
  'ios',
];

const CREATOR_REF_RE = /((?:[\p{sc=Han}\p{sc=Katakana}A-Za-z0-9ー・]{2,20})(?:先生|氏|さん)の|@[A-Za-z0-9_]{3,})/gu;

const TRADEMARK_RE = /[™®©]/u;

/**
 * 依拠性の判定。
 *
 * @param texts 企画・商品名・プロンプト・紹介文など、外に出る/生成に使う全ての文字列
 * @param denylist 運営者が登録した禁止語 (作品名・ブランド名・キャラクター名)。
 *                 大文字小文字・全半角は正規化して比較する。
 */
export function checkDerivativeRisk(
  texts: ReadonlyArray<string | null | undefined>,
  denylist: ReadonlyArray<string> = [],
  now: () => Date = () => new Date(),
): DerivativeCheckResult {
  const joined = texts
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .join('\n');
  const risks: DerivativeRisk[] = [];

  if (joined.trim().length > 0) {
    // 1. 運営者の禁止語 (最優先。作品名・キャラクター名はここで持つしかない)
    const normalized = normalize(joined);
    for (const raw of denylist) {
      const term = normalize(raw);
      if (term.length === 0) continue;
      if (normalized.includes(term)) {
        risks.push({
          kind: 'denylisted_term',
          matched: raw,
          reason: `禁止語「${raw}」を含みます。特定の作品・ブランド・キャラクターに依拠する企画は作りません。`,
        });
      }
    }

    // 2. 「〜風」系 (一般的な様式名は除外)
    for (const m of joined.matchAll(STYLE_IMITATION_RE)) {
      const whole = m[0];
      if (GENERIC_STYLE_WORDS.some((w) => whole.includes(w))) continue;
      risks.push({
        kind: 'style_imitation',
        matched: whole,
        reason: `「${whole}」は既存の何かに寄せる表現です。特定の作品・作家への依拠と判断される恐れがあります。`,
      });
    }

    // 3. 二次創作系の語
    for (const m of joined.matchAll(FAN_WORK_RE)) {
      risks.push({
        kind: 'fan_work_wording',
        matched: m[0],
        reason: `「${m[0]}」は二次創作・既存作品への依拠を示す語です。`,
      });
    }

    // 4. 特定アバターへの対応・専用 (プラットフォーム名は除外)
    for (const m of joined.matchAll(SPECIFIC_FIT_RE)) {
      const subject = normalize(m[1] ?? '');
      if (PLATFORM_TERMS.includes(subject)) continue;
      risks.push({
        kind: 'specific_avatar_fit',
        matched: m[0],
        reason: `「${m[0]}」は特定のアバター/モデルに依存します。3DP は汎用の小物・アクセサリだけを扱います。`,
      });
    }

    // 5. 作家・権利者への言及
    for (const m of joined.matchAll(CREATOR_REF_RE)) {
      risks.push({
        kind: 'creator_reference',
        matched: m[0],
        reason: `「${m[0]}」は特定の作家・権利者への言及です。`,
      });
    }

    // 6. 商標記号
    if (TRADEMARK_RE.test(joined)) {
      const matched = joined.match(TRADEMARK_RE)?.[0] ?? '';
      risks.push({
        kind: 'trademark_marker',
        matched,
        reason: `商標記号 (${matched}) を含みます。ブランドに依拠する企画は作りません。`,
      });
    }
  }

  // 同じ語で複数当たった分は 1 件にまとめる (UI が同文で埋まるのを防ぐ)。
  const seen = new Set<string>();
  const deduped = risks.filter((r) => {
    const key = `${r.kind}:${r.matched}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    allowed: deduped.length === 0,
    risks: deduped,
    denylist_size: denylist.length,
    checked_at: now().toISOString(),
  };
}

/** 比較用の正規化 — NFKC (全半角統一) + lower-case + 空白除去。 */
function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/**
 * 既定の禁止語。**作品名・キャラクター名は入れない** (網羅不能で、入れると
 * 「このリストに無いから安全」という誤った安心を与える)。
 * ここに入れるのは「依拠性そのものを示す構造語」だけで、固有名詞は運営者が
 * 設定画面で足していく。
 */
export const DEFAULT_DERIVATIVE_DENYLIST: readonly string[] = [
  'コスプレ衣装',
  '痛車',
  'キャラ再現',
  '推しの子',
  '公式コラボ',
];

/**
 * 月間出品上限の判定 (docs/12 R-1)。
 *
 * BOOTH は「大量・連続的な出品」を監視対象にしており、閾値は非開示。
 * **分からない以上、少なく出す方に倒す。** 上限は目標ではない。
 */
export function canListMore(args: {
  /** 当月すでに出品した件数。 */
  listedThisMonth: number;
  /** 月間上限 (app_settings)。 */
  monthlyLimit: number;
}): { allowed: boolean; remaining: number; reason?: string } {
  const { allowed, remaining, limit } = computeSlots({
    limit: args.monthlyLimit,
    publishedThisMonth: args.listedThisMonth,
    activeReservations: 0,
  });
  if (allowed) return { allowed: true, remaining };
  return {
    allowed: false,
    remaining: 0,
    reason:
      `当月の出品上限 ${limit} 件に達しました。BOOTH は「大量・連続的な出品」を` +
      '監視対象にしており (2025-07-18 発表)、閾値は非開示です。来月まで出品しません。' +
      (args.monthlyLimit > limit
        ? `設定値 ${args.monthlyLimit} 件はコード側の上限 ${limit} 件で読み替えています (設定 → 月間出品上限)。`
        : ''),
  };
}
