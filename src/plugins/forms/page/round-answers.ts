import type {
  AnswerStatus,
  FindingAction,
  Finding,
  ItemAnswer,
  ItemKind,
  KindPick,
  PageKind,
} from '../contract';
import { isResponded } from '../item-response';
import { drawnOriginSpec } from './kinds/finding/verdict';
import {
  type AnswerableItem,
  answerableItems,
  type FindingAnswer,
  focusedItem,
  isAnswerable,
  isNoticesStop,
  kindItems,
  type RoundItem,
  type RoundState,
  sameRailItem,
  type TextTarget,
} from './round-model';

export interface Progress {
  // Responded items (`answerStatus`), notes-only ones included.
  answered: number;
  notApplicable: number;
  untouched: number;
  total: number;
}

// The item actions that change the focused item's answer through its kind.
export type AnswerAction =
  // `number` is 1-based down the card: the kind's `pick.choose`. A number
  // past the last changes nothing.
  | { type: 'choose'; number: number }
  // The kind's `pick.clear`.
  | { type: 'clearChoice' }
  // The kind's `pick.recommended`.
  | { type: 'acceptRecommendation' }
  | { type: 'toggleNotApplicable' }
  | { type: 'toggleDontAsk' };

// The item's answer as its kind holds it. Throws when the round has no such
// item of a registered kind.
export function kindAnswer(round: RoundState, item: RoundItem): unknown {
  const answers = round.itemAnswers[item.kind];
  const isItem =
    answers !== undefined && item.index >= 1 && item.index <= answers.length;
  if (!isItem) {
    throw new Error(`round ${round.formId} has no ${item.kind} ${item.index}`);
  }
  return answers[item.index - 1];
}

// The kinds the round holds items of with no registration, in the round's
// kind order, with their item counts.
export function unregisteredKinds(
  round: RoundState,
): { kind: ItemKind; count: number }[] {
  return Object.entries(round.round.items).flatMap(([kind, items]) =>
    round.kinds.get(kind) === undefined && items.length > 0
      ? [{ kind, count: items.length }]
      : [],
  );
}

// An answerable item's kind and its pick rules.
interface AnswerableKindOf {
  kind: PageKind;
  pick: KindPick<unknown, unknown>;
}

// Throws when the item's kind is unregistered or takes no answer.
function answerableKindOf(
  round: RoundState,
  item: RoundItem,
): AnswerableKindOf {
  const kind = round.kinds.get(item.kind);
  const pick = kind?.reduce.pick;
  if (kind === undefined || pick === undefined) {
    throw new Error(`round ${round.formId}: ${item.kind} takes no answer`);
  }
  return { kind, pick };
}

function kindItem(round: RoundState, item: RoundItem): unknown {
  return kindItems(round.round, item.kind)[item.index - 1];
}

// An answerable item's answer. Throws when the round has no such item, or its
// kind takes no answer.
export function itemAnswer(round: RoundState, item: RoundItem): ItemAnswer {
  answerableKindOf(round, item);
  return kindAnswer(round, item) as ItemAnswer;
}

// The action picked on a finding; '' on any other kind.
export function findingActionOf(
  round: RoundState,
  item: AnswerableItem,
): FindingAction | '' {
  return item.kind === 'finding'
    ? (kindAnswer(round, item) as FindingAnswer).action
    : '';
}

// The finding card's word for `action` on finding `item` in `round`, as the
// card draws its origin's spec, or null when the spec does not offer it.
export function findingActionWord(
  round: RoundState,
  item: AnswerableItem,
  action: FindingAction,
): string | null {
  const finding = kindItem(round, item) as Finding;
  return drawnOriginSpec(finding.origin).actions[action] ?? null;
}

// Whether the item's picks alone answer it, notes aside: the kind's
// `pick.isComplete`.
export function pickIsComplete(
  round: RoundState,
  item: AnswerableItem,
): boolean {
  const { pick } = answerableKindOf(round, item);
  return pick.isComplete(kindItem(round, item), kindAnswer(round, item));
}

// The 1-based number the item's pick has down its card, 0 for no pick: the
// kind's `pick.number`.
export function pickNumber(round: RoundState, item: AnswerableItem): number {
  const { pick } = answerableKindOf(round, item);
  return pick.number(kindItem(round, item), kindAnswer(round, item));
}

// The item's status as the page counts it: `answered` once the item is
// responded (`isResponded`), its pick complete or its notes written, where the
// payload counts the pick alone. Throws when the round has no such item.
export function answerStatus(
  round: RoundState,
  item: AnswerableItem,
): AnswerStatus {
  const answer = itemAnswer(round, item);
  if (answer.notApplicable) {
    return 'not_applicable';
  }
  const responded = isResponded({
    notApplicable: answer.notApplicable,
    pickIsComplete: pickIsComplete(round, item),
    notes: answer.notes,
  });
  return responded ? 'answered' : 'untouched';
}

// The next answerable item after the focused one, by `step` and wrapping,
// whose status is untouched; the focused item is checked last. Null when
// every item is responded or not applicable.
export function unansweredItem(
  round: RoundState,
  step: 1 | -1,
): AnswerableItem | null {
  const items = answerableItems(round);
  const count = items.length;
  const focused = focusedItem(round);
  const position =
    focused === null
      ? -1
      : items.findIndex((item) => sameRailItem(item, focused));
  // With the notices stop or a stop with no answer focused, the search
  // starts just outside the items, so forward runs from the first and
  // backward from the last.
  const outside = step === 1 ? -1 : count;
  const start = position < 0 ? outside : position;
  for (let offset = 1; offset <= count; offset++) {
    const item = items[(((start + step * offset) % count) + count) % count];
    if (answerStatus(round, item) === 'untouched') {
      return item;
    }
  }
  return null;
}

export function progress(round: RoundState): Progress {
  const statuses = answerableItems(round).map((item) =>
    answerStatus(round, item),
  );
  const count = (status: AnswerStatus) =>
    statuses.filter((candidate) => candidate === status).length;
  return {
    answered: count('answered'),
    notApplicable: count('not_applicable'),
    untouched: count('untouched'),
    total: statuses.length,
  };
}

export function applyAnswerAction(
  round: RoundState,
  action: AnswerAction,
): RoundState {
  switch (action.type) {
    case 'choose':
      return updateFocusedPick(round, (pick, item, answer) =>
        pick.choose(item, answer, action.number),
      );
    case 'clearChoice':
      return updateFocusedPick(round, (pick, item, answer) =>
        pick.clear(item, answer),
      );
    case 'acceptRecommendation':
      return updateFocusedPick(round, (pick, item, answer) =>
        pick.recommended(item, answer),
      );
    case 'toggleNotApplicable':
      return updateFocusedAnswer(round, (answer) => ({
        ...answer,
        notApplicable: !answer.notApplicable,
      }));
    case 'toggleDontAsk':
      return updateFocusedAnswer(round, (answer) => ({
        ...answer,
        dontAsk: !answer.dontAsk,
      }));
  }
}

// The focused stop as an answerable item; null on the notices stop, a kind
// with no answer, or no stop.
function focusedAnswerable(round: RoundState): AnswerableItem | null {
  const focused = focusedItem(round);
  if (focused === null || isNoticesStop(focused)) {
    return null;
  }
  return isAnswerable(round, focused)
    ? { kind: focused.kind, index: focused.index }
    : null;
}

// Applies `change` through the focused kind's pick rules while its answer
// applies; a no-op off an answerable stop, while not applicable, or when
// `change` returns the answer it was given.
function updateFocusedPick(
  round: RoundState,
  change: (
    pick: KindPick<unknown, unknown>,
    item: unknown,
    answer: unknown,
  ) => unknown,
): RoundState {
  const focused = focusedAnswerable(round);
  if (focused === null) {
    return round;
  }
  const { pick } = answerableKindOf(round, focused);
  const answer = kindAnswer(round, focused);
  if ((answer as ItemAnswer).notApplicable) {
    return round;
  }
  const next = change(pick, kindItem(round, focused), answer);
  return next === answer ? round : withItemAnswer(round, focused, next);
}

// A no-op off an answerable stop or when `change` returns the answer it was
// given; `change` keeps the answer's own fields, so a finding's action
// survives.
function updateFocusedAnswer(
  round: RoundState,
  change: <Answer extends ItemAnswer>(answer: Answer) => Answer,
): RoundState {
  const focused = focusedAnswerable(round);
  if (focused === null) {
    return round;
  }
  const answer = itemAnswer(round, focused);
  const next = change(answer);
  return next === answer ? round : withItemAnswer(round, focused, next);
}

function withItemAnswer(
  round: RoundState,
  item: RoundItem,
  answer: unknown,
): RoundState {
  const answers = round.itemAnswers[item.kind].map((current, i) =>
    i === item.index - 1 ? answer : current,
  );
  return {
    ...round,
    itemAnswers: { ...round.itemAnswers, [item.kind]: answers },
    revision: round.revision + 1,
  };
}

// The round note, or an item box's text through its kind's `reduce.withText`;
// a no-op for an item the round lacks or a kind with no registration.
export function setText(
  round: RoundState,
  target: TextTarget,
  value: string,
): RoundState {
  if (!('item' in target)) {
    return value === round.note
      ? round
      : { ...round, note: value, revision: round.revision + 1 };
  }
  const { item, field } = target;
  const kind = round.kinds.get(item.kind);
  const answers = round.itemAnswers[item.kind];
  const isItem =
    kind !== undefined &&
    answers !== undefined &&
    item.index >= 1 &&
    item.index <= answers.length;
  if (!isItem) {
    return round;
  }
  const answer = answers[item.index - 1];
  if (kind.reduce.text(answer, field) === value) {
    return round;
  }
  return withItemAnswer(
    round,
    item,
    kind.reduce.withText(answer, field, value),
  );
}
