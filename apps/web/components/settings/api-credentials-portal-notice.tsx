/**
 * ApiCredentialsPortalNotice — API キー管理は M2P ポータルに集約 (運営者判断 2026-09-21)。
 * A2P 側は状態の読み取り表示だけにし、設定/テスト/削除は `${PORTAL_URL}/settings/api-keys` へ誘導する。
 * 旧フォーム (`api-credentials-list.tsx`) は Server Action ごと残すが画面からは外す。
 */
import { ExternalLink, KeyRound } from 'lucide-react';

import { messages } from '@/lib/messages';
import type { ApiCredentialStatusRow } from '@/lib/settings-view';

const m = messages.settings.sections.apiCredentials;

/** 本番は `NEXT_PUBLIC_PORTAL_URL`、ローカルは portal dev (3002)。未設定ならリンクを出さない。 */
const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3002' : '');

function statusLabel(status: ApiCredentialStatusRow['status']): string {
  if (status === 'db') return m.statusDb;
  if (status === 'env') return m.statusEnv;
  return m.statusUnset;
}

export function ApiCredentialsPortalNotice({ credentials }: { credentials: ApiCredentialStatusRow[] }) {
  return (
    <section
      aria-labelledby="api-credentials-heading"
      className="rounded-card border border-border-warm bg-cream-light p-space-loose"
      data-testid="api-credentials-portal-notice"
    >
      <div className="flex flex-wrap items-start justify-between gap-space-snug">
        <div>
          <h2 id="api-credentials-heading" className="flex items-center gap-2 text-card-title font-medium text-foreground">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {m.title}
          </h2>
          <p className="mt-1 text-body text-muted">{m.portalNotice}</p>
        </div>
        {PORTAL_URL && (
          <a
            href={`${PORTAL_URL}/settings/api-keys`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-default bg-foreground px-4 py-2 text-button-sm font-medium text-white no-underline"
            data-testid="api-credentials-portal-link"
          >
            {m.portalLink}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
      <ul className="mt-space-snug divide-y divide-border-warm rounded-default border border-border-warm bg-white">
        {credentials.map((row) => (
          <li key={row.provider} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-body">
            <span className="text-charcoal">{m.providers[row.provider] ?? row.provider}</span>
            <span className="flex items-center gap-3 text-caption text-muted">
              {row.key_mask && <code className="text-charcoal">{row.key_mask}</code>}
              <span
                className={
                  row.status === 'db'
                    ? 'rounded-pill border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700'
                    : row.status === 'env'
                      ? 'rounded-pill border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-700'
                      : 'rounded-pill border border-border-warm px-2 py-0.5'
                }
              >
                {statusLabel(row.status)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
