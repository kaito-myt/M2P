/**
 * ANP ホーム（ミッションコントロール骨格 / 認証必須）。
 *
 * Phase 0: SSO で起動する骨格。実データ接続（アカウント/記事/売上/販促）は
 * Prisma の note_* モデル追加後に段階実装する（docs/11-anp-design.md §8 ロードマップ）。
 */
import { auth } from '@/auth';
import { logout } from './actions';

/** M2P ポータルへ戻る URL。未設定時はローカル dev の 3002。本番は AUTH_COOKIE_DOMAIN 配下。 */
const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL ||
  (process.env.NODE_ENV !== 'production' ? 'http://localhost:3002' : '');

interface PlannedSection {
  title: string;
  body: string;
  phase: string;
}

const SECTIONS: PlannedSection[] = [
  {
    title: 'note アカウント（テーマ別マルチ）',
    body: 'ニッチごとに複数の note アカウントを台帳管理。各アカウントの収益方針（無料比率/有料価格帯/メンバーシップ）とリンク SNS を保持。',
    phase: 'Phase 2',
  },
  {
    title: '記事パイプライン',
    body: 'テーマ生成 → 構成 → 本文（無料+続き有料のライン）→ 校閲 → アイキャッチ画像 → 品質判定 → 価格/公開ゲート。',
    phase: 'Phase 1',
  },
  {
    title: 'note 出版オートメーション',
    body: 'Playwright アシストで下書き作成〜価格設定〜公開。再認証は LINE 認証リレー（note_auth_requests）で通す。',
    phase: 'Phase 2',
  },
  {
    title: '販促（SNS 自動）',
    body: 'アカウント別に X / Instagram / TikTok へ記事告知を自動生成・投稿。note 記事 URL を導線に差し込む。',
    phase: 'Phase 3',
  },
  {
    title: '収益・KPI',
    body: '記事別売上・ビュー・スキ・フォロワー・メンバーシップ課金者数を取得。当月純利益（売上−コスト）を集約。',
    phase: 'Phase 2',
  },
  {
    title: 'コスト可観測性',
    body: '全 LLM / 画像生成呼び出しを token_usage に記録（tool=anp）。アカウント別・工程別コストを可視化。',
    phase: 'Phase 1',
  },
];

export default async function AnpHomePage() {
  const session = await auth();
  const username = session?.user?.username ?? session?.user?.name ?? '';

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-space-relaxed py-space-loose">
      <header className="flex flex-wrap items-center justify-between gap-space-snug">
        <div className="flex min-w-0 items-center gap-space-snug">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-card border border-border-warm bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/anp-logo.png" alt="ANP" className="h-full w-full object-contain p-1" />
          </span>
          <div className="min-w-0">
            <h1 className="text-sub-heading font-medium text-charcoal">ANP</h1>
            <p className="mt-0.5 text-body text-muted">
              Automated Note Publishing{username ? ` ・ ${username} さん` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-space-snug">
          {PORTAL_URL && (
            <a
              href={PORTAL_URL}
              className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal no-underline hover:bg-charcoal-04"
            >
              ← M2P ポータル
            </a>
          )}
          <form action={logout}>
            <button
              type="submit"
              className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <div
        className="mt-space-loose rounded-container border px-space-relaxed py-space-relaxed"
        style={{ background: '#eef4f1', borderColor: '#1f4d3f33' }}
      >
        <p className="text-body" style={{ color: '#1f4d3f' }}>
          🚧 ANP はセットアップ中です。note 記事の企画〜執筆〜出版〜販促〜収益化を、
          <strong>テーマ別のマルチアカウント</strong>で自動化します。以下の機能を段階的に実装していきます。
        </p>
      </div>

      <section aria-label="実装予定の機能" className="mt-space-loose grid grid-cols-1 gap-space-relaxed sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <div key={s.title} className="flex flex-col rounded-container border border-border-warm bg-cream-light p-space-relaxed">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-card-title font-medium text-charcoal">{s.title}</h2>
              <span className="shrink-0 rounded-pill border border-border-warm px-2 py-0.5 text-caption text-muted">
                {s.phase}
              </span>
            </div>
            <p className="mt-2 text-body text-muted">{s.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto pt-space-loose text-caption text-muted">
        <p>M2P (Money-Making Platform) · ANP — Automated Note Publishing Tool · 設計: docs/11-anp-design.md</p>
      </footer>
    </div>
  );
}
