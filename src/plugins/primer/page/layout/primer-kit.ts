import { appended, element } from '../../../../shared/page/dom';
import type { EditorBoxes } from '../../../../shared/page/editor-boxes';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { boxHint, keyStack } from '../../../../shared/page/ui/key-anchors';
import { inputFrame } from '../../../../shared/page/ui/input-frame';
import { row } from '../../../../shared/page/ui/row';
import { sectionHeader } from '../../../../shared/page/ui/section-header';
import {
  setToggleMark,
  toggleMark,
} from '../../../../shared/page/ui/toggle-mark';
import type { PrimerEntry, PrimerItem } from '../../contract';
import {
  type PrimerCommandName,
  primerCommand,
  primerScope,
  type PrimerScopeName,
} from '../../ids';
import type {
  FeatureCardInput,
  FeatureKit,
  ItemCardInput,
  ItemKit,
  PrimerKit,
  RailKit,
  ReviewKit,
  TaskCardInput,
  TaskKit,
} from '../../layouts/layout';
import { primerManifest } from '../../manifest';
import {
  boxText,
  type PrimerBox,
  type TaskTarget,
  taskTargets,
} from '../boxes';
import { needTag, taskName } from '../primer-review';
import {
  FEATURE_FIELDS,
  includedCount,
  type OpenPrimer,
  type PrimerAction,
  railRows,
  type TextTarget,
} from '../primer-state';

// What every primer kit reads: the keys plugin's `anchor` and `keysFor`, the
// commands a kit's `command` reaches, and the platform its key hints draw for.
export type PrimerKitDeps = OwnerKitServices;

// What the card and rail kits act through besides: the text boxes and the
// store.
export interface PrimerPartKitDeps extends PrimerKitDeps {
  boxes: Pick<EditorBoxes<PrimerBox>, 'mount' | 'destroyBox'>;
  dispatch(action: PrimerAction): void;
}

// A card's kit and what the app does around the layout's card: append the
// boxes the card left out at its end, and bring the kit's own parts up to date
// with the card's input.
export interface CardKit<K, Input> {
  kit: K;
  appendUnmountedBoxes(card: HTMLElement): void;
  update(input: Input): void;
}

// The rail's kit and the row element `railRow` drew at each position.
export interface DrawnRailKit {
  kit: RailKit;
  rows: Map<number, HTMLElement>;
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
    kit: { ...createPrimerKit(deps, 'card', rollback), textBox: boxes.mount },
    appendUnmountedBoxes: boxes.appendUnmounted,
    update: () => undefined,
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
    kit: { ...createPrimerKit(deps, 'card', rollback), textBox: boxes.mount },
    appendUnmountedBoxes: boxes.appendUnmounted,
    update: () => undefined,
  };
}

// The kit of item `number` (1-based) of `entry`. Each include mark it drew
// shows the item's include on each `update`.
export function createItemKit(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  entry: PrimerEntry,
  number: number,
  rollback: RollbackDeps,
): CardKit<ItemKit, ItemCardInput> {
  const item = itemOf(entry, number);
  const boxes = createCardBoxes(deps, primer, rollback, [
    {
      field: 'comment',
      target: { field: 'itemComment', entryId: entry.id, item: number },
      label: 'Comment',
      command: 'editItemComment',
    },
  ]);
  const marks: HTMLElement[] = [];
  return {
    kit: {
      ...createPrimerKit(deps, 'card', rollback),
      textBox: boxes.mount,
      includeMark(parent) {
        const mark = toggleMark({
          isOn: item.include,
          label: 'Include the item',
          onToggle: () => deps.dispatch({ type: 'toggleInclude' }),
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
              'rail',
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
    appendUnmountedBoxes: boxes.appendUnmounted,
    update(input) {
      for (const mark of marks) {
        setToggleMark(mark, input.include);
      }
    },
  };
}

// The rail's kit over the primer's rail rows: each row `railRow` draws
// selects its row on a click, and an item row's mark selects and toggles its
// item.
export function createRailKit(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  rollback: RollbackDeps,
): DrawnRailKit {
  const base = createPrimerKit(deps, 'rail', rollback);
  const rows = new Map<number, HTMLElement>();
  const railRowsNow = railRows(primer);
  const select = (position: number) => () =>
    deps.dispatch({ type: 'selectRow', row: position });
  const kit: RailKit = {
    ...base,
    railRow(parent, position) {
      const node = railRowElement(primer, railRowsNow, position, select, () => {
        select(position)();
        deps.dispatch({ type: 'toggleInclude' });
      });
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

export function createReviewKit(
  deps: PrimerKitDeps,
  rollback: RollbackDeps,
): ReviewKit {
  return createPrimerKit(deps, 'review', rollback);
}

// The list row for rail `position`: the Feature row, a task row with its need
// tag and count, or an item row led by its mark and number. Throws for a
// position `rows` lacks.
function railRowElement(
  primer: OpenPrimer,
  rows: ReturnType<typeof railRows>,
  position: number,
  select: (position: number) => () => void,
  toggle: () => void,
): HTMLElement {
  const railRow = rows[position];
  if (railRow === undefined) {
    throw new Error(`the rail has no row ${position}`);
  }
  if (railRow.kind === 'feature') {
    return row({
      density: 'list',
      label: 'Feature',
      detail: primer.feature.name,
      onClick: select(position),
    });
  }
  const entry = primer.entries.find(
    (candidate) => candidate.id === railRow.entryId,
  );
  if (entry === undefined) {
    throw new Error(`primer ${primer.formId} has no task ${railRow.entryId}`);
  }
  if (railRow.kind === 'task') {
    return row({
      density: 'list',
      label: taskName(entry),
      trailing: railTrailing(entry),
      onClick: select(position),
    });
  }
  return railItemRow(
    itemOf(entry, railRow.item),
    railRow.item,
    select(position),
    toggle,
  );
}

// A task row's need tag and `<included>/<total>` count of its items.
function railTrailing(entry: PrimerEntry): HTMLElement {
  const trailing = element('span', 'primer-rail-trailing');
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
function railItemRow(
  item: PrimerItem,
  number: number,
  onSelect: () => void,
  onToggle: () => void,
): HTMLElement {
  const lead = element('span', 'primer-rail-item-lead');
  lead.append(
    toggleMark({ isOn: item.include, label: 'Include the item', onToggle }),
    element('span', 'primer-item-number', String(number)),
  );
  return row({
    density: 'list',
    depth: 1,
    label: item.text,
    leading: lead,
    onClick: onSelect,
  });
}

// One card draw's text boxes. `mount` draws the box of `field` in its
// labelled field and records it in `rollback`; it throws for a field the card
// lacks or one already mounted. `appendUnmounted` mounts every box `mount`
// has not, in `cardBoxes` order, at the end of `card`.
function createCardBoxes<Field extends string>(
  deps: PrimerPartKitDeps,
  primer: OpenPrimer,
  rollback: RollbackDeps,
  cardBoxes: CardBox<Field>[],
): {
  mount(parent: HTMLElement, field: Field): HTMLElement;
  appendUnmounted(card: HTMLElement): void;
} {
  const mounted = new Set<Field>();
  const mount = (parent: HTMLElement, field: Field) => {
    const box = cardBoxes.find((candidate) => candidate.field === field);
    if (box === undefined) {
      throw new Error(`the card has no ${field} box`);
    }
    if (mounted.has(field)) {
      throw new Error(`the ${field} box is already on the card`);
    }
    mounted.add(field);
    return appendField(deps, primer, rollback, parent, box);
  };
  return {
    mount,
    appendUnmounted(card) {
      for (const box of cardBoxes) {
        if (!mounted.has(box.field)) {
          mount(card, box.field);
        }
      }
    },
  };
}

// A labelled box: its label over its input frame, an anchor for its command
// in the card scope beside the label, then the `⌃P ⌃N` keys, which show on the
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
  const frame = inputFrame();
  frame.classList.add('primer-box');
  field.append(
    sectionHeader(box.label, hint),
    frame,
    boxHint('box-keys', [
      anchored('primer-box-key', 'prevBox'),
      anchored('primer-box-key', 'nextBox'),
    ]),
  );
  parent.append(field);
  const primerBox: PrimerBox = { primerId: primer.formId, target: box.target };
  deps.boxes.mount(frame, primerBox, boxText(primer, box.target));
  rollback.recordBox(() => deps.boxes.destroyBox(primerBox));
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
