import type {
  BaseKit,
  KitRowOptions,
} from '../../../shared/page/layout-host/kit';

// The row options, for a layout's JSDoc to import from here.
export type { KitRowOptions };

// Settings mode's layout contract. Every part appends its root element to `parent` and returns it; the app sets
// `data-layout="<name>"` and `data-layout-owner="settings"` on that root. The app keeps the reads and writes, the
// cursor (`is-selected`, `is-cursor`, `is-pane-inactive`), the keys, the scrolling, the filter box, a row's open box
// and the list picker's panel.

// What a pane part returns: its root element.
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

// The settings parts every kit holds, beside the base kit's.
export interface SettingsKit extends BaseKit {
  // `span.ui-row-trailing`, appended to `row`.
  rowTrailing(row: HTMLElement): HTMLElement;
  // `span.ui-key-edge.settings-edge.settings-edge--<side>`: a focus move's keys for the settings `command`. `end`
  // draws `<keys> <label> ›`, `start` draws `‹ <label> <keys>`.
  edgePrompt(
    parent: HTMLElement,
    side: 'start' | 'end',
    command: string,
    label: string,
  ): HTMLElement;
}

// Slots: each appends an element the app fills and returns it. A slot the part leaves out, the app appends at the end
// of the part's root.

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
  // A `span` the app fills with the cursor prompt (`span.settings-row-actions`) while the row is the cursor row. Left
  // out: the prompt goes at the end of the row's root.
  rowActions(parent: HTMLElement): HTMLElement;
  // A `div` the app fills with the row's open box. Left out: the box goes at the end of the row's root.
  box(parent: HTMLElement): HTMLElement;
}
export interface PickerRowKit extends SettingsKit {
  // The app's element for the end of the cursor row, or null on every other row; pass it as
  // `KitRowOptions.trailing`. One the part leaves out, the app appends in a `rowTrailing` at the end of the row's
  // root. The picker sets `title`, `is-selected`, `is-cursor` and the click on the root, so the row takes no
  // `onClick`.
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
  // One per section, into `sectionRows`, on each draw of the side bar.
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
export interface CompleteSettingsLayout extends SettingsLayout {
  sections(parent: HTMLElement, kit: SectionsKit): SettingsPane;
  rows(parent: HTMLElement, input: RowsInput, kit: RowsKit): SettingsPane;
  sectionRow(
    parent: HTMLElement,
    input: SectionRowInput,
    kit: SettingsKit,
  ): HTMLElement;
  settingRow(
    parent: HTMLElement,
    input: SettingRowInput,
    kit: RowKit,
  ): HTMLElement;
  keyRow(parent: HTMLElement, input: KeyRowInput, kit: RowKit): HTMLElement;
  leaderRow(
    parent: HTMLElement,
    input: LeaderRowInput,
    kit: RowKit,
  ): HTMLElement;
  advancedRow(
    parent: HTMLElement,
    input: AdvancedRowInput,
    kit: RowKit,
  ): HTMLElement;
  groupHeader(
    parent: HTMLElement,
    input: GroupHeaderInput,
    kit: SettingsKit,
  ): HTMLElement;
  empty(parent: HTMLElement, input: EmptyInput, kit: SettingsKit): HTMLElement;
  problem(
    parent: HTMLElement,
    input: ProblemInput,
    kit: SettingsKit,
  ): HTMLElement;
  pickerRow(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): HTMLElement;
}
