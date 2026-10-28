import type { BoxIdentity } from '../../../shared/page/editor-boxes';
import { activeForm } from '../../../shared/page/session-forms';
import { MAX_PRIMER_ITEMS, type PrimerEntry } from '../contract';
import {
  FEATURE_FIELDS,
  type OpenPrimer,
  type PrimerAction,
  type PrimerState,
  selectedEntry,
  selectedRow,
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

// The boxes the user can reach now, in Ctrl+n order: the boxes of the card
// the selected row shows in view 'primer', none in any other view.
export function shownBoxes(state: PrimerState): PrimerBox[] {
  const primer = activeForm(state);
  if (primer === null || state.view !== 'primer') {
    return [];
  }
  const primerId = primer.formId;
  const row = selectedRow(primer);
  const entry = selectedEntry(primer);
  if (row.kind === 'item') {
    const { entryId, item } = row;
    return [{ primerId, target: { field: 'itemComment', entryId, item } }];
  }
  if (entry === null) {
    return FEATURE_FIELDS.map(([name]) => ({
      primerId,
      target: { field: 'feature', name },
    }));
  }
  return taskTargets(entry).map((target) => ({ primerId, target }));
}

// What a task card's box edits.
export type TaskTarget = Extract<
  TextTarget,
  { field: 'taskName' | 'newItem' | 'taskComment' }
>;

// A task card's boxes, in card order: an extra task's name, the add-item box
// unless the task is full, then the task's comment.
export function taskTargets(entry: PrimerEntry): TaskTarget[] {
  const entryId = entry.id;
  const name: TaskTarget[] =
    entry.group === 'extra' ? [{ field: 'taskName', entryId }] : [];
  const newItem: TaskTarget[] = hasAddItemBox(entry)
    ? [{ field: 'newItem', entryId }]
    : [];
  return [...name, ...newItem, { field: 'taskComment', entryId }];
}

// A task holding MAX_PRIMER_ITEMS items takes no more.
export function hasAddItemBox(entry: PrimerEntry): boolean {
  return entry.items.length < MAX_PRIMER_ITEMS;
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
    throw new Error(`primer ${primer.formId} has no task ${target.entryId}`);
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
          `task ${entry.id} of primer ${primer.formId} has no item ${target.item}`,
        );
      }
      return item.comment;
    }
  }
}

// Shows the box's row in the active primer; null for a box of
// another primer or outside view 'primer'.
export function focusActionFor(
  state: PrimerState,
  box: PrimerBox,
): PrimerAction | null {
  const isActiveBox = state.activeFormId === box.primerId;
  if (!isActiveBox || state.view !== 'primer') {
    return null;
  }
  return { type: 'showTarget', formId: box.primerId, target: box.target };
}
