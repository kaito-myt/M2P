'use client';

/**
 * ConsultWorkspace — 相談チャット (左) + ブリーフ草案パネル (右) を 1 つの状態で結ぶ。
 * A2P の CeoChat (`apps/web/components/org/ceo-chat.tsx`) と同じ非同期方式:
 * 送信は Server Action、AI 返答は worker が生成するので、返答待ちの間だけ 2.5 秒間隔で
 * `getConsultationState` をポーリングし、届いたら停止する。
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';

import {
  archiveConsultation,
  createDesignFromConsultation,
  getConsultationState,
  retryConsultMessage,
  sendConsultMessage,
} from '@/app/actions/account-consult';
import type { ConsultationStateView, ConsultMessageView } from '@/lib/account-consult-core';
import { messages } from '@/lib/messages';

const POLL_MS = 2500;
const cm = messages.accountConsult;

export function ConsultWorkspace({ initial }: { initial: ConsultationStateView }) {
  const router = useRouter();
  const [state, setState] = useState<ConsultationStateView>(initial);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const res = await getConsultationState({ consultation_id: initial.id });
    if (res.ok) setState(res.data);
  }, [initial.id]);

  // 返答待ちの間だけポーリング。
  useEffect(() => {
    if (!state.awaiting_reply) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [state.awaiting_reply, load]);

  // 新着で最下部へスクロール。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.messages.length, state.awaiting_reply]);

  const archived = state.status !== 'active';

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || state.awaiting_reply || archived) return;
    setSending(true);
    setError(null);
    const res = await sendConsultMessage({ consultation_id: state.id, message: text });
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setInput('');
    // 楽観表示: 返答待ちに入れてすぐポーリング開始。
    setState((prev) => ({
      ...prev,
      awaiting_reply: true,
      messages: [
        ...prev.messages,
        {
          id: res.data.message_id,
          role: 'operator',
          content: text,
          status: 'pending',
          error: null,
          research: [],
          suggested_questions: [],
          created_at: new Date().toISOString(),
        },
      ],
    }));
    void load();
  }, [input, sending, state.awaiting_reply, state.id, archived, load]);

  const handleRetry = useCallback(
    async (messageId: string) => {
      setError(null);
      const res = await retryConsultMessage({ consultation_id: state.id, message_id: messageId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setState((prev) => ({ ...prev, awaiting_reply: true }));
      void load();
    },
    [state.id, load],
  );

  const handleCreateDesign = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    const res = await createDesignFromConsultation({ consultation_id: state.id });
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/accounts/design/${res.data.design_id}`);
  }, [creating, state.id, router]);

  const handleArchive = useCallback(async () => {
    setError(null);
    const res = await archiveConsultation({ consultation_id: state.id });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push('/accounts/design/consult');
  }, [state.id, router]);

  const lastAdvisor = [...state.messages].reverse().find((m) => m.role === 'advisor');
  const suggested = !state.awaiting_reply && lastAdvisor ? lastAdvisor.suggested_questions : [];

  return (
    <div className="mt-space-relaxed grid grid-cols-1 gap-space-relaxed lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
      {/* --- チャット --- */}
      <section
        aria-labelledby="consult-chat-heading"
        className="flex min-w-0 flex-col gap-space-snug rounded-container border border-border-warm bg-cream-light p-space-relaxed"
        data-testid="consult-chat"
      >
        <h2 id="consult-chat-heading" className="text-card-title font-medium text-charcoal">
          {cm.chat.title}
        </h2>

        <div
          ref={scrollRef}
          className="flex max-h-[60vh] min-h-64 flex-col gap-space-snug overflow-y-auto rounded-card border border-border-warm bg-white p-space-snug"
          data-testid="consult-chat-log"
        >
          {state.messages.map((msg) => (
            <ChatBubble key={msg.id} msg={msg} onRetry={handleRetry} />
          ))}
          {state.awaiting_reply && (
            <div className="flex items-center gap-2 text-button-sm text-muted" data-testid="consult-chat-awaiting">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              {cm.chat.awaiting}
            </div>
          )}
        </div>

        {suggested.length > 0 && (
          <div>
            <p className="text-caption text-muted">{cm.chat.suggestedTitle}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {suggested.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="rounded-pill border border-border-warm bg-white px-3 py-1 text-caption text-charcoal-82 hover:bg-charcoal-04"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-button-sm text-red-600" data-testid="consult-chat-error">
            {error}
          </p>
        )}

        {archived ? (
          <p className="text-body text-muted">{cm.chat.archivedNotice}</p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder={cm.chat.placeholder}
              className="min-h-[44px] flex-1 resize-y rounded-card border border-border-warm bg-white px-3 py-2 text-body focus:outline-none focus-visible:ring-2 focus-visible:ring-charcoal"
              data-testid="consult-chat-input"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || state.awaiting_reply || input.trim().length === 0}
              className="flex h-11 items-center gap-1.5 rounded-card bg-charcoal px-4 text-button-sm font-medium text-white disabled:opacity-50"
              data-testid="consult-chat-send"
            >
              {sending ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Send aria-hidden="true" className="h-4 w-4" />
              )}
              {sending ? cm.chat.sending : cm.chat.send}
            </button>
          </div>
        )}
      </section>

      {/* --- ブリーフ草案 --- */}
      <aside className="flex min-w-0 flex-col gap-space-snug" data-testid="consult-draft">
        <section className="rounded-container border border-border-warm bg-cream-light p-space-relaxed">
          <h2 className="text-card-title font-medium text-charcoal">{cm.draft.title}</h2>
          <p className="mt-1 text-caption text-muted">{cm.draft.description}</p>
          <BriefDraftView draft={state.brief_draft} />
          <p className={`mt-space-snug text-caption ${state.ready_to_design ? 'text-emerald-700' : 'text-muted'}`}>
            {state.ready_to_design ? cm.draft.readyNotice : cm.draft.notReadyNotice}
          </p>
          <button
            type="button"
            onClick={() => void handleCreateDesign()}
            disabled={creating || !state.brief_draft.idea || state.awaiting_reply}
            className="mt-space-snug w-full rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
            data-testid="consult-create-design"
          >
            {creating ? cm.draft.creatingDesign : cm.draft.createDesign}
          </button>
        </section>

        {state.designs.length > 0 && (
          <section className="rounded-container border border-border-warm bg-cream-light p-space-relaxed">
            <h3 className="text-body font-medium text-charcoal">{cm.draft.designsTitle}</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {state.designs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-caption">
                  <span className="text-muted">
                    {new Date(d.created_at).toLocaleString('ja-JP')} ・{' '}
                    {messages.accountDesign.statusLabel[d.status as keyof typeof messages.accountDesign.statusLabel] ??
                      d.status}
                  </span>
                  <a href={`/accounts/design/${d.id}`} className="shrink-0 text-charcoal underline">
                    {cm.draft.viewDesign}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!archived && (
          <button
            type="button"
            onClick={() => void handleArchive()}
            className="self-start text-caption text-muted underline"
          >
            {cm.draft.archive}
          </button>
        )}
      </aside>
    </div>
  );
}

function ChatBubble({
  msg,
  onRetry,
}: {
  msg: ConsultMessageView;
  onRetry: (messageId: string) => Promise<void>;
}) {
  const [showResearch, setShowResearch] = useState(false);
  const isOperator = msg.role === 'operator';
  return (
    <div className={`flex ${isOperator ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap break-words rounded-card px-3 py-2 text-body ${
          isOperator ? 'bg-charcoal text-white' : 'border border-border-warm bg-cream-light text-charcoal'
        }`}
      >
        <span className={`mb-0.5 block text-caption font-medium ${isOperator ? 'text-white/70' : 'text-muted'}`}>
          {isOperator ? cm.chat.operatorLabel : cm.chat.advisorLabel}
        </span>
        {msg.content}
        {isOperator && msg.status === 'failed' && (
          <div className="mt-1 text-caption text-red-200">
            {cm.chat.failed}
            {msg.error && <span className="block opacity-80">{msg.error}</span>}
            <button type="button" onClick={() => void onRetry(msg.id)} className="mt-1 underline">
              {cm.chat.retry}
            </button>
          </div>
        )}
        {!isOperator && msg.research.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowResearch((v) => !v)}
              className="text-caption text-muted underline"
            >
              {cm.chat.researchToggle(msg.research.length)}
            </button>
            {showResearch && (
              <ul className="mt-1 flex flex-col gap-1">
                {msg.research.map((r) => (
                  <li key={r.url} className="text-caption text-muted">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-charcoal underline">
                      {r.title}
                    </a>
                    {r.snippet && <span className="block opacity-80">{r.snippet}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BriefDraftView({ draft }: { draft: ConsultationStateView['brief_draft'] }) {
  const f = cm.draft.fields;
  const rows: Array<{ key: keyof typeof f; value: string | undefined }> = [
    { key: 'idea', value: draft.idea },
    { key: 'goal', value: draft.goal },
    { key: 'target_reader_hint', value: draft.target_reader_hint },
    { key: 'monetization_hint', value: draft.monetization_hint },
    { key: 'constraints', value: draft.constraints },
    {
      key: 'persona_type',
      value: draft.persona_type ? cm.draft.personaLabels[draft.persona_type] : undefined,
    },
    {
      key: 'reference_accounts',
      value:
        draft.reference_accounts && draft.reference_accounts.length > 0
          ? draft.reference_accounts.join('\n')
          : undefined,
    },
  ];
  const filled = rows.filter((r) => r.value && r.value.trim().length > 0);
  if (filled.length === 0) {
    return <p className="mt-space-snug text-body text-muted">{cm.draft.empty}</p>;
  }
  return (
    <dl className="mt-space-snug flex flex-col gap-2">
      {filled.map((r) => (
        <div key={r.key}>
          <dt className="text-caption text-muted">{f[r.key]}</dt>
          <dd className="whitespace-pre-wrap break-words rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal">
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
