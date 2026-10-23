import type { Disposable } from '../../../contracts/disposable';
import type { EditorHost } from '../../../contracts/editor';
import type { UserKeymap } from '../../../contracts/keymap';
import type { Platform } from '../../../contracts/platform';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import type { Log } from '../../../contracts/log';
import type {
  ConfigWriteResult,
  UserConfigRead,
  UserConfigSchema,
} from '../../../contracts/user-config';
import { errorText } from '../../../shared/error-text';
import { isSameJson } from '../../../shared/json';
import { element } from '../../../shared/page/dom';
import {
  createListPicker,
  type ListPicker,
} from '../../../shared/page/list-picker';
import { textBoxInput } from '../../../shared/page/text-box';
import { card } from '../../../shared/page/ui/card';
import { emptyState } from '../../../shared/page/ui/empty-state';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { sheet } from '../../../shared/page/ui/sheet';
import type { SettingsChannel } from '../contract';
import { keymapSection } from './keymap-view';
import { type BoxRequest, createRowBox, type RowBox } from './row-box';
import { createSectionsView } from './sections-view';
import { settingSection } from './setting-rows-view';

// The user config file a row edits.
export type ConfigFile = 'settings' | 'keymap';

const FILE_NAMES: Record<ConfigFile, string> = {
  settings: 'settings.json',
  keymap: 'keymap.json',
};

const KEYMAP_SECTION = { id: 'keymap', title: 'Keymap' };

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

// One drawn row: `key` names it in the cursor and log lines (a setting's
// path, a command id, `leader` or `advanced`).
export interface SettingsRow {
  key: string;
  file: ConfigFile;
  element: HTMLElement;
  actions: RowActions;
}

// A section's drawing: `items` in order, headers among the rows' elements.
export interface SectionDrawing {
  items: HTMLElement[];
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
  platform: Platform;
  read(): UserConfigRead;
  settingsLayer(): Record<string, unknown> | null;
  keymapLayer(): UserKeymap | null;
  openBox(request: BoxRequest): void;
  closeBox(box: RowBox): void;
  // Logs the problem and shows it under the box, which stays open.
  boxProblem(box: RowBox, problem: string): void;
  openPicker<T>(request: PickRequest<T>): void;
  commitSettings(layer: Record<string, unknown>, via: CommitVia): void;
  commitKeymap(layer: UserKeymap, via: CommitVia): void;
  toast(text: string, tone: ToastTone): void;
}

export interface SettingsViewDeps {
  channel: PageChannel<SettingsChannel>;
  editor: EditorHost;
  platform: Platform;
  log: Log;
  toast(text: string, tone: ToastTone): void;
  setScope(scope: 'sections' | 'rows'): void;
  pushScope(scope: 'box' | 'picker'): PushedScope;
  addOverlay(element: HTMLElement): Disposable;
  // The keys of `settings.clearFilter` in the rows, null when unbound.
  clearFilterKeys(): string | null;
  kbd(keys: string): HTMLElement;
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
  | 'focusSections'
  | 'focusRows'
  | 'boxAccept'
  | 'boxCancel'
  | 'pickerDown'
  | 'pickerUp'
  | 'pickerChoose'
  | 'pickerCancel';

// Settings mode's view: the sections for the side bar, the open section's
// rows in the sheet, the one box or picker open over them, and the reads and
// writes behind them, logging under `settings`. `load` reads the schema and
// both files; `reread` reads the files again and redraws (the channel's
// `changed`); `shown` runs as the mode shows: the first time it opens the
// first section with focus on the side bar, and each time it sets the scope
// where focus was left.
export interface SettingsView {
  sideBar: HTMLElement;
  sheet: HTMLElement;
  load(): Promise<void>;
  reread(): void;
  shown(): void;
  // The side bar was hidden: focus leaves it for the rows.
  sideBarHidden(): void;
  keysChanged(): void;
  commands: Record<SettingsCommand, () => void>;
}

interface OpenBox {
  box: RowBox;
  file: ConfigFile;
  scope: PushedScope;
}

export function createSettingsView(deps: SettingsViewDeps): SettingsView {
  const { channel } = deps;
  const log = (message: string) => deps.log('settings', message);
  const sections = createSectionsView({
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
  const filterFrame = inputFrame();
  filterFrame.classList.add('settings-filter');
  filterFrame.hidden = true;
  const filterBox = textBoxInput('settings-box-input');
  filterFrame.append(filterBox);
  const brokenSlot = element('div', 'settings-broken');
  const list = element('ol', 'settings-rows');
  rowsSheet.append(filterFrame, brokenSlot, list);

  const picker: ListPicker = createListPicker({
    pushScope: () => deps.pushScope('picker'),
    log: deps.log,
    logSource: 'settings',
  });
  deps.addOverlay(picker.element);

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
  let hasShown = false;
  let hasOpenedSection = false;
  let focus: 'sections' | 'rows' = 'sections';
  let query = '';
  let filterScope: PushedScope | null = null;
  let rows: SettingsRow[] = [];
  let cursorKey: string | null = null;
  let openBox: OpenBox | null = null;

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

  // Marks the cursor row selected, and draws its focus ring while the keys
  // act on the rows: an open box or filter draws its own ring instead. The
  // pane without focus is marked inactive, so its selected row takes the
  // inactive selection fill.
  const markCursor = () => {
    const isRowsFocused =
      focus === 'rows' && openBox === null && filterScope === null;
    rowsSheet.classList.toggle('is-pane-inactive', focus !== 'rows');
    sections.element.classList.toggle('is-pane-inactive', focus !== 'sections');
    for (const row of rows) {
      const isCursor = row.key === cursorKey;
      row.element.classList.toggle('is-selected', isCursor);
      row.element.classList.toggle('is-cursor', isCursor && isRowsFocused);
    }
    sections.draw(
      sectionList(),
      sectionsCursor,
      openSectionId,
      focus === 'sections',
    );
    rows
      .find((row) => row.key === cursorKey)
      ?.element.scrollIntoView({ block: 'nearest' });
  };

  const brokenCard = (file: ConfigFile, problem: string) => {
    const shown = card('error');
    shown.textContent = `${FILE_NAMES[file]} has a problem: ${problem}`;
    return shown;
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
    for (const row of rows) {
      row.element.addEventListener('click', (event) => {
        const isInBox =
          event.target instanceof Element &&
          event.target.closest('.settings-box') !== null;
        if (!isInBox && openBox === null) {
          setCursor(row.key);
          focusRows();
        }
      });
    }
    if (!rows.some((row) => row.key === cursorKey)) {
      setCursor(rows[0]?.key ?? null);
    }
    const file = sectionFile();
    const read = latest[file];
    brokenSlot.replaceChildren(
      ...(read.state === 'broken' ? [brokenCard(file, read.problem)] : []),
    );
    const items = [...drawing.items];
    const isEmpty = query !== '' && rows.length === 0;
    if (isEmpty) {
      const keys = deps.clearFilterKeys();
      items.push(
        emptyState(
          `No rows match "${query}".`,
          keys === null ? null : deps.kbd(keys),
        ),
      );
    }
    list.replaceChildren(...items);
    markCursor();
  };

  // Redraws the rows, the open box moving into its row's new element with
  // its focus and text kept; a box whose row is no longer drawn, or whose
  // file is now broken, closes, so it never writes over the broken file.
  const draw = () => {
    const held = openBox;
    if (held === null) {
      drawRows();
      return;
    }
    held.box.keepFocusAcross(() => {
      drawRows();
      rows
        .find((row) => row.key === held.box.key)
        ?.element.append(held.box.element);
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

  // Each focus change closes an open filter first: `setScope` leaves the
  // filter's pushed scope in force.
  const focusRows = () => {
    if (filterScope !== null) {
      logFilter();
      closeFilter();
    }
    focus = 'rows';
    deps.setScope('rows');
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
    held.scope.pop();
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
    row.element.append(box.element);
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
    log(`section ${section.id}`);
    deps.sectionShown(section.title);
    cursorKey = null;
    draw();
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
    filterFrame.hidden = query === '';
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
      if (query === '') {
        return;
      }
      query = '';
      filterBox.value = '';
      filterFrame.hidden = true;
      draw();
      logFilter();
    },
    focusSections,
    focusRows,
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
    keysChanged: draw,
    commands,
  };
}
