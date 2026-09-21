'use client';

/**
 * ProfilePanel — F-ANP-05: note プロフィール素材 (自己紹介文 / アイコン / カバー画像) の生成・編集・コピー・DL。
 * 生成は worker `note.account.profile` が非同期で行うので、生成中は 3 秒間隔で
 * `getAccountProfileState` をポーリングし、終わったら停止する。
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, Loader2, RefreshCw, Sparkles } from 'lucide-react';

import { generateAccountProfile, getAccountProfileState, updateAccountBio } from '@/app/actions/accounts';
import type { AccountProfileState } from '@/lib/account-profile-core';
import { messages } from '@/lib/messages';

const POLL_MS = 3000;
const NOTE_BIO_MAX = 140;
const pm = messages.accounts.profile;

export function ProfilePanel({ noteAccountId, initial }: { noteAccountId: string; initial: AccountProfileState }) {
  const [state, setState] = useState<AccountProfileState>(initial);
  const [bio, setBio] = useState(initial.bio ?? '');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<'bio' | 'visuals' | 'save' | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getAccountProfileState({ note_account_id: noteAccountId });
    if (!res.ok) return;
    setState((prev) => {
      // 生成完了で bio が更新されたら編集欄にも反映する (手直し中の入力は上書きしない)。
      if (prev.generating && !res.data.generating && res.data.bio && res.data.bio !== prev.bio) setBio(res.data.bio);
      return res.data;
    });
  }, [noteAccountId]);

  useEffect(() => {
    if (!state.generating) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [state.generating, load]);

  const generate = async (targets: Array<'bio' | 'visuals'>) => {
    const kind = targets.includes('bio') ? 'bio' : 'visuals';
    setBusy(kind);
    setError(null);
    setNotice(null);
    const res = await generateAccountProfile({
      note_account_id: noteAccountId,
      targets,
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setState((prev) => ({
      ...prev,
      generating: true,
      job: { id: res.data.job_id, status: 'queued', targets, error: null, bio_alternatives: [], created_at: new Date().toISOString() },
    }));
    void load();
  };

  const saveBio = async () => {
    setBusy('save');
    setError(null);
    setNotice(null);
    const res = await updateAccountBio({ note_account_id: noteAccountId, bio });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setState((prev) => ({ ...prev, bio: bio.trim() || null }));
    setNotice(pm.saved);
  };

  const copyBio = async () => {
    try {
      await navigator.clipboard.writeText(bio);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(pm.errors.copyFailed);
    }
  };

  const generatingTargets = state.generating ? state.job?.targets ?? [] : [];
  const bioGenerating = generatingTargets.includes('bio');
  const visualsGenerating = generatingTargets.includes('visuals');
  const lastFailed = state.job?.status === 'failed';
  const alternatives = !state.generating ? state.job?.bio_alternatives ?? [] : [];
  const bioLen = Array.from(bio).length;

  return (
    <section className="rounded-container border border-border-warm bg-cream-light p-space-relaxed" data-testid="profile-panel">
      <h2 className="text-card-title font-medium text-charcoal">{pm.title}</h2>
      <p className="mt-1 text-caption text-muted">{pm.description}</p>

      {/* --- 自己紹介文 --- */}
      <div className="mt-space-snug">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="profile-bio" className="text-body font-medium text-charcoal">
            {pm.bioLabel}
          </label>
          <span className={`text-caption tabular-nums ${bioLen > NOTE_BIO_MAX ? 'text-red-600' : 'text-muted'}`}>
            {bioLen} / {NOTE_BIO_MAX}
          </span>
        </div>
        <textarea
          id="profile-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder={pm.bioPlaceholder}
          disabled={bioGenerating}
          className="mt-1 w-full rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal disabled:opacity-60"
          data-testid="profile-bio-input"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void generate(['bio'])}
            disabled={busy !== null || state.generating}
            className="flex items-center gap-1.5 rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
            data-testid="profile-generate-bio"
          >
            {bioGenerating || busy === 'bio' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {bioGenerating ? pm.generating : state.bio ? pm.regenerateBio : pm.generateBio}
          </button>
          <button
            type="button"
            onClick={() => void copyBio()}
            disabled={bio.trim().length === 0}
            className="flex items-center gap-1.5 rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50"
            data-testid="profile-copy-bio"
          >
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copied ? pm.copied : pm.copy}
          </button>
          <button
            type="button"
            onClick={() => void saveBio()}
            disabled={busy !== null || bio === (state.bio ?? '')}
            className="rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50"
            data-testid="profile-save-bio"
          >
            {busy === 'save' ? pm.saving : pm.save}
          </button>
        </div>
        {alternatives.length > 0 && (
          <div className="mt-2">
            <p className="text-caption text-muted">{pm.alternativesTitle}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {alternatives.map((alt) => (
                <li key={alt}>
                  <button
                    type="button"
                    onClick={() => setBio(alt)}
                    className="w-full rounded-card border border-border-warm bg-white px-3 py-2 text-left text-caption text-charcoal-82 hover:bg-charcoal-04"
                  >
                    {alt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* --- アイコン / カバー --- */}
      <div className="mt-space-relaxed">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-body font-medium text-charcoal">{pm.visualsLabel}</h3>
          <button
            type="button"
            onClick={() => void generate(['visuals'])}
            disabled={busy !== null || state.generating}
            className="flex items-center gap-1.5 rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
            data-testid="profile-generate-visuals"
          >
            {visualsGenerating || busy === 'visuals' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {visualsGenerating ? pm.generatingVisuals : state.avatar_url ? pm.regenerateVisuals : pm.generateVisuals}
          </button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-space-snug sm:grid-cols-[160px_minmax(0,1fr)]">
          <figure className="flex flex-col gap-1">
            <figcaption className="text-caption text-muted">{pm.avatarLabel}</figcaption>
            <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-card border border-border-warm bg-white">
              {state.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={state.avatar_url} alt={pm.avatarLabel} className="h-full w-full object-cover" />
              ) : (
                <span className="text-caption text-muted">{visualsGenerating ? pm.generatingVisuals : pm.noImage}</span>
              )}
            </div>
            {state.avatar_url && (
              <a href={state.avatar_url} download="avatar.png" className="flex items-center gap-1 text-caption text-charcoal underline">
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {pm.downloadAvatar}
              </a>
            )}
          </figure>
          <figure className="flex min-w-0 flex-col gap-1">
            <figcaption className="text-caption text-muted">{pm.headerLabel}</figcaption>
            <div className="flex aspect-[1280/670] w-full items-center justify-center overflow-hidden rounded-card border border-border-warm bg-white">
              {state.header_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={state.header_url} alt={pm.headerLabel} className="h-full w-full object-cover" />
              ) : (
                <span className="text-caption text-muted">{visualsGenerating ? pm.generatingVisuals : pm.noImage}</span>
              )}
            </div>
            {state.header_url && (
              <a href={state.header_url} download="header.jpg" className="flex items-center gap-1 text-caption text-charcoal underline">
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {pm.downloadHeader}
              </a>
            )}
          </figure>
        </div>
      </div>

      {/* --- 追加指示 --- */}
      <label className="mt-space-relaxed flex flex-col gap-1 text-caption text-muted">
        {pm.instructionLabel}
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={1000}
          placeholder={pm.instructionPlaceholder}
          className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal"
          data-testid="profile-instruction"
        />
      </label>

      {(error || notice || lastFailed) && (
        <div className="mt-2 flex flex-col gap-1">
          {error && <p role="alert" className="text-caption text-red-600" data-testid="profile-error">{error}</p>}
          {notice && <p className="text-caption text-emerald-700">{notice}</p>}
          {lastFailed && !state.generating && (
            <p className="text-caption text-red-600">
              {pm.lastFailed}
              {state.job?.error ? `: ${state.job.error}` : ''}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
