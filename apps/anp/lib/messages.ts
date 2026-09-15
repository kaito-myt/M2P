/**
 * ANP UI の日本語文言を1箇所に集約する (CLAUDE.md ハードルール: 日本語文言はコンポーネント内
 * ハードコーディング禁止・1箇所の辞書に集約)。
 */
export const messages = {
  common: {
    unknownError: '不明なエラーが発生しました',
    unauthorized: 'ログインが必要です',
    save: '保存',
    cancel: 'キャンセル',
    create: '作成',
    approve: '承認',
    reject: '却下',
  },
  accounts: {
    pageTitle: 'note アカウント',
    pageDescription: 'テーマ (ニッチ) ごとに note アカウントを台帳管理します。',
    empty: 'まだ note アカウントがありません。下のフォームから作成してください。',
    form: {
      title: 'アカウントを作成',
      niche: 'ニッチ (例: 副業×AI)',
      displayName: '表示名',
      targetReader: '想定読者',
      tone: 'トーン (文体・語り口)',
      freeRatio: '無料公開比率 (0〜1)',
      priceMin: '価格帯 (下限, 円)',
      priceMax: '価格帯 (上限, 円)',
      membership: 'メンバーシップを扱う',
      submit: 'アカウントを作成',
    },
    errors: {
      nicheRequired: 'ニッチを入力してください',
      displayNameRequired: '表示名を入力してください',
      unknown: 'アカウントの作成に失敗しました',
    },
    detailLink: '詳細を見る',
  },
  accountDetail: {
    back: '← アカウント一覧',
    themesTitle: 'テーマ候補',
    themesEmpty: 'テーマ候補がありません。「テーマ生成」を実行してください。',
    generateThemes: 'テーマ生成',
    generateThemesRunning: '生成中…',
    articlesTitle: '記事',
    articlesEmpty: 'まだ記事がありません。テーマを承認すると記事が作成されます。',
    themeStatus: {
      pending: '未承認',
      accepted: '承認済み',
      rejected: '却下',
    },
    articleStatus: {
      queued: '待機中',
      writing: '構成生成中',
      editing: '執筆/校閲中',
      eyecatch: 'アイキャッチ生成中',
      judging: '品質判定中',
      ready: '公開準備完了',
      published: '公開済み',
      needs_human_review: '要確認 (品質基準未達)',
      failed: '失敗',
      cancelled: 'キャンセル',
    },
    recommendPaid: '有料推奨',
    recommendFree: '無料推奨',
    suggestedPrice: (price: number) => `想定価格 ¥${price.toLocaleString('ja-JP')}`,
    errors: {
      generateFailed: 'テーマ生成の起動に失敗しました',
      approveFailed: 'テーマの承認に失敗しました',
      rejectFailed: 'テーマの却下に失敗しました',
    },
  },
} as const;
