// The texts for when a doc was last loaded: short and relative on a tree row,
// the full local date and time on hover, and the doc view's sentence.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const DATE_AFTER = 8 * WEEK;

type LoadedAge =
  | { form: 'now' }
  | { form: 'relative'; text: string }
  | { form: 'date'; text: string };

// How long before `now` (epoch milliseconds) the ISO time `iso` was: `now`
// under a minute or ahead of the clock, then `4m`, `3h`, `2d`, `5w`, and from
// 8 weeks the local date, `Mar 3`, with the year when it is not `now`'s.
export function loadedAgo(iso: string, now: number): string {
  const age = loadedAge(iso, now);
  return age.form === 'now' ? 'now' : age.text;
}

// The full local date and time of `iso`, in the user's locale.
export function loadedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// The doc view's sentence: `Loaded just now`, `Loaded 3h ago`, `Loaded Mar 3`.
export function loadedLine(iso: string, now: number): string {
  const age = loadedAge(iso, now);
  switch (age.form) {
    case 'now':
      return 'Loaded just now';
    case 'relative':
      return `Loaded ${age.text} ago`;
    case 'date':
      return `Loaded ${age.text}`;
  }
}

function loadedAge(iso: string, now: number): LoadedAge {
  const elapsed = now - Date.parse(iso);
  if (elapsed < MINUTE) {
    return { form: 'now' };
  }
  if (elapsed < HOUR) {
    return relative(elapsed, MINUTE, 'm');
  }
  if (elapsed < DAY) {
    return relative(elapsed, HOUR, 'h');
  }
  if (elapsed < WEEK) {
    return relative(elapsed, DAY, 'd');
  }
  if (elapsed < DATE_AFTER) {
    return relative(elapsed, WEEK, 'w');
  }
  return { form: 'date', text: localDate(iso, now) };
}

function relative(elapsed: number, unit: number, letter: string): LoadedAge {
  return { form: 'relative', text: `${Math.floor(elapsed / unit)}${letter}` };
}

function localDate(iso: string, now: number): string {
  const date = new Date(iso);
  const isThisYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(
    'en-US',
    isThisYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}
