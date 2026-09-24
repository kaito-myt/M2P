'use client';

/**
 * EditorialPanel — F-ANP-07/07b: 記事の方針・トンマナ (ニッチ / 想定読者 / トーン / 方針) の編集と AI 生成。
 * 生成は worker `note.account.profile` (targets=['editorial']) が非同期で行い、完了までポーリングする。
 * AI への指示には参考画像 (記事のスクショ等) を貼り付けられる (ImageAttachTextarea)。
 *
 * 2026-09-22 運営者要望「想定読者とトーンが見切れていて読みづらいので横幅いっぱいで OK」「記事の方針も長い文章と
 * なっているけど『主なテーマ』『記事のフォーマット』『文末表現/禁止事項』『CTA』『その他』にテキストボックス自体
 * 分けた方が読みやすい」「品質判定項目も設けましょうか」→ 各項目を 1 行 1 項目・横幅いっぱいに、方針は 6 区分の
 * テキストボックスに分割 (保存時に `composeEditorialPolicy` で 1 本のテキストへ連結、DB/プロンプト注入は従来どおり)。
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import {
  EDITORIAL_SECTION_HEADINGS,
  EDITORIAL_SECTION_KEYS,
  composeEditorialPolicy,
  parseEditorialPolicy,
  type EditorialSectionKey,
  type NoteEditorialSections,
} from '@a2p/contracts/agents/anp';

import { generateAccountProfile, getAccountProfileState, updateAccountEditorial } from '@/app/actions/accounts';
import { GenerationProgress } from '@/components/generation-progress';
import { ImageAttachTextarea, type ImageAttachment } from '@/components/image-attach-textarea';
import type { AccountProfileState } from '@/lib/account-profile-core';
import { messages } from '@/lib/messages';

const POLL_MS = 3000;
const ESTIMATE_SEC = 45;
const POLICY_MAX = 3000;
const em = messages.accounts.editorial;

const SECTION_ROWS: Record<EditorialSectionKey, number> = { themes: 4, format: 6, style_rules: 5, cta: 3, quality: 6, seo: 5, other: 4 };

export function EditorialPanel({ noteAccountId, initial }: { noteAccountId: string; initial: AccountProfileState }) {
  const [state, setState] = useState<AccountProfileState>(initial);
  const [niche, setNiche] = useState(initial.niche);
  const [targetReader, setTargetReader] = useState(initial.target_reader ?? '');
  const [tone, setTone] = useState(initial.tone ?? '');
  const [sections, setSections] = useState<NoteEditorialSections>(() => parseEditorialPolicy(initial.editorial_policy));
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
        setSections(parseEditorialPolicy(res.data.editorial_policy));
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

  const policy = composeEditorialPolicy(sections);

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
  const fieldClass = 'w-full rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal disabled:opacity-60';

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

      {/* 基本項目: 1 行 1 項目・横幅いっぱい */}
      <div className="mt-space-snug flex flex-col gap-space-snug">
        <label className="flex flex-col gap-1 text-caption text-muted">
          {em.niche}
          <input value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={200} disabled={generating} className={fieldClass} data-testid="editorial-niche" />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {em.targetReader}
          <textarea value={targetReader} onChange={(e) => setTargetReader(e.target.value)} maxLength={300} rows={2} disabled={generating} className={fieldClass} data-testid="editorial-target-reader" />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {em.tone}
          <textarea value={tone} onChange={(e) => setTone(e.target.value)} maxLength={200} rows={2} disabled={generating} className={fieldClass} data-testid="editorial-tone" />
        </label>
      </div>

      {/* 記事の方針: 6 区分 */}
      <div className="mt-space-relaxed flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body font-medium text-charcoal">{em.policy}</h3>
        <span className={`text-caption tabular-nums ${policyLen > POLICY_MAX ? 'text-red-600' : 'text-muted'}`}>{em.charCount(policyLen, POLICY_MAX)}</span>
      </div>
      <p className="mt-0.5 text-caption text-muted">{em.sectionsHint}</p>
      <div className="mt-space-snug flex flex-col gap-space-snug">
        {EDITORIAL_SECTION_KEYS.map((key) => (
          <label key={key} className="flex flex-col gap-1 text-caption text-muted">
            <span className="text-charcoal-82">{EDITORIAL_SECTION_HEADINGS[key]}</span>
            <textarea
              value={sections[key]}
              onChange={(e) => setSections((prev) => ({ ...prev, [key]: e.target.value }))}
              rows={SECTION_ROWS[key]}
              maxLength={2000}
              placeholder={em.sectionPlaceholder[key]}
              disabled={generating}
              className={fieldClass}
              data-testid={`editorial-section-${key}`}
            />
          </label>
        ))}
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
