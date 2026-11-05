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
import { textBoxInput } from '../../../shared/page/text-box';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { sheet } from '../../../shared/page/ui/sheet';
import type { SettingsChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  AdvancedRowInput,
  CompleteSettingsLayout,
  GroupHeaderInput,
  KeyRowInput,
  LeaderRowInput,
  ProblemInput,
  RowKit,
  SettingRowInput,
  SettingsKit,
  SettingsLayout,
} from '../layouts/layout';
import { keymapSection } from './keymap-view';
import {
  buildEntry,
  buildPickerRow,
  buildRow,
  buildRowsPane,
  buildSectionsPane,
  type BuiltRow,
  type BuiltRowsPane,
} from './layout/settings-kit';
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

const KEYMAP_SECTION = { id: 'keymap', title: 'Keymap' };

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
  keyRow: KeyRowInput;
  leaderRow: LeaderRowInput;
  advancedRow: AdvancedRowInput;
}

// The layout part `P` that draws a row, and its input.
type RowPartOf<P extends keyof RowInputs> = { part: P; input: RowInputs[P] };

export type RowPart = { [P in keyof RowInputs]: RowPartOf<P> }[keyof RowInputs];

// One row: `key` names it in the cursor and log lines (a setting's path, a
// command id, `leader` or `advanced`); `draw` is the part that draws it.
export interface SettingsRow {
  key: string;
  file: ConfigFile;
  draw: RowPart;
  actions: RowActions;
}

export type SectionEntry =
  | { type: 'header'; input: GroupHeaderInput }
  | { type: 'row'; row: SettingsRow };

// A section's drawing: `entries` in order, group headers among the rows.
export interface SectionDrawing {
  entries: SectionEntry[];
  rows: SettingsRow[];
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
  commitKeymap(layer: UserKeymap, via: CommitVia): void;
  toast(text: string, tone: ToastTone): void;
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
  setScope(scope: 'sections' | 'rows'): void;
  // Hands over the target the focus keys move between the sections and the
  // rows; the view calls it after each `setScope`, since a change of the set
  // scope drops it.
  setFocusTarget(target: FocusTarget): void;
  // True while the side bar lies beside or over the rows: the focus keys
  // move to the sections only then.
  isSideBarShown(): boolean;
  pushScope(scope: 'box'): PushedScope;
  picker: ListPickerService;
  addOverlay(element: HTMLElement): Disposable;
  // Keeps the keys of the settings `command` drawn in `element`, shown while
  // `scope` is in force, followed by `label` (true: the command's label): the
  // cursor prompt's keys, which the app draws in each layout.
  anchor(
    element: HTMLElement,
    command: SettingsCommand,
    scope: 'sections' | 'rows',
    label?: boolean | string,
  ): Disposable;
  // The open section's title, for the title bar.
  sectionShown(title: string): void;
  // Hears each section the user opens from the side bar, by click or Enter.
  sectionPicked(): void;
}

export type SettingsCommand =
  | 'down'
  | 'up'
  | 'top'
  | 'bottom'
  | 'open'
  | 'edit'
  | 'reset'
  | 'addBind'
  | 'removeBind'
  | 'filter'
  | 'clearFilter'
  | 'boxAccept'
  | 'boxCancel'
  | 'pickerDown'
  | 'pickerUp'
  | 'pickerChoose'
  | 'pickerCancel';

// Settings mode's view: the sections for the side bar, the open section's
// rows in the sheet, the one box or picker open over them, and the reads and
// writes behind them, logging under `settings`. The panes, rows and picker
// rows draw through the settings layout; `default` draws until the first
// `setLayouts`. `load` reads the schema and both files; `reread` reads the
// files again and redraws (the channel's `changed`); `shown` runs as the mode
// shows: the first time it opens the first section with focus on the side
// bar, and each time it sets the scope where focus was left. The keys show
// where they act: the cursor row's actions in its layout's `rowActions` slot.
// `setLayouts` draws everything again in the new layouts, keeping the cursor,
// the open section, the focus side, an open box or filter and an open picker.
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
  commands: Record<SettingsCommand, () => void>;
}

// The cursor prompt's label for each action it shows.
const PROMPT_LABELS: Record<PromptAction, string> = {
  edit: 'edit',
  addBind: 'add',
  removeBind: 'remove',
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

  // Draws a row's `part` with its `input` into `parent`.
  const drawSettingsRow = <P extends keyof RowInputs>(
    { part, input }: RowPartOf<P>,
    parent: HTMLElement,
  ): DrawnPart<BuiltRow> =>
    rowParts.draw(part, parent, (draw, rowParent, rollback) =>
      buildRow(draw, rowParent, input, services, rollback, part),
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
    clicked: (index) => {
      sectionsCursor = index;
      focusSections();
      openSection(index);
      deps.sectionPicked();
    },
  });
  const rowsSheet = sheet();
  rowsSheet.classList.add('settings-sheet');
  rowsSheet.tabIndex = -1;

  // The cursor row's action keys; `markCursor` moves the prompt into the
  // cursor row's actions slot and shows the keys of the actions that row has.
  const rowPrompt = element('span', 'settings-row-actions');
  const promptHints: Record<PromptAction, HTMLElement> = {
    edit: anchored('edit', 'rows', PROMPT_LABELS.edit),
    addBind: anchored('addBind', 'rows', PROMPT_LABELS.addBind),
    removeBind: anchored('removeBind', 'rows', PROMPT_LABELS.removeBind),
    reset: anchored('reset', 'rows', PROMPT_LABELS.reset),
  };
  rowPrompt.append(
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

  const picker = deps.picker.create();

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
  let filterScope: PushedScope | null = null;
  let rows: SettingsRow[] = [];
  // Each drawn row by its key, and the dispose of every part drawn into the
  // rows pane's slots.
  let drawnRows = new Map<string, BuiltRow>();
  let entryDisposes: (() => void)[] = [];
  let cursorKey: string | null = null;
  let openBox: OpenBox | null = null;

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
    KEYMAP_SECTION,
  ];

  const sectionFile = (): ConfigFile =>
    openSectionId === KEYMAP_SECTION.id ? 'keymap' : 'settings';

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
    if (cursorKey !== null) {
      drawnRows.get(cursorKey)?.element.scrollIntoView({ block: 'nearest' });
    }
  };

  // The build of a group header, empty state or problem card for `input`.
  const entryBuild =
    <I>(input: I) =>
    (draw: EntryDraw<I>, parent: HTMLElement, rollback: RollbackDeps) =>
      buildEntry(draw, parent, input, 'rows', services, rollback);

  // Draws `row` into `parent`; a click on it outside its box moves the
  // cursor to it.
  const drawRowEntry = (row: SettingsRow, parent: HTMLElement) => {
    const drawn = drawSettingsRow(row.draw, parent);
    entryDisposes.push(drawn.dispose);
    drawnRows.set(row.key, drawn.built);
    drawn.built.element.addEventListener('click', (event) => {
      const isInBox =
        event.target instanceof Element &&
        event.target.closest('.settings-box') !== null;
      if (!isInBox && openBox === null) {
        setCursor(row.key);
        focusRows();
      }
    });
  };

  const drawRows = () => {
    if (schema === null || latest === null) {
      return;
    }
    const section = schema.sections.find((each) => each.id === openSectionId);
    const drawing =
      section === undefined
        ? keymapSection(context, query)
        : settingSection(section, context, query);
    rows = drawing.rows;
    if (!rows.some((row) => row.key === cursorKey)) {
      setCursor(rows[0]?.key ?? null);
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
    for (const entry of drawing.entries) {
      if (entry.type === 'header') {
        const drawn = parts.draw(
          'groupHeader',
          rowList,
          entryBuild(entry.input),
        );
        entryDisposes.push(drawn.dispose);
      } else {
        drawRowEntry(entry.row, rowList);
      }
    }
    const isEmpty = query.trim() !== '' && rows.length === 0;
    if (isEmpty) {
      const drawn = parts.draw('empty', rowList, entryBuild({ query }));
      entryDisposes.push(drawn.dispose);
    }
    markCursor();
  };

  // Redraws the rows, and first the rows pane when `isPaneRedrawn`; the open
  // box moves into its row's new box slot with its focus and text kept; a box
  // whose row is no longer drawn, or whose file is now broken, closes, so it
  // never writes over the broken file.
  const draw = (isPaneRedrawn = false) => {
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
      const drawn = drawnRows.get(held.box.key);
      drawn?.box.append(held.box.element);
    });
    const isRowGone = !rows.some((row) => row.key === held.box.key);
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

  // `right` from the sections focuses the rows and `left` from the rows the
  // sections while the side bar shows; every other move leaves focus where it
  // is.
  const focusTarget: FocusTarget = {
    move(direction) {
      if (focus === 'sections' && direction === 'right') {
        focusRows();
        return true;
      }
      if (focus === 'rows' && direction === 'left' && deps.isSideBarShown()) {
        focusSections();
        return true;
      }
      return false;
    },
  };

  // Each focus change closes an open filter first: `setScope` leaves the
  // filter's pushed scope in force.
  const focusRows = () => {
    if (filterScope !== null) {
      logFilter();
      closeFilter();
    }
    focus = 'rows';
    deps.setScope('rows');
    deps.setFocusTarget(focusTarget);
    rowsSheet.focus();
    markCursor();
  };

  const focusSections = () => {
    if (filterScope !== null) {
      logFilter();
      closeFilter();
    }
    focus = 'sections';
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
    const row = rows.find((each) => each.key === request.key);
    if (row === undefined) {
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
    const drawn = drawnRows.get(row.key);
    (drawn?.box ?? drawn?.element)?.append(box.element);
    box.focus();
    log(`box open ${request.key}`);
  };

  const commit = async (
    file: ConfigFile,
    write: (expectedText: string | null) => Promise<ConfigWriteResult>,
    isUnchanged: boolean,
    via: CommitVia,
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
        if (box !== null) {
          closeBox(box);
        }
        await refresh(true);
        return;
      case 'refused':
        log(`refused ${name}: ${result.problem}`);
        if (box !== null && isBoxOpen()) {
          showUnderBox(box, result.problem);
        } else {
          deps.toast(result.problem, 'error');
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
        drawRow(list, _item, { label, trailing }) {
          const drawn = parts.draw(
            'pickerRow',
            list,
            (pickerRow, parent, rollback) =>
              buildPickerRow(
                pickerRow,
                parent,
                { picker: request.title, label },
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
    commitKeymap(layer, via) {
      commitQuietly(
        commit(
          'keymap',
          (expectedText) => channel.invoke('writeKeymap', layer, expectedText),
          isSameJson(keymapLayer ?? {}, layer),
          via,
        ),
      );
    },
    toast: deps.toast,
  };

  const openSection = (index: number) => {
    const section = sectionList()[index];
    if (section === undefined) {
      return;
    }
    openSectionId = section.id;
    hasOpenedSection = true;
    query = '';
    filterBox.value = '';
    filterFrame.hidden = true;
    openSectionTitle = section.title;
    log(`section ${section.id}`);
    deps.sectionShown(section.title);
    cursorKey = null;
    draw(true);
  };

  // The first show opens the first section, once the schema names it.
  const openFirstSection = () => {
    if (hasShown && !hasOpenedSection && schema !== null) {
      openSection(0);
    }
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
    if (openBox !== null || picker.isOpen()) {
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

  const openFilter = () => {
    if (filterScope !== null || openBox !== null) {
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

  filterBox.addEventListener('input', () => {
    query = filterBox.value;
    draw();
  });

  const commands: Record<SettingsCommand, () => void> = {
    down: () =>
      move(
        () => sectionsCursor + 1,
        (index) => index + 1,
      ),
    up: () =>
      move(
        () => sectionsCursor - 1,
        (index) => index - 1,
      ),
    top: () =>
      move(
        () => 0,
        () => 0,
      ),
    bottom: () =>
      move(
        (count) => count - 1,
        (_index, count) => count - 1,
      ),
    open() {
      if (focus === 'sections') {
        openSection(sectionsCursor);
        deps.sectionPicked();
        return;
      }
      runQuietly('open', true)();
    },
    edit: runQuietly('edit', true),
    reset: runQuietly('reset', false),
    addBind: runQuietly('addBind', true),
    removeBind: runQuietly('removeBind', true),
    filter: openFilter,
    clearFilter() {
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
    pickerDown: () => picker.down(),
    pickerUp: () => picker.up(),
    pickerChoose: () => picker.choose(),
    pickerCancel: () => picker.cancel(),
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
    commands,
  };
}
