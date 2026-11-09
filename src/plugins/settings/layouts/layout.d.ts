import type {
  BaseKit,
  KitRowOptions,
} from '../../../shared/page/layout-host/kit';

// The row options, for a layout's JSDoc to import from here.
export type { KitRowOptions };

// Settings mode's layout contract. Every part appends its root element to `parent`; a pane part returns
// `{ element }` holding it, every other part returns it. The app sets `data-layout="<name>"` and
// `data-layout-owner="settings"` on that root. The app keeps the reads and writes, the cursor (`is-selected`,
// `is-cursor`, `is-pane-inactive`), the keys, the scrolling, the filter box, a row's open box and the list picker's
// panel.

// What a pane part returns: its root element. The root sits in the app's container, a flex column; `default`'s is
// `div.settings-pane`, which draws no box (`display: contents`), so its parts lay out as the container's children. A
// user pane root takes that class for the same flow.
export interface SettingsPane {
  element: HTMLElement;
}

// The open section's pane: its id (`core`, a plugin id, or `keymap`) and its title.
export interface RowsInput {
  sectionId: string;
  title: string;
}
export interface SectionRowInput {
  id: string;
  title: string;
}
export interface SettingRowInput {
  // The dotted path, as `settings.json` nests it.
  path: string;
  label: string;
  description: string;
  // The value in force as text: `Not set` when unset.
  value: string;
  // The value is undefined or null.
  isUnset: boolean;
  // The user set it: a `Set` tag.
  isSet: boolean;
  // The default as text, shown after the `Set` tag; null when the row draws no default.
  defaultText: string | null;
  control: 'number' | 'string' | 'boolean' | 'choice' | 'theme' | 'json';
}
// One plugin's row in the Plugins section.
export interface PluginRowInput {
  id: string;
  label: string;
  description: string;
  // `true` while a version of it runs, `false` while none does, as the
  // boolean picker shows them.
  value: 'true' | 'false';
  // `Needed by <label>, <label>` while plugins that run depend on it, and
  // `Edit settings.json to turn off` on Settings' own row while it runs; else
  // null.
  lockedText: string | null;
  // `user` or `replaces built-in`; null for a built-in.
  originText: string | null;
  // Why the plugin failed to load or start; null when it did not fail.
  problem: string | null;
}
// One line of a key row: a bind (`keys` in vim notation printed for the platform) or an accelerator (its chord printed
// for the platform). `tags` in order: for a bind its scope (`Everywhere` for `any`), `where`, `mode`, `Set` for a user
// bind, then what covers it (`Removed`, `Replaced by <label>`, `Partly removed — …`); for an accelerator its kind
// (`App menu`, `Global`, `Intercept`), then `Removed` or `Replaced by <label>`. `isStruck`: it fires nowhere.
export interface KeyLineInput {
  kind: 'bind' | 'accelerator';
  keys: string;
  tags: readonly string[];
  isStruck: boolean;
}
// A command's row: its qualified id, its label (capitalised), where it runs, and its binds then its accelerators.
export interface KeyRowInput {
  command: string;
  label: string;
  runsIn: 'page' | 'main';
  lines: readonly KeyLineInput[];
}
// The leader row: the leader in force and the default leader, each printed for the platform.
export interface LeaderRowInput {
  keys: string;
  defaultKeys: string;
  isSet: boolean;
}
// The advanced row: `isSet` while the user's keymap holds any advanced entry.
export interface AdvancedRowInput {
  isSet: boolean;
}
// A plugin's header over its command rows.
export interface GroupHeaderInput {
  title: string;
}
// The filter matched no row.
export interface EmptyInput {
  query: string;
}
// The open section's file failed its check; the section refuses edits until it is fixed.
export interface ProblemInput {
  file: 'settings.json' | 'keymap.json';
  problem: string;
}
// A row of the list picker: `picker` is the open picker's title, `label` the row's line.
export interface PickerRowInput {
  picker: string;
  label: string;
}

// The kit every settings part draws with: the base kit, naming settings' commands by their short names. `default`
// adds `settings-edge settings-edge--<side>` to each `edge` it draws.
export interface SettingsKit extends BaseKit {}

// Slots: each appends an element the app fills and returns it. A slot the part leaves out, the app appends at the end
// of the part's root; a slot called twice fails the part.

export interface SectionsKit extends SettingsKit {
  // `ol.settings-section-rows`: the app replaces its children with a `sectionRow` per section on each draw.
  sectionRows(parent: HTMLElement): HTMLElement;
}
export interface RowsKit extends SettingsKit {
  // `span.ui-key-stack.settings-filter-hint`: the `filter` keys of the sections and rows scopes in one cell, so the
  // one in force never moves.
  filterHint(parent: HTMLElement): HTMLElement;
  // Places the app's filter frame (`settings-filter`) and returns it. The app keeps the one frame and its input
  // across every redraw, and shows it while a filter is typed or kept.
  filterBox(parent: HTMLElement): HTMLElement;
  // `div.settings-broken`: the app replaces its children with the `problem` part while the section's file is broken.
  problem(parent: HTMLElement): HTMLElement;
  // `ol.settings-rows`: the app replaces its children with the section's rows, group headers and `empty` on each
  // draw.
  rowList(parent: HTMLElement): HTMLElement;
}
export interface RowKit extends SettingsKit {
  // `span.settings-row-actions-slot`, which draws no box (`display: contents`): the app fills it with the cursor
  // prompt (`span.settings-row-actions`) while the row is the cursor row.
  rowActions(parent: HTMLElement): HTMLElement;
  // A `div` the app fills with the row's open box.
  box(parent: HTMLElement): HTMLElement;
}
export interface PickerRowKit extends SettingsKit {
  // The app's element for the end of the cursor row, or null on every other row; pass it as
  // `KitRowOptions.trailing`. One the row's root does not hold, the app appends in a `rowTrailing` at the end of the
  // root. The picker sets `title`, `is-selected`, `is-cursor`, `ui-row--action`, a mousedown that takes no focus and
  // the click on the root, so the row takes no `onClick`.
  trailing(): HTMLElement | null;
}

// A layout defines only the parts it changes; each part comes from the `settings.layout` setting's layout when it
// defines the part, else from `default`. A part that throws, or returns no element appended to `parent`, is drawn by
// `default` instead.
export interface SettingsLayout {
  // The side bar, drawn into `div.settings-sections` once per layout set.
  sections?(parent: HTMLElement, kit: SectionsKit): SettingsPane;
  // The open section, drawn into the rows sheet once per layout set and per opened section.
  rows?(parent: HTMLElement, input: RowsInput, kit: RowsKit): SettingsPane;
  // One per section, into `sectionRows`, on each draw of the side bar. The app adds `ui-row--action`, a mousedown that
  // takes no focus and the click that opens the section to its root, so the row takes no `onClick`.
  sectionRow?(
    parent: HTMLElement,
    input: SectionRowInput,
    kit: SettingsKit,
  ): HTMLElement;
  // One per setting, into `rowList`, on each draw of the rows.
  settingRow?(
    parent: HTMLElement,
    input: SettingRowInput,
    kit: RowKit,
  ): HTMLElement;
  // One per plugin, into rowList, in the Plugins section.
  pluginRow?(
    parent: HTMLElement,
    input: PluginRowInput,
    kit: RowKit,
  ): HTMLElement;
  // One per command in the Keymap section.
  keyRow?(parent: HTMLElement, input: KeyRowInput, kit: RowKit): HTMLElement;
  // The Keymap section's first row.
  leaderRow?(
    parent: HTMLElement,
    input: LeaderRowInput,
    kit: RowKit,
  ): HTMLElement;
  // The Keymap section's last row, drawn while no filter is kept.
  advancedRow?(
    parent: HTMLElement,
    input: AdvancedRowInput,
    kit: RowKit,
  ): HTMLElement;
  // Over each plugin's command rows in the Keymap section.
  groupHeader?(
    parent: HTMLElement,
    input: GroupHeaderInput,
    kit: SettingsKit,
  ): HTMLElement;
  // Drawn in place of the rows while a filter matches none.
  empty?(parent: HTMLElement, input: EmptyInput, kit: SettingsKit): HTMLElement;
  // Into `problem`, while the open section's file is broken.
  problem?(
    parent: HTMLElement,
    input: ProblemInput,
    kit: SettingsKit,
  ): HTMLElement;
  // One per item of the open list picker, into the picker's list, on each draw of the picker.
  pickerRow?(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): HTMLElement;
}

// The built-in `default` layout, which defines every part.
export interface CompleteSettingsLayout extends Required<SettingsLayout> {}
