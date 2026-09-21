'use client';

/**
 * EditorialPanel — F-ANP-07: 記事の方針・トンマナ (ニッチ / 想定読者 / トーン / 方針本文) の編集と AI 生成。
 * 生成は worker `note.account.profile` (targets=['editorial']) が非同期で行い、完了までポーリングする。
 * AI への指示には参考画像 (記事のスクショ等) を貼り付けられる (ImageAttachTextarea)。
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { generateAccountProfile, getAccountProfileState, updateAccountEditorial } from '@/app/actions/accounts';
import { GenerationProgress } from '@/components/generation-progress';
import { ImageAttachTextarea, type ImageAttachment } from '@/components/image-attach-textarea';
import type { AccountProfileState } from '@/lib/account-profile-core';
import { messages } from '@/lib/messages';

const POLL_MS = 3000;
const ESTIMATE_SEC = 45;
const POLICY_MAX = 3000;
const em = messages.accounts.editorial;

export function EditorialPanel({ noteAccountId, initial }: { noteAccountId: string; initial: AccountProfileState }) {
  const [state, setState] = useState<AccountProfileState>(initial);
  const [niche, setNiche] = useState(initial.niche);
  const [targetReader, setTargetReader] = useState(initial.target_reader ?? '');
  const [tone, setTone] = useState(initial.tone ?? '');
  const [policy, setPolicy] = useState(initial.editorial_policy ?? '');
  const [instruction, setInstruction] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const generating = state.generating && (state.job?.targets ?? []).includes('editorial');

  const load = useCallback(async () => {
    const res = await getAccountProfileState({ note_account_id: noteAccountId });
    if (!res.ok) return;
    setState((prev) => {
      const wasEditorial = prev.generating && (prev.job?.targets ?? []).includes('editorial');
      if (wasEditorial && !res.data.generating) {
        // 生成完了: フォームへ反映 (運営者は続けて手直しできる)。
        setNiche(res.data.niche);
        setTargetReader(res.data.target_reader ?? '');
        setTone(res.data.tone ?? '');
        setPolicy(res.data.editorial_policy ?? '');
      }
      return res.data;
    });
  }, [noteAccountId]);

  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [generating, load]);

  const generate = async () => {
    setBusy('generate');
    setError(null);
    setNotice(null);
    const res = await generateAccountProfile({
      note_account_id: noteAccountId,
      targets: ['editorial'],
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      ...(images.length > 0 ? { reference_image_keys: images.map((i) => i.key) } : {}),
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setState((prev) => ({
      ...prev,
      generating: true,
      job: { id: res.data.job_id, status: 'queued', targets: ['editorial'], error: null, bio_alternatives: [], progress: null, created_at: new Date().toISOString(), started_at: null },
    }));
    void load();
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    setNotice(null);
    const res = await updateAccountEditorial({ note_account_id: noteAccountId, niche, target_reader: targetReader, tone, editorial_policy: policy });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setState((prev) => ({ ...prev, niche, target_reader: targetReader || null, tone: tone || null, editorial_policy: policy || null }));
    setNotice(em.saved);
  };

  const dirty =
    niche !== state.niche || targetReader !== (state.target_reader ?? '') || tone !== (state.tone ?? '') || policy !== (state.editorial_policy ?? '');
  const policyLen = Array.from(policy).length;
  const progress = generating && state.job ? state.job : null;

  return (
    <section className="rounded-container border border-border-warm bg-cream-light p-space-relaxed" data-testid="editorial-panel">
      <h2 className="text-card-title font-medium text-charcoal">{em.title}</h2>
      <p className="mt-1 text-caption text-muted">{em.description}</p>

      {progress && (
        <GenerationProgress
          className="mt-space-snug rounded-card border border-border-warm bg-white px-3 py-2"
          startedAt={progress.created_at}
          estimateSec={ESTIMATE_SEC}
          pct={progress.progress?.pct ?? null}
          stageLabel={progress.status === 'queued' ? messages.accounts.profile.progress.queued : em.progressStage}
          capPct={progress.status === 'queued' ? 8 : 90}
        />
      )}

      <div className="mt-space-snug grid grid-cols-1 gap-space-snug sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-caption text-muted">
          {em.niche}
          <input value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={200} disabled={generating} className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal" data-testid="editorial-niche" />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {em.targetReader}
          <input value={targetReader} onChange={(e) => setTargetReader(e.target.value)} maxLength={300} disabled={generating} className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal" data-testid="editorial-target-reader" />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {em.tone}
          <input value={tone} onChange={(e) => setTone(e.target.value)} maxLength={200} disabled={generating} className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal" data-testid="editorial-tone" />
        </label>
      </div>
      <div className="mt-space-snug">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="editorial-policy" className="text-caption text-muted">
            {em.policy}
          </label>
          <span className={`text-caption tabular-nums ${policyLen > POLICY_MAX ? 'text-red-600' : 'text-muted'}`}>{em.charCount(policyLen, POLICY_MAX)}</span>
        </div>
        <textarea
          id="editorial-policy"
          value={policy}
          onChange={(e) => setPolicy(e.target.value)}
          rows={10}
          maxLength={4000}
          placeholder={em.policyPlaceholder}
          disabled={generating}
          className="mt-1 w-full rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal disabled:opacity-60"
          data-testid="editorial-policy"
        />
      </div>

      <div className="mt-space-snug flex flex-col gap-1 text-caption text-muted">
        {em.instructionLabel}
        <ImageAttachTextarea value={instruction} onChange={setInstruction} attachments={images} onAttachmentsChange={setImages} rows={2} maxLength={1000} placeholder={em.instructionPlaceholder} disabled={generating} data-testid="editorial-instruction" />
      </div>

      <div className="mt-space-snug flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy !== null || state.generating}
          className="flex items-center gap-1.5 rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
          data-testid="editorial-generate"
        >
          {generating || busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {generating ? em.generating : state.editorial_policy ? em.regenerate : em.generate}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null || !dirty || policyLen > POLICY_MAX || niche.trim().length === 0}
          className="rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50"
          data-testid="editorial-save"
        >
          {busy === 'save' ? em.saving : em.save}
        </button>
        {dirty && !generating && <span className="text-caption text-amber-700">{em.unsaved}</span>}
        {error && (
          <p role="alert" className="text-caption text-red-600" data-testid="editorial-error">
            {error}
          </p>
        )}
        {notice && <p className="text-caption text-emerald-700">{notice}</p>}
      </div>
    </section>
  );
}
