/**
 * note アカウント戦略の AI 相談 (F-ANP-04) — 読み取り側の共通ロジック。
 * server component (`/accounts/design/consult/[id]`) とポーリング用 Server Action
 * (`getConsultationState`) の両方から使う。'use server' ファイルに置くと認証無しの公開
 * エンドポイントになってしまうため、ここ (通常モジュール) に分離する。
 */
import { prisma } from '@a2p/db';
import {
  NoteAccountConsultBriefDraftSchema,
  type NoteAccountConsultBriefDraft,
} from '@a2p/contracts/agents/anp';

export interface ConsultMessageView {
  id: string;
  role: 'operator' | 'advisor';
  content: string;
  status: string;
  error: string | null;
  research: Array<{ query: string; title: string; url: string; snippet?: string }>;
  suggested_questions: string[];
  created_at: string;
}

export interface ConsultationStateView {
  id: string;
  title: string;
  status: string;
  brief_draft: NoteAccountConsultBriefDraft;
  ready_to_design: boolean;
  awaiting_reply: boolean;
  messages: ConsultMessageView[];
  designs: Array<{ id: string; status: string; created_at: string }>;
}

function toMessageView(row: {
  id: string;
  role: string;
  content: string;
  status: string;
  error: string | null;
  research_json: unknown;
  created_at: Date;
}): ConsultMessageView {
  const rj = (row.research_json ?? {}) as { research?: unknown; suggested_questions?: unknown };
  const research = Array.isArray(rj.research)
    ? (rj.research as Array<Record<string, unknown>>)
        .filter((r) => typeof r.url === 'string' && typeof r.title === 'string')
        .map((r) => ({
          query: String(r.query ?? ''),
          title: String(r.title),
          url: String(r.url),
          ...(typeof r.snippet === 'string' ? { snippet: r.snippet } : {}),
        }))
    : [];
  const suggested = Array.isArray(rj.suggested_questions)
    ? (rj.suggested_questions as unknown[]).filter((q): q is string => typeof q === 'string')
    : [];
  return {
    id: row.id,
    role: row.role === 'advisor' ? 'advisor' : 'operator',
    content: row.content,
    status: row.status,
    error: row.error,
    research,
    suggested_questions: suggested,
    created_at: row.created_at.toISOString(),
  };
}

/** 相談のスナップショット。存在しなければ null。 */
export async function loadConsultationState(consultationId: string): Promise<ConsultationStateView | null> {
  const row = await prisma.noteAccountConsultation.findUnique({
    where: { id: consultationId },
    select: {
      id: true,
      title: true,
      status: true,
      brief_draft_json: true,
      ready_to_design: true,
      messages: {
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          status: true,
          error: true,
          research_json: true,
          created_at: true,
        },
      },
      designs: {
        orderBy: { created_at: 'desc' },
        select: { id: true, status: true, created_at: true },
        take: 10,
      },
    },
  });
  if (!row) return null;
  const draft = NoteAccountConsultBriefDraftSchema.safeParse(row.brief_draft_json ?? {});
  const msgs = row.messages.map(toMessageView);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    brief_draft: draft.success ? draft.data : {},
    ready_to_design: row.ready_to_design,
    awaiting_reply: msgs.some((x) => x.role === 'operator' && (x.status === 'pending' || x.status === 'processing')),
    messages: msgs,
    designs: row.designs.map((d) => ({ id: d.id, status: d.status, created_at: d.created_at.toISOString() })),
  };
}
