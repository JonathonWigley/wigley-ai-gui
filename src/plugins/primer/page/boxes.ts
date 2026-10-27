import type { BoxIdentity } from '../../../shared/page/editor-boxes';
import type { PrimerEntry } from '../contract';
import {
  activePrimer,
  FEATURE_FIELDS,
  type OpenPrimer,
  type PrimerAction,
  type PrimerState,
  selectedEntry,
  type TextTarget,
} from './primer-state';

// One text box: the primer it belongs to and the field it edits.
export interface PrimerBox {
  primerId: string;
  target: TextTarget;
}

export function boxKey(box: PrimerBox): string {
  const { primerId, target } = box;
  switch (target.field) {
    case 'feature':
      return `${primerId}/feature/${target.name}`;
    case 'taskName':
      return `${primerId}/task/${target.entryId}/name`;
    case 'itemComment':
      return `${primerId}/task/${target.entryId}/item/${target.item}/comment`;
    case 'newItem':
      return `${primerId}/task/${target.entryId}/new-item`;
    case 'taskComment':
      return `${primerId}/task/${target.entryId}/comment`;
  }
}

// How the log names a box, e.g. `comment on item 2 of task 3`.
export function boxDescription(box: PrimerBox): string {
  const { target } = box;
  switch (target.field) {
    case 'feature':
      return target.name === 'notes'
        ? 'notes on the feature'
        : `${target.name} of the feature`;
    case 'taskName':
      return `name of task ${target.entryId}`;
    case 'itemComment':
      return `comment on item ${target.item} of task ${target.entryId}`;
    case 'newItem':
      return `new item on task ${target.entryId}`;
    case 'taskComment':
      return `comment on task ${target.entryId}`;
  }
}

// The primer's boxes, one primer's boxes to a form.
export const PRIMER_BOX_IDENTITY: BoxIdentity<PrimerBox> = {
  formIdOf: (box) => box.primerId,
  keyOf: boxKey,
  describe: boxDescription,
  logSource: 'primer',
};

// The boxes the user can reach now, in Ctrl+n order: the selected row's card
// in view 'primer', none in any other view.
export function shownBoxes(state: PrimerState): PrimerBox[] {
  const primer = activePrimer(state);
  if (primer === null || state.view !== 'primer') {
    return [];
  }
  const { primerId } = primer;
  const entry = selectedEntry(primer);
  if (entry === null) {
    return FEATURE_FIELDS.map(([name]) => ({
      primerId,
      target: { field: 'feature', name },
    }));
  }
  return taskTargets(entry).map((target) => ({ primerId, target }));
}

// A task card's boxes: an extra task's name, each item's comment, the
// add-item box, then the task's comment.
function taskTargets(entry: PrimerEntry): TextTarget[] {
  const entryId = entry.id;
  const name: TextTarget[] =
    entry.group === 'extra' ? [{ field: 'taskName', entryId }] : [];
  return [
    ...name,
    ...entry.items.map((_, i): TextTarget => ({
      field: 'itemComment',
      entryId,
      item: i + 1,
    })),
    { field: 'newItem', entryId },
    { field: 'taskComment', entryId },
  ];
}

// The text a box mounts with. Throws when the primer has no such task or
// item.
export function boxText(primer: OpenPrimer, target: TextTarget): string {
  if (target.field === 'feature') {
    return primer.feature[target.name];
  }
  if (target.field === 'newItem') {
    return primer.newItemTexts[target.entryId] ?? '';
  }
  const entry = primer.entries.find(
    (candidate) => candidate.id === target.entryId,
  );
  if (entry === undefined) {
    throw new Error(`primer ${primer.primerId} has no task ${target.entryId}`);
  }
  switch (target.field) {
    case 'taskName':
      return entry.task;
    case 'taskComment':
      return entry.comment;
    case 'itemComment': {
      const item = entry.items[target.item - 1];
      if (item === undefined) {
        throw new Error(
          `task ${entry.id} of primer ${primer.primerId} has no item ${target.item}`,
        );
      }
      return item.comment;
    }
  }
}

// Shows the box's row and item in the active primer; null for a box of
// another primer or outside view 'primer'.
export function focusActionFor(
  state: PrimerState,
  box: PrimerBox,
): PrimerAction | null {
  const isActiveBox = state.activePrimerId === box.primerId;
  if (!isActiveBox || state.view !== 'primer') {
    return null;
  }
  return { type: 'showTarget', primerId: box.primerId, target: box.target };
}
