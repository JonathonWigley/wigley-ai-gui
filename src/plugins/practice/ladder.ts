/** A problem's place on the review ladder; `due` is a `YYYY-MM-DD` day. */
export interface ReviewState {
  step: number | null;
  due: string | null;
}

/** The ladder after a clean solve (one step up, capped at the top) or a peek (back to the first step). */
export function nextReview(
  state: ReviewState,
  outcome: 'clean' | 'peeked',
  today: string,
  steps: readonly number[],
): ReviewState {
  const step =
    outcome === 'peeked' || state.step === null
      ? 0
      : Math.min(state.step + 1, steps.length - 1);
  return { step, due: addDays(today, steps[step]) };
}

export function isDue(state: ReviewState, today: string): boolean {
  return state.due !== null && state.due <= today;
}

export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return formatDay(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** The local calendar day of an instant. */
export function dayOf(epochMs: number): string {
  const instant = new Date(epochMs);
  return formatDay(
    instant.getFullYear(),
    instant.getMonth() + 1,
    instant.getDate(),
  );
}

function formatDay(year: number, month: number, date: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(date)}`;
}
