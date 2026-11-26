import type { BoxIdentity } from '../../../shared/page/editor-boxes';
import {
  activeForm,
  formById,
  sessionPaneView,
} from '../../../shared/page/session-forms';
import type { FormsAction, FormsState } from './form-state';
import { kindAnswer } from './round-answers';
import {
  focusedItem,
  isNoticesStop,
  railPosition,
  type RoundItem,
  type RoundState,
  type TextTarget,
} from './round-model';

// One text box: the round it belongs to and the answer field it edits.
export interface BoxRef {
  roundId: string;
  target: TextTarget;
}

export type BoxField = TextTarget['field'];

// `<roundId>/note`, or `<roundId>/<kind>/<index>/<field>` for an item's box.
export function boxKey(box: BoxRef): string {
  const { roundId, target } = box;
  if (!('item' in target)) {
    return `${roundId}/note`;
  }
  const { item, field } = target;
  return `${roundId}/${item.kind}/${item.index}/${field}`;
}

// How the log names a box, e.g. `notes on finding 2`.
export function boxDescription(box: BoxRef): string {
  const { target } = box;
  if (!('item' in target)) {
    return 'note on the form';
  }
  return `${target.field} on ${target.item.kind} ${target.item.index}`;
}

// Forms' boxes, one round's boxes to a form.
export const FORMS_BOX_IDENTITY: BoxIdentity<BoxRef> = {
  formIdOf: (box) => box.roundId,
  keyOf: boxKey,
  describe: boxDescription,
};

// The boxes the user can reach now, in Tab order: the active round's boxes
// in `state.view`.
export function shownBoxes(state: FormsState): BoxRef[] {
  const round = activeForm(state);
  return round === null ? [] : boxesInView(round, state.view);
}

// The boxes round `roundId`'s view draws, focused or not: its boxes in the
// view its session's pane draws it in; none for the active round under the
// cancel prompt.
export function roundViewBoxes(state: FormsState, roundId: string): BoxRef[] {
  const round = formById(state, roundId);
  const isUnderPrompt =
    state.view === 'confirm' && state.activeFormId === roundId;
  return round === undefined || isUnderPrompt
    ? []
    : boxesInView(round, sessionPaneView(state, round.sessionId, 'forms'));
}

// The forms view shows the focused item's shown boxes, or on the notices stop
// the open lines' shown boxes; the review only the round note.
function boxesInView(round: RoundState, view: FormsState['view']): BoxRef[] {
  switch (view) {
    case 'forms':
      return itemBoxes(round);
    case 'review':
      return [{ roundId: round.formId, target: { field: 'note' } }];
    default:
      return [];
  }
}

function itemBoxes(round: RoundState): BoxRef[] {
  const focused = focusedItem(round);
  if (focused === null) {
    return [];
  }
  if (isNoticesStop(focused)) {
    return round.openNotices.flatMap((isOpen, i) =>
      isOpen ? shownItemBoxes(round, { kind: 'notice', index: i + 1 }) : [],
    );
  }
  return shownItemBoxes(round, focused);
}

// The item's boxes its kind's `boxes.shown` gives for its answer; none for a
// kind with no registration.
function shownItemBoxes(round: RoundState, item: RoundItem): BoxRef[] {
  const kind = round.kinds.get(item.kind);
  if (kind === undefined) {
    return [];
  }
  return kind.boxes
    .shown(kindAnswer(round, item))
    .map((field) => ({ roundId: round.formId, target: { field, item } }));
}

export function isBoxShown(state: FormsState, box: BoxRef): boolean {
  return hasBox(shownBoxes(state), box);
}

// Whether a drop on the box's round view may type into it: drawn by the view,
// and not under the cancel prompt.
export function isBoxInRoundView(state: FormsState, box: BoxRef): boolean {
  return hasBox(roundViewBoxes(state, box.roundId), box);
}

function hasBox(boxes: BoxRef[], box: BoxRef): boolean {
  const key = boxKey(box);
  return boxes.some((shown) => boxKey(shown) === key);
}

// The first shown box editing one of `fields`, or null.
export function shownBox(state: FormsState, fields: BoxField[]): BoxRef | null {
  return (
    shownBoxes(state).find((box) => fields.includes(box.target.field)) ?? null
  );
}

// Focuses the box's item in the active round, or for a box of a kind with no
// rail order (`notice`) puts the notices stop's line cursor on its item; null
// for the round note, a box of another round, or an item the round lacks.
export function focusActionFor(
  state: FormsState,
  box: BoxRef,
): FormsAction | null {
  const round = activeForm(state);
  const { target } = box;
  if (round === null || round.formId !== box.roundId) {
    return null;
  }
  if (!('item' in target)) {
    return null;
  }
  const kind = round.kinds.get(target.item.kind);
  if (kind === undefined) {
    return null;
  }
  if (kind.railOrder === null) {
    const { index } = target.item;
    const isNotice = index >= 1 && index <= round.openNotices.length;
    return isNotice ? { type: 'focusNotice', notice: index } : null;
  }
  const item = railPosition(round, target.item);
  return item < 0 ? null : { type: 'focusItem', item };
}
