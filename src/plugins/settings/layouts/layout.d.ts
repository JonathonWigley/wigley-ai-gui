import type {
  BaseKit,
  KitRowOptions,
  PromptActionInput,
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

// The open section's pane: its id (`core`, a plugin id, `plugins`, `keymap` for the Keybindings section, or `leader`
// for the Leader menu) and its title.
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
  // The id of the row's control kind: number, string, boolean, choice, theme,
  // json, layout, or a kind a plugin registers. A layout that does not know the kind
  // draws the row as any other.
  control: string;
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
// for the platform). `tags` in order: for a bind its scope's title unless it is `any`, `where`, `mode`, `Set` for a
// user bind, then what covers it (`Removed`, `Replaced by <label>`, `Partly removed — …`); for an accelerator its kind
// (`App menu`, `Global`, `Intercept`), then `Removed` or `Replaced by <label>`. `isStruck`: it fires nowhere.
export interface KeyLineInput {
  kind: 'bind' | 'accelerator';
  keys: string;
  tags: readonly string[];
  isStruck: boolean;
}
// A key recording in progress: `keys` the keys held so far, printed for the platform (null before an accepted press);
// `prompt` what to press next; `note` the last press's note (what the keys move from, or why a press was refused),
// `isRefused` while it refuses one.
export interface RecordingInput {
  keys: string | null;
  prompt: string;
  note: string | null;
  isRefused: boolean;
}
// A command's row in the Keybindings section: its qualified id, its label (capitalised), its manifest `group`, where it
// runs, its binds then its accelerators, and the recording on it. `recording.line` is the index into `lines` of the
// bind the recording replaces, null when it adds one; `recording` is null while the row records nothing.
export interface KeyRowInput {
  command: string;
  label: string;
  group: string;
  runsIn: 'page' | 'main';
  lines: readonly KeyLineInput[];
  recording: (RecordingInput & { line: number | null }) | null;
}
// One chip of the Keybindings section's filter bar: `count` is the command rows it would show under the `/` filter and
// the find query.
export interface KeyFilterChipInput {
  id: 'all' | 'bound' | 'unbound' | 'changed';
  label: string;
  count: number;
  isOn: boolean;
}
// The Keybindings section's filter bar: the chips in `f`'s order, and the find by key query: `keys` printed for the
// platform (null with none), `prompt` what to press while `?` waits for its key (null while it waits for none).
export interface KeyFiltersInput {
  chips: readonly KeyFilterChipInput[];
  find: { keys: string | null; prompt: string | null };
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
// A row of the list picker: `picker` is the open picker's title, `label` the row's line, `keys` the keys its item
// holds printed for the platform (null for none).
export interface PickerRowInput {
  picker: string;
  label: string;
  keys: string | null;
}

// The cursor row's prompt: the actions its row shows, in order, each a command and the word its hint draws. Draw each
// with `kit.keyHint(parent, action.command, { label: action.label })`; the kit's scope is the pane's (`rows`, or the
// Leader menu's groups or items pane), so a hint shows only while that pane holds the keys.
export interface CursorPromptInput {
  actions: readonly PromptActionInput[];
}
// The line under an open box: why a write was refused, or that the file changed on disk.
export interface BoxMessageInput {
  text: string;
}

// The Leader menu: `focused` the pane last focused, `itemsTitle` the selected group's title (`Top level`, `b — session`).
export interface LeaderPanesInput {
  focused: 'groups' | 'items';
  itemsTitle: string;
}
// A group of the Leader menu's groups pane: `prefix` its keys in vim notation (`<Leader>b`), `key` its last key printed
// for the platform (empty on Top level), `name` its `groups` name, or unnamed (`isNamed` false) its commands' manifest
// groups; `isSet` while the user's `groups` names it; `depth` 0 for Top level and its children, one more per nested
// level; `count` its entries; `recording` the key recording on it (adding a group under it), null while none.
export interface LeaderGroupRowInput {
  prefix: string;
  key: string;
  name: string;
  isNamed: boolean;
  isSet: boolean;
  depth: number;
  count: number;
  recording: RecordingInput | null;
}
// An entry of the Leader menu's items pane: a `command` bind or a nested `group`. `key` its key printed for the platform
// (`<Leader>` prints as the leader); `label` the command's label capitalised, or the nested group's name; `command` the
// qualified id with its argument, null on a group row; `tags` the scope's title unless `any`, `in a box` when only its
// box half fires, `Set` for a user bind; `recording` the key recording on it (changing or moving its key).
export interface LeaderItemRowInput {
  kind: 'command' | 'group';
  key: string;
  label: string;
  command: string | null;
  tags: readonly string[];
  recording: RecordingInput | null;
}
// The items pane's last row, which adds an item: the group's free keys printed for the platform, and the key recording
// on it.
export interface LeaderAddRowInput {
  freeKeys: readonly string[];
  recording: RecordingInput | null;
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
  // `span.settings-row-actions-slot`, which draws no box (`display: contents`): the app draws `cursorPrompt` into it
  // while the row is the cursor row.
  rowActions(parent: HTMLElement): HTMLElement;
  // A `div` the app fills with the row's open box.
  box(parent: HTMLElement): HTMLElement;
}
export interface LeaderPanesKit extends SettingsKit {
  // The base kit in the groups pane's and the items pane's scope: an edge or hint drawn with one shows only while its
  // pane holds the keys.
  groupsKit: SettingsKit;
  itemsKit: SettingsKit;
  // `ol.settings-leader-groups` and `ol.settings-leader-items`: the app replaces their children with the group rows,
  // and the selected group's item rows then its add row, on each draw, and marks each `is-pane-inactive` while the
  // other pane or the side bar holds the keys.
  groupRows(parent: HTMLElement): HTMLElement;
  itemRows(parent: HTMLElement): HTMLElement;
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
  // One per command in the Keybindings section.
  keyRow?(parent: HTMLElement, input: KeyRowInput, kit: RowKit): HTMLElement;
  // The Keybindings section's first entry, into `rowList`, on each draw of its rows.
  keyFilters?(
    parent: HTMLElement,
    input: KeyFiltersInput,
    kit: SettingsKit,
  ): HTMLElement;
  // The Keybindings section's first row.
  leaderRow?(
    parent: HTMLElement,
    input: LeaderRowInput,
    kit: RowKit,
  ): HTMLElement;
  // The Keybindings section's last row, drawn under the `all` chip with no `/`
  // filter or find query.
  advancedRow?(
    parent: HTMLElement,
    input: AdvancedRowInput,
    kit: RowKit,
  ): HTMLElement;
  // Over each plugin's command rows in the Keybindings section, and over a find by key query's rows.
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
  // The Leader menu, drawn into `rowList` on each draw of its rows: the groups pane beside the selected group's items.
  leaderPanes?(
    parent: HTMLElement,
    input: LeaderPanesInput,
    kit: LeaderPanesKit,
  ): SettingsPane;
  // One per group, into `groupRows`.
  leaderGroupRow?(
    parent: HTMLElement,
    input: LeaderGroupRowInput,
    kit: RowKit,
  ): HTMLElement;
  // One per entry of the selected group, into `itemRows`.
  leaderItemRow?(
    parent: HTMLElement,
    input: LeaderItemRowInput,
    kit: RowKit,
  ): HTMLElement;
  // The last row of `itemRows`.
  leaderAddRow?(
    parent: HTMLElement,
    input: LeaderAddRowInput,
    kit: RowKit,
  ): HTMLElement;
  // One per item of the open list picker, into the picker's list, on each draw of the picker.
  pickerRow?(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): HTMLElement;
  // The cursor row's action keys, into its `rowActions` slot, drawn again only when the cursor reaches another row or
  // the row's actions change, so a cursor move draws no row again. A layout that leaves it out draws it with
  // `default`; a `cursorPrompt` that draws no hint shows no prompt: the app places none of its own.
  cursorPrompt?(
    parent: HTMLElement,
    input: CursorPromptInput,
    kit: SettingsKit,
  ): HTMLElement;
  // The message under an open box, into the box's message slot (`div.settings-box-message-slot`, which draws no box)
  // each time the box shows one, and again after a layout change. A layout that leaves it out draws it with
  // `default`; a `boxMessage` that draws no text shows no message: the app places none of its own.
  boxMessage?(
    parent: HTMLElement,
    input: BoxMessageInput,
    kit: SettingsKit,
  ): HTMLElement;
}

// The built-in `default` layout, which defines every part.
export interface CompleteSettingsLayout extends Required<SettingsLayout> {}
