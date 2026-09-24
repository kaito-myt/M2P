/**
 * CEO が起票したソースコード変更要求の一覧 (F-098)。
 *
 * worker は本番コンテナで動いておりリポジトリを書き換えられないため、CEO は
 * 「何をどう変えたいか」を要求として残す。ここはその受け皿で、実装は運営者または
 * 開発エージェントが行う。対話で完結させるための可視化。
 */
import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';

const m = messages.orgCodeRequests;

const URGENCY_LABEL: Record<string, string> = {
  high: m.urgency.high,
  normal: m.urgency.normal,
  low: m.urgency.low,
};

export async function OrgCodeRequests() {
  const rows = await prisma.orgCodeRequest.findMany({
    where: { status: { in: ['open', 'in_progress'] } },
    orderBy: [{ created_at: 'desc' }],
    take: 10,
    select: {
      id: true,
      title: true,
      intent: true,
      change_summary: true,
      files_json: true,
      urgency: true,
      status: true,
      created_at: true,
    },
  });

  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-space-snug" data-testid="org-code-requests">
      <div className="flex items-baseline gap-space-snug">
        <h2 className="text-section-title text-foreground">{m.title}</h2>
        <span className="text-caption text-muted">{m.description}</span>
      </div>
      <ul className="flex flex-col divide-y divide-border-warm border-y border-border-warm">
        {rows.map((r) => {
          const files = Array.isArray(r.files_json) ? (r.files_json as unknown[]).map(String) : [];
          return (
            <li key={r.id} className="flex flex-col gap-1 py-2" data-testid={`code-request-${r.id}`}>
              <div className="flex items-center gap-space-snug">
                <span className="shrink-0 rounded-full border border-border-warm bg-cream px-2 py-0.5 text-button-sm text-charcoal">
                  {URGENCY_LABEL[r.urgency] ?? r.urgency}
                </span>
                <span className="min-w-0 flex-1 truncate text-body-sm text-foreground">{r.title}</span>
                <span className="shrink-0 text-caption text-muted">
                  {r.created_at.toISOString().slice(0, 10)}
                </span>
              </div>
              <p className="text-caption text-charcoal-82">{r.change_summary}</p>
              {files.length > 0 ? (
                <p className="truncate text-caption text-muted" title={files.join(' ')}>
                  {files.join(' / ')}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
