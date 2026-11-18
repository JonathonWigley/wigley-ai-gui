import type {
  FindingAction,
  ItemAnswer,
  ItemKind,
  PageKind,
  Round,
} from '../contract';
import type { SessionForm } from '../../../shared/page/session-forms';
import type { PageKindTable } from './kinds/page-kinds';

// Any one item of a round, by kind. `index` is 1-based within its kind, as
// the forms contract numbers items.
export type RoundItem = { kind: ItemKind; index: number };

// An item of a kind whose `spec.answerable` is true.
export type AnswerableItem = RoundItem;

// The rail stop that holds every notice of the round.
export type NoticesStop = { kind: 'notices' };

// A stop on the rail: one item of a kind with a rail order, or the notices
// stop.
export type RailItem = RoundItem | NoticesStop;

export function isNoticesStop(item: RailItem): item is NoticesStop {
  return item.kind === 'notices';
}

// `choice` and `action` are one pick, one of the finding's numbered entries
// (`findingEntries`): `choice` is 0 for an action's header. No pick is
// `{ choice: 0, action: '' }`.
export interface FindingAnswer extends ItemAnswer {
  action: FindingAction | '';
}

// A notice's answer: the user's comment on it.
export interface NoticeAnswer {
  comment: string;
}

// The draft entries of a kind the page has no registration for, kept as main
// sent them, and the body key they write back to.
export interface HeldEntries {
  bodyKey: string;
  entries: readonly unknown[];
}

// `formId` is the round's id.
export interface RoundState extends SessionForm {
  round: Round;
  // The kinds the round was derived with.
  kinds: PageKindTable;
  // Each registered kind's answers, one per item, in order.
  itemAnswers: Readonly<Record<ItemKind, readonly unknown[]>>;
  // Each unregistered kind's draft entries, unchanged.
  heldEntries: Readonly<Record<ItemKind, HeldEntries>>;
  // One per notice, in order: whether its line is open on the notices stop.
  openNotices: boolean[];
  // The 1-based notice under the notices stop's line cursor; 0 when the round
  // has no notices.
  noticeLine: number;
  note: string;
  // A position in railItems(round).
  focus: number;
  // A position in answerableItems(round).
  reviewRow: number;
}

// The round note, or one of an item's text boxes by its kind's box field.
export type TextTarget = { field: 'note' } | { field: string; item: RoundItem };

export const NOTICE_KIND: ItemKind = 'notice';

// The kind's items in the round, in order; none for a kind the round lacks.
export function kindItems(round: Round, kind: ItemKind): readonly unknown[] {
  return round.items[kind] ?? [];
}

// The stops of each kind with a rail order, by rail order, then the notices
// stop when the round has notices.
export function railItems(round: RoundState): RailItem[] {
  const items: RailItem[] = round.kinds.railKinds.flatMap((kind) =>
    kindStops(round, kind),
  );
  return noticeCount(round) > 0 ? [...items, { kind: 'notices' }] : items;
}

// The stops of the answerable kinds, in rail order: the review's rows.
export function answerableItems(round: RoundState): AnswerableItem[] {
  return round.kinds.railKinds
    .filter((kind) => kind.spec.answerable)
    .flatMap((kind) => kindStops(round, kind));
}

function kindStops(round: RoundState, kind: PageKind): RoundItem[] {
  const { id } = kind.spec;
  return kindItems(round.round, id).map((_, i) => ({ kind: id, index: i + 1 }));
}

// The notices the notices stop holds: none while `notice` has no
// registration.
function noticeCount(round: RoundState): number {
  return round.kinds.get(NOTICE_KIND) === undefined
    ? 0
    : kindItems(round.round, NOTICE_KIND).length;
}

// The item's position in railItems(round), or -1 when the round lacks it.
export function railPosition(round: RoundState, item: RailItem): number {
  return railItems(round).findIndex((candidate) =>
    sameRailItem(candidate, item),
  );
}

export function sameRailItem(a: RailItem, b: RailItem): boolean {
  if (isNoticesStop(a) || isNoticesStop(b)) {
    return a.kind === b.kind;
  }
  return a.kind === b.kind && a.index === b.index;
}

export function focusedItem(round: RoundState): RailItem | null {
  return railItems(round)[round.focus] ?? null;
}

// Whether the item's kind is registered and takes an answer.
export function isAnswerable(round: RoundState, item: RoundItem): boolean {
  return round.kinds.get(item.kind)?.spec.answerable === true;
}
