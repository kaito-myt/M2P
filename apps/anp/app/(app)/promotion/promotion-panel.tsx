'use client';

/**
 * PromotionPanel — 1 アカウント × 1 媒体の販促施策 (F-ANP-32)。
 *   - ON/OFF トグル (既定/個別)、施策本文、ハッシュタグ、週あたり投稿数、CTA の編集と保存
 *   - 「AI で生成」(note.account.profile targets=['promotion']) と進捗ポーリング。指示欄は画像添付可
 *   - この媒体でのこのアカウントの告知投稿一覧 (promotion_posts) と集計
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { generateAccountPromotionPolicy, getAccountPromotionState, updateAccountPromotionPolicy } from '@/app/actions/promotion';
import { GenerationProgress } from '@/components/generation-progress';
import { ImageAttachTextarea, type ImageAttachment } from '@/components/image-attach-textarea';
import { Switch } from '@/components/switch';
import { messages } from '@/lib/messages';
import type { LinkedPromotionAccountView } from '@/lib/promotion-accounts-core';
import { formatHashtags, type AccountPromotionState, type PromotionChannelSummary, type PromotionPostView } from '@/lib/promotion-view';
import type { ZernioAccountView } from '@/lib/zernio';

import { LinkedAccountCard } from './linked-account-card';
import { PostPreview } from './post-preview';
import { formatJstShort } from '@/lib/datetime';

const POLL_MS = 3000;
const ESTIMATE_SEC = 45;
const m = messages.promotion;

function fmt(iso: string | null): string {
  return iso ? formatJstShort(iso) : '—';
}

export function PromotionPanel({
  noteAccountId,
  initial,
  posts,
  summary,
  linked,
  zernio,
  flash,
  author,
}: {
  noteAccountId: string;
  initial: AccountPromotionState;
  posts: PromotionPostView[];
  summary: PromotionChannelSummary;
  /** F-ANP-33: この媒体の投稿先アカウント連携。 */
  linked: LinkedPromotionAccountView;
  zernio: { configured: boolean; accounts: ZernioAccountView[] } | null;
  flash?: { tone: 'ok' | 'err'; text: string } | null;
  /** F-ANP-32b: 投稿プレビューの「誰として出るか」(連携済みなら SNS 側のハンドル)。 */
  author: { name: string; handle: string | null; avatar_url: string | null };
}) {
  const channel = initial.channel;
  const [state, setState] = useState<AccountPromotionState>(initial);
  const [enabled, setEnabled] = useState<boolean | null>(initial.explicit_enabled ? initial.effective_enabled : null);
  const [policy, setPolicy] = useState(initial.policy?.policy ?? '');
  const [hashtags, setHashtags] = useState(formatHashtags(initial.policy?.hashtags ?? []));
  const [postsPerWeek, setPostsPerWeek] = useState(initial.policy?.posts_per_week != null ? String(initial.policy.posts_per_week) : '');
  const [cta, setCta] = useState(initial.policy?.cta ?? '');
  const [instruction, setInstruction] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [busy, setBusy] = useState<'save' | 'generate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const effectiveEnabled = enabled ?? state.effective_enabled;

  const load = useCallback(async () => {
    const res = await getAccountPromotionState({ note_account_id: noteAccountId, channel });
    if (!res.ok) return;
    setState((prev) => {
      if (prev.generating && !res.data.generating && res.data.policy) {
        // 生成完了: フォームへ反映 (続けて手直しできる)。
        setPolicy(res.data.policy.policy ?? '');
        setHashtags(formatHashtags(res.data.policy.hashtags));
        setPostsPerWeek(res.data.policy.posts_per_week != null ? String(res.data.policy.posts_per_week) : '');
        setCta(res.data.policy.cta ?? '');
      }
      return res.data;
    });
  }, [noteAccountId, channel]);

  useEffect(() => {
    if (!state.generating) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [state.generating, load]);

  const save = async (overrides: Partial<{ enabled: boolean | null }> = {}) => {
    setBusy('save');
    setError(null);
    setNotice(null);
    const res = await updateAccountPromotionPolicy({
      note_account_id: noteAccountId,
      channel,
      enabled: overrides.enabled !== undefined ? overrides.enabled : enabled,
      policy,
      hashtags_text: hashtags,
      posts_per_week: postsPerWeek,
      cta,
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(m.saved);
    void load();
  };

  const generate = async () => {
    setBusy('generate');
    setError(null);
    setNotice(null);
    const res = await generateAccountPromotionPolicy({
      note_account_id: noteAccountId,
      channel,
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
      job: { id: res.data.job_id, status: 'queued', channel, error: null, progress: null, created_at: new Date().toISOString() },
    }));
  };

  const dirty =
    policy !== (state.policy?.policy ?? '') ||
    hashtags !== formatHashtags(state.policy?.hashtags ?? []) ||
    postsPerWeek !== (state.policy?.posts_per_week != null ? String(state.policy.posts_per_week) : '') ||
    cta !== (state.policy?.cta ?? '');
  const generating = state.generating;
  const job = generating ? state.job : null;

  return (
    <div className="mt-space-relaxed flex flex-col gap-space-relaxed">
      {/* 上段: 施策 (広め) ＋ 投稿先アカウント連携 */}
      <div className="grid grid-cols-1 gap-space-relaxed lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {/* 施策 */}
      <section className="rounded-container border border-border-warm bg-cream-light p-space-relaxed" data-testid="promotion-policy-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-card-title font-medium text-charcoal">{m.policyTitle(m.channelLabel[channel])}</h2>
            <p className="mt-1 text-caption text-muted">{m.channelHint[channel]}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Switch checked={effectiveEnabled} disabled={busy !== null || generating} label={m.enabled} onChange={(next) => { setEnabled(next); void save({ enabled: next }); }} testId="promotion-enabled" />
            <span className="text-caption text-muted">
              {effectiveEnabled ? m.enabledOn : m.enabledOff}
              {enabled === null && ` (${m.enabledDefault})`}
              {enabled !== null && (
                <>
                  {' '}
                  <button type="button" onClick={() => { setEnabled(null); void save({ enabled: null }); }} disabled={busy !== null} className="text-charcoal underline disabled:opacity-50">
                    {m.resetDefault}
                  </button>
                </>
              )}
            </span>
          </div>
        </div>
        {channel === 'tiktok' && !state.tiktok_enabled && enabled === null && <p className="mt-2 text-caption text-amber-700">{m.tiktokNeedsSetting}</p>}
        {channel === 'blog' && <p className="mt-2 text-caption text-muted">{m.blogNotice}</p>}

        {job && (
          <GenerationProgress
            className="mt-space-snug rounded-card border border-border-warm bg-white px-3 py-2"
            startedAt={job.created_at}
            estimateSec={ESTIMATE_SEC}
            pct={job.progress?.pct ?? null}
            stageLabel={job.status === 'queued' ? messages.accounts.profile.progress.queued : m.generatingStage}
            capPct={job.status === 'queued' ? 8 : 90}
          />
        )}
        {state.job && state.job.status === 'failed' && state.job.channel === channel && (
          <p role="alert" className="mt-2 text-caption text-red-600">
            {m.lastGenerationFailed}
            {state.job.error ? `: ${state.job.error}` : ''}
          </p>
        )}

        <label className="mt-space-snug flex flex-col gap-1 text-caption text-muted">
          {m.policy}
          <textarea
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            rows={12}
            maxLength={3000}
            placeholder={m.policyPlaceholder}
            disabled={generating}
            className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal disabled:opacity-60"
            data-testid="promotion-policy"
          />
        </label>
        <div className="mt-space-snug grid grid-cols-1 gap-space-snug sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <label className="flex flex-col gap-1 text-caption text-muted">
            {m.hashtags}
            <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} maxLength={2000} placeholder={m.hashtagsPlaceholder} disabled={generating} className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal disabled:opacity-60" data-testid="promotion-hashtags" />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            {m.postsPerWeek}
            <input type="number" min={0} max={70} value={postsPerWeek} onChange={(e) => setPostsPerWeek(e.target.value)} disabled={generating} className="rounded-card border border-border-warm bg-white px-3 py-2 text-right text-body text-charcoal disabled:opacity-60" data-testid="promotion-posts-per-week" />
          </label>
        </div>
        <label className="mt-space-snug flex flex-col gap-1 text-caption text-muted">
          {m.cta}
          <input value={cta} onChange={(e) => setCta(e.target.value)} maxLength={300} placeholder={m.ctaPlaceholder} disabled={generating} className="rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal disabled:opacity-60" data-testid="promotion-cta" />
        </label>
        {state.policy?.rationale && (
          <details className="mt-space-snug text-caption text-muted">
            <summary className="cursor-pointer">{m.rationale}</summary>
            <p className="mt-1 whitespace-pre-wrap">{state.policy.rationale}</p>
          </details>
        )}

        <div className="mt-space-snug flex flex-col gap-1 text-caption text-muted">
          {m.instructionLabel}
          <ImageAttachTextarea value={instruction} onChange={setInstruction} attachments={images} onAttachmentsChange={setImages} rows={2} maxLength={1000} placeholder={m.instructionPlaceholder} disabled={generating} data-testid="promotion-instruction" />
        </div>

        <div className="mt-space-snug flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void generate()} disabled={busy !== null || generating} className="flex items-center gap-1.5 rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50" data-testid="promotion-generate">
            {generating || busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {generating ? m.generating : state.policy?.policy ? m.regenerate : m.generate}
          </button>
          <button type="button" onClick={() => void save()} disabled={busy !== null || generating || !dirty} className="rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50" data-testid="promotion-save">
            {busy === 'save' ? m.saving : m.save}
          </button>
          {dirty && !generating && <span className="text-caption text-amber-700">{m.unsaved}</span>}
          {state.policy?.updated_at && !dirty && <span className="text-caption text-muted">{m.updatedAt(fmt(state.policy.updated_at))}</span>}
          {error && (
            <p role="alert" className="text-caption text-red-600" data-testid="promotion-error">
              {error}
            </p>
          )}
          {notice && <p className="text-caption text-emerald-700">{notice}</p>}
        </div>
      </section>

      {/* 投稿先アカウント連携 (F-ANP-33) */}
      <LinkedAccountCard noteAccountId={noteAccountId} channel={channel} initial={linked} zernio={zernio} flash={flash ?? null} />
      </div>

      {/*
        投稿一覧 — 運営者要望 (2026-10-15)「投稿一覧は下に横幅いっぱいに表示させて。
        あと、Xっぽい見た目にしないとプレビューにならないからよろしく」。
        右カラムの狭い抜粋リストから、フル幅 × 実物の見た目のカードに変えた。
      */}
      <section className="w-full rounded-container border border-border-warm bg-cream-light p-space-relaxed" data-testid="promotion-posts-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-space-snug">
          <h2 className="text-card-title font-medium text-charcoal">{m.postsTitle}</h2>
          <p className="text-caption text-muted">{m.preview.hint[channel]}</p>
        </div>
        <dl className="mt-space-snug grid grid-cols-2 gap-2 text-caption sm:grid-cols-4">
          <div className="rounded-card border border-border-warm bg-white px-2 py-1.5">
            <dt className="text-muted">{m.summary.posted}</dt>
            <dd className="text-body tabular-nums text-charcoal">{summary.posted}</dd>
          </div>
          <div className="rounded-card border border-border-warm bg-white px-2 py-1.5">
            <dt className="text-muted">{m.summary.scheduled}</dt>
            <dd className="text-body tabular-nums text-charcoal">{summary.scheduled}</dd>
          </div>
          <div className="rounded-card border border-border-warm bg-white px-2 py-1.5">
            <dt className="text-muted">{m.summary.failed}</dt>
            <dd className="text-body tabular-nums text-charcoal">{summary.failed}</dd>
          </div>
          <div className="rounded-card border border-border-warm bg-white px-2 py-1.5">
            <dt className="text-muted">{m.summary.impressions}</dt>
            <dd className="text-body tabular-nums text-charcoal">{summary.impressions.toLocaleString('ja-JP')}</dd>
          </div>
        </dl>
        {posts.length === 0 ? (
          <p className="mt-space-snug text-body text-muted">{m.postsEmpty[channel]}</p>
        ) : (
          // フル幅を使い切りつつ 1 枚の幅が X の実物に近くなるよう、広い画面だけ 2 列にする。
          <div className="mt-space-snug grid grid-cols-1 gap-space-snug xl:grid-cols-2" data-testid="promotion-posts-list">
            {posts.map((p) => (
              <PostPreview key={p.id} post={p} channel={channel} authorName={author.name} authorHandle={author.handle} avatarUrl={author.avatar_url} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
