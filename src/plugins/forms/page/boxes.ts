import type { BoxIdentity } from '../../../shared/page/editor-boxes';
import {
  activeRound,
  focusedItem,
  type FormsAction,
  type FormsState,
  itemAnswer,
  type RailItem,
  railPosition,
  type RoundState,
  type TextTarget,
} from './form-state';

// One text box: the round it belongs to and the answer field it edits.
export interface BoxRef {
  roundId: string;
  target: TextTarget;
}

export type BoxField = TextTarget['field'];

export function boxKey(box: BoxRef): string {
  const { roundId, target } = box;
  switch (target.field) {
    case 'note':
      return `${roundId}/note`;
    case 'comment':
      return `${roundId}/comment/${target.notice}`;
    default:
      return `${roundId}/${target.field}/${target.item.kind}/${target.item.index}`;
  }
}

// How the log names a box, e.g. `notes on finding 2`.
export function boxDescription(box: BoxRef): string {
  const { target } = box;
  switch (target.field) {
    case 'note':
      return 'note on the round';
    case 'comment':
      return `comment on notice ${target.notice}`;
    default:
      return `${target.field} on ${target.item.kind} ${target.item.index}`;
  }
}

// Forms' boxes, one round's boxes to a form.
export const FORMS_BOX_IDENTITY: BoxIdentity<BoxRef> = {
  formIdOf: (box) => box.roundId,
  keyOf: boxKey,
  describe: boxDescription,
  logSource: 'forms',
};

// The boxes the user can reach now, in Ctrl+n order: the forms view shows the
// focused item's boxes, the review only the round note.
export function shownBoxes(state: FormsState): BoxRef[] {
  const round = activeRound(state);
  if (round === null) {
    return [];
  }
  const note: BoxRef = { roundId: round.roundId, target: { field: 'note' } };
  switch (state.view) {
    case 'forms':
      return itemBoxes(round);
    case 'review':
      return [note];
    default:
      return [];
  }
}

function itemBoxes(round: RoundState): BoxRef[] {
  const item = focusedItem(round);
  const { roundId } = round;
  if (item === null) {
    return [];
  }
  if (item.kind === 'notice') {
    return [{ roundId, target: { field: 'comment', notice: item.index } }];
  }
  const answerable = { kind: item.kind, index: item.index };
  const notes: BoxRef = {
    roundId,
    target: { field: 'notes', item: answerable },
  };
  const isDontAskOn = itemAnswer(round, answerable).dontAsk;
  return isDontAskOn
    ? [notes, { roundId, target: { field: 'dontAskReason', item: answerable } }]
    : [notes];
}

export function isBoxShown(state: FormsState, box: BoxRef): boolean {
  const key = boxKey(box);
  return shownBoxes(state).some((shown) => boxKey(shown) === key);
}

// The first shown box editing one of `fields`, or null.
export function shownBox(state: FormsState, fields: BoxField[]): BoxRef | null {
  return (
    shownBoxes(state).find((box) => fields.includes(box.target.field)) ?? null
  );
}

// Focuses the box's item in the active round; null for the round note or a
// box of another round.
export function focusActionFor(
  state: FormsState,
  box: BoxRef,
): FormsAction | null {
  const round = activeRound(state);
  const { target } = box;
  if (round === null || round.roundId !== box.roundId) {
    return null;
  }
  if (target.field === 'note') {
    return null;
  }
  const wanted: RailItem =
    target.field === 'comment'
      ? { kind: 'notice', index: target.notice }
      : target.item;
  const item = railPosition(round.round, wanted);
  return item < 0 ? null : { type: 'focusItem', item };
}
