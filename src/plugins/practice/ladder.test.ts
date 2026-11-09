import { describe, expect, it } from 'vitest';
import { dayOf, isDue, nextReview, type ReviewState } from './ladder';

const STEPS = [2, 5, 9];

describe('nextReview', () => {
  it.each<{
    state: ReviewState;
    outcome: 'clean' | 'peeked';
    today: string;
    next: ReviewState;
  }>([
    {
      state: { step: null, due: null },
      outcome: 'clean',
      today: '2026-11-09',
      next: { step: 0, due: '2026-11-11' },
    },
    {
      state: { step: 0, due: '2026-11-01' },
      outcome: 'clean',
      today: '2026-11-09',
      next: { step: 1, due: '2026-11-14' },
    },
    {
      state: { step: 2, due: '2026-11-01' },
      outcome: 'clean',
      today: '2026-11-09',
      next: { step: 2, due: '2026-11-18' },
    },
    {
      state: { step: 1, due: '2026-11-01' },
      outcome: 'peeked',
      today: '2026-11-09',
      next: { step: 0, due: '2026-11-11' },
    },
    {
      state: { step: null, due: null },
      outcome: 'peeked',
      today: '2026-11-09',
      next: { step: 0, due: '2026-11-11' },
    },
    {
      state: { step: 0, due: '2026-11-01' },
      outcome: 'clean',
      today: '2026-11-30',
      next: { step: 1, due: '2026-12-05' },
    },
    {
      state: { step: 0, due: '2026-11-01' },
      outcome: 'clean',
      today: '2026-12-30',
      next: { step: 1, due: '2027-01-04' },
    },
  ])(
    'moves step $state.step on a $outcome solve on $today to $next.step, due $next.due',
    ({ state, outcome, today, next }) => {
      expect(nextReview(state, outcome, today, STEPS)).toEqual(next);
    },
  );
});

describe('isDue', () => {
  it.each([
    { due: null, today: '2026-11-09', isDueToday: false },
    { due: '2026-11-08', today: '2026-11-09', isDueToday: true },
    { due: '2026-11-09', today: '2026-11-09', isDueToday: true },
    { due: '2026-11-10', today: '2026-11-09', isDueToday: false },
  ])('is $isDueToday when due $due on $today', ({ due, today, isDueToday }) => {
    expect(isDue({ step: 0, due }, today)).toBe(isDueToday);
  });
});

describe('dayOf', () => {
  it.each([
    { instant: new Date(2026, 10, 9, 23, 30).getTime(), day: '2026-11-09' },
    { instant: new Date(2026, 10, 10, 0, 15).getTime(), day: '2026-11-10' },
  ])('reads the local day of $instant as $day', ({ instant, day }) => {
    expect(dayOf(instant)).toBe(day);
  });
});
