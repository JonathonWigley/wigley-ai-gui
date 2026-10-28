import { appended, element } from '../../../../shared/page/dom';
import { appSlot } from '../../../../shared/page/layout-host/app-slot';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import {
  type RollbackDeps,
  requireElementIn,
} from '../../../../shared/page/layout-host/draw-part';
import { keyStack } from '../../../../shared/page/ui/key-anchors';
import type {
  CompleteSettingsLayout,
  PickerRowInput,
  PickerRowKit,
  RowKit,
  RowsInput,
  RowsKit,
  SectionsKit,
  SettingsKit,
} from '../../layouts/layout';
import { settingsManifest } from '../../manifest';

// The settings scope a part's keys fire in.
export type SettingsKitScope = 'sections' | 'rows' | 'picker';

// The kit one part draw builds with: the base kit in the settings `scope`,
// naming settings' own commands by their short names. Each anchor it names is
// recorded in `rollback`.
export function createSettingsKit(
  services: OwnerKitServices,
  scope: SettingsKitScope,
  rollback: RollbackDeps,
): SettingsKit {
  return createBaseKit(
    ownerBaseKitDeps(settingsManifest, services, scope, rollback),
  );
}

// A drawn side bar pane: its root and its section rows slot.
export interface BuiltSectionsPane {
  element: HTMLElement;
  sectionRows: HTMLElement;
}

// A drawn rows pane: its root, and the slots the app fills on each draw.
export interface BuiltRowsPane {
  element: HTMLElement;
  problem: HTMLElement;
  rowList: HTMLElement;
}

// A drawn row: its root, and the slots for the cursor prompt and the open
// box, each placed in the row.
export interface BuiltRow {
  element: HTMLElement;
  actions: HTMLElement;
  box: HTMLElement;
}

type Builder<K extends keyof CompleteSettingsLayout> =
  CompleteSettingsLayout[K];

// Draws the side bar with `sections`; a section rows slot it leaves out is
// appended at the end of its root.
export function buildSectionsPane(
  sections: Builder<'sections'>,
  parent: HTMLElement,
  services: OwnerKitServices,
  rollback: RollbackDeps,
): BuiltSectionsPane {
  const sectionRows = element('ol', 'settings-section-rows');
  const sectionRowsSlot = appSlot(sectionRows, 'sectionRows', rollback);
  const kit: SectionsKit = {
    ...createSettingsKit(services, 'sections', rollback),
    sectionRows: (slotParent) => sectionRowsSlot.place(slotParent),
  };
  const root = paneRoot(sections(parent, kit), parent, 'sections');
  sectionRowsSlot.placeIfLeftOut(root);
  return { element: root, sectionRows };
}

// Draws the open section's pane with `rows`, placing `filterFrame` in its
// filter box slot; a slot it leaves out is appended at the end of its root.
// The filter hint's anchors name the `filter` command in the sections and
// rows scopes.
export function buildRowsPane(
  rows: Builder<'rows'>,
  parent: HTMLElement,
  input: RowsInput,
  filterFrame: HTMLElement,
  services: OwnerKitServices,
  rollback: RollbackDeps,
): BuiltRowsPane {
  const problem = element('div', 'settings-broken');
  const rowList = element('ol', 'settings-rows');
  const slots = [
    appSlot(filterFrame, 'filterBox', rollback),
    appSlot(problem, 'problem', rollback),
    appSlot(rowList, 'rowList', rollback),
  ] as const;
  const [filterBoxSlot, problemSlot, rowListSlot] = slots;
  const sectionsKit = createSettingsKit(services, 'sections', rollback);
  const settingsKit = createSettingsKit(services, 'rows', rollback);
  const kit: RowsKit = {
    ...settingsKit,
    filterHint(slotParent) {
      const hint = appended(slotParent, keyStack('settings-filter-hint', []));
      sectionsKit.keyHint(hint, 'filter', { label: 'filter' });
      settingsKit.keyHint(hint, 'filter', { label: 'filter' });
      return hint;
    },
    filterBox: (slotParent) => filterBoxSlot.place(slotParent),
    problem: (slotParent) => problemSlot.place(slotParent),
    rowList: (slotParent) => rowListSlot.place(slotParent),
  };
  const root = paneRoot(rows(parent, input, kit), parent, 'rows');
  for (const slot of slots) {
    slot.placeIfLeftOut(root);
  }
  return { element: root, problem, rowList };
}

// Draws a setting, key, leader or advanced row with `draw`; a slot it leaves
// out is appended at the end of its root.
export function buildRow<I>(
  draw: (parent: HTMLElement, input: I, kit: RowKit) => HTMLElement,
  parent: HTMLElement,
  input: I,
  services: OwnerKitServices,
  rollback: RollbackDeps,
  partName: string,
): BuiltRow {
  const actions = element('span', 'settings-row-actions-slot');
  const box = element('div');
  const actionsSlot = appSlot(actions, 'rowActions', rollback);
  const boxSlot = appSlot(box, 'box', rollback);
  const kit: RowKit = {
    ...createSettingsKit(services, 'rows', rollback),
    rowActions: (slotParent) => actionsSlot.place(slotParent),
    box: (slotParent) => boxSlot.place(slotParent),
  };
  const root = requireElementIn(parent, draw(parent, input, kit), partName);
  actionsSlot.placeIfLeftOut(root);
  boxSlot.placeIfLeftOut(root);
  return { element: root, actions, box };
}

// Draws a section row, group header, empty state or problem card with
// `draw`, in the kit of `scope`.
export function buildEntry<I>(
  draw: (parent: HTMLElement, input: I, kit: SettingsKit) => HTMLElement,
  parent: HTMLElement,
  input: I,
  scope: SettingsKitScope,
  services: OwnerKitServices,
  rollback: RollbackDeps,
): { element: HTMLElement } {
  return {
    element: draw(parent, input, createSettingsKit(services, scope, rollback)),
  };
}

// Draws a list picker row with `pickerRow`; a cursor row element `trailing`
// its root does not hold is appended in a `rowTrailing` at the end of it.
export function buildPickerRow(
  pickerRow: Builder<'pickerRow'>,
  parent: HTMLElement,
  input: PickerRowInput,
  trailing: HTMLElement | null,
  services: OwnerKitServices,
  rollback: RollbackDeps,
): { element: HTMLElement } {
  const kit: PickerRowKit = {
    ...createSettingsKit(services, 'picker', rollback),
    trailing: () => trailing,
  };
  const root = requireElementIn(
    parent,
    pickerRow(parent, input, kit),
    'pickerRow',
  );
  if (trailing !== null && !root.contains(trailing)) {
    kit.rowTrailing(root).append(trailing);
  }
  return { element: root };
}

// A pane's checked root, from what its part returned.
function paneRoot(
  pane: { element: HTMLElement } | null | undefined,
  parent: HTMLElement,
  partName: string,
): HTMLElement {
  return requireElementIn(parent, pane?.element, partName);
}
