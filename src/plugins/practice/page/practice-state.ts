import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { PracticePlace, ProblemStatus, ProblemSummary } from '../contract';
import type { Difficulty } from '../problem';

// The pane holding the keys: the side bar's list, the problem column, or the
// interviewer's pane.
export type PracticeFocus = 'list' | 'main' | 'interviewer';

// `problems` in the order main listed them; `message` is the last failed
// read's error, null once a read lands. `selectedSlug` is the list's cursor,
// `openSlug` the problem the column shows, `filter` the filter box's text.
export interface PracticeState {
  problems: ProblemSummary[];
  isLoaded: boolean;
  message: string | null;
  selectedSlug: string | null;
  openSlug: string | null;
  filter: string;
  focus: PracticeFocus;
}

export type PracticeAction =
  | { type: 'loaded'; problems: ProblemSummary[] }
  | { type: 'loadFailed'; message: string }
  // A reloaded page's place, put back once the first list loads.
  | { type: 'placeRestored'; place: PracticePlace }
  | { type: 'move'; to: 'down' | 'up' | 'top' | 'bottom' }
  | { type: 'select'; slug: string }
  | { type: 'setFilter'; text: string }
  | { type: 'opened'; slug: string }
  | { type: 'focus'; focus: PracticeFocus };

const STATUS_ORDER: Record<ProblemStatus, number> = {
  attempted: 0,
  new: 1,
  solved: 2,
};

const DIFFICULTY_ORDER: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
const STATUSES: readonly ProblemStatus[] = ['new', 'attempted', 'solved'];

export function initialPracticeState(): PracticeState {
  return {
    problems: [],
    isLoaded: false,
    message: null,
    selectedSlug: null,
    openSlug: null,
    filter: '',
    focus: 'list',
  };
}

// Attempted, then new, then solved; inside each, easy, medium, hard; then by
// title, ignoring case and accents.
export function sortedProblems(
  problems: readonly ProblemSummary[],
): ProblemSummary[] {
  return [...problems].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty] ||
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  );
}

// The rows the list shows, sorted: the problems every word of the filter
// keeps. A word is a difficulty, a status (`unsolved` is new or attempted,
// `due` the due ones), a whole word of any loaded problem's tag or list, or
// else a fuzzy match on the title.
export function visibleProblems(
  state: PracticeState,
  matcher: FuzzyMatcher,
): ProblemSummary[] {
  const words = state.filter
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  const vocabulary = new Set(state.problems.flatMap(tagAndListWords));
  return sortedProblems(
    state.problems.filter((problem) =>
      words.every((word) => isKeptBy(problem, word, vocabulary, matcher)),
    ),
  );
}

// Solved of total for each difficulty, easy first, over every problem.
export function difficultyCounts(
  problems: readonly ProblemSummary[],
): { difficulty: Difficulty; solved: number; total: number }[] {
  return DIFFICULTIES.map((difficulty) => {
    const ofDifficulty = problems.filter(
      (problem) => problem.difficulty === difficulty,
    );
    return {
      difficulty,
      solved: ofDifficulty.filter((problem) => problem.status === 'solved')
        .length,
      total: ofDifficulty.length,
    };
  });
}

export function placeOf(state: PracticeState): PracticePlace {
  return {
    selectedSlug: state.selectedSlug,
    openSlug: state.openSlug,
    filter: state.filter,
  };
}

export function practiceReducer(
  state: PracticeState,
  action: PracticeAction,
  matcher: FuzzyMatcher,
): PracticeState {
  switch (action.type) {
    case 'loaded':
      return withSelectionKept(
        {
          ...state,
          problems: action.problems,
          isLoaded: true,
          message: null,
        },
        matcher,
      );
    case 'loadFailed':
      return { ...state, message: action.message };
    case 'placeRestored':
      return withSelectionKept(
        {
          ...state,
          selectedSlug: action.place.selectedSlug,
          openSlug: state.problems.some(
            (problem) => problem.slug === action.place.openSlug,
          )
            ? action.place.openSlug
            : null,
          filter: action.place.filter,
        },
        matcher,
      );
    case 'move':
      return move(state, action.to, matcher);
    case 'select': {
      const isShown = visibleProblems(state, matcher).some(
        (problem) => problem.slug === action.slug,
      );
      return isShown && state.selectedSlug !== action.slug
        ? { ...state, selectedSlug: action.slug }
        : state;
    }
    case 'setFilter':
      return withSelectionKept({ ...state, filter: action.text }, matcher);
    case 'opened':
      return { ...state, openSlug: action.slug, selectedSlug: action.slug };
    case 'focus':
      return state.focus === action.focus
        ? state
        : { ...state, focus: action.focus };
  }
}

// `state` with its selection kept while a visible row holds it, else on the
// first visible row, else null.
function withSelectionKept(
  state: PracticeState,
  matcher: FuzzyMatcher,
): PracticeState {
  const rows = visibleProblems(state, matcher);
  const isSelectionShown = rows.some(
    (problem) => problem.slug === state.selectedSlug,
  );
  return {
    ...state,
    selectedSlug: isSelectionShown
      ? state.selectedSlug
      : (rows[0]?.slug ?? null),
  };
}

// One row down or up, held at the ends, or to the first or last row; no
// rows changes nothing.
function move(
  state: PracticeState,
  to: 'down' | 'up' | 'top' | 'bottom',
  matcher: FuzzyMatcher,
): PracticeState {
  const rows = visibleProblems(state, matcher);
  if (rows.length === 0) {
    return state;
  }
  const at = rows.findIndex((problem) => problem.slug === state.selectedSlug);
  const last = rows.length - 1;
  let index: number;
  switch (to) {
    case 'down':
      index = Math.min(at + 1, last);
      break;
    case 'up':
      index = Math.max(at - 1, 0);
      break;
    case 'top':
      index = 0;
      break;
    case 'bottom':
      index = last;
      break;
  }
  const slug = rows[index]?.slug ?? null;
  return slug === state.selectedSlug ? state : { ...state, selectedSlug: slug };
}

// Whether `word`, lowercased, keeps `problem`: the first rule it names
// decides, a word of `vocabulary` (every loaded problem's tag and list
// words) never falling to the title.
function isKeptBy(
  problem: ProblemSummary,
  word: string,
  vocabulary: ReadonlySet<string>,
  matcher: FuzzyMatcher,
): boolean {
  if (isDifficulty(word)) {
    return problem.difficulty === word;
  }
  if (isStatus(word)) {
    return problem.status === word;
  }
  if (word === 'unsolved') {
    return problem.status !== 'solved';
  }
  if (word === 'due') {
    return problem.due;
  }
  if (vocabulary.has(word)) {
    return tagAndListWords(problem).includes(word);
  }
  return matcher.matches(word, problem.title);
}

// Each whitespace-separated word of the problem's tags and lists, lowercased.
function tagAndListWords(problem: ProblemSummary): string[] {
  return [...problem.tags, ...problem.lists].flatMap((name) =>
    name
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word !== ''),
  );
}

function isDifficulty(word: string): word is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(word);
}

function isStatus(word: string): word is ProblemStatus {
  return (STATUSES as readonly string[]).includes(word);
}
