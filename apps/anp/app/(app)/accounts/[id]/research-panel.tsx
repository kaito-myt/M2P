'use client';

/**
 * ResearchPanel — F-ANP-56: アカウント別 週次リサーチの結果表示と手動実行。
 *
 * 運営者が見たいのは「AI が何を観点にして、何を見つけ、来週の作り方をどう変えるのか」。
 * 観点 (angles) を隠さず出すのは、ニッチ違いのアカウントで観点がズレていたときに
 * 運営者が気づけるようにするため (観点を AI に決めさせる設計の安全弁)。
 *
 * `editorial_policy` の改訂提案は**自動反映しない**。運営者が設定した方針を AI が
 * 書き換えると、意図しない変更に気づけないため、提案として見せるだけにする。
 */
import { useState, useTransition } from 'react';
import { Loader2, Search } from 'lucide-react';

import type { NoteAccountResearch } from '@a2p/contracts/agents/anp';

import { runAccountResearch } from '@/app/actions/accounts';
import { messages } from '@/lib/messages';

const m = messages.accounts.research;

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-caption font-medium text-charcoal">{title}</h3>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((it, i) => (
          <li key={i} className="text-caption text-muted">
            ・{it}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResearchPanel({
  noteAccountId,
  research,
  updatedAt,
}: {
  noteAccountId: string;
  research: NoteAccountResearch | null;
  updatedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setNotice(null);
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const res = await runAccountResearch({ note_account_id: noteAccountId });
      setBusy(false);
      if (res.ok) setNotice(m.runStarted);
      else setError(res.error);
    });
  };

  return (
    <section className="mt-space-loose rounded-container border border-border-warm bg-white p-space-relaxed">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-card-title font-medium text-charcoal">{m.title}</h2>
          <p className="mt-1 text-caption text-muted">{m.description}</p>
          {updatedAt && <p className="mt-1 text-caption text-muted">{m.updatedAt(updatedAt)}</p>}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending || busy}
          data-testid="account-run-research"
          className="inline-flex items-center gap-1.5 rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04 disabled:opacity-50"
        >
          {pending || busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Search className="h-3.5 w-3.5" aria-hidden />
          )}
          {pending || busy ? m.runningButton : m.runButton}
        </button>
      </div>

      {notice && <p className="mt-2 text-caption text-charcoal">{notice}</p>}
      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}

      {!research ? (
        <p className="mt-space-snug text-caption text-muted">{m.empty}</p>
      ) : (
        <div className="mt-space-snug flex flex-col gap-space-snug">
          {research.summary && <p className="text-body text-charcoal">{research.summary}</p>}

          {research.angles.length > 0 && (
            <div>
              <h3 className="text-caption font-medium text-charcoal">{m.anglesTitle}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {research.angles.map((a, i) => (
                  <li key={i} className="text-caption text-muted">
                    ・{a.angle}
                    {a.why ? ` — ${a.why}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {research.findings.length > 0 && (
            <div>
              <h3 className="text-caption font-medium text-charcoal">{m.findingsTitle}</h3>
              <ul className="mt-1 flex flex-col gap-1.5">
                {research.findings.map((f, i) => (
                  <li key={i} className="text-caption text-muted">
                    ・{f.finding}
                    {f.implication ? <span className="text-charcoal"> → {f.implication}</span> : null}
                    {f.sources.length > 0 && (
                      <span className="ml-1">
                        {f.sources.slice(0, 3).map((u, j) => (
                          <a
                            key={j}
                            href={u}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 text-muted underline"
                          >
                            出典{j + 1}
                          </a>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <List title={m.patternsTitle} items={research.winning_patterns} />

          {research.art_direction && (
            <div>
              <h3 className="text-caption font-medium text-charcoal">{m.artDirectionTitle}</h3>
              <p className="mt-1 whitespace-pre-wrap text-caption text-muted">
                {research.art_direction}
              </p>
              {/*
                F-ANP-57: この画作りが**実物のサムネを見て決まったのか**を必ず出す。
                見ていない回はジャンル既定を上書きしないので、運営者に挙動の違いが伝わる
                ようにしておく (以前は推測でも「上書きします」と書いてあった)。
              */}
              <p className="mt-0.5 text-caption text-muted">
                {research.art_direction_evidence.length > 0
                  ? m.artDirectionGrounded(research.art_direction_evidence.length)
                  : m.artDirectionUngrounded}
              </p>
              {research.art_direction_evidence.length > 0 && (
                <p className="mt-0.5 text-caption text-muted">
                  {research.art_direction_evidence.slice(0, 6).map((u, i) => (
                    <a
                      key={i}
                      href={u}
                      target="_blank"
                      rel="noreferrer"
                      className="mr-2 text-muted underline"
                    >
                      サムネ{i + 1}
                    </a>
                  ))}
                </p>
              )}
            </div>
          )}

          {/* F-ANP-57: 実物を見て読み取った「共通の作法」と「自分たちに足りない点」。 */}
          {research.rival_eyecatches && research.rival_eyecatches.shots.length > 0 && (
            <div className="rounded-card border border-border-warm bg-cream-light p-3">
              <h3 className="text-caption font-medium text-charcoal">
                {m.rivalEyecatchTitle(research.rival_eyecatches.shots.length)}
              </h3>
              {research.rival_eyecatches.common_patterns.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1">
                  {research.rival_eyecatches.common_patterns.map((pt, i) => (
                    <li key={i} className="text-caption text-muted">
                      ・{pt}
                    </li>
                  ))}
                </ul>
              )}
              {research.rival_eyecatches.our_gap && (
                <p className="mt-1 text-caption text-charcoal">
                  {m.rivalEyecatchGap}: {research.rival_eyecatches.our_gap}
                </p>
              )}
            </div>
          )}

          {/* F-ANP-57b: 使ってよいと判定された画風。ここが空なら全候補からくじ引き。 */}
          <List title={m.preferredStylesTitle} items={research.preferred_style_keys} />
          <List title={m.copyRulesTitle} items={research.copy_rules} />
          <List title={m.pursueTitle} items={research.topics_to_pursue} />
          <List title={m.avoidTitle} items={research.topics_to_avoid} />

          {research.editorial_policy_suggestion && (
            <div className="rounded-card border border-border-warm bg-cream-light p-3">
              <h3 className="text-caption font-medium text-charcoal">{m.policySuggestionTitle}</h3>
              <p className="mt-1 whitespace-pre-wrap text-caption text-muted">
                {research.editorial_policy_suggestion}
              </p>
              <p className="mt-1 text-caption text-muted">{m.policySuggestionNote}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
