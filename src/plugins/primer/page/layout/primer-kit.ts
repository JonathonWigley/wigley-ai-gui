import { appended, element } from '../../../../shared/page/dom';
import type { EditorBoxes } from '../../../../shared/page/editor-boxes';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import { appSlot } from '../../../../shared/page/layout-host/app-slot';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import {
  boxHint,
  keyChevron,
  keyEdge,
  keyStack,
} from '../../../../shared/page/ui/key-anchors';
import { row } from '../../../../shared/page/ui/row';
import { sectionHeader } from '../../../../shared/page/ui/section-header';
import {
  setToggleMark,
  toggleMark,
} from '../../../../shared/page/ui/toggle-mark';
import type { PrimerEntry, PrimerItem, TaskRow } from '../../contract';
import {
  type PrimerCommandName,
  primerCommand,
  primerScope,
  type PrimerScopeName,
} from '../../ids';
import type {
  CardEdgeKit,
  FeatureCardInput,
  FeatureKit,
  ItemCardInput,
  ItemKit,
  ItemsHeadKit,
  ItemsKit,
  PrimerKit,
  ReviewFooterKit,
  ReviewKit,
  TaskCardInput,
  TaskKit,
  TasksFootKit,
  TasksHeadKit,
  TasksKit,
} from '../../layouts/layout';
import { primerManifest } from '../../manifest';
import {
  boxText,
  type ItemTarget,
  itemTargets,
  type PrimerBox,
  type TaskTarget,
  taskTargets,
} from '../boxes';
import { needTag, taskName } from '../primer-review';
import {
  FEATURE_FIELDS,
  includedCount,
  type OpenPrimer,
  selectedEntry,
  taskRows,
  type TextTarget,
} from '../primer-state';

// What every primer kit reads: the core keys API's `anchor` and `keysFor`, the
// commands a kit's `command` reaches, and the platform its key hints draw for.
export type PrimerKitDeps = OwnerKitServices;

// What the card and column kits act through besides: the text boxes. Every
// click runs a primer command through `commands`.
export interface PrimerPartKitDeps extends PrimerKitDeps {
  boxes: Pick<EditorBoxes<PrimerBox>, 'place' | 'release' | 'setText'>;
}

// A card's kit and what the app does around the layout's card: append the
// boxes the card left out at its end, and bring the kit's own parts up to date
// with the card's input and each of its boxes to its text in `primer`.
export interface CardKit<K, Input> {
  kit: K;
  appendUnplacedBoxes(card: HTMLElement): void;
  update(input: Input, primer: OpenPrimer): void;
}

// The tasks column's kit and the row element `taskRow` drew at each position.
export interface DrawnTasksKit {
  kit: TasksKit;
  rows: Map<number, HTMLElement>;
}

// The items column's kit and the row element `itemRow` drew at each position.
export interface DrawnItemsKit {
  kit: ItemsKit;
  rows: Map<number, HTMLElement>;
}

// A column head's kit, every row pair it drew (for the app's `is-no-target`),
// and the app's step after the build: it places the save status at the start
// of `root` when the head left it out (nothing for the items head).
export interface DrawnColumnHeadKit<K> {
  kit: K;
  rowSteps: HTMLElement[];
  placeLeftOut(root: HTMLElement): void;
}

// One text box a card has: the field a layout names it by, what it edits,
// its label and the command its hint shows.
interface CardBox<Field extends string> {
  field: Field;
  target: TextTarget;
  label: string;
  command: PrimerCommandName | null;
}

// The task card's box for each target `taskTargets` lists, but its target.
const TASK_BOXES: {
  [F in TaskTarget['field']]: Omit<
    CardBox<Parameters<TaskKit['textBox']>[1]>,
    'target'
  >;
} = {
  taskName: { field: 'name', label: 'Name', command: 'editFirstField' },
  newItem: { field: 'newItem', label: 'New item', command: 'addItem' },
  taskComment: {
    field: 'comment',
    label: 'Comment',
    command: 'editTaskComment',
  },
};

// The item card's box for each target `itemTargets` lists, but its target.
// The text box sits first on an added item's card, so `i` reaches it.
const ITEM_BOXES: {
  [F in ItemTarget['field']]: Omit<
    CardBox<Parameters<ItemKit['textBox']>[1]>,
    'target'
  >;
} = {
  itemText: { field: 'text', label: 'Item', command: 'editFirstField' },
  itemComment: {
    field: 'comment',
    label: 'Comment',
    command: 'editItemComment',
  },
};

// The base kit for one part draw in the primer `scope`, each anchor it names
// recorded in `rollback`, with the need tag.
export function createPrimerKit(
  deps: PrimerKitDeps,
  scope: PrimerScopeName,
  rollback: RollbackDeps,
): PrimerKit {
  const base = createBaseKit(
    ownerBaseKitDeps(primerManifest, deps, scope, rollback),
  );
  return {
    ...base,
    needTag: (parent, need) => appended(parent, needTag(need)),
  };
}

export function createFeatureKit(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  rollback: RollbackDeps,
): CardKit<FeatureKit, FeatureCardInput> {
  const boxes = createCardBoxes(
    deps,
    primer,
    rollback,
    FEATURE_FIELDS.map(([name, label]) => ({
      field: name,
      target: { field: 'feature', name },
      label,
      command: name === 'name' ? 'editFirstField' : null,
    })),
  );
  return {
    kit: { ...createPrimerKit(deps, 'card', rollback), textBox: boxes.place },
    appendUnplacedBoxes: boxes.appendUnplaced,
    update: (_input, current) => boxes.syncText(current),
  };
}

export function createTaskKit(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  entry: PrimerEntry,
  rollback: RollbackDeps,
): CardKit<TaskKit, TaskCardInput> {
  const boxes = createCardBoxes(
    deps,
    primer,
    rollback,
    taskTargets(entry).map((target) => ({
      ...TASK_BOXES[target.field],
      target,
    })),
  );
  return {
    kit: { ...createPrimerKit(deps, 'card', rollback), textBox: boxes.place },
    appendUnplacedBoxes: boxes.appendUnplaced,
    update: (_input, current) => boxes.syncText(current),
  };
}

// The kit of item `number` (1-based) of `entry`: its comment box, and on an
// item the user added its text box. Each include mark it drew runs
// `primer.toggleInclude`, on the selected item as the key does, and shows the
// item's include on each `update`.
export function createItemKit(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  entry: PrimerEntry,
  number: number,
  rollback: RollbackDeps,
): CardKit<ItemKit, ItemCardInput> {
  const item = itemOf(entry, number);
  const boxes = createCardBoxes(
    deps,
    primer,
    rollback,
    itemTargets(entry, number).map((target) => ({
      ...ITEM_BOXES[target.field],
      target,
    })),
  );
  const marks: HTMLElement[] = [];
  const base = createPrimerKit(deps, 'card', rollback);
  return {
    kit: {
      ...base,
      textBox: boxes.place,
      includeMark(parent) {
        const mark = toggleMark({
          isOn: item.include,
          label: 'Include the item',
          onToggle: base.command(primerCommand('toggleInclude')),
        });
        marks.push(mark);
        return appended(parent, mark);
      },
      stepKey(parent, command) {
        return appended(
          parent,
          keyStack('primer-item-step-keys', [
            anchoredSpan(
              deps,
              rollback,
              'primer-item-step-key',
              command,
              'items',
            ),
            anchoredSpan(
              deps,
              rollback,
              'primer-item-step-key',
              command,
              'card',
            ),
          ]),
        );
      },
    },
    appendUnplacedBoxes: boxes.appendUnplaced,
    update(input, current) {
      for (const mark of marks) {
        setToggleMark(mark, input.include);
      }
      boxes.syncText(current);
    },
  };
}

// The tasks column's kit over the primer's task rows: each row `taskRow`
// draws runs `primer.selectTask` with its position on a click.
export function createTasksKit(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  rollback: RollbackDeps,
): DrawnTasksKit {
  const base = createPrimerKit(deps, 'tasks', rollback);
  const rows = new Map<number, HTMLElement>();
  const taskRowsNow = taskRows(primer);
  const kit: TasksKit = {
    ...base,
    taskRow(parent, position) {
      const node = taskRowElement(
        primer,
        taskRowsNow,
        position,
        base.command(primerCommand('selectTask'), position),
      );
      rows.set(position, node);
      return appended(parent, node);
    },
    addPrompt(parent) {
      return base.keyHint(parent, 'addExtraTask', {
        className: 'primer-add-prompt',
        label: 'add',
      });
    },
  };
  return { kit, rows };
}

// The items column's kit over the selected task's items: each row `itemRow`
// draws runs `primer.selectItem` with its item's number on a click, and its
// mark `primer.toggleIncludeAt`.
export function createItemsKit(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  rollback: RollbackDeps,
): DrawnItemsKit {
  const base = createPrimerKit(deps, 'items', rollback);
  const rows = new Map<number, HTMLElement>();
  const items = selectedEntry(primer)?.items ?? [];
  const kit: ItemsKit = {
    ...base,
    itemRow(parent, position) {
      const item = items[position];
      if (item === undefined) {
        throw new Error(`the items column has no row ${position}`);
      }
      const number = position + 1;
      const node = itemRowElement(
        item,
        number,
        base.command(primerCommand('selectItem'), number),
        base.command(primerCommand('toggleIncludeAt'), number),
      );
      rows.set(position, node);
      return appended(parent, node);
    },
  };
  return { kit, rows };
}

export function createReviewKit(
  deps: PrimerKitDeps,
  rollback: RollbackDeps,
): ReviewKit {
  return createPrimerKit(deps, 'review', rollback);
}

// The tasks column head's kit: its row pair in the tasks scope, and
// `saveStatus`, the app's status line, placed once per draw.
export function createTasksHeadKit(
  deps: PrimerKitDeps,
  saveStatus: HTMLElement,
  rollback: RollbackDeps,
): DrawnColumnHeadKit<TasksHeadKit> {
  const head = createColumnHeadKit(deps, 'tasks', rollback);
  const slot = appSlot(saveStatus, 'saveStatus', rollback);
  return {
    kit: { ...head.kit, saveStatus: (parent) => slot.place(parent) },
    rowSteps: head.rowSteps,
    placeLeftOut: (root) => slot.placeIfLeftOut(root, 'start'),
  };
}

export function createItemsHeadKit(
  deps: PrimerKitDeps,
  rollback: RollbackDeps,
): DrawnColumnHeadKit<ItemsHeadKit> {
  return createColumnHeadKit(deps, 'items', rollback);
}

// The tasks column foot's kit: `reviewKeys` anchors openReview in the tasks,
// items and card scopes, so the Review button shows its key while any of them
// has focus.
export function createTasksFootKit(
  deps: PrimerKitDeps,
  rollback: RollbackDeps,
): TasksFootKit {
  return {
    ...createPrimerKit(deps, 'tasks', rollback),
    reviewKeys: (parent) =>
      appended(
        parent,
        keyStack(
          'primer-review-keys',
          (['tasks', 'items', 'card'] as const).map((scope) =>
            anchoredSpan(
              deps,
              rollback,
              'primer-review-key',
              'openReview',
              scope,
            ),
          ),
        ),
      ),
  };
}

export function createCardEdgeKit(
  deps: PrimerKitDeps,
  rollback: RollbackDeps,
): CardEdgeKit {
  return createPrimerKit(deps, 'card', rollback);
}

export function createReviewFooterKit(
  deps: PrimerKitDeps,
  rollback: RollbackDeps,
): ReviewFooterKit {
  return createPrimerKit(deps, 'review', rollback);
}

// A column head's kit in `scope`: each `rowStep` draws `⌃H ▲ ▼ ⌃L` and is
// kept in `rowSteps`. Nothing is left out for the app to place.
function createColumnHeadKit(
  deps: PrimerKitDeps,
  scope: 'tasks' | 'items',
  rollback: RollbackDeps,
): DrawnColumnHeadKit<ItemsHeadKit> {
  const rowSteps: HTMLElement[] = [];
  const stepKey = (command: 'prevRow' | 'nextRow') =>
    anchoredSpan(deps, rollback, 'primer-column-key', command, scope);
  return {
    kit: {
      ...createPrimerKit(deps, scope, rollback),
      rowStep(parent) {
        const edge = keyEdge('primer-column-edge', [
          stepKey('prevRow'),
          keyChevron('▲'),
          keyChevron('▼'),
          stepKey('nextRow'),
        ]);
        rowSteps.push(edge);
        return appended(parent, edge);
      },
    },
    rowSteps,
    placeLeftOut: () => undefined,
  };
}

// The list row for tasks column `position`: the Feature row, or a task row
// with its need tag and count. Throws for a position `rows` lacks.
function taskRowElement(
  primer: OpenPrimer,
  rows: TaskRow[],
  position: number,
  onSelect: () => void,
): HTMLElement {
  const taskRow = rows[position];
  if (taskRow === undefined) {
    throw new Error(`the tasks column has no row ${position}`);
  }
  if (taskRow.kind === 'feature') {
    return row({
      density: 'list',
      label: 'Feature',
      detail: primer.feature.name,
      onClick: onSelect,
    });
  }
  const entry = primer.entries.find(
    (candidate) => candidate.id === taskRow.entryId,
  );
  if (entry === undefined) {
    throw new Error(`primer ${primer.formId} has no task ${taskRow.entryId}`);
  }
  return row({
    density: 'list',
    label: taskName(entry),
    trailing: taskTrailing(entry),
    onClick: onSelect,
  });
}

// A task row's need tag and `<included>/<total>` count of its items.
function taskTrailing(entry: PrimerEntry): HTMLElement {
  const trailing = element('span', 'primer-task-trailing');
  trailing.append(
    needTag(entry.need),
    element(
      'span',
      'primer-count',
      `${includedCount(entry)}/${entry.items.length}`,
    ),
  );
  return trailing;
}

// An item row: its include mark and its number leading the item text.
// `onToggle` runs on a click on the mark.
function itemRowElement(
  item: PrimerItem,
  number: number,
  onSelect: () => void,
  onToggle: () => void,
): HTMLElement {
  const lead = element('span', 'primer-item-lead');
  lead.append(
    toggleMark({ isOn: item.include, label: 'Include the item', onToggle }),
    element('span', 'primer-item-number', String(number)),
  );
  return row({
    density: 'list',
    label: item.text,
    leading: lead,
    onClick: onSelect,
  });
}

// One card draw's text boxes. `place` draws the box of `field` in its
// labelled field and records it in `rollback`; it throws for a field the card
// lacks or one already placed. `appendUnplaced` places every box `place`
// has not, in `cardBoxes` order, at the end of `card`. `syncText` sets each
// placed box's editor to its text in `current`, where the two differ.
function createCardBoxes<Field extends string>(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  rollback: RollbackDeps,
  cardBoxes: CardBox<Field>[],
): {
  place(parent: HTMLElement, field: Field): HTMLElement;
  appendUnplaced(card: HTMLElement): void;
  syncText(current: OpenPrimer): void;
} {
  const placed = new Set<Field>();
  const place = (parent: HTMLElement, field: Field) => {
    const box = cardBoxes.find((candidate) => candidate.field === field);
    if (box === undefined) {
      throw new Error(`the card has no ${field} box`);
    }
    if (placed.has(field)) {
      throw new Error(`the ${field} box is already on the card`);
    }
    placed.add(field);
    return appendField(deps, primer, rollback, parent, box);
  };
  return {
    place,
    appendUnplaced(card) {
      for (const box of cardBoxes) {
        if (!placed.has(box.field)) {
          place(card, box.field);
        }
      }
    },
    syncText(current) {
      for (const box of cardBoxes) {
        deps.boxes.setText(
          { primerId: current.formId, target: box.target },
          boxText(current, box.target),
        );
      }
    },
  };
}

// A labelled box: its label over its input frame, an anchor for its command
// in the card scope beside the label, then the `⇧⇥ ⇥` keys, which show on the
// frame's bottom edge while the box has focus.
function appendField(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  rollback: RollbackDeps,
  parent: HTMLElement,
  box: CardBox<string>,
): HTMLElement {
  const anchored = (className: string, command: PrimerCommandName) =>
    anchoredSpan(deps, rollback, className, command, 'card');
  const hint =
    box.command === null ? null : anchored('primer-field-hint', box.command);
  const field = element('div', 'primer-field');
  field.append(sectionHeader(box.label, hint));
  parent.append(field);
  const primerBox: PrimerBox = { primerId: primer.formId, target: box.target };
  const frame = deps.boxes.place(field, primerBox, boxText(primer, box.target));
  frame.classList.add('primer-box');
  field.append(
    boxHint('box-keys', [
      anchored('primer-box-key', 'prevBox'),
      anchored('primer-box-key', 'nextBox'),
    ]),
  );
  rollback.recordBox(() => deps.boxes.release(primerBox));
  return field;
}

// A `span` of `className` anchored to the primer `command` in the primer
// `scope`, its anchor recorded in `rollback`.
function anchoredSpan(
  deps: PrimerKitDeps,
  rollback: RollbackDeps,
  className: string,
  command: PrimerCommandName,
  scope: PrimerScopeName,
): HTMLElement {
  const node = element('span', className);
  rollback.recordAnchor(
    deps.keys.anchor(node, primerCommand(command), {
      scope: primerScope(scope),
    }),
  );
  return node;
}

// Item `number` (1-based) of `entry`; throws when the task has no such item.
function itemOf(entry: PrimerEntry, number: number): PrimerItem {
  const item = entry.items[number - 1];
  if (item === undefined) {
    throw new Error(`task ${entry.id} has no item ${number}`);
  }
  return item;
}
