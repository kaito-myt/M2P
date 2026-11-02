import {HISTORY_FEATURE_CONTRACT, inventoryHash} from './joint-feature-inventory-catalog.mjs';
import {projectInventoryRace, validInventoryDate} from './joint-feature-inventory-projection.mjs';

const MAX_RACERS = 20000, MAX_DAY_RACES = 1000, KEEP = HISTORY_FEATURE_CONTRACT.retainedStarts;
const dayNumber = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
const compare = (a, b) => b.date.localeCompare(a.date, 'en') || a.raceKey.localeCompare(b.raceKey, 'en');
const copy = value => structuredClone(value);
const validKey = (key, date) => typeof key === 'string' && new RegExp(`^turnmark_v1:${date}:(?:[1-9]|1[0-9]|2[0-4]):(?:[1-9]|1[0-2])$`).test(key);

function summary(rows, status = 'available') {
  const n = rows.length, usable = n > 0 && status === 'available';
  return {status: n ? status : 'no_observed_history', support: n,
    meanPlace: usable ? rows.reduce((sum, row) => sum + row.place, 0) / n : null,
    winRate: usable ? rows.filter(row => row.place === 1).length / n : null,
    top2Rate: usable ? rows.filter(row => row.place <= 2).length / n : null,
    top3Rate: usable ? rows.filter(row => row.place <= 3).length / n : null};
}

function features(state, date) {
  const records = state?.records ?? [], split10 = records.length > 10 && records[9].date === records[10].date,
    split30 = records.length > 30 && records[29].date === records[30].date,
    recent = summary(records.slice(0, 10), split10 ? 'ambiguous_same_day_boundary' : 'available'),
    preceding = summary(records.slice(10, 30), split10 || split30 ? 'ambiguous_same_day_boundary' : 'available'),
    contrastAvailable = recent.status === 'available' && preceding.status === 'available';
  const completeThrough = records.length <= 30 ? records : records.filter(row => row.date > records[30].date);
  return {recent10: recent, preceding20: preceding, windowContrast: {status: contrastAvailable ? 'available' : 'insufficient_or_ambiguous_windows',
    meanPlaceDelta: contrastAvailable ? recent.meanPlace - preceding.meanPlace : null,
    top2RateDelta: contrastAvailable ? recent.top2Rate - preceding.top2Rate : null,
    fullWindowSupport: recent.support === 10 && preceding.support === 20},
    daysSinceLastObservedProgram: state?.lastObservedDate ? dayNumber(date) - dayNumber(state.lastObservedDate) : null,
    daysSinceLastEligibleResult: records.length ? dayNumber(date) - dayNumber(records[0].date) : null,
    courseHistory: Array.from({length: 6}, (_, i) => ({course: i + 1,
      ...summary(completeThrough.filter(row => row.exhibitionCourse === i + 1)), definition: 'historical_exhibition_course_not_result_course'})),
    support: {eligibleResultsRetained: records.length, courseWindowResults: completeThrough.length,
      observedPrograms: state?.observedPrograms ?? 0, excludedResultRaces: state?.excludedResultRaces ?? 0,
      latestExcludedResult: copy(state?.latestExcludedResult ?? null),
      windowDefinition: 'last_ten_and_preceding_twenty_eligible_ordinary_finish_races_not_all_observed_starts',
      historyCompleteness: 'observed_archive_only_not_career_complete', sameDayOrderVerified: false,
      ambiguousRecentBoundary: split10, ambiguousPrecedingBoundary: split10 || split30},
    residual: {status: 'not_computed', reason: 'past_fold_baseline_not_defined'},
    medicalAbsence: {status: 'not_inferred', reason: 'calendar_gap_is_not_diagnosis_or_confirmed_absence'}, liveEligible: false};
}

function assertRacerState(row, lastDate) {
  if (!Number.isSafeInteger(row.registration) || row.registration < 1 || row.registration > 99999 || !validInventoryDate(row.lastObservedDate) ||
    row.lastObservedDate > lastDate || !Array.isArray(row.records) || row.records.length > KEEP ||
    !Number.isSafeInteger(row.observedPrograms) || row.observedPrograms < row.records.length ||
    !Number.isSafeInteger(row.excludedResultRaces) || row.excludedResultRaces < 0 || row.excludedResultRaces > row.observedPrograms)
    throw Error('feature_history_snapshot_racer');
  const excluded = row.latestExcludedResult;
  if (excluded !== null && (!validInventoryDate(excluded?.date) || excluded.date > row.lastObservedDate || !validKey(excluded.raceKey, excluded.date) ||
    !['result_not_normal', 'six_placings_required', 'nonordinary_place_excluded', 'tied_places_excluded'].includes(excluded.reason) ||
    !(excluded.placeCode === null || Number.isSafeInteger(excluded.placeCode) && excluded.placeCode >= 1 && excluded.placeCode <= 13) ||
    !['normal', 'unresolved', 'refund', 'cancelled', 'tie', 'unknown'].includes(excluded.resultState))) throw Error('feature_history_snapshot_exclusion');
  if ((row.excludedResultRaces > 0) !== (excluded !== null)) throw Error('feature_history_snapshot_exclusion_count');
  const keys = new Set();
  for (const record of row.records) {
    if (!validInventoryDate(record.date) || record.date > row.lastObservedDate || !validKey(record.raceKey, record.date) || keys.has(record.raceKey) ||
      !Number.isInteger(record.place) || record.place < 1 || record.place > 6 ||
      !(record.exhibitionCourse === null || Number.isInteger(record.exhibitionCourse) && record.exhibitionCourse >= 1 && record.exhibitionCourse <= 6))
      throw Error('feature_history_snapshot_record');
    keys.add(record.raceKey);
  }
  if (JSON.stringify(row.records) !== JSON.stringify([...row.records].sort(compare))) throw Error('feature_history_snapshot_order');
}

export function createFeatureHistory(snapshot = null) {
  let lastCommittedDate = null, state = new Map(), pending = null;
  if (snapshot !== null) {
    const {digest, ...body} = snapshot;
    if (body.version !== HISTORY_FEATURE_CONTRACT.version || inventoryHash(body) !== digest ||
      inventoryHash(body.contract) !== inventoryHash(HISTORY_FEATURE_CONTRACT) || !(validInventoryDate(body.lastCommittedDate) || body.lastCommittedDate === null && body.racers?.length === 0) ||
      !Array.isArray(body.racers) || body.racers.length > MAX_RACERS || new Set(body.racers.map(row => row.registration)).size !== body.racers.length)
      throw Error('feature_history_snapshot_binding');
    body.racers.forEach(row => assertRacerState(row, body.lastCommittedDate));
    lastCommittedDate = body.lastCommittedDate;
    state = new Map(body.racers.map(({registration, ...row}) => [registration, copy(row)]));
  }

  return {
    beginDay(date, races) {
      if (pending) throw Error('feature_history_day_pending');
      if (!validInventoryDate(date) || lastCommittedDate !== null && date <= lastCommittedDate || !Array.isArray(races) || races.length > MAX_DAY_RACES)
        throw Error('feature_history_day_order_or_budget');
      const views = races.map(projectInventoryRace);
      if (views.some(view => view.date !== date || view.status === 'unsupported') || new Set(views.map(view => view.raceKey)).size !== views.length)
        throw Error('feature_history_day_identity');
      const ids = new Set([...state.keys(), ...views.flatMap(view => view.entries.map(entry => entry.registration))]);
      if (ids.size > MAX_RACERS) throw Error('feature_history_racer_budget');
      const identities = views.map(view => ({raceKey: view.raceKey, date: view.date, featureDigest: view.featureDigest,
        entries: view.entries.map(entry => ({lane: entry.lane, registration: entry.registration,
          exhibitionCourse: entry.fields['entry.preview.course_number'].status === 'recorded' &&
            Number.isInteger(entry.fields['entry.preview.course_number'].researchValue) && entry.fields['entry.preview.course_number'].researchValue >= 1 &&
            entry.fields['entry.preview.course_number'].researchValue <= 6 ? entry.fields['entry.preview.course_number'].researchValue : null}))}));
      const output = views.map(view => ({raceKey: view.raceKey, date, entries: view.entries.map(entry => ({lane: entry.lane,
        registration: entry.registration, history: features(state.get(entry.registration), date)}))}));
      pending = {date, identities, featureDigest: inventoryHash(identities)};
      return {version: HISTORY_FEATURE_CONTRACT.version, date, cutoff: 'strictly_prior_calendar_date',
        priorStateDate: lastCommittedDate, dayFeatureDigest: pending.featureDigest, races: output,
        evidence: {resultFieldsRead: false, currentDayResultsUsed: false, residualsComputed: false, liveEligible: false}};
    },
    commitDay(date, resultRaces) {
      if (!pending || pending.date !== date || !Array.isArray(resultRaces) || resultRaces.length !== pending.identities.length)
        throw Error('feature_history_commit_binding');
      const input = new Map(resultRaces.map(race => [race.raceKey, race]));
      if (input.size !== resultRaces.length) throw Error('feature_history_commit_duplicate');
      const additions = [], exclusionCounts = {};
      for (const identity of pending.identities) {
        const race = input.get(identity.raceKey), projected = projectInventoryRace(race);
        if (projected.date !== date || projected.featureDigest !== identity.featureDigest) throw Error('feature_history_commit_features_changed');
        const placings = race.result?.placings;
        let reason = race.result?.state !== 'normal' ? 'result_not_normal' : !Array.isArray(placings) || placings.length !== 6 ? 'six_placings_required' : null;
        if (!reason) {
          const byLane = new Map(placings.map(row => [row.lane, row]));
          if (byLane.size !== 6 || identity.entries.some(entry => byLane.get(entry.lane)?.registration !== entry.registration))
            throw Error('feature_history_result_identity');
          if (placings.some(row => !Number.isInteger(row.placeNumber) || row.placeNumber < 1 || row.placeNumber > 6)) reason = 'nonordinary_place_excluded';
          else if (new Set(placings.map(row => row.placeNumber)).size !== 6) reason = 'tied_places_excluded';
        }
        if (reason) exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1;
        for (const entry of identity.entries) {
          const record = reason ? null : {date, raceKey: identity.raceKey,
            place: placings.find(row => row.lane === entry.lane).placeNumber, exhibitionCourse: entry.exhibitionCourse};
          const resultPlace = Array.isArray(placings) ? placings.find(row => row.lane === entry.lane && row.registration === entry.registration)?.placeNumber : null;
          const exclusion = !reason ? null : {date, raceKey: identity.raceKey, reason,
            placeCode: Number.isSafeInteger(resultPlace) && resultPlace >= 1 && resultPlace <= 13 ? resultPlace : null,
            resultState: ['normal', 'unresolved', 'refund', 'cancelled', 'tie'].includes(race.result?.state) ? race.result.state : 'unknown'};
          additions.push({registration: entry.registration, record, exclusion});
        }
      }
      const next = new Map(state);
      for (const entry of additions) {
        const prior = next.get(entry.registration), records = entry.record ? [...(prior?.records ?? []), entry.record].sort(compare).slice(0, KEEP) : [...(prior?.records ?? [])];
        next.set(entry.registration, {lastObservedDate: date, records, observedPrograms: (prior?.observedPrograms ?? 0) + 1,
          excludedResultRaces: (prior?.excludedResultRaces ?? 0) + Number(entry.exclusion !== null),
          latestExcludedResult: entry.exclusion ?? prior?.latestExcludedResult ?? null});
      }
      const receipt = {date, dayFeatureDigest: pending.featureDigest, observedRaces: pending.identities.length,
        eligibleResultRaces: pending.identities.length - Object.values(exclusionCounts).reduce((sum, n) => sum + n, 0), exclusionCounts};
      state = next; lastCommittedDate = date; pending = null;
      return {...receipt, stateDigest: this.snapshot().digest};
    },
    snapshot() {
      if (pending) throw Error('feature_history_snapshot_pending_day');
      const body = {version: HISTORY_FEATURE_CONTRACT.version, contract: HISTORY_FEATURE_CONTRACT, lastCommittedDate,
        racers: [...state].sort(([a], [b]) => a - b).map(([registration, row]) => ({registration, ...copy(row)}))};
      return {...body, digest: inventoryHash(body)};
    },
  };
}
