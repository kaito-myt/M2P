'use client';

/**
 * CeoChat — 運営者 ⇔ CEO の対話パネル（経営ダッシュボード /org）。
 *
 * 送信は sendCeoMessage SA（operator メッセージ保存 + org.ceo.chat を enqueue）。
 * CEO 応答は worker が非同期生成するため、/api/org/ceo/messages をポーリングして反映する。
 * 応答待ちの間だけ 2.5 秒間隔でポーリングし、届いたら停止する。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';

import { sendCeoMessage } from '@/app/actions/org';

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  status: string;
  created_at: string;
}

const POLL_MS = 2500;

export function CeoChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/org/ceo/messages', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: ChatMessage[]; awaiting_reply: boolean };
      setMessages(data.messages);
      setAwaiting(data.awaiting_reply);
    } catch {
      // ignore transient fetch errors
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 応答待ちの間だけポーリング。
  useEffect(() => {
    if (!awaiting) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [awaiting, load]);

  // 新着で最下部へスクロール。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    // 楽観表示。
    const optimistic: ChatMessage = {
      id: `tmp-${text.length}-${text.slice(0, 8)}`,
      role: 'operator',
      content: text,
      status: 'pending',
      created_at: new Date(0).toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    const res = await sendCeoMessage({ message: text });
    setSending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setAwaiting(true);
    void load();
  }, [input, sending, load]);

  return (
    <section
      aria-labelledby="ceo-chat-heading"
      className="flex flex-col gap-space-snug rounded-card border border-border-warm bg-cream-light p-space-loose"
      data-testid="ceo-chat"
    >
      <div>
        <h2 id="ceo-chat-heading" className="text-card-title font-medium text-foreground">
          CEO と会話
        </h2>
        <p className="text-body text-muted">
          社長(CEO)に直接指示・相談できます。CEO は各本部に施策(ToDo)を割り当てて実行に移します。
        </p>
      </div>

      <div
        ref={scrollRef}
        className="flex max-h-96 min-h-40 flex-col gap-space-snug overflow-y-auto rounded-default border border-border-warm bg-white p-space-snug"
        data-testid="ceo-chat-log"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-button-sm text-muted">
            まだ会話はありません。例:「競馬ジャンルに絞って新刊を2冊企画して」「今月は販促を強化して」
          </p>
        ) : (
          messages.map((msg) => {
            const isOperator = msg.role === 'operator';
            return (
              <div
                key={msg.id}
                className={`flex ${isOperator ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-card px-3 py-2 text-body ${
                    isOperator
                      ? 'bg-foreground text-white'
                      : 'border border-border-warm bg-cream-light text-charcoal'
                  }`}
                >
                  {!isOperator && <span className="mb-0.5 block text-caption font-medium text-muted">CEO</span>}
                  {msg.content}
                </div>
              </div>
            );
          })
        )}
        {awaiting && (
          <div className="flex items-center gap-2 text-button-sm text-muted" data-testid="ceo-chat-awaiting">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            CEO が考えています…
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-button-sm text-destructive" data-testid="ceo-chat-error">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          placeholder="CEO への指示・相談を入力（⌘/Ctrl+Enter で送信）"
          className="min-h-[44px] flex-1 resize-y rounded-default border border-border-warm bg-white px-3 py-2 text-body focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          data-testid="ceo-chat-input"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || input.trim().length === 0}
          data-testid="ceo-chat-send"
          className="flex h-11 items-center gap-1.5 rounded-default bg-foreground px-4 text-button-sm font-medium text-white disabled:opacity-50"
        >
          {sending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Send aria-hidden="true" className="h-4 w-4" />}
          送信
        </button>
      </div>
    </section>
  );
}
