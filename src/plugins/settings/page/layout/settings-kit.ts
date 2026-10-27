import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { Platform } from '../../../../contracts/platform';
import { qualify } from '../../../../shared/plugin-manifests';
import { element } from '../../../../shared/page/dom';
import {
  createBaseKit,
  type KitCommands,
} from '../../../../shared/page/layout-host/base-kit';
import {
  type RollbackDeps,
  requireElementIn,
} from '../../../../shared/page/layout-host/draw-part';
import {
  keyChevron,
  keyEdge,
  keyStack,
} from '../../../../shared/page/ui/key-anchors';
import type { KeysPageExports } from '../../../keys/contract';
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

// What a settings kit reads: the keys plugin's `anchor` and `keysFor`, and the
// commands its `command` reaches.
export interface SettingsKitDeps {
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
  commands: KitCommands;
  platform: Platform;
}

// The settings scope a part's keys fire in.
export type SettingsKitScope = 'sections' | 'rows' | 'picker';

// The kit one part draw builds with: the base kit in the qualified `scope`,
// naming settings' own commands by their short names, plus the settings
// parts. Each anchor it names is recorded in `rollback`.
export function createSettingsKit(
  deps: SettingsKitDeps,
  scope: SettingsKitScope,
  rollback: RollbackDeps,
): SettingsKit {
  const base = createBaseKit({
    markdown: deps.markdown,
    keys: {
      anchor(node, command, options) {
        const anchor = deps.keys.anchor(node, command, options);
        rollback.recordAnchor(anchor);
        return anchor;
      },
      keysFor: (command, viewScope) => deps.keys.keysFor(command, viewScope),
    },
    commands: deps.commands,
    scope: qualify(settingsManifest.id, scope),
    commandNamed: (short) =>
      Object.hasOwn(settingsManifest.commands, short)
        ? qualify(settingsManifest.id, short)
        : null,
    platform: deps.platform,
  });
  return {
    ...base,
    rowTrailing: (row) => appended(row, element('span', 'ui-row-trailing')),
    edgePrompt(parent, side, command, label) {
      const edge = appended(
        parent,
        keyEdge(`settings-edge settings-edge--${side}`, []),
      );
      if (side === 'start') {
        edge.append(keyChevron(`‹ ${label}`));
        base.keyHint(edge, command);
      } else {
        base.keyHint(edge, command, { label });
        edge.append(keyChevron('›'));
      }
      return edge;
    },
  };
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
// box, null for each the row left out.
export interface BuiltRow {
  element: HTMLElement;
  actions: HTMLElement | null;
  box: HTMLElement | null;
}

type Builder<K extends keyof CompleteSettingsLayout> =
  CompleteSettingsLayout[K];

// Draws the side bar with `sections`; a section rows slot it leaves out is
// appended at the end of its root.
export function buildSectionsPane(
  sections: Builder<'sections'>,
  parent: HTMLElement,
  deps: SettingsKitDeps,
  rollback: RollbackDeps,
): BuiltSectionsPane {
  const slots: { sectionRows: HTMLElement | null } = { sectionRows: null };
  const kit: SectionsKit = {
    ...createSettingsKit(deps, 'sections', rollback),
    sectionRows(slotParent) {
      slots.sectionRows = appended(
        slotParent,
        element('ol', 'settings-section-rows'),
      );
      return slots.sectionRows;
    },
  };
  const root = paneRoot(sections(parent, kit), parent, 'sections');
  return {
    element: root,
    sectionRows: slots.sectionRows ?? kit.sectionRows(root),
  };
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
  deps: SettingsKitDeps,
  rollback: RollbackDeps,
): BuiltRowsPane {
  const slots: {
    filterBox: HTMLElement | null;
    problem: HTMLElement | null;
    rowList: HTMLElement | null;
  } = { filterBox: null, problem: null, rowList: null };
  const sectionsKit = createSettingsKit(deps, 'sections', rollback);
  const settingsKit = createSettingsKit(deps, 'rows', rollback);
  const kit: RowsKit = {
    ...settingsKit,
    filterHint(slotParent) {
      const hint = appended(slotParent, keyStack('settings-filter-hint', []));
      sectionsKit.keyHint(hint, 'filter', { label: 'filter' });
      settingsKit.keyHint(hint, 'filter', { label: 'filter' });
      return hint;
    },
    filterBox(slotParent) {
      slots.filterBox = appended(slotParent, filterFrame);
      return filterFrame;
    },
    problem(slotParent) {
      slots.problem = appended(slotParent, element('div', 'settings-broken'));
      return slots.problem;
    },
    rowList(slotParent) {
      slots.rowList = appended(slotParent, element('ol', 'settings-rows'));
      return slots.rowList;
    },
  };
  const root = paneRoot(rows(parent, input, kit), parent, 'rows');
  if (slots.filterBox === null) {
    kit.filterBox(root);
  }
  return {
    element: root,
    problem: slots.problem ?? kit.problem(root),
    rowList: slots.rowList ?? kit.rowList(root),
  };
}

// Draws a setting, key, leader or advanced row with `draw`; the slots it
// leaves out are null, and the app puts their contents at the end of its root.
export function buildRow<I>(
  draw: (parent: HTMLElement, input: I, kit: RowKit) => HTMLElement,
  parent: HTMLElement,
  input: I,
  deps: SettingsKitDeps,
  rollback: RollbackDeps,
  partName: string,
): BuiltRow {
  const slots: { actions: HTMLElement | null; box: HTMLElement | null } = {
    actions: null,
    box: null,
  };
  const kit: RowKit = {
    ...createSettingsKit(deps, 'rows', rollback),
    rowActions(slotParent) {
      const actions = appended(slotParent, element('span'));
      // The slot draws no box, so an empty one adds no gap to its line.
      actions.style.display = 'contents';
      slots.actions = actions;
      return actions;
    },
    box(slotParent) {
      slots.box = appended(slotParent, element('div'));
      return slots.box;
    },
  };
  const root = requireElementIn(parent, draw(parent, input, kit), partName);
  return { element: root, ...slots };
}

// Draws a section row, group header, empty state or problem card with
// `draw`, in the kit of `scope`.
export function buildEntry<I>(
  draw: (parent: HTMLElement, input: I, kit: SettingsKit) => HTMLElement,
  parent: HTMLElement,
  input: I,
  scope: SettingsKitScope,
  deps: SettingsKitDeps,
  rollback: RollbackDeps,
): { element: HTMLElement } {
  return {
    element: draw(parent, input, createSettingsKit(deps, scope, rollback)),
  };
}

// Draws a list picker row with `pickerRow`; a cursor row element `trailing`
// it leaves unplaced is appended in a trailing span at the end of its root.
export function buildPickerRow(
  pickerRow: Builder<'pickerRow'>,
  parent: HTMLElement,
  input: PickerRowInput,
  trailing: HTMLElement | null,
  deps: SettingsKitDeps,
  rollback: RollbackDeps,
): { element: HTMLElement } {
  let isTrailingPlaced = false;
  const kit: PickerRowKit = {
    ...createSettingsKit(deps, 'picker', rollback),
    trailing() {
      isTrailingPlaced = true;
      return trailing;
    },
  };
  const root = requireElementIn(
    parent,
    pickerRow(parent, input, kit),
    'pickerRow',
  );
  if (trailing !== null && !isTrailingPlaced) {
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

function appended<E extends HTMLElement>(parent: HTMLElement, node: E): E {
  parent.append(node);
  return node;
}
