import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { EditorHost, ScrollStep } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Paths } from '../../../contracts/paths';
import type { Platform } from '../../../contracts/platform';
import type {
  CommandsRunIn,
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { scrollContent, scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { createConfirmPrompt } from '../../../shared/page/confirm-prompt';
import { element, markdownElement } from '../../../shared/page/dom';
import { keyHint } from '../../../shared/page/key-hint';
import {
  createListPicker,
  type ListPicker,
} from '../../../shared/page/list-picker';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { textBoxInput } from '../../../shared/page/text-box';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { emptyState } from '../../../shared/page/ui/empty-state';
import { icon } from '../../../shared/page/ui/icon';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { row } from '../../../shared/page/ui/row';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { sheet } from '../../../shared/page/ui/sheet';
import { createSplit } from '../../../shared/page/ui/split';
import { tag } from '../../../shared/page/ui/tag';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type { BacklogChannel, BacklogEdit, BacklogHome } from '../contract';
import type { backlogManifest } from '../manifest';
import {
  AGENT_READY,
  actedFollowup,
  actedHome,
  actedRow,
  type BacklogRow,
  type BacklogState,
  backlogReducer,
  type EmptyReason,
  editorEdit,
  emptyReason,
  initialBacklogState,
  isDraftChanged,
  openHome,
  orderedHomes,
  rowTitle,
  selectedRow,
  tagsOf,
  visibleRows,
  withTagToggled,
} from './backlog-state';
import { createFollowupEditor } from './followup-editor';

const PLUGIN_ID = 'backlog';

// The base scopes the view sets; the box, confirm and picker scopes are
// pushed over them.
export type BacklogBaseScope = 'list' | 'detail' | 'editor';

type BacklogPushedScope = 'box' | 'confirm' | 'picker';

// Every page command but `showMode`, which the page part runs itself.
export type BacklogCommand = Exclude<
  CommandsRunIn<typeof backlogManifest, 'page'>,
  'showMode'
>;

// The list's start pane width limits in CSS pixels.
const LIST_SPLIT = { initial: 380, min: 240, max: 720 };

const SECTION_TITLES: Record<BacklogRow['kind'], string> = {
  followup: 'Follow-ups',
  plan: 'Plans',
  feature: 'Features',
  task: '',
};

export interface BacklogViewDeps {
  channel: PageChannel<BacklogChannel>;
  editor: EditorHost;
  markdown: MarkdownRenderer;
  paths: Paths;
  homeDir: string;
  uiState: UiState;
  log: Log;
  toast(text: string, tone: ToastTone): void;
  platform: Platform;
  keys: KeysPageExports;
  // The `tags` setting as the user config now sets it.
  tags(): readonly string[];
  openDoc(path: string, line?: number): void;
  setScope(scope: BacklogBaseScope): void;
  pushScope(scope: BacklogPushedScope): PushedScope;
  addOverlay(element: HTMLElement): Disposable;
  run(command: CommandId): void;
  isShown(): boolean;
  // Opens the mode's side bar when it is hidden.
  revealSideBar(): void;
  // Hears each home the user opens from the side bar, by click or key.
  homePicked(): void;
  // The open home, for the title bar; null with none open.
  homeShown(home: BacklogHome | null): void;
}

// Backlog mode's view: the homes for the side bar, the open home's rows and
// the detail in the sheet, the follow-up editor, and the reads and writes
// behind them, logging under `backlog`. Every decision about what shows lives
// in `backlogReducer`; the view draws its state after each change. `load`
// reads the homes; `reload` reads them again (the channel's `changed`);
// `shown` sets the scope and focus where the keys were left.
export interface BacklogView {
  sideBar: HTMLElement;
  sheet: HTMLElement;
  load(): void;
  reload(): void;
  shown(): void;
  // The side bar was hidden: focus leaves it for the rows.
  sideBarHidden(): void;
  // The side bar opened over the rows: focus moves to it.
  sideBarOpenedOver(): void;
  keysChanged(): void;
  commands: Record<BacklogCommand, () => void>;
}

export function createBacklogView(deps: BacklogViewDeps): BacklogView {
  const { channel, paths, homeDir } = deps;
  const log = (message: string) => deps.log(PLUGIN_ID, message);
  const tilde = (path: string) => paths.tilde(path, homeDir);
  const keysFor = (command: BacklogCommand, scope: string) =>
    deps.keys.keysFor(qualify(PLUGIN_ID, command), qualify(PLUGIN_ID, scope));
  const hint = (command: BacklogCommand, scope: string) =>
    keyHint(keysFor(command, scope), deps.platform);

  const store = createReducerStore(initialBacklogState(), backlogReducer);
  const dispatch = store.dispatch;

  // ── Elements ───────────────────────────────────────────────────────────
  const homesPane = element('div', 'backlog-homes');
  homesPane.tabIndex = -1;
  const status = element('div', 'backlog-status');
  status.hidden = true;
  const homesList = element('ol', 'backlog-home-rows');
  homesPane.append(status, homesList);

  const listPane = element('div', 'backlog-list');
  listPane.tabIndex = -1;
  const filterFrame = inputFrame();
  filterFrame.classList.add('backlog-filter');
  filterFrame.hidden = true;
  const filterBox = textBoxInput('backlog-filter-input');
  filterFrame.append(filterBox);
  const rowsList = element('ol', 'backlog-rows');
  listPane.append(filterFrame, rowsList);

  const detailPane = element('div', 'backlog-detail');
  detailPane.tabIndex = -1;
  const detailBody = element('div', 'backlog-detail-body');
  const followupEditor = createFollowupEditor({
    editor: deps.editor,
    log: deps.log,
    changed: (field, text) => dispatch({ type: 'draftChanged', field, text }),
    hints: () => editorHints(),
  });
  detailPane.append(detailBody, followupEditor.element);

  const split = createSplit({
    ...LIST_SPLIT,
    uiState: deps.uiState,
    stateKey: 'listWidth',
  });
  split.element.classList.add('backlog-split');
  split.start.append(listPane);
  split.end.append(detailPane);
  const contentSheet = sheet();
  contentSheet.classList.add('backlog-sheet');
  contentSheet.append(split.element);

  const picker: ListPicker = createListPicker({
    pushScope: () => deps.pushScope('picker'),
    log: deps.log,
    logSource: PLUGIN_ID,
  });
  deps.addOverlay(picker.element);

  const confirmCommand = (command: BacklogCommand) =>
    qualify(PLUGIN_ID, command);
  const promptDeps = {
    scope: qualify(PLUGIN_ID, 'confirm'),
    keys: deps.keys,
    run: deps.run,
    platform: deps.platform,
    pushScope: () => deps.pushScope('confirm'),
    isSending: () => false,
    dismiss: () => dispatch({ type: 'dismissConfirm' }),
    onBaseChanged: () => undefined,
    log: deps.log,
    logSource: PLUGIN_ID,
  };
  const deletePrompt = createConfirmPrompt({
    ...promptDeps,
    title: 'Delete this follow-up?',
    body: 'The follow-up leaves its file.',
    keep: { label: 'Keep it', command: confirmCommand('confirmNo') },
    confirm: { label: 'Delete', command: confirmCommand('confirmYes') },
    isAsked: () => store.get().confirm?.kind === 'delete',
  });
  const discardPrompt = createConfirmPrompt({
    ...promptDeps,
    title: 'Discard your changes?',
    body: 'Your changes are lost; the file stays as it was.',
    keep: { label: 'Keep editing', command: confirmCommand('confirmNo') },
    confirm: { label: 'Discard', command: confirmCommand('confirmYes') },
    isAsked: () => store.get().confirm?.kind === 'discard',
  });
  deps.addOverlay(deletePrompt.element);
  deps.addOverlay(discardPrompt.element);

  // ── Drawing ────────────────────────────────────────────────────────────
  let filterScope: PushedScope | null = null;
  let loadCount = 0;
  let loadedCount = 0;
  let isSaving = false;
  let shownSelectedKey: string | null = null;
  let shownOpenRoot: string | null = null;
  let shownFocus: string | null = null;
  let shownDetailKey: string | null = null;
  let detailRequest = 0;

  const scopeOf = (state: BacklogState): BacklogBaseScope => {
    if (state.editor !== null) {
      return 'editor';
    }
    return state.focus === 'detail' ? 'detail' : 'list';
  };

  const drawHomes = (state: BacklogState) => {
    const homes = orderedHomes(state);
    const statusText =
      state.message ??
      (state.isLoaded && homes.length === 0 ? 'No features homes found' : null);
    status.hidden = statusText === null;
    status.textContent = statusText ?? '';
    status.title = statusText ?? '';
    const items: HTMLElement[] = [];
    let repo: string | null = null;
    homes.forEach((home, index) => {
      if (home.repo !== repo) {
        repo = home.repo;
        const header = sectionHeader(home.repo);
        header.classList.add('backlog-repo');
        items.push(header);
      }
      const shown = row({
        density: 'list',
        tag: 'li',
        label: tilde(home.root),
        depth: 1,
        trailing: home.uncommitted ? tag('uncommitted') : null,
        onClick: () => {
          dispatch({ type: 'openHome', root: home.root });
          deps.homePicked();
        },
      });
      shown.title = home.root;
      shown.classList.toggle('is-selected', home.root === state.openRoot);
      shown.classList.toggle(
        'is-cursor',
        state.focus === 'homes' && index === state.homeCursor,
      );
      items.push(shown);
    });
    homesList.replaceChildren(...items);
    homesPane.classList.toggle('is-pane-inactive', state.focus !== 'homes');
    homesList.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  const tagsElement = (tags: readonly string[]): HTMLElement | null => {
    if (tags.length === 0) {
      return null;
    }
    const shown = element('span', 'backlog-tags');
    shown.append(
      ...tags.map((each) =>
        tag(each, each === AGENT_READY ? 'accent' : 'neutral'),
      ),
    );
    return shown;
  };

  const progress = (checked: number, total: number) =>
    `${String(checked)}/${String(total)}`;

  const rowElement = (shown: BacklogRow): HTMLElement => {
    const select = () => {
      dispatch({ type: 'select', key: shown.key });
      dispatch({ type: 'focus', focus: 'items' });
    };
    switch (shown.kind) {
      case 'followup':
        return row({
          density: 'list',
          tag: 'li',
          label: shown.item.title,
          detail: shown.item.oneLine,
          trailing: tagsElement(shown.item.tags),
          onClick: select,
        });
      case 'plan':
        return row({
          density: 'list',
          tag: 'li',
          leading: icon(shown.isExpanded ? 'chevron-down' : 'chevron-right'),
          label: shown.plan.title,
          detail: [
            shown.plan.feature,
            progress(shown.plan.checked, shown.plan.total),
            shown.plan.target,
          ]
            .filter((part) => part !== null)
            .join(' · '),
          onClick: select,
        });
      case 'feature':
        return row({
          density: 'list',
          tag: 'li',
          leading: icon(shown.isExpanded ? 'chevron-down' : 'chevron-right'),
          label: shown.feature.slug,
          detail: progress(shown.feature.checked, shown.feature.total),
          onClick: select,
        });
      case 'task':
        return row({
          density: 'list',
          tag: 'li',
          label: shown.task.title,
          detail: shown.task.status,
          depth: 1,
          onClick: select,
        });
    }
  };

  const emptyRows = (reason: EmptyReason, filter: string): HTMLElement => {
    switch (reason) {
      case 'noHome':
        return emptyState(
          'Open a features home from the side bar.',
          hint('back', 'list'),
        );
      case 'filter':
        return emptyState(`No rows match "${filter}".`);
      case 'allDone':
        return emptyState('Every follow-up here is done.');
      case 'agentReadyNone':
        return emptyState('No agent-ready follow-ups here.');
      case 'nothing':
        return emptyState('Nothing is planned here.', hint('create', 'list'));
    }
  };

  const drawRows = (state: BacklogState) => {
    const rows = visibleRows(state);
    const items: HTMLElement[] = [];
    let section: BacklogRow['kind'] | null = null;
    for (const shown of rows) {
      if (shown.kind !== 'task' && shown.kind !== section) {
        section = shown.kind;
        items.push(sectionHeader(SECTION_TITLES[shown.kind]));
      }
      const drawn = rowElement(shown);
      const isSelected = shown.key === state.selectedKey;
      drawn.classList.toggle('is-selected', isSelected);
      drawn.classList.toggle(
        'is-cursor',
        isSelected && state.focus === 'items' && filterScope === null,
      );
      items.push(drawn);
    }
    const reason = emptyReason(state);
    if (reason !== null) {
      items.push(emptyRows(reason, state.filter));
    }
    rowsList.replaceChildren(...items);
    listPane.classList.toggle('is-pane-inactive', state.focus !== 'items');
    filterFrame.hidden = filterScope === null && state.filter === '';
    if (filterScope === null) {
      filterBox.value = state.filter;
    }
    rowsList
      .querySelector('.is-selected')
      ?.scrollIntoView({ block: 'nearest' });
  };

  const followupDetail = (
    shown: Extract<BacklogRow, { kind: 'followup' }>,
  ): HTMLElement => {
    const { item } = shown;
    const body = element('div', 'backlog-followup');
    body.append(element('h2', 'backlog-detail-title', item.title));
    const tags = tagsElement(item.tags);
    if (tags !== null) {
      body.append(tags);
    }
    body.append(
      markdownElement(
        'div',
        'backlog-detail-line',
        deps.markdown.inline(item.oneLine),
      ),
      markdownElement('div', 'md', deps.markdown.block(item.body)),
    );
    return body;
  };

  const docPathOf = (shown: BacklogRow): string => {
    switch (shown.kind) {
      case 'followup':
        return shown.path;
      case 'plan':
        return shown.plan.path;
      case 'feature':
        return shown.feature.path;
      case 'task':
        return shown.task.path;
    }
  };

  // Reads and renders a plan, feature or task file; a read overtaken by a
  // later selection draws nothing.
  const showDoc = (path: string) => {
    const request = ++detailRequest;
    channel
      .invoke('readDoc', path)
      .then((text) => deps.markdown.document(text))
      .then((html) => {
        if (request === detailRequest) {
          detailBody.replaceChildren(markdownElement('div', 'md', html));
          detailPane.scrollTop = 0;
        }
      })
      .catch((error) => {
        log(`not read ${path}: ${errorText(error)}`);
        if (request === detailRequest) {
          detailBody.replaceChildren(emptyState(errorText(error)));
        }
      });
  };

  // Draws the selected row's detail when the row, its text or the load it
  // came from changed since the last draw.
  const drawDetail = (state: BacklogState) => {
    const shown = selectedRow(state);
    detailBody.hidden = state.editor !== null;
    let key: string | null = null;
    if (shown !== null) {
      key =
        shown.kind === 'followup'
          ? `${shown.key}\n${JSON.stringify(shown.item)}`
          : `${shown.key}\n${String(loadedCount)}`;
    }
    if (key === shownDetailKey) {
      return;
    }
    shownDetailKey = key;
    detailRequest += 1;
    detailPane.scrollTop = 0;
    if (shown === null) {
      detailBody.replaceChildren();
    } else if (shown.kind === 'followup') {
      detailBody.replaceChildren(followupDetail(shown));
    } else {
      showDoc(docPathOf(shown));
    }
  };

  const editorHints = (): HTMLElement[] =>
    [
      { command: 'save' as const, text: 'Save' },
      { command: 'cancelEdit' as const, text: 'Cancel' },
      { command: 'nextField' as const, text: 'Next field' },
      { command: 'pickTag' as const, text: 'Pick a tag' },
    ].flatMap(({ command, text }) => {
      const keys = hint(command, 'editor');
      if (keys === null) {
        return [];
      }
      const part = element('span', 'backlog-editor-hint', text);
      part.append(keys);
      return [part];
    });

  const syncEditor = (state: BacklogState) => {
    const { editor } = state;
    if (editor !== null && !followupEditor.isOpen()) {
      followupEditor.open(
        editor.kind === 'create' ? 'New follow-up' : 'Edit follow-up',
        editor.draft,
      );
      log(`editor open ${editor.kind}`);
      followupEditor.focus('title', { insertAtEnd: true });
    } else if (editor === null && followupEditor.isOpen()) {
      followupEditor.close();
      log('editor closed');
    }
  };

  // Moves the DOM focus to the pane the keys act on, when that changed.
  const syncFocus = (state: BacklogState, always: boolean) => {
    const focus = state.editor === null ? state.focus : 'editor';
    if (!deps.isShown() || (!always && focus === shownFocus)) {
      return;
    }
    shownFocus = focus;
    switch (focus) {
      case 'homes':
        homesPane.focus();
        return;
      case 'items':
        listPane.focus();
        return;
      case 'detail':
        detailPane.focus();
        return;
      case 'editor':
        if (!followupEditor.hasFocusedBox()) {
          followupEditor.element.focus();
        }
    }
  };

  const logChanges = (state: BacklogState) => {
    if (state.openRoot !== shownOpenRoot) {
      shownOpenRoot = state.openRoot;
      const home = openHome(state);
      deps.homeShown(home);
      if (home !== null) {
        log(`opened ${home.repo} ${tilde(home.root)}`);
      }
    }
    if (state.selectedKey !== shownSelectedKey) {
      shownSelectedKey = state.selectedKey;
      const shown = selectedRow(state);
      if (shown !== null) {
        log(`selected ${rowTitle(shown)}`);
      }
    }
  };

  const render = (always = false) => {
    deletePrompt.settleOwedDismiss();
    discardPrompt.settleOwedDismiss();
    const state = store.get();
    drawHomes(state);
    drawRows(state);
    syncEditor(state);
    drawDetail(state);
    logChanges(state);
    deletePrompt.setBaseScope(() =>
      discardPrompt.setBaseScope(() => {
        if (deps.isShown()) {
          deps.setScope(scopeOf(state));
        }
      }),
    );
    syncFocus(state, always);
  };
  store.subscribe(() => render());

  // ── Reads and writes ───────────────────────────────────────────────────
  // A read overtaken by a later one is dropped.
  const read = async (method: 'load' | 'rescan') => {
    const count = ++loadCount;
    const result = await channel.invoke(method);
    if (count !== loadCount) {
      return;
    }
    loadedCount += 1;
    dispatch({ type: 'loaded', read: result });
    log(`loaded ${String(result.homes.length)} homes`);
  };

  // Logs and toasts a failed read in place of throwing it.
  const readQuietly = (method: 'load' | 'rescan'): Promise<void> =>
    read(method).catch((error) => {
      log(`not loaded: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
    });

  // Sends `edit`, logs and toasts its result, and reloads on `applied`.
  // `isDraftKept`: an open editor keeps the user's draft when the write
  // does not apply. Resolves to whether it applied, a failed reload after
  // an applied write included.
  const write = async (
    homeRoot: string,
    path: string | null,
    edit: BacklogEdit,
    isDraftKept: boolean,
  ): Promise<boolean> => {
    const result = await channel.invoke('applyEdit', homeRoot, path, edit);
    log(`wrote ${path ?? tilde(homeRoot)} ${result.type}`);
    switch (result.type) {
      case 'applied':
        await readQuietly('load');
        return true;
      case 'missing':
        deps.toast(
          isDraftKept
            ? `${result.title} is gone from the file; your draft is kept`
            : `${result.title} is gone from the file`,
          'error',
        );
        return false;
      case 'titleTaken':
        deps.toast(
          `A follow-up titled ${result.title} is already in the file`,
          'error',
        );
        return false;
      case 'changed':
        deps.toast(
          isDraftKept
            ? `${result.title} changed on disk; your draft is kept`
            : `${result.title} changed on disk`,
          'error',
        );
        return false;
      case 'refused':
        deps.toast(result.reason, 'error');
        return false;
    }
  };

  const writeQuietly = (
    homeRoot: string,
    path: string | null,
    edit: BacklogEdit,
  ) => {
    write(homeRoot, path, edit, false).catch((error) => {
      log(`write failed: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
    });
  };

  const setTags = (tags: string[]) => {
    const shown = actedFollowup(store.get());
    const home = openHome(store.get());
    if (shown === null || home === null) {
      return;
    }
    writeQuietly(home.root, shown.path, {
      type: 'setTags',
      title: shown.item.title,
      tags,
    });
  };

  const save = async () => {
    const { editor } = store.get();
    if (editor === null || isSaving) {
      return;
    }
    const edit = editorEdit(editor);
    const { draft } = edit;
    if (draft.title === '') {
      deps.toast('Give the follow-up a title', 'error');
      return;
    }
    isSaving = true;
    try {
      if (await write(editor.homeRoot, editor.path, edit, true)) {
        dispatch({ type: 'closeEditor' });
        dispatch({ type: 'selectFollowup', title: draft.title });
      }
    } finally {
      isSaving = false;
    }
  };

  const commit = async () => {
    const home = actedHome(store.get());
    if (home === null) {
      return;
    }
    const root = tilde(home.root);
    if (home.gitRoot === null) {
      deps.toast(`${root} is not in git`, 'error');
      return;
    }
    try {
      const message = await channel.invoke('commit', home.root);
      log(`committed ${root}`);
      deps.toast(message, 'success');
    } catch (error) {
      log(`commit failed ${root}: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
      return;
    }
    await readQuietly('load');
  };

  // ── Filter, picker and scroll ──────────────────────────────────────────
  const closeFilter = () => {
    log(`filter ${store.get().filter}`);
    filterScope?.pop();
    filterScope = null;
    render(true);
  };

  const openFilter = () => {
    const state = store.get();
    if (filterScope !== null || openHome(state) === null) {
      return;
    }
    dispatch({ type: 'focus', focus: 'items' });
    const scope = deps.pushScope('box');
    scope.onBaseChanged(() => {
      if (filterScope === scope) {
        closeFilter();
      }
    });
    filterScope = scope;
    render();
    filterBox.focus();
    filterBox.select();
  };

  filterBox.addEventListener('input', () => {
    dispatch({ type: 'setFilter', text: filterBox.value });
  });

  // Gives the focus back to the pane the keys act on once the picker closed.
  const pickerClosed = () => render(true);

  const pickTag = () => {
    const state = store.get();
    const shown = actedFollowup(state);
    const { editor } = state;
    let current: string[];
    if (editor !== null) {
      current = tagsOf(editor.draft.tags);
    } else if (shown !== null) {
      current = shown.item.tags;
    } else {
      return;
    }
    const choices = [...new Set([...deps.tags(), ...current])];
    picker.open({
      title: 'Tags',
      items: choices,
      label: (each) =>
        current.includes(each) ? `Remove ${each}` : `Add ${each}`,
      chosen(choice) {
        const tags = withTagToggled(current, choice);
        if (editor === null) {
          setTags(tags);
        } else {
          const text = tags.join(', ');
          followupEditor.setText('tags', text);
          dispatch({ type: 'draftChanged', field: 'tags', text });
        }
        pickerClosed();
      },
      cancelled: pickerClosed,
    });
  };

  const scrollDetail = (step: ScrollStep, direction: 1 | -1) => {
    const scroll = scrollContent(
      detailPane,
      step,
      direction,
      textLineHeightPx(detailPane),
    );
    log(scrollText('the detail', step, direction, scroll));
  };

  const openInDocs = () => {
    const shown = actedRow(store.get());
    if (shown === null) {
      return;
    }
    if (shown.kind === 'followup') {
      deps.openDoc(shown.path, shown.item.line);
    } else {
      deps.openDoc(docPathOf(shown));
    }
  };

  const listMove = (to: 'down' | 'up' | 'top' | 'bottom') => () =>
    dispatch({ type: 'move', to });

  const commands: Record<BacklogCommand, () => void> = {
    listDown: listMove('down'),
    listUp: listMove('up'),
    listTop: listMove('top'),
    listBottom: listMove('bottom'),
    open() {
      const wasOnHomes = store.get().focus === 'homes';
      dispatch({ type: 'open' });
      if (wasOnHomes) {
        deps.homePicked();
      }
    },
    toggle() {
      const wasOnHomes = store.get().focus === 'homes';
      dispatch({ type: 'toggle' });
      if (wasOnHomes) {
        deps.homePicked();
      }
    },
    back() {
      if (store.get().focus === 'items') {
        deps.revealSideBar();
      }
      dispatch({ type: 'back' });
    },
    filter: openFilter,
    rescan: () => readQuietly('rescan'),
    create: () => dispatch({ type: 'openCreate' }),
    edit: () => dispatch({ type: 'openEdit' }),
    delete: () => dispatch({ type: 'askDelete' }),
    toggleAgentReady() {
      const shown = actedFollowup(store.get());
      if (shown !== null) {
        setTags(withTagToggled(shown.item.tags, AGENT_READY));
      }
    },
    pickTag,
    commit() {
      commit().catch((error) => {
        log(`commit failed: ${errorText(error)}`);
        deps.toast(errorText(error), 'error');
      });
    },
    toggleDone() {
      dispatch({ type: 'toggleDone' });
      log(store.get().isDoneShown ? 'done shown' : 'done hidden');
    },
    toggleAgentReadyOnly() {
      dispatch({ type: 'toggleAgentReadyOnly' });
      log(`agent-ready only ${store.get().isAgentReadyOnly ? 'on' : 'off'}`);
    },
    openInDocs,
    focusDetail: () => dispatch({ type: 'focus', focus: 'detail' }),
    focusList: () => dispatch({ type: 'focus', focus: 'items' }),
    lineDown: () => scrollDetail('line', 1),
    lineUp: () => scrollDetail('line', -1),
    halfPageDown: () => scrollDetail('halfPage', 1),
    halfPageUp: () => scrollDetail('halfPage', -1),
    save() {
      save().catch((error) => {
        log(`write failed: ${errorText(error)}`);
        deps.toast(errorText(error), 'error');
      });
    },
    cancelEdit() {
      const { editor } = store.get();
      if (editor === null) {
        return;
      }
      dispatch(
        isDraftChanged(editor)
          ? { type: 'askDiscard' }
          : { type: 'closeEditor' },
      );
    },
    leaveBox: () => followupEditor.leave(),
    nextField: () => followupEditor.step(1),
    previousField: () => followupEditor.step(-1),
    pickerDown: () => picker.down(),
    pickerUp: () => picker.up(),
    pickerChoose: () => picker.choose(),
    pickerCancel: () => picker.cancel(),
    boxAccept() {
      if (filterScope !== null) {
        closeFilter();
      }
    },
    boxCancel() {
      if (filterScope !== null) {
        dispatch({ type: 'setFilter', text: '' });
        closeFilter();
      }
    },
    confirmYes() {
      const { confirm } = store.get();
      if (confirm === null) {
        return;
      }
      if (confirm.kind === 'discard') {
        dispatch({ type: 'closeEditor' });
        return;
      }
      dispatch({ type: 'dismissConfirm' });
      writeQuietly(confirm.homeRoot, confirm.path, {
        type: 'delete',
        title: confirm.title,
      });
    },
    confirmNo: () => dispatch({ type: 'dismissConfirm' }),
  };

  return {
    sideBar: homesPane,
    sheet: contentSheet,
    load: () => readQuietly('load'),
    reload: () => readQuietly('load'),
    shown() {
      render(true);
      log('shown');
    },
    sideBarHidden() {
      if (store.get().focus === 'homes') {
        dispatch({ type: 'focus', focus: 'items' });
      }
    },
    sideBarOpenedOver() {
      if (store.get().editor === null) {
        dispatch({ type: 'focus', focus: 'homes' });
      }
    },
    keysChanged() {
      followupEditor.redrawHints();
      render();
    },
    commands,
  };
}
