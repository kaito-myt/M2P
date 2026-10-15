/**
 * 3DP UI の日本語文言を1箇所に集約する (CLAUDE.md Hard Rule #2: 日本語が主言語 /
 * 文言のコンポーネント内ハードコーディング禁止・1箇所の辞書に集約)。
 */
export const messages = {
  common: {
    unknownError: '不明なエラーが発生しました',
    unauthorized: 'ログインが必要です',
    save: '保存',
    cancel: 'キャンセル',
    saved: '保存しました。',
  },
  brand: {
    appName: '3DP',
    tagline: '3D Products Publisher — 3Dモデル商材の開発と販売を自動化。',
  },
  nav: {
    sidebarAriaLabel: 'サイドナビゲーション',
    sectionMain: 'メニュー',
    itemHome: 'ホーム',
    itemProducts: '商品',
    sectionSystem: 'システム',
    itemSettings: '設定',
  },
  header: {
    portalLabel: 'ポータル',
    portalTitle: 'M2P ポータルへ戻る',
    userMenuLabel: 'ユーザーメニュー',
    settingsLabel: '設定',
    settingsMenuLabel: '設定',
    logoutLabel: 'ログアウト',
  },
  home: {
    pageTitle: 'ホーム',
    pageDescription:
      '3Dモデル商材 (プロップ・家具・アクセサリ・テクスチャ) の企画から BOOTH 出品までの状況。',
    quotaTitle: '当月の出品枠',
    quotaRemaining: '残り',
    quotaUnit: '件',
    quotaOf: '上限',
    quotaListed: '当月の出品数',
    quotaExhausted: '当月の出品枠を使い切りました。',
    quotaNote:
      'BOOTH は「大量・連続的な出品」を監視対象にしており (2025-07-18 発表)、閾値は非開示です。上限は目標ではありません。',
    statusTitle: '商品の状態',
    statusDescription: '`tdp_products` の件数を状態別に集計しています。',
    totalProducts: '商品総数',
    empty: 'まだ商品がありません。Inc-3 (企画) が入ると自動で積まれます。',
    toProducts: '商品一覧へ',
  },
  products: {
    pageTitle: '商品',
    pageDescription:
      '企画から出品までの 3Dモデル商材。needs_fix は自動検査で弾かれた商品で、検査 NG の理由を持ちます。',
    empty: 'まだ商品がありません。',
    emptyHint:
      '企画 (tdp.planner) と生成 (Meshy) は Inc-2 / Inc-3 で接続します。それまではこの一覧は空です。',
    filterAll: 'すべて',
    colTitle: '商品名',
    colKind: '種別',
    colStatus: '状態',
    colPrice: '価格',
    colUpdated: '更新',
    noPrice: '—',
    derivativeBlocked: '依拠性ガードで却下',
  },
  /** docs/12 §7 の `status` 値。英語のまま出さない。 */
  productStatus: {
    planned: '企画済',
    generating: '生成中',
    inspecting: '検査中',
    needs_fix: '要修正',
    ready: '生成完了',
    review: '承認待ち',
    listed: '出品済',
    failed: '失敗',
    rejected: '却下',
  } as Record<string, string>,
  /** docs/12 §3.1 の `kind` 値。アバター本体・衣装本体は扱わない。 */
  productKind: {
    prop: 'プロップ',
    furniture: '家具',
    accessory: 'アクセサリ',
    texture: 'テクスチャ',
  } as Record<string, string>,
  settings: {
    pageTitle: '設定',
    pageDescription:
      'BOOTH の AI 生成物規制 (2025-07-18) に対する 2 つの安全装置を設定します。どちらもツール側の自主制限です。',
    limitTitle: '月間出品上限 (R-1)',
    limitDescription:
      'BOOTH は「大量・連続的な出品」を監視対象にしており、違反はショップ強制非公開・アカウント停止に至ります。閾値は非開示のため、分からない以上は少なく出す方に倒します。0 にすると出品を完全に止められます。',
    limitLabel: '1 か月に出品する上限件数',
    limitRemainingPrefix: '当月はあと',
    limitRemainingSuffix: '件出せます',
    limitExhausted: '当月の出品枠は残っていません。',
    limitListedPrefix: '当月の出品数',
    denylistTitle: '禁止語リスト (R-2)',
    denylistDescription:
      '作品名・ブランド名・キャラクター名を 1 行に 1 つ登録します。企画・生成・出品の 3 段で機械的に照合し、含む企画は進めません。照合は NFKC 正規化 + 小文字化 + 空白除去で行うため、全半角・大文字小文字・空白の違いでは抜けられません。',
    denylistLabel: '禁止語 (1 行 1 語)',
    denylistPlaceholder: '例:\nブランド名\n作品名\nキャラクター名',
    denylistCountPrefix: '登録済み',
    denylistCountSuffix: '語',
    denylistEmpty: 'まだ禁止語がありません。固有名詞は網羅できないので、気づいたものから足してください。',
    denylistNote:
      '固有名詞を既定では入れていません (網羅不能なリストは「ここに無いから安全」という誤った安心を与えるため)。「〜風」「二次創作」「◯◯専用」などの構造語は、このリストに関係なく常に弾きます。',
    builtinTitle: '常時有効な判定 (設定不要)',
    builtinDescription:
      '以下は禁止語リストとは独立に、決定論的に弾きます (LLM には判定させません。同じ企画は毎回同じ結果になる必要があるため)。',
    errors: {
      saveFailed: '保存に失敗しました',
      limitRange: '月間出品上限は 0〜50 の範囲で指定してください',
      denylistTooMany: '禁止語は 500 語までです',
    },
  },
  /** 設定画面に出す「常時有効な判定」の説明。derivative-guard.ts の実装と対応。 */
  derivativeKinds: {
    style_imitation: '「〜風」「〜っぽい」「〜系」「オマージュ」「インスパイア」など、既存の何かに寄せる表現',
    fan_work_wording: '二次創作 / ファンアート / 原作 / 公式 / 版権 / 完全再現 などの語',
    specific_avatar_fit: '「◯◯ちゃん専用衣装」「◯◯対応アクセサリ」など特定のアバター/モデルへの依存',
    creator_reference: '「◯◯先生の」「@ハンドル」など特定の作家・権利者への言及',
    denylisted_term: '上で登録した禁止語',
    trademark_marker: '商標記号 (™ ® ©)',
  } as Record<string, string>,
  derivativeAllowed: {
    title: '弾かない (明示的な除外)',
    styles: '一般的な様式名: 和風 / 洋風 / 北欧風 / 中華風 / アンティーク風 など',
    platforms:
      'プラットフォーム・フォーマットへの「対応」: VRChat / Unity / Blender / Quest / VRM / MMD など (動作環境の表示であって作品への依拠ではない)',
  },
} as const;
