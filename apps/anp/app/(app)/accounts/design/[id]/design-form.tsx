'use client';

import { useState, useTransition } from 'react';

import type { NoteAccountDesign } from '@a2p/contracts/agents/anp';

import { adoptDesign, rejectDesign, updateDesignAndGenerateVisuals } from '@/app/actions/account-design';
import { messages } from '@/lib/messages';

const dm = messages.accountDesign.detail;

interface DesignFormProps {
  designId: string;
  initial: NoteAccountDesign;
  avatarUrl: string | null;
  headerUrl: string | null;
}

/** JSON textarea を安全に parse する。失敗時は null (呼出側でエラー表示)。 */
function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function DesignForm({ designId, initial, avatarUrl, headerUrl }: DesignFormProps) {
  const [selectedDisplayName, setSelectedDisplayName] = useState(
    initial.display_name_candidates[0] ?? '',
  );
  const [selectedHandle, setSelectedHandle] = useState(initial.handle_candidates[0] ?? '');
  const [bio, setBio] = useState(initial.bio);
  const [concept, setConcept] = useState(initial.concept);
  const [targetReader, setTargetReader] = useState(initial.target_reader);
  const [tone, setTone] = useState(initial.tone);
  const [personaType, setPersonaType] = useState(initial.persona_type);
  const [characterSheet, setCharacterSheet] = useState(initial.character_sheet ?? '');
  const [contentPillarsText, setContentPillarsText] = useState(
    JSON.stringify(initial.content_pillars, null, 2),
  );
  const [genrePolicy, setGenrePolicy] = useState(initial.genre_policy.join(', '));
  const [freeRatio, setFreeRatio] = useState(initial.monetization_policy.free_ratio);
  const [priceMin, setPriceMin] = useState(initial.monetization_policy.price_band[0]);
  const [priceMax, setPriceMax] = useState(initial.monetization_policy.price_band[1]);
  const [membership, setMembership] = useState(initial.monetization_policy.membership);
  const [paidLineStrategy, setPaidLineStrategy] = useState(initial.monetization_policy.paid_line_strategy);
  const [timesPerWeek, setTimesPerWeek] = useState(initial.posting_cadence.times_per_week);
  const [timeOfDay, setTimeOfDay] = useState(initial.posting_cadence.time_of_day);
  const [firstThemesText, setFirstThemesText] = useState(JSON.stringify(initial.first_themes, null, 2));
  const [followers30d, setFollowers30d] = useState(initial.kpi_targets.followers_30d);
  const [articles30d, setArticles30d] = useState(initial.kpi_targets.articles_30d);
  const [revenue90d, setRevenue90d] = useState(initial.kpi_targets.revenue_90d_jpy);
  const [avatarPrompt, setAvatarPrompt] = useState(initial.avatar_prompt);
  const [headerPrompt, setHeaderPrompt] = useState(initial.header_prompt);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function buildEdited(): NoteAccountDesign | null {
    const contentPillars = tryParseJson(contentPillarsText);
    const firstThemes = tryParseJson(firstThemesText);
    if (contentPillars === null || firstThemes === null) {
      setError(messages.accountDesign.errors.invalidEdit);
      return null;
    }
    return {
      display_name_candidates: initial.display_name_candidates,
      handle_candidates: initial.handle_candidates,
      bio,
      concept,
      target_reader: targetReader,
      tone,
      persona_type: personaType,
      character_sheet: personaType === 'person' ? characterSheet || null : null,
      content_pillars: contentPillars as NoteAccountDesign['content_pillars'],
      genre_policy: genrePolicy
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      monetization_policy: {
        free_ratio: freeRatio,
        price_band: [priceMin, priceMax],
        membership,
        paid_line_strategy: paidLineStrategy,
      },
      posting_cadence: { times_per_week: timesPerWeek, time_of_day: timeOfDay },
      first_themes: firstThemes as NoteAccountDesign['first_themes'],
      kpi_targets: {
        followers_30d: followers30d,
        articles_30d: articles30d,
        revenue_90d_jpy: revenue90d,
      },
      avatar_prompt: avatarPrompt,
      header_prompt: headerPrompt,
      ...(initial.rationale !== undefined ? { rationale: initial.rationale } : {}),
    };
  }

  const onGenerateImages = () => {
    setError(null);
    const edited = buildEdited();
    if (!edited) return;
    startTransition(async () => {
      const result = await updateDesignAndGenerateVisuals({ design_id: designId, design: edited });
      if (!result.ok) setError(result.error);
    });
  };

  const onAdopt = () => {
    setError(null);
    const edited = buildEdited();
    if (!edited) return;
    startTransition(async () => {
      const result = await adoptDesign({
        design_id: designId,
        selected_display_name: selectedDisplayName,
        selected_handle: selectedHandle,
        design: edited,
      });
      if (!result.ok) setError(result.error);
    });
  };

  const onReject = () => {
    setError(null);
    startTransition(async () => {
      const result = await rejectDesign({ design_id: designId });
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="mt-space-snug flex flex-col gap-space-relaxed">
      <fieldset className="flex flex-col gap-1 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <legend className="text-body font-medium text-charcoal">{dm.displayNameCandidates}</legend>
        {initial.display_name_candidates.map((c) => (
          <label key={c} className="flex items-center gap-2 text-body text-charcoal">
            <input
              type="radio"
              name="display_name"
              checked={selectedDisplayName === c}
              onChange={() => setSelectedDisplayName(c)}
            />
            {c}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <legend className="text-body font-medium text-charcoal">{dm.handleCandidates}</legend>
        {initial.handle_candidates.map((c) => (
          <label key={c} className="flex items-center gap-2 text-body text-charcoal">
            <input
              type="radio"
              name="handle"
              checked={selectedHandle === c}
              onChange={() => setSelectedHandle(c)}
            />
            note.com/{c}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-body text-charcoal">
        {dm.bio}
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          maxLength={400}
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-body text-charcoal">
        {dm.concept}
        <textarea
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          rows={2}
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>

      <div className="grid grid-cols-1 gap-space-snug sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.targetReader}
          <input
            value={targetReader}
            onChange={(e) => setTargetReader(e.target.value)}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.tone}
          <input
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-body font-medium text-charcoal">{dm.personaType}</legend>
        <label className="flex items-center gap-2 text-body text-charcoal">
          <input
            type="radio"
            name="persona_type"
            checked={personaType === 'person'}
            onChange={() => setPersonaType('person')}
          />
          {dm.personaTypeOptions.person}
        </label>
        <label className="flex items-center gap-2 text-body text-charcoal">
          <input
            type="radio"
            name="persona_type"
            checked={personaType === 'brand'}
            onChange={() => setPersonaType('brand')}
          />
          {dm.personaTypeOptions.brand}
        </label>
      </fieldset>

      {personaType === 'person' && (
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.characterSheet}
          <textarea
            value={characterSheet}
            onChange={(e) => setCharacterSheet(e.target.value)}
            rows={5}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-body text-charcoal">
        {dm.contentPillars}
        <textarea
          value={contentPillarsText}
          onChange={(e) => setContentPillarsText(e.target.value)}
          rows={8}
          className="rounded-card border border-border-warm px-3 py-2 font-mono text-caption"
        />
      </label>

      <label className="flex flex-col gap-1 text-body text-charcoal">
        {dm.genrePolicy}
        <input
          value={genrePolicy}
          onChange={(e) => setGenrePolicy(e.target.value)}
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>

      <div className="grid grid-cols-2 gap-space-snug sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.freeRatio}
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={freeRatio}
            onChange={(e) => setFreeRatio(Number(e.target.value))}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.priceMin}
          <input
            type="number"
            min="0"
            value={priceMin}
            onChange={(e) => setPriceMin(Number(e.target.value))}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.priceMax}
          <input
            type="number"
            min="0"
            value={priceMax}
            onChange={(e) => setPriceMax(Number(e.target.value))}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-body text-charcoal">
          <input type="checkbox" checked={membership} onChange={(e) => setMembership(e.target.checked)} />
          {dm.membership}
        </label>
      </div>

      <label className="flex flex-col gap-1 text-body text-charcoal">
        {dm.paidLineStrategy}
        <textarea
          value={paidLineStrategy}
          onChange={(e) => setPaidLineStrategy(e.target.value)}
          rows={2}
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>

      <div className="grid grid-cols-1 gap-space-snug sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.timesPerWeek}
          <input
            type="number"
            min="1"
            max="21"
            value={timesPerWeek}
            onChange={(e) => setTimesPerWeek(Number(e.target.value))}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.timeOfDay}
          <input
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-body text-charcoal">
        {dm.firstThemes}
        <textarea
          value={firstThemesText}
          onChange={(e) => setFirstThemesText(e.target.value)}
          rows={8}
          className="rounded-card border border-border-warm px-3 py-2 font-mono text-caption"
        />
      </label>

      <div className="grid grid-cols-3 gap-space-snug">
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.followers30d}
          <input
            type="number"
            min="0"
            value={followers30d}
            onChange={(e) => setFollowers30d(Number(e.target.value))}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.articles30d}
          <input
            type="number"
            min="0"
            value={articles30d}
            onChange={(e) => setArticles30d(Number(e.target.value))}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {dm.revenue90dJpy}
          <input
            type="number"
            min="0"
            value={revenue90d}
            onChange={(e) => setRevenue90d(Number(e.target.value))}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-body text-charcoal">
        {dm.avatarPrompt}
        <textarea
          value={avatarPrompt}
          onChange={(e) => setAvatarPrompt(e.target.value)}
          rows={3}
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-body text-charcoal">
        {dm.headerPrompt}
        <textarea
          value={headerPrompt}
          onChange={(e) => setHeaderPrompt(e.target.value)}
          rows={3}
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>

      {initial.rationale && (
        <p className="text-caption text-muted">
          {dm.rationale}: {initial.rationale}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-space-relaxed">
        <div>
          <button
            type="button"
            disabled={isPending}
            onClick={onGenerateImages}
            className="rounded-card border border-border-warm bg-cream-light px-4 py-2 text-button-sm text-charcoal disabled:opacity-50"
          >
            {isPending ? dm.generatingImages : dm.generateImages}
          </button>
          <div className="mt-2 flex gap-3">
            {avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={dm.avatarLabel} className="h-24 w-24 rounded-card object-cover" />
            )}
            {headerUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={headerUrl} alt={dm.headerLabel} className="h-24 w-44 rounded-card object-cover" />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={onAdopt}
          className="rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
        >
          {dm.adopt}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={onReject}
          className="rounded-card border border-border-warm bg-cream-light px-4 py-2 text-button-sm text-charcoal disabled:opacity-50"
        >
          {dm.reject}
        </button>
      </div>

      {error && <p className="text-body text-red-600">{error}</p>}
    </div>
  );
}
