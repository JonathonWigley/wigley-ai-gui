import type { CommandKey } from '../../../contracts/commands';
import type { PluginStatus } from '../../../contracts/core-state';
import type { Disposable } from '../../../contracts/disposable';
import type { EditorHost } from '../../../contracts/editor';
import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { ListPickerService } from '../../../contracts/list-picker';
import type { UserKeymap } from '../../../contracts/keymap';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { FocusTarget } from '../../../contracts/panes';
import type { OsName } from '../../../contracts/platform';
import type { LayoutState } from '../../../contracts/state';
import type {
  KeyHints,
  PageChannel,
  PushedScope,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import type {
  ConfigWriteResult,
  UserConfigRead,
  UserConfigSchema,
} from '../../../contracts/user-config';
import { errorText } from '../../../shared/error-text';
import { isSameJson } from '../../../shared/json';
import type { ListPickerCommand } from '../../../shared/list-picker-commands';
import { element } from '../../../shared/page/dom';
import type {
  KitCommands,
  OwnerKitServices,
} from '../../../shared/page/layout-host/base-kit';
import type {
  DrawnPart,
  RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import {
  createLayoutParts,
  type LayoutParts,
} from '../../../shared/page/layout-host/layout-parts';
import { listPickerCommands } from '../../../shared/page/list-picker';
import { textBoxInput } from '../../../shared/page/text-box';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { sheet } from '../../../shared/page/ui/sheet';
import {
  type SettingsChannel,
  type SettingsPlace,
  settingsMoveToRowCommand,
  settingsOpenSectionAtCommand,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  AdvancedRowInput,
  CompleteSettingsLayout,
  GroupHeaderInput,
  KeyFiltersInput,
  KeyRowInput,
  LeaderAddRowInput,
  LeaderGroupRowInput,
  LeaderItemRowInput,
  LeaderRowInput,
  PluginRowInput,
  ProblemInput,
  RowKit,
  SettingRowInput,
  SettingsKit,
  SettingsLayout,
} from '../layouts/layout';
import {
  createKeyRecorder,
  type RecordRequest,
  type Recording,
} from './key-recorder';
import { KEY_FILTERS } from './keymap-rows';
import { keymapSection, type KeysViewState } from './keymap-view';
import {
  buildEntry,
  buildLeaderPanes,
  buildPickerRow,
  buildRow,
  buildRowsPane,
  buildSectionsPane,
  type BuiltRow,
  type BuiltRowsPane,
  type SettingsKitScope,
} from './layout/settings-kit';
import {
  createLeaderMenuView,
  type LeaderMenuCommand,
  type LeaderScope,
} from './leader-menu-view';
import { pluginSection } from './plugin-rows-view';
import { type BoxRequest, createRowBox, type RowBox } from './row-box';
import { type PromptAction, rowPromptActions } from './row-prompt';
import { createSectionsView } from './sections-view';
import { settingSection } from './setting-rows-view';

// The user config file a row edits.
export type ConfigFile = 'settings' | 'keymap';

const FILE_NAMES: Record<ConfigFile, ProblemInput['file']> = {
  settings: 'settings.json',
  keymap: 'keymap.json',
};

const PLUGINS_SECTION = { id: 'plugins', title: 'Plugins' };
// Its id stays `keymap`: the keys plugin's settings already hold a section
// `keys`.
export const KEYS_SECTION = { id: 'keymap', title: 'Keybindings' };
export const LEADER_SECTION = { id: 'leader', title: 'Leader menu' };

// The key of `?`'s recording, which names no row: every command id holds a
// dot.
const FIND_KEY = 'find';

const NO_KEYS_FILTER: KeysViewState = { filter: 'all', findKeys: null };

// A row part's and an entry part's builder, as a layout defines it.
type RowDraw<I> = (parent: HTMLElement, input: I, kit: RowKit) => HTMLElement;
type EntryDraw<I> = (
  parent: HTMLElement,
  input: I,
  kit: SettingsKit,
) => HTMLElement;

// What a row does on each edit command; a command the row leaves out runs
// nothing on it.
export interface RowActions {
  open?(): void;
  edit?(): void;
  reset?(): void;
  addBind?(): void;
  removeBind?(): void;
}

export type RowAction = keyof RowActions;

// Each row part's input, by part name.
interface RowInputs {
  settingRow: SettingRowInput;
  pluginRow: PluginRowInput;
  keyRow: KeyRowInput;
  leaderRow: LeaderRowInput;
  advancedRow: AdvancedRowInput;
  leaderGroupRow: LeaderGroupRowInput;
  leaderItemRow: LeaderItemRowInput;
  leaderAddRow: LeaderAddRowInput;
}

// The layout part `P` that draws a row, and its input.
type RowPartOf<P extends keyof RowInputs> = { part: P; input: RowInputs[P] };

export type RowPart = { [P in keyof RowInputs]: RowPartOf<P> }[keyof RowInputs];

// One row: `key` names it in the cursor and log lines (a setting's path,
// `plugin:<id>`, `commandTarget(id, arg)`, `leader` or `advanced`); `draw` is
// the part that draws it.
export interface SettingsRow {
  key: string;
  file: ConfigFile;
  draw: RowPart;
  actions: RowActions;
}

export type SectionEntry =
  | { type: 'header'; input: GroupHeaderInput }
  | { type: 'keyFilters'; input: KeyFiltersInput }
  | { type: 'row'; row: SettingsRow };

// A section's drawing: `entries` in order, group headers among the rows.
// `emptyQuery` is what the empty state names when no row shows, in place of
// the `/` query.
export interface SectionDrawing {
  entries: SectionEntry[];
  rows: SettingsRow[];
  emptyQuery?: string;
}

// What an edit writes against: the open box, whose expected text it sends and
// under which its result shows; the expected text a picker opened with; or,
// for null, the latest read's text.
export type CommitVia =
  | { box: RowBox }
  | { expectedText: string | null }
  | null;

export interface PickRequest<T> {
  file: ConfigFile;
  title: string;
  items: readonly T[];
  label(item: T): string;
  // The keys a row's item holds, printed for the platform; null for none.
  keysOf?(item: T): string | null;
  selected?: number;
  // `expectedText` is the file's text when the picker opened.
  chosen(item: T, expectedText: string | null): void;
  cancelled?(): void;
}

// What the section views read and call. The layers are the last `ok` ones
// the view held (null: no file, or never read ok), read at call time, so a
// box's handler sees the layer in force when it commits.
export interface RowContext {
  schema: UserConfigSchema;
  platform: OsName;
  read(): UserConfigRead;
  settingsLayer(): Record<string, unknown> | null;
  keymapLayer(): UserKeymap | null;
  matcher: FuzzyMatcher;
  openBox(request: BoxRequest): void;
  closeBox(box: RowBox): void;
  // Logs the problem and shows it under the box, which stays open.
  boxProblem(box: RowBox, problem: string): void;
  openPicker<T>(request: PickRequest<T>): void;
  commitSettings(layer: Record<string, unknown>, via: CommitVia): void;
  // `written` runs once the write lands, before the rows redraw with it.
  commitKeymap(layer: UserKeymap, via: CommitVia, written?: () => void): void;
  toast(text: string, tone: ToastTone): void;
  // Every built-in plugin as the plugin switch last wrote it.
  plugins(): readonly PluginStatus[];
  // The reason turning `pluginId` off would be refused now, or null. A
  // rejection is logged and toasted before it rejects.
  mayDisable(pluginId: string): Promise<string | null>;
  // Logs `refused settings.json: <reason>` and toasts `reason`, as a refused
  // write with no box open shows.
  refuse(reason: string): void;
  // Records keys on a row, replacing any recording in progress; the rows
  // redraw on each change to it.
  recordKey(request: RecordRequest): void;
  recording(): Recording | null;
}

// `markdown`, `keys`, `commands` and `state` are what the layout's kits read.
export interface SettingsViewDeps {
  channel: PageChannel<SettingsChannel>;
  editor: EditorHost;
  matcher: FuzzyMatcher;
  platform: OsName;
  markdown: MarkdownRenderer;
  keys: Pick<KeyHints, 'anchor' | 'keysFor'>;
  commands: KitCommands;
  state: LayoutState;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  setScope(scope: 'sections' | 'rows' | LeaderScope): void;
  // Hands over the target the focus keys move between the sections and the
  // rows; the view calls it after each `setScope`, since a change of the set
  // scope drops it.
  setFocusTarget(target: FocusTarget): void;
  pushScope(scope: 'box'): PushedScope;
  // The page's one-shot key capture, as `api.keys.captureKey` arms it.
  captureKey(onKey: (keys: string) => void, onCancel: () => void): Disposable;
  picker: ListPickerService;
  // Keeps the keys of the settings `command` drawn in `element`, shown while
  // `scope` is in force, followed by `label` (true: the command's label): the
  // cursor prompt's keys, which the app draws in each layout.
  anchor(
    element: HTMLElement,
    command: SettingsCommand,
    scope: 'sections' | 'rows' | LeaderScope,
    label?: boolean | string,
  ): Disposable;
  // The open section's title, for the title bar.
  sectionShown(title: string): void;
  // Hears each section the user picks from the side bar, by click or Enter,
  // and main taking the keys; `l` opens one without picking it.
  sectionPicked(): void;
  // Runs the command `key` with `arg`, as a click does: a row's click runs
  // `settings.moveToRow` and a section's `settings.openSectionAt`.
  runKey<A>(key: CommandKey<A>, arg: A): void;
  // Hears the place after each change to the cursors, the open section or the
  // filter.
  placeChanged(place: SettingsPlace): void;
  // Every built-in plugin as the plugin switch last wrote it.
  plugins(): readonly PluginStatus[];
}

export type SettingsCommand =
  | 'down'
  | 'up'
  | 'top'
  | 'bottom'
  | 'open'
  | 'openKeepingFocus'
  | 'edit'
  | 'reset'
  | 'addBind'
  | 'removeBind'
  | 'filter'
  | 'clearFilter'
  | 'cycleKeyFilter'
  | 'findByKey'
  | 'renameGroup'
  | 'changeKey'
  | 'moveToGroup'
  | 'boxAccept'
  | 'boxCancel'
  | ListPickerCommand;

// Settings mode's view: the sections for the side bar, the open section's
// rows in the sheet, the one box or picker open over them, and the reads and
// writes behind them, logging under `settings`. The panes, rows and picker
// rows draw through the settings layout; `default` draws until the first
// `setLayouts`. `load` reads the schema and both files; `reread` reads the
// files again and redraws (the channel's `changed`); `shown` runs as the mode
// shows: the first time it opens the first section with focus on the side
// bar, and each time it sets the scope where focus was left. Each change of
// focus logs `sections focused` or `rows focused`. The keys show
// where they act: the cursor row's actions in its layout's `rowActions` slot.
// `setLayouts` draws everything again in the new layouts, keeping the cursor,
// the open section, the focus side, an open box or filter, an open picker and
// a key recording. A recording ends on Esc, on opening a section, on `hidden`
// and when a redraw leaves its row out. In the Keybindings section `f` cycles
// the filter chips (`key filter <id>`) and `?` records a key to find by
// (`find by key <keys>`), which Esc clears (`find by key cleared`) before the
// text filter; opening a section resets both. In the Leader menu the
// leader menu view draws the rows and takes the row commands, and `/` opens no
// filter. Each change to the place reaches `placeChanged`.
export interface SettingsView {
  sideBar: HTMLElement;
  sheet: HTMLElement;
  setLayouts(shown: ShownLayouts<SettingsLayout>): void;
  load(): Promise<void>;
  reread(): void;
  shown(): void;
  // The side bar was hidden: focus leaves it for the rows.
  sideBarHidden(): void;
  // The side bar opened over the rows: focus moves to it.
  sideBarOpenedOver(): void;
  // The core's area chain reached the side bar: focus moves to the sections.
  focusSideBar(): void;
  // Main takes the keys back: focus moves to the rows.
  focusMain(): void;
  commands: Record<SettingsCommand, () => void>;
  // The cursor moves to the row `key` keys and the rows take focus, unless a
  // box is open; a key no row holds logs `no row <key>`.
  moveToRow(key: string): void;
  // Opens the section at `index` with the side bar's cursor and focus on it,
  // then tells `sectionPicked`; an index no section holds logs
  // `no section <index>`.
  openSectionAt(index: number): void;
  // Puts back a reloaded page's place, before `load`: the first show opens the
  // saved section with its filter applied, its box closed. A saved section the
  // schema no longer holds opens the first, and a saved cursor key no row
  // holds leaves the cursor where the first draw sets it.
  restorePlace(place: SettingsPlace): void;
  // The plugin switch wrote a new status list: the rows redraw while the
  // Plugins section is open.
  pluginsChanged(): void;
  // The mode was hidden: a key recording in progress is cancelled.
  hidden(): void;
}

// The cursor prompt's label for each action it shows.
const PROMPT_LABELS: Record<PromptAction, string> = {
  open: 'reassign',
  edit: 'edit',
  addBind: 'add key',
  removeBind: 'clear',
  reset: 'reset',
};

interface OpenBox {
  box: RowBox;
  file: ConfigFile;
  scope: PushedScope;
}

export function createSettingsView(deps: SettingsViewDeps): SettingsView {
  const { channel, log } = deps;
  const anchored = (
    command: SettingsCommand,
    scope: 'sections' | 'rows',
    label?: boolean | string,
  ): HTMLElement => {
    const hint = element('span');
    deps.anchor(hint, command, scope, label);
    return hint;
  };
  const services: OwnerKitServices = {
    markdown: deps.markdown,
    keys: deps.keys,
    commands: deps.commands,
    platform: deps.platform,
    state: deps.state,
  };
  const parts = createLayoutParts<SettingsLayout, CompleteSettingsLayout>({
    owner: 'settings',
    defaultLayout,
    log,
  });

  // `parts` seen through the row parts alone, each keyed to its input, so a
  // row's part name and input stay paired in one generic draw.
  const rowParts: LayoutParts<
    SettingsLayout,
    { [P in keyof RowInputs]: RowDraw<RowInputs[P]> }
  > = parts;

  // Draws a row's `part` with its `input` into `parent`, its kit in `scope`.
  const drawSettingsRow = <P extends keyof RowInputs>(
    { part, input }: RowPartOf<P>,
    parent: HTMLElement,
    scope: SettingsKitScope = 'rows',
  ): DrawnPart<BuiltRow> =>
    rowParts.draw(part, parent, (draw, rowParent, rollback) =>
      buildRow(draw, rowParent, input, services, rollback, scope, part),
    );

  const sections = createSectionsView({
    drawPane: (container) =>
      parts.draw('sections', container, (pane, parent, rollback) =>
        buildSectionsPane(pane, parent, services, rollback),
      ),
    drawRow: (parent, section) =>
      parts.draw('sectionRow', parent, (sectionRow, rowParent, rollback) =>
        buildEntry(
          sectionRow,
          rowParent,
          section,
          'sections',
          services,
          rollback,
        ),
      ),
    clicked: (index) => deps.runKey(settingsOpenSectionAtCommand, index),
  });
  const rowsSheet = sheet();
  rowsSheet.classList.add('settings-sheet');
  rowsSheet.tabIndex = -1;

  // The cursor row's action keys; `markCursor` moves the prompt into the
  // cursor row's actions slot and shows the keys of the actions that row has.
  const rowPrompt = element('span', 'settings-row-actions');
  const promptHints: Record<PromptAction, HTMLElement> = {
    open: anchored('open', 'rows', PROMPT_LABELS.open),
    edit: anchored('edit', 'rows', PROMPT_LABELS.edit),
    addBind: anchored('addBind', 'rows', PROMPT_LABELS.addBind),
    removeBind: anchored('removeBind', 'rows', PROMPT_LABELS.removeBind),
    reset: anchored('reset', 'rows', PROMPT_LABELS.reset),
  };
  rowPrompt.append(
    promptHints.open,
    promptHints.edit,
    promptHints.addBind,
    promptHints.removeBind,
    promptHints.reset,
  );

  // The filter frame the rows pane places; it and its input outlive every
  // redraw.
  const filterFrame = inputFrame();
  filterFrame.classList.add('settings-filter');
  filterFrame.hidden = true;
  const filterBox = textBoxInput('settings-box-input');
  filterFrame.append(filterBox);

  const picker = deps.picker.create({ filter: true });

  let schema: UserConfigSchema | null = null;
  let latest: UserConfigRead | null = null;
  let settingsLayer: Record<string, unknown> | null = null;
  let keymapLayer: UserKeymap | null = null;
  let brokenProblems: Record<ConfigFile, string | null> = {
    settings: null,
    keymap: null,
  };
  let readCount = 0;
  let sectionsCursor = 0;
  let openSectionId = 'core';
  let openSectionTitle = '';
  let hasShown = false;
  let hasOpenedSection = false;
  let focus: 'sections' | 'rows' = 'sections';
  let query = '';
  // The `/` query and the Keybindings chip and find query the rows were last
  // drawn under.
  let drawnFilter: { query: string; keys: KeysViewState } = {
    query: '',
    keys: NO_KEYS_FILTER,
  };
  let filterScope: PushedScope | null = null;
  let rows: SettingsRow[] = [];
  // Each drawn row by its key, and the dispose of every part drawn into the
  // rows pane's slots.
  let drawnRows = new Map<string, BuiltRow>();
  let entryDisposes: (() => void)[] = [];
  let cursorKey: string | null = null;
  let openBox: OpenBox | null = null;
  let isPlaceRestored = false;
  let keysState: KeysViewState = NO_KEYS_FILTER;
  const recorder = createKeyRecorder({
    captureKey: deps.captureKey,
    changed: () => draw(),
    log,
  });

  const disposeEntries = () => {
    const disposes = entryDisposes;
    entryDisposes = [];
    drawnRows = new Map();
    for (const dispose of disposes) {
      dispose();
    }
  };

  const drawPane = (): DrawnPart<BuiltRowsPane> =>
    parts.draw('rows', rowsSheet, (pane, parent, rollback) =>
      buildRowsPane(
        pane,
        parent,
        { sectionId: openSectionId, title: openSectionTitle },
        filterFrame,
        services,
        rollback,
      ),
    );
  let rowsPane = drawPane();

  // Draws the rows pane again, for a new layout or a newly opened section;
  // the rows are drawn into it by the next `drawRows`.
  const redrawRowsPane = () => {
    disposeEntries();
    rowsPane.dispose();
    rowsPane.built.element.remove();
    rowsPane = drawPane();
  };

  const sectionList = (): { id: string; title: string }[] => [
    ...(schema?.sections ?? []).map(({ id, title }) => ({ id, title })),
    PLUGINS_SECTION,
    KEYS_SECTION,
    LEADER_SECTION,
  ];

  const isLeaderOpen = () => openSectionId === LEADER_SECTION.id;

  const sectionFile = (): ConfigFile =>
    openSectionId === KEYS_SECTION.id || isLeaderOpen() ? 'keymap' : 'settings';

  // The drawn row `key` names: the Leader menu's rows live in its view.
  const drawnRowOf = (key: string): BuiltRow | undefined =>
    isLeaderOpen() ? leaderMenu.drawnRow(key) : drawnRows.get(key);

  const isBroken = (file: ConfigFile) => latest?.[file].state === 'broken';

  const setCursor = (key: string | null) => {
    if (key === cursorKey) {
      return;
    }
    cursorKey = key;
    if (key !== null) {
      log(`cursor ${key}`);
    }
  };

  // Puts the cursor prompt in the cursor row's actions slot, showing the keys
  // of the actions that row has; with no cursor row it leaves the rows.
  const placeRowPrompt = (row: SettingsRow | undefined) => {
    const drawn = row === undefined ? undefined : drawnRows.get(row.key);
    if (row === undefined || drawn === undefined) {
      rowPrompt.remove();
      return;
    }
    const shownActions = rowPromptActions(row.actions);
    for (const action of Object.keys(promptHints) as PromptAction[]) {
      promptHints[action].hidden = !shownActions.includes(action);
    }
    drawn.actions.append(rowPrompt);
  };

  // Marks the cursor row selected, and draws its focus ring while the keys
  // act on the rows: an open box or filter draws its own ring instead. The
  // pane without focus is marked inactive, so its selected row takes the
  // inactive selection fill. The cursor prompt moves to the cursor row.
  const markCursor = () => {
    const isRowsFocused =
      focus === 'rows' && openBox === null && filterScope === null;
    rowsSheet.classList.toggle('is-pane-inactive', focus !== 'rows');
    sections.element.classList.toggle('is-pane-inactive', focus !== 'sections');
    for (const [key, drawn] of drawnRows) {
      const isCursor = key === cursorKey;
      drawn.element.classList.toggle('is-selected', isCursor);
      drawn.element.classList.toggle('is-cursor', isCursor && isRowsFocused);
    }
    sections.draw(
      sectionList(),
      sectionsCursor,
      openSectionId,
      focus === 'sections',
    );
    const cursorRow = rows.find((row) => row.key === cursorKey);
    placeRowPrompt(cursorRow);
    // On the first row the sheet scrolls to its top, so the header, filter
    // chips and the find heading above that row show with it.
    if (cursorKey !== null && rows[0]?.key === cursorKey) {
      rowsSheet.scrollTop = 0;
    } else if (cursorKey !== null) {
      drawnRows.get(cursorKey)?.element.scrollIntoView({ block: 'nearest' });
    }
    deps.placeChanged({
      sectionsCursor,
      openSectionId,
      cursorKey,
      filter: query,
    });
  };

  // The build of a group header, empty state or problem card for `input`.
  const entryBuild =
    <I>(input: I) =>
    (draw: EntryDraw<I>, parent: HTMLElement, rollback: RollbackDeps) =>
      buildEntry(draw, parent, input, 'rows', services, rollback);

  // Draws `row` into `parent`; a click on it outside its box runs
  // `settings.moveToRow` with its key.
  const drawRowEntry = (row: SettingsRow, parent: HTMLElement) => {
    const drawn = drawSettingsRow(row.draw, parent);
    entryDisposes.push(drawn.dispose);
    drawnRows.set(row.key, drawn.built);
    drawn.built.element.addEventListener('click', (event) => {
      const isInBox =
        event.target instanceof Element &&
        event.target.closest('.settings-box') !== null;
      if (!isInBox) {
        deps.runKey(settingsMoveToRowCommand, row.key);
      }
    });
  };

  const drawRows = () => {
    if (schema === null || latest === null) {
      return;
    }
    const drawing = sectionDrawing(schema);
    const cursorIndex = rows.findIndex((row) => row.key === cursorKey);
    const isSameFilter =
      query === drawnFilter.query && keysState === drawnFilter.keys;
    drawnFilter = { query, keys: keysState };
    rows = drawing.rows;
    if (!rows.some((row) => row.key === cursorKey)) {
      // A row that left the list hands the cursor to the row now in its place;
      // a row a new filter, chip or find query hid hands it to the best match.
      const place = isSameFilter ? Math.max(cursorIndex, 0) : 0;
      setCursor(rows[Math.min(place, rows.length - 1)]?.key ?? null);
    }
    disposeEntries();
    const { problem, rowList } = rowsPane.built;
    problem.replaceChildren();
    rowList.replaceChildren();
    const file = sectionFile();
    const read = latest[file];
    if (read.state === 'broken') {
      const input = { file: FILE_NAMES[file], problem: read.problem };
      const drawn = parts.draw('problem', problem, entryBuild(input));
      entryDisposes.push(drawn.dispose);
    }
    if (isLeaderOpen()) {
      leaderMenu.draw(rowList);
      markCursor();
      return;
    }
    for (const entry of drawing.entries) {
      if (entry.type === 'row') {
        drawRowEntry(entry.row, rowList);
        continue;
      }
      const drawn =
        entry.type === 'header'
          ? parts.draw('groupHeader', rowList, entryBuild(entry.input))
          : parts.draw('keyFilters', rowList, entryBuild(entry.input));
      entryDisposes.push(drawn.dispose);
    }
    const emptyQuery = drawing.emptyQuery ?? query;
    const isEmpty = emptyQuery.trim() !== '' && rows.length === 0;
    if (isEmpty) {
      const input = { query: emptyQuery };
      const drawn = parts.draw('empty', rowList, entryBuild(input));
      entryDisposes.push(drawn.dispose);
    }
    markCursor();
  };

  // A row recording keys ends its recording when a redraw leaves it out;
  // `?`'s recording names no row.
  const cancelRecordingOfGoneRow = () => {
    const recording = recorder.current();
    const isRowGone =
      recording !== null &&
      recording.key !== FIND_KEY &&
      drawnRowOf(recording.key) === undefined;
    if (isRowGone) {
      recorder.cancel();
    }
  };

  // Redraws the rows, and first the rows pane when `isPaneRedrawn`; the open
  // box moves into its row's new box slot with its focus and text kept; a box
  // whose row is no longer drawn, or whose file is now broken, closes, so it
  // never writes over the broken file.
  const draw = (isPaneRedrawn = false) => {
    drawKeepingBox(isPaneRedrawn);
    cancelRecordingOfGoneRow();
  };

  const drawKeepingBox = (isPaneRedrawn: boolean) => {
    const drawAll = () => {
      if (isPaneRedrawn) {
        redrawRowsPane();
      }
      drawRows();
    };
    const held = openBox;
    if (held === null) {
      drawAll();
      return;
    }
    held.box.keepFocusAcross(() => {
      drawAll();
      drawnRowOf(held.box.key)?.box.append(held.box.element);
    });
    const isRowGone = drawnRowOf(held.box.key) === undefined;
    if (isRowGone || isBroken(held.file)) {
      closeBox(held.box);
    }
  };

  const noteBroken = (read: UserConfigRead) => {
    const next = { ...brokenProblems };
    for (const file of ['settings', 'keymap'] as const) {
      const fileRead = read[file];
      next[file] = fileRead.state === 'broken' ? fileRead.problem : null;
      const isNewlyBroken =
        next[file] !== null && next[file] !== brokenProblems[file];
      if (isNewlyBroken) {
        log(`broken ${FILE_NAMES[file]}`);
      }
    }
    brokenProblems = next;
  };

  // Reads both files and returns the read; redraws when `always`, else only
  // when the read differs from the last. A read overtaken by a later one is
  // returned without being held or drawn.
  const refresh = async (always: boolean): Promise<UserConfigRead> => {
    const count = ++readCount;
    const read = await channel.invoke('read');
    if (count !== readCount) {
      return read;
    }
    const isChanged = !isSameJson(read, latest);
    latest = read;
    if (read.settings.state === 'ok') {
      settingsLayer = read.settings.layer;
    }
    if (read.keymap.state === 'ok') {
      keymapLayer = read.keymap.layer;
    }
    noteBroken(read);
    if (always || isChanged) {
      draw();
      log('redrawn');
    }
    return read;
  };

  const refreshQuietly = (always: boolean) =>
    refresh(always).catch((error) => {
      log(`read failed: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
    });

  // `right` from the sections focuses the rows; every other move leaves focus
  // where it is, so the core reaches the side bar from the rows' left edge.
  const focusTarget: FocusTarget = {
    move(direction) {
      if (focus === 'sections' && direction === 'right') {
        focusMain();
        return true;
      }
      return false;
    },
  };

  const setFocus = (next: 'sections' | 'rows') => {
    if (focus !== next) {
      log(`${next} focused`);
    }
    focus = next;
  };

  // Each focus change closes an open filter first: `setScope` leaves the
  // filter's pushed scope in force.
  // The Leader menu's view takes the keys in place of the rows.
  const focusRows = () => {
    if (filterScope !== null) {
      logFilter();
      closeFilter();
    }
    setFocus('rows');
    if (isLeaderOpen()) {
      leaderMenu.focus();
    } else {
      deps.setScope('rows');
      deps.setFocusTarget(focusTarget);
      rowsSheet.focus();
    }
    markCursor();
  };

  // The rows take the keys; `sectionPicked` closes a narrow window's side bar
  // overlay, so the keys never sit in rows under it. The rows take focus
  // first, so the `sideBarHidden` it may cause finds them already focused.
  const focusMain = () => {
    focusRows();
    deps.sectionPicked();
  };

  const focusSections = () => {
    if (filterScope !== null) {
      logFilter();
      closeFilter();
    }
    setFocus('sections');
    if (isLeaderOpen()) {
      leaderMenu.blur();
    }
    deps.setScope('sections');
    deps.setFocusTarget(focusTarget);
    sections.element.focus();
    markCursor();
  };

  // Gives focus back to where the keys act when a closed box or picker left
  // it nowhere: the box still open, else the focused pane.
  const restoreFocus = () => {
    const isFocusLost =
      document.activeElement === null ||
      document.activeElement === document.body;
    if (!isFocusLost) {
      return;
    }
    if (openBox !== null) {
      openBox.box.focus();
      return;
    }
    if (focus === 'rows' && isLeaderOpen()) {
      leaderMenu.focus();
      return;
    }
    (focus === 'rows' ? rowsSheet : sections.element).focus();
  };

  const closeBox = (box: RowBox) => {
    if (openBox?.box !== box) {
      return;
    }
    const held = openBox;
    openBox = null;
    // A write landing after the plugin stopped closes here too, so no `pop`.
    held.scope.dispose();
    box.destroy();
    log(`box closed ${box.key}`);
    markCursor();
    restoreFocus();
  };

  // Shows `text` under a box still open, focusing it again when a picker
  // over it took the focus.
  const showUnderBox = (box: RowBox, text: string) => {
    box.showMessage(text);
    if (!box.element.contains(document.activeElement)) {
      box.focus();
    }
  };

  const showBox = (request: BoxRequest) => {
    if (openBox !== null || latest === null) {
      return;
    }
    const drawn = drawnRowOf(request.key);
    if (drawn === undefined) {
      return;
    }
    const box = createRowBox(request, latest[request.file].text, {
      editor: deps.editor,
      quit: () => closeBox(box),
    });
    const scope = deps.pushScope('box');
    scope.onBaseChanged(() => closeBox(box));
    openBox = { box, file: request.file, scope };
    markCursor();
    drawn.box.append(box.element);
    box.focus();
    log(`box open ${request.key}`);
  };

  // A write refused with no box open to show it under.
  const refuse = (file: ConfigFile, problem: string) => {
    log(`refused ${FILE_NAMES[file]}: ${problem}`);
    deps.toast(problem, 'error');
  };

  const commit = async (
    file: ConfigFile,
    write: (expectedText: string | null) => Promise<ConfigWriteResult>,
    isUnchanged: boolean,
    via: CommitVia,
    written?: () => void,
  ) => {
    const box = via !== null && 'box' in via ? via.box : null;
    if (isUnchanged) {
      log('unchanged');
      if (box !== null) {
        closeBox(box);
      }
      return;
    }
    let expectedText = latest?.[file].text ?? null;
    if (box !== null) {
      expectedText = box.expectedText;
    } else if (via !== null && 'expectedText' in via) {
      expectedText = via.expectedText;
    }
    const name = FILE_NAMES[file];
    const isBoxOpen = () => box !== null && openBox?.box === box;
    const result = await write(expectedText);
    switch (result.type) {
      case 'written':
        log(`wrote ${name}`);
        written?.();
        if (box !== null) {
          closeBox(box);
        }
        await refresh(true);
        return;
      case 'refused':
        if (box !== null && isBoxOpen()) {
          log(`refused ${name}: ${result.problem}`);
          showUnderBox(box, result.problem);
        } else {
          refuse(file, result.problem);
        }
        return;
      case 'changedOnDisk': {
        log(`changed on disk ${name}`);
        const reread = await refresh(true);
        const text =
          reread[file].state === 'broken'
            ? `${name} changed on disk and is now broken; the form shows the problem and closed any open box`
            : `${name} changed on disk; the form now shows it`;
        if (box !== null && isBoxOpen()) {
          box.expectedText = reread[file].text;
          showUnderBox(box, text);
        } else {
          deps.toast(text, 'info');
        }
      }
    }
  };

  const commitQuietly = (run: Promise<void>) =>
    run.catch((error) => {
      log(`write failed: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
    });

  const context: RowContext = {
    get schema() {
      if (schema === null) {
        throw new Error('The settings schema is not read yet');
      }
      return schema;
    },
    platform: deps.platform,
    matcher: deps.matcher,
    read() {
      if (latest === null) {
        throw new Error('The user config is not read yet');
      }
      return latest;
    },
    settingsLayer: () => settingsLayer,
    keymapLayer: () => keymapLayer,
    openBox: showBox,
    closeBox,
    boxProblem(box, problem) {
      log(`box problem ${box.key}: ${problem}`);
      box.showMessage(problem);
    },
    openPicker(request) {
      const expectedText = latest?.[request.file].text ?? null;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) {
        focused.blur();
      }
      picker.open({
        title: request.title,
        items: request.items,
        label: request.label,
        selected: request.selected,
        drawRow(list, item, { label, trailing }) {
          const drawn = parts.draw(
            'pickerRow',
            list,
            (pickerRow, parent, rollback) =>
              buildPickerRow(
                pickerRow,
                parent,
                {
                  picker: request.title,
                  label,
                  keys: request.keysOf?.(item) ?? null,
                },
                trailing,
                services,
                rollback,
              ),
          );
          return { element: drawn.built.element, dispose: drawn.dispose };
        },
        chosen(item) {
          request.chosen(item, expectedText);
          restoreFocus();
        },
        cancelled() {
          request.cancelled?.();
          restoreFocus();
        },
      });
    },
    commitSettings(layer, via) {
      commitQuietly(
        commit(
          'settings',
          (expectedText) =>
            channel.invoke('writeSettings', layer, expectedText),
          isSameJson(settingsLayer ?? {}, layer),
          via,
        ),
      );
    },
    commitKeymap(layer, via, written) {
      commitQuietly(
        commit(
          'keymap',
          (expectedText) => channel.invoke('writeKeymap', layer, expectedText),
          isSameJson(keymapLayer ?? {}, layer),
          via,
          written,
        ),
      );
    },
    toast: deps.toast,
    plugins: deps.plugins,
    async mayDisable(pluginId) {
      try {
        return await channel.invoke('mayDisable', pluginId);
      } catch (error) {
        log(`write failed: ${errorText(error)}`);
        deps.toast(errorText(error), 'error');
        throw error;
      }
    },
    refuse: (reason) => refuse('settings', reason),
    recordKey: (request) => recorder.start(request),
    recording: () => recorder.current(),
  };

  const leaderMenu = createLeaderMenuView({
    context,
    drawPanes(parent, input) {
      const drawn = parts.draw('leaderPanes', parent, (panes, at, rollback) =>
        buildLeaderPanes(panes, at, input, services, rollback),
      );
      entryDisposes.push(drawn.dispose);
      return drawn.built;
    },
    drawRow(row, parent, scope) {
      const drawn = drawSettingsRow(row, parent, scope);
      entryDisposes.push(drawn.dispose);
      return drawn.built;
    },
    anchor: (element, command, scope, label) =>
      deps.anchor(element, command, scope, label),
    setScope: deps.setScope,
    setFocusTarget: deps.setFocusTarget,
    redraw: () => draw(),
    log,
  });

  // The open section's drawing: the Plugins section's plugin rows, a schema
  // section's setting rows, or the Keybindings section's rows, which also
  // draw for a section id the schema does not hold yet. The Leader menu's
  // rows are its view's, so its drawing holds none.
  const sectionDrawing = (held: UserConfigSchema): SectionDrawing => {
    if (openSectionId === PLUGINS_SECTION.id) {
      return pluginSection(context, query);
    }
    if (isLeaderOpen()) {
      return { entries: [], rows: [] };
    }
    const section =
      openSectionId === KEYS_SECTION.id
        ? undefined
        : held.sections.find((each) => each.id === openSectionId);
    return section === undefined
      ? keymapSection(context, query, keysState)
      : settingSection(section, context, query);
  };

  // Opens the section at `index` with `filter` and the cursor on `cursorKey`:
  // a fresh open clears both.
  const openSection = (
    index: number,
    filter = '',
    openCursorKey: string | null = null,
  ) => {
    const section = sectionList()[index];
    if (section === undefined) {
      return;
    }
    recorder.cancel();
    keysState = NO_KEYS_FILTER;
    openSectionId = section.id;
    hasOpenedSection = true;
    query = filter;
    filterBox.value = filter;
    filterFrame.hidden = filter.trim() === '';
    openSectionTitle = section.title;
    if (isLeaderOpen()) {
      leaderMenu.reset();
    }
    log(`section ${section.id}`);
    deps.sectionShown(section.title);
    cursorKey = openCursorKey;
    draw(true);
  };

  // The first show opens the first section, once the schema names it, with
  // the sections cursor on it; or the restored place's section with its
  // filter and cursor, the sections cursor clamped to the sections there are.
  const openFirstSection = () => {
    if (!hasShown || hasOpenedSection || schema === null) {
      return;
    }
    const list = sectionList();
    const restoredIndex = list.findIndex(
      (section) => section.id === openSectionId,
    );
    if (isPlaceRestored && restoredIndex !== -1) {
      sectionsCursor = Math.max(0, Math.min(list.length - 1, sectionsCursor));
      openSection(restoredIndex, query, cursorKey);
      return;
    }
    sectionsCursor = 0;
    openSection(0);
  };

  const moveSections = (to: (count: number) => number) => {
    const count = sectionList().length;
    sectionsCursor = Math.max(0, Math.min(count - 1, to(count)));
    markCursor();
  };

  const moveRows = (to: (index: number, count: number) => number) => {
    if (rows.length === 0) {
      return;
    }
    const index = rows.findIndex((row) => row.key === cursorKey);
    const next = Math.max(0, Math.min(rows.length - 1, to(index, rows.length)));
    setCursor(rows[next].key);
    markCursor();
  };

  const move = (
    sectionsTo: (count: number) => number,
    rowsTo: (index: number, count: number) => number,
  ) => {
    if (focus === 'sections') {
      moveSections(sectionsTo);
    } else {
      moveRows(rowsTo);
    }
  };

  // Runs `action` on the cursor row, unless its file is broken. An action
  // that may open a box or picker reads the files first, so the box holds
  // their text as it is now.
  const runRowAction = async (action: RowAction, readsFirst: boolean) => {
    const row = rows.find((each) => each.key === cursorKey);
    if (row?.actions[action] === undefined || isBroken(row.file)) {
      return;
    }
    if (readsFirst) {
      await refresh(false);
    }
    const fresh = rows.find((each) => each.key === row.key);
    if (fresh === undefined || isBroken(fresh.file)) {
      return;
    }
    fresh.actions[action]?.();
  };

  const runQuietly = (action: RowAction, readsFirst: boolean) => () => {
    if (openBox !== null || picker.isOpen() || recorder.current() !== null) {
      return;
    }
    runRowAction(action, readsFirst).catch((error) => {
      log(`${action} failed: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
    });
  };

  // Logs the count, then the first row's key (`none` with no rows).
  const logFilter = () => {
    log(`filter "${query}": ${rows.length} rows`);
    log(`filter "${query}" first row ${rows[0]?.key ?? 'none'}`);
  };

  const closeFilter = () => {
    filterScope?.pop();
    filterScope = null;
    filterFrame.hidden = query.trim() === '';
    markCursor();
  };

  // The Leader menu filters nothing, so `/` opens no box there.
  const openFilter = () => {
    if (filterScope !== null || openBox !== null || isLeaderOpen()) {
      return;
    }
    const scope = deps.pushScope('box');
    scope.onBaseChanged(() => {
      if (filterScope === scope) {
        closeFilter();
      }
    });
    filterScope = scope;
    filterBox.value = query;
    filterFrame.hidden = false;
    markCursor();
    filterBox.focus();
    filterBox.select();
  };

  // Whether the Keybindings section's own keys act: its rows hold the keys,
  // with no box, picker, filter box or recording over them.
  const isKeysSectionIdle = () =>
    openSectionId === KEYS_SECTION.id &&
    focus === 'rows' &&
    openBox === null &&
    filterScope === null &&
    !picker.isOpen() &&
    recorder.current() === null;

  const findByKey = () => {
    if (!isKeysSectionIdle()) {
      return;
    }
    recorder.start({
      key: FIND_KEY,
      replacing: null,
      prompt: 'Press a key to find what it runs — Esc cancels',
      confirm: 'press',
      judge: () => ({ type: 'free' }),
      keep(keys) {
        keysState = { ...keysState, findKeys: keys };
        log(`find by key ${keys}`);
        draw();
      },
    });
  };

  const cycleKeyFilter = () => {
    if (!isKeysSectionIdle()) {
      return;
    }
    const index = KEY_FILTERS.indexOf(keysState.filter);
    const filter = KEY_FILTERS[(index + 1) % KEY_FILTERS.length];
    keysState = { ...keysState, filter };
    log(`key filter ${filter}`);
    draw();
  };

  // Whether the Leader menu's view takes the row commands: it is open and
  // the rows hold the keys.
  const isLeaderFocused = () => isLeaderOpen() && focus === 'rows';

  // Runs the Leader menu's `command` with no box, picker or recording over
  // it; an edit refuses while keymap.json is broken.
  const runLeader = (command: LeaderMenuCommand) => {
    const isBusy =
      openBox !== null || picker.isOpen() || recorder.current() !== null;
    const isMove = ['down', 'up', 'top', 'bottom'].includes(command);
    if (isBusy || (!isMove && isBroken('keymap'))) {
      return;
    }
    leaderMenu.commands[command]();
  };

  // `command` on the Leader menu while it holds the keys, else `elsewhere`.
  const leaderOr =
    (command: LeaderMenuCommand, elsewhere: () => void) => () => {
      if (isLeaderFocused()) {
        runLeader(command);
        return;
      }
      elsewhere();
    };

  // `command` on the Leader menu while it holds the keys; nothing elsewhere.
  const notOutsideLeader = (command: LeaderMenuCommand) =>
    leaderOr(command, () => undefined);

  // Does nothing while the Leader menu holds the keys.
  const notInLeader = (run: () => void) => () => {
    if (!isLeaderFocused()) {
      run();
    }
  };

  filterBox.addEventListener('input', () => {
    query = filterBox.value;
    draw();
  });

  const commands: Record<SettingsCommand, () => void> = {
    down: leaderOr('down', () =>
      move(
        () => sectionsCursor + 1,
        (index) => index + 1,
      ),
    ),
    up: leaderOr('up', () =>
      move(
        () => sectionsCursor - 1,
        (index) => index - 1,
      ),
    ),
    top: leaderOr('top', () =>
      move(
        () => 0,
        () => 0,
      ),
    ),
    bottom: leaderOr('bottom', () =>
      move(
        (count) => count - 1,
        (_index, count) => count - 1,
      ),
    ),
    open: leaderOr('open', () => {
      if (focus === 'sections') {
        openSection(sectionsCursor);
        deps.sectionPicked();
        focusRows();
        return;
      }
      runQuietly('open', true)();
    }),
    openKeepingFocus() {
      if (focus === 'sections') {
        openSection(sectionsCursor);
      }
    },
    edit: notInLeader(runQuietly('edit', true)),
    reset: leaderOr('reset', runQuietly('reset', false)),
    addBind: leaderOr('addBind', runQuietly('addBind', true)),
    removeBind: leaderOr('removeBind', runQuietly('removeBind', true)),
    renameGroup: notOutsideLeader('renameGroup'),
    changeKey: notOutsideLeader('changeKey'),
    moveToGroup: notOutsideLeader('moveToGroup'),
    filter: openFilter,
    cycleKeyFilter,
    findByKey,
    // Clears the find query first, then the text filter.
    clearFilter() {
      if (keysState.findKeys !== null) {
        keysState = { ...keysState, findKeys: null };
        log('find by key cleared');
        draw();
        return;
      }
      if (query.trim() === '') {
        return;
      }
      query = '';
      filterBox.value = '';
      filterFrame.hidden = true;
      draw();
      logFilter();
    },
    boxAccept() {
      if (filterScope !== null) {
        logFilter();
        closeFilter();
        focusRows();
        return;
      }
      openBox?.box.accept();
    },
    boxCancel() {
      if (filterScope !== null) {
        query = '';
        filterBox.value = '';
        draw();
        logFilter();
        closeFilter();
        focusRows();
        return;
      }
      if (openBox !== null) {
        closeBox(openBox.box);
      }
    },
    ...listPickerCommands(picker),
  };

  return {
    sideBar: sections.element,
    sheet: rowsSheet,
    setLayouts(next) {
      parts.setLayouts(next);
      sections.redrawPane();
      draw(true);
      if (filterScope !== null) {
        filterBox.focus();
      }
      markCursor();
      picker.redraw();
    },
    async load() {
      schema = await channel.invoke('schema');
      await refresh(true);
      openFirstSection();
    },
    reread: () => refreshQuietly(true),
    shown() {
      hasShown = true;
      openFirstSection();
      if (focus === 'sections') {
        focusSections();
      } else {
        focusRows();
      }
    },
    sideBarHidden() {
      if (focus === 'sections') {
        focusRows();
      }
    },
    sideBarOpenedOver: focusSections,
    focusSideBar: focusSections,
    focusMain,
    commands,
    moveToRow(key) {
      if (openBox !== null) {
        return;
      }
      if (!rows.some((row) => row.key === key)) {
        log(`no row ${key}`);
        return;
      }
      setCursor(key);
      focusRows();
    },
    openSectionAt(index) {
      if (sectionList()[index] === undefined) {
        log(`no section ${index}`);
        return;
      }
      sectionsCursor = index;
      focusSections();
      openSection(index);
      deps.sectionPicked();
    },
    restorePlace(place) {
      isPlaceRestored = true;
      sectionsCursor = place.sectionsCursor;
      openSectionId = place.openSectionId;
      cursorKey = place.cursorKey;
      query = place.filter;
      filterBox.value = place.filter;
      filterFrame.hidden = place.filter.trim() === '';
    },
    pluginsChanged() {
      if (openSectionId === PLUGINS_SECTION.id) {
        draw();
      }
    },
    hidden: () => recorder.cancel(),
  };
}
