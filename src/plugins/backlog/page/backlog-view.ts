import type { Timers } from '../../../contracts/ambient';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { PageDrops } from '../../../contracts/drops';
import type { EditorHost, ScrollStep } from '../../../contracts/editor';
import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type {
  DrawnPickerRow,
  DrawRowInput,
  ListPickerService,
} from '../../../contracts/list-picker';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type {
  FocusTarget,
  PaneDirection,
  ResizeTarget,
} from '../../../contracts/panes';
import type { Paths } from '../../../contracts/paths';
import type { OsName } from '../../../contracts/platform';
import type { LayoutState } from '../../../contracts/state';
import type {
  CommandsRunIn,
  KeyHints,
  PageChannel,
  PushedScope,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { scrollContent, scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import {
  type ConfirmBodyParts,
  createConfirmPrompt,
} from '../../../shared/page/confirm-prompt';
import { appended, element } from '../../../shared/page/dom';
import { createMarkdownMount } from '../../../shared/page/markdown-mount';
import { keepFocusedBox } from '../../../shared/page/editor-boxes';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import type {
  KitCommands,
  OwnerKitServices,
} from '../../../shared/page/layout-host/base-kit';
import type {
  DrawnPart,
  RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { textBoxInput } from '../../../shared/page/text-box';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { createSplit } from '../../../shared/page/ui/split';
import { qualify } from '../../../shared/plugin-manifests';
import type { BacklogChannel, BacklogEdit, BacklogHome } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  BacklogLayout,
  CompleteBacklogLayout,
  GroupHeaderInput,
  RowKit,
} from '../layouts/layout';
import type { backlogManifest } from '../manifest';
import {
  AGENT_READY,
  actedFollowup,
  actedHome,
  actedRow,
  type BacklogAction,
  type BacklogConfirm,
  type BacklogEditor,
  type BacklogFocus,
  type BacklogRow,
  type BacklogState,
  backlogReducer,
  type CursorCommand,
  cursorCommands,
  type DraftTexts,
  EDITOR_FIELDS,
  type EditorField,
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
import {
  createFollowupEditor,
  EDITOR_FIELD_LABELS,
  FOLLOWUP_FORM_ID,
} from './followup-editor';
import {
  type BacklogBaseScope,
  type BacklogKitScope,
  createBacklogKit,
} from './layout/backlog-kit';

const PLUGIN_ID = 'backlog';

// The tag picker's title, which its rows' input carries.
const TAGS_PICKER = 'Tags';

// A drawn part whose root the view keeps, and the dispose of its anchors and
// boxes.
type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

type BacklogPushedScope = 'box' | 'confirm';

// Every page command but `showMode`, which the page part runs itself.
export type BacklogCommand = Exclude<
  CommandsRunIn<typeof backlogManifest, 'page'>,
  'showMode'
>;

// The list split's limits in CSS pixels: the list's opening and least widths,
// and the detail's least width.
const LIST_SPLIT = { initial: 380, min: 240, endMin: 240 };

const SECTION_TITLES: Record<GroupHeaderInput['section'], string> = {
  followup: 'Follow-ups',
  plan: 'Plans',
  feature: 'Features',
};

export interface BacklogViewDeps {
  channel: PageChannel<BacklogChannel>;
  editor: EditorHost;
  markdown: MarkdownRenderer;
  matcher: FuzzyMatcher;
  paths: Paths;
  homeDir: string;
  uiState: UiState;
  // Runs the list split's resize prompt linger.
  timers: Timers;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  // Makes the follow-up editor's slot a drop target.
  drops: Pick<PageDrops, 'addTarget' | 'savePasted'>;
  keys: KeyHints;
  platform: OsName;
  // The slots a layout's kit reads.
  state: LayoutState;
  // The commands a layout's kit runs by qualified id.
  commands: KitCommands;
  // The `tags` setting as the user config now sets it.
  tags(): readonly string[];
  openDoc(path: string, line?: number): void;
  setScope(scope: BacklogBaseScope): void;
  // Sets the divider the resize keys move, after each `setScope`: the list |
  // detail split, or null while the homes have focus, which moves the side bar.
  setResizeTarget(target: ResizeTarget | null): void;
  // Sets the panes the focus keys move between, after each `setScope`.
  setFocusTarget(target: FocusTarget | null): void;
  pushScope(scope: BacklogPushedScope): PushedScope;
  picker: ListPickerService;
  addOverlay(element: HTMLElement): Disposable;
  run(command: CommandId): void;
  isShown(): boolean;
  // Opens the mode's side bar when it is hidden.
  revealSideBar(): void;
  // Hears each home the user picks from the side bar, by click or Enter; `l`
  // opens one without picking it.
  homePicked(): void;
  // The open home, for the title bar; null with none open.
  homeShown(home: BacklogHome | null): void;
}

// Backlog mode's view: the homes for the side bar, the open home's rows and
// the detail in the sheet, the follow-up editor, and the reads and writes
// behind them, logging under `backlog`. Every decision about what shows lives
// in `backlogReducer`; the view draws its state after each change, every pane,
// row, picker row and prompt body through the layout picked for that part.
// It draws with `default` until the first `setLayouts`. `load` reads the
// homes; `reload` reads them again (the channel's `changed`); `shown` sets the
// scope and focus where the keys were left. Each change of the pane holding
// the keys logs `homes focused`, `list focused`, `detail focused` or `editor
// focused`.
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
  // The core's area chain reached the side bar: focus moves to the homes, the
  // cursor on the open home; an open editor keeps it.
  focusSideBar(): void;
  // Main takes the keys back: an open editor takes the DOM focus again, else
  // main's last pane, the list or the detail, takes focus.
  focusMain(): void;
  // Draws every pane, the rows, an open picker's rows and the prompts' bodies
  // again with `shown`, keeping an open editor's draft and focused box, an
  // open filter, the scroll, the selection and the focus.
  setLayouts(shown: ShownLayouts<BacklogLayout>): void;
  // Ends the list split's observer and `window` listeners.
  dispose(): void;
  commands: Record<BacklogCommand, () => void>;
}

export function createBacklogView(deps: BacklogViewDeps): BacklogView {
  const { channel, paths, homeDir } = deps;
  const tilde = (path: string) => paths.tilde(path, homeDir);
  // A new element, made once for the view's life, that the core draws
  // the keys of `command` in `scope` into, then `label` when given. The anchor
  // is disposed when backlog stops.
  const anchored = (
    command: BacklogCommand,
    scope: BacklogBaseScope,
    label?: string,
  ): HTMLElement => {
    const target = element('span', 'backlog-hint');
    deps.keys.anchor(target, qualify(PLUGIN_ID, command), {
      scope: qualify(PLUGIN_ID, scope),
      label,
    });
    return target;
  };

  const { matcher } = deps;
  const store = createReducerStore(
    initialBacklogState(),
    (state: BacklogState, action: BacklogAction) =>
      backlogReducer(state, action, matcher),
  );
  const dispatch = store.dispatch;

  // ── Layouts ────────────────────────────────────────────────────────────
  const parts = createLayoutParts<BacklogLayout, CompleteBacklogLayout>({
    owner: PLUGIN_ID,
    defaultLayout,
    log: deps.log,
  });
  const kitServices: OwnerKitServices = {
    markdown: deps.markdown,
    keys: deps.keys,
    commands: deps.commands,
    platform: deps.platform,
    state: deps.state,
  };
  const kitFor = (scope: BacklogKitScope, rollback: RollbackDeps) =>
    createBacklogKit(kitServices, scope, rollback);

  // ── Elements ───────────────────────────────────────────────────────────
  // The containers stay app-owned; each pane part draws inside its own, and
  // places the slots below.
  const homesPane = element('div', 'backlog-homes');
  homesPane.tabIndex = -1;
  const status = element('div', 'backlog-status');
  status.hidden = true;
  const homesList = element('ol', 'backlog-home-rows');

  const listPane = element('div', 'backlog-list');
  listPane.tabIndex = -1;
  const filterFrame = inputFrame();
  filterFrame.classList.add('backlog-filter');
  filterFrame.hidden = true;
  const filterBox = textBoxInput('backlog-filter-input');
  filterFrame.append(filterBox);
  const rowsList = element('ol', 'backlog-rows');

  // The cursor prompt, moved into the selected row's `cursorActions` slot on
  // each draw.
  const cursorPrompt = element('span', 'backlog-row-actions');
  const cursorHints = new Map<CursorCommand, HTMLElement>([
    ['edit', anchored('edit', 'list', 'edit')],
    ['delete', anchored('delete', 'list', 'delete')],
    ['toggleAgentReady', anchored('toggleAgentReady', 'list', 'agent-ready')],
    ['pickTag', anchored('pickTag', 'list', 'tag')],
    ['openInDocs', anchored('openInDocs', 'list', 'docs')],
  ]);
  cursorPrompt.append(...cursorHints.values());

  const detailPane = element('div', 'backlog-detail');
  detailPane.tabIndex = -1;
  const detailBody = element('div', 'backlog-detail-body');
  // The editor pane's slot, hidden while no editor is open.
  const editorSlot = element('div', 'backlog-editor');
  editorSlot.tabIndex = -1;
  editorSlot.hidden = true;
  const fieldHint = element('span', 'backlog-field-hint');
  fieldHint.append(
    anchored('previousField', 'editor'),
    anchored('nextField', 'editor'),
  );
  const followupEditor = createFollowupEditor({
    editor: deps.editor,
    log: deps.log,
    changed: (field, text) => dispatch({ type: 'draftChanged', field, text }),
    element: editorSlot,
    fieldHint,
    drops: deps.drops,
    toast: deps.toast,
  });

  const split = createSplit({
    ...LIST_SPLIT,
    uiState: deps.uiState,
    stateKey: 'listWidth',
    anchor: deps.keys.anchor,
    timers: deps.timers,
  });
  split.element.classList.add('backlog-split');
  // The focus keys: between the list and the detail, and right out of the
  // homes into main; left of the list the core reaches the side bar. An open
  // editor holds the keys, so it takes every move and moves nothing.
  const focusTarget: FocusTarget = {
    move(direction) {
      const state = store.get();
      if (state.editor !== null) {
        deps.log('pane keys ignored: the editor is open');
        return true;
      }
      if (state.focus === 'homes' && direction === 'right') {
        focusMain();
        return true;
      }
      const to = paneTo(state.focus, direction);
      if (to === null) {
        return false;
      }
      dispatch({ type: 'focus', focus: to });
      return store.get().focus === to;
    },
  };
  split.start.append(listPane);
  split.end.append(detailPane);
  const contentSheet = sheet();
  contentSheet.classList.add('backlog-sheet');
  contentSheet.append(split.element);

  const picker = deps.picker.create();

  // A prompt's `drawBody`: the layout's `confirmBody` for `kind`, with the
  // prompt's own buttons; each kind's last body draw is disposed as it draws
  // again.
  const drawConfirmBody =
    (kind: BacklogConfirm['kind']) =>
    (body: HTMLElement, prompt: ConfirmBodyParts) => {
      parts.redraw(
        'confirmBody',
        body,
        (confirmBody, into, rollback) => ({
          element: confirmBody(
            into,
            { kind, body: prompt.body },
            {
              ...kitFor('confirm', rollback),
              keepButton: prompt.keepButton,
              confirmButton: prompt.confirmButton,
            },
          ),
        }),
        `confirmBody:${kind}`,
      );
    };
  const confirmCommand = (command: BacklogCommand) =>
    qualify(PLUGIN_ID, command);
  const promptDeps = {
    scope: qualify(PLUGIN_ID, 'confirm'),
    keys: deps.keys,
    run: deps.run,
    pushScope: () => deps.pushScope('confirm'),
    isSending: () => false,
    dismiss: () => dispatch({ type: 'dismissConfirm' }),
    log: deps.log,
  };
  const deletePrompt = createConfirmPrompt({
    ...promptDeps,
    title: 'Delete this follow-up?',
    body: 'The follow-up leaves its file.',
    keep: { label: 'Keep it', command: confirmCommand('confirmNo') },
    confirm: { label: 'Delete', command: confirmCommand('confirmYes') },
    isAsked: () => store.get().confirm?.kind === 'delete',
    drawBody: drawConfirmBody('delete'),
  });
  const discardPrompt = createConfirmPrompt({
    ...promptDeps,
    title: 'Discard your changes?',
    body: 'Your changes are lost; the file stays as it was.',
    keep: { label: 'Keep editing', command: confirmCommand('confirmNo') },
    confirm: { label: 'Discard', command: confirmCommand('confirmYes') },
    isAsked: () => store.get().confirm?.kind === 'discard',
    drawBody: drawConfirmBody('discard'),
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
  // Main's pane that last held the keys, which `focusMain` focuses again.
  let lastMainFocus: 'items' | 'detail' = 'items';
  let shownDetailKey: string | null = null;
  // The detail's scroll as the last pane draw found it, which the detail body
  // draws again at; null once that draw is done.
  let keptDetailScroll: number | null = null;
  let detailRequest = 0;
  // The last draw of the editor pane and of the detail body, and each row
  // slot's draws; each is disposed before its part draws again.
  // Null while no editor is open.
  let editorDraw: DrawnRoot | null = null;
  let detailBodyDraw: DrawnRoot | null = null;
  let homeRowDraws: DrawnRoot[] = [];
  let rowDraws: DrawnRoot[] = [];

  const scopeOf = (state: BacklogState): BacklogBaseScope => {
    if (state.editor !== null) {
      return 'editor';
    }
    switch (state.focus) {
      case 'homes':
        return 'homes';
      case 'items':
        return 'list';
      case 'detail':
        return 'detail';
    }
  };

  // Draws the three panes again. The lists move to the new panes and keep
  // their scroll; the detail body draws again at the detail's scroll.
  const drawPanes = () => {
    const homesScroll = homesList.scrollTop;
    const rowsScroll = rowsList.scrollTop;
    keptDetailScroll = detailPane.scrollTop;
    parts.redraw('homes', homesPane, (homes, into, rollback) => {
      const statusSlot = appSlot(status, 'status', rollback);
      const rowsSlot = appSlot(homesList, 'homeRows', rollback);
      const pane = homes(into, {
        ...kitFor('homes', rollback),
        status: statusSlot.place,
        homeRows: rowsSlot.place,
      });
      statusSlot.placeIfLeftOut(pane.element);
      rowsSlot.placeIfLeftOut(pane.element);
      return pane;
    });
    parts.redraw('list', listPane, (list, into, rollback) => {
      const filterSlot = appSlot(filterFrame, 'filterBox', rollback);
      const rowsSlot = appSlot(rowsList, 'rows', rollback);
      const pane = list(into, {
        ...kitFor('list', rollback),
        filterBox: filterSlot.place,
        rows: rowsSlot.place,
      });
      filterSlot.placeIfLeftOut(pane.element);
      rowsSlot.placeIfLeftOut(pane.element);
      return pane;
    });
    parts.redraw('detail', detailPane, (detail, into, rollback) => {
      const bodySlot = appSlot(detailBody, 'body', rollback);
      const editorPaneSlot = appSlot(editorSlot, 'editor', rollback);
      const pane = detail(into, {
        ...kitFor('detail', rollback),
        body: bodySlot.place,
        editor: editorPaneSlot.place,
      });
      bodySlot.placeIfLeftOut(pane.element);
      editorPaneSlot.placeIfLeftOut(pane.element);
      return pane;
    });
    homesList.scrollTop = homesScroll;
    rowsList.scrollTop = rowsScroll;
  };

  // `textBox` for one editor pane draw: frames `field`'s box in `parent` and
  // mounts it with its text in `texts`, recorded for the draw's dispose.
  const textBoxFor =
    (texts: DraftTexts, rollback: RollbackDeps) =>
    (parent: HTMLElement, field: EditorField): HTMLElement => {
      const frame = appended(parent, inputFrame());
      frame.classList.add('backlog-editor-box', `backlog-editor-box--${field}`);
      followupEditor.mount(field, frame, texts[field]);
      rollback.recordBox(() => {
        if (followupEditor.isMounted(field)) {
          followupEditor.boxes.destroyBox(field);
        }
      });
      return frame;
    };

  // Draws the editor pane into its slot with the draft's texts; a field box
  // the pane leaves out is appended at its end, under its label.
  const drawEditorPane = (editor: BacklogEditor) => {
    editorDraw?.dispose();
    followupEditor.destroy();
    editorSlot.replaceChildren();
    editorDraw = parts.draw(
      'editor',
      editorSlot,
      (editorPane, into, rollback) => {
        const textBox = textBoxFor(editor.draft, rollback);
        const pane = editorPane(
          into,
          {
            kind: editor.kind,
            heading:
              editor.kind === 'create' ? 'New follow-up' : 'Edit follow-up',
          },
          { ...kitFor('editor', rollback), textBox },
        );
        for (const field of EDITOR_FIELDS) {
          if (!followupEditor.isMounted(field)) {
            pane.element.append(
              element(
                'label',
                'backlog-editor-label',
                EDITOR_FIELD_LABELS[field],
              ),
            );
            textBox(pane.element, field);
          }
        }
        return pane;
      },
    );
    editorSlot.hidden = false;
  };

  const closeEditorPane = () => {
    editorDraw?.dispose();
    editorDraw = null;
    followupEditor.destroy();
    followupEditor.forget();
    editorSlot.replaceChildren();
    editorSlot.hidden = true;
  };

  const drawHomes = (state: BacklogState) => {
    const homes = orderedHomes(state);
    const statusText =
      state.message ??
      (state.isLoaded && homes.length === 0 ? 'No features homes found' : null);
    status.hidden = statusText === null;
    status.textContent = statusText ?? '';
    status.title = statusText ?? '';
    homeRowDraws = disposeDraws(homeRowDraws);
    homesList.replaceChildren();
    let repo: string | null = null;
    homes.forEach((home, index) => {
      if (home.repo !== repo) {
        repo = home.repo;
        homeRowDraws.push(
          parts.draw('repoHeader', homesList, (repoHeader, into, rollback) => ({
            element: repoHeader(
              into,
              { repo: home.repo },
              kitFor('homes', rollback),
            ),
          })),
        );
      }
      const drawn = parts.draw(
        'homeRow',
        homesList,
        (homeRow, into, rollback) => ({
          element: homeRow(
            into,
            {
              repo: home.repo,
              root: home.root,
              shownRoot: tilde(home.root),
              isCreateTarget: home.isCreateTarget,
              uncommitted: home.uncommitted,
            },
            kitFor('homes', rollback),
          ),
        }),
      );
      homeRowDraws.push(drawn);
      const root = drawn.built.element;
      rowAction(root, () => {
        dispatch({ type: 'openHome', root: home.root });
        deps.homePicked();
      });
      root.classList.toggle('is-selected', home.root === state.openRoot);
      root.classList.toggle(
        'is-cursor',
        state.focus === 'homes' && index === state.homeCursor,
      );
    });
    homesPane.classList.toggle('is-pane-inactive', state.focus !== 'homes');
    homesList.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  // Draws `shown`'s row into the rows slot; its `cursorActions` slot is
  // `actions`, appended at the row's end when the row leaves it out.
  const drawRow = (shown: BacklogRow, actions: HTMLElement): DrawnRoot => {
    // One attempt's row, which `draw` builds with the row kit.
    const withActions = (
      rollback: RollbackDeps,
      draw: (kit: RowKit) => HTMLElement,
    ) => {
      const actionsSlot = appSlot(actions, 'cursorActions', rollback);
      const root = draw({
        ...kitFor('list', rollback),
        cursorActions: actionsSlot.place,
      });
      actionsSlot.placeIfLeftOut(root);
      return { element: root };
    };
    switch (shown.kind) {
      case 'followup':
        return parts.draw('followupRow', rowsList, (row, into, rollback) =>
          withActions(rollback, (kit) =>
            row(
              into,
              {
                title: shown.item.title,
                oneLine: shown.item.oneLine,
                tags: shown.item.tags,
                done: shown.item.done,
              },
              kit,
            ),
          ),
        );
      case 'plan':
        return parts.draw('planRow', rowsList, (row, into, rollback) =>
          withActions(rollback, (kit) =>
            row(
              into,
              {
                title: shown.plan.title,
                feature: shown.plan.feature,
                checked: shown.plan.checked,
                total: shown.plan.total,
                target: shown.plan.target,
                written: shown.plan.written,
                isExpanded: shown.isExpanded,
              },
              kit,
            ),
          ),
        );
      case 'feature':
        return parts.draw('featureRow', rowsList, (row, into, rollback) =>
          withActions(rollback, (kit) =>
            row(
              into,
              {
                slug: shown.feature.slug,
                checked: shown.feature.checked,
                total: shown.feature.total,
                isExpanded: shown.isExpanded,
              },
              kit,
            ),
          ),
        );
      case 'task':
        return parts.draw('taskRow', rowsList, (row, into, rollback) =>
          withActions(rollback, (kit) =>
            row(
              into,
              { title: shown.task.title, status: shown.task.status },
              kit,
            ),
          ),
        );
    }
  };

  // Moves the cursor prompt into the selected row's `cursorActions` slot,
  // showing only the commands that act on it; detached with no selected row.
  // Its anchors hide, keeping their space, while the list's scope is not in
  // force.
  const placeCursorPrompt = (
    selectedRow: { shown: BacklogRow; actions: HTMLElement } | null,
  ) => {
    if (selectedRow === null) {
      cursorPrompt.remove();
      return;
    }
    const shownCommands = cursorCommands(selectedRow.shown);
    for (const [command, hint] of cursorHints) {
      hint.hidden = !shownCommands.includes(command);
    }
    selectedRow.actions.append(cursorPrompt);
  };

  const drawRows = (state: BacklogState) => {
    const rows = visibleRows(state, matcher);
    rowDraws = disposeDraws(rowDraws);
    rowsList.replaceChildren();
    let section: GroupHeaderInput['section'] | null = null;
    let selectedRow: { shown: BacklogRow; actions: HTMLElement } | null = null;
    for (const shown of rows) {
      if (shown.kind !== 'task' && shown.kind !== section) {
        const shownSection: GroupHeaderInput['section'] = shown.kind;
        section = shownSection;
        rowDraws.push(
          parts.draw(
            'groupHeader',
            rowsList,
            (groupHeader, into, rollback) => ({
              element: groupHeader(
                into,
                { section: shownSection, title: SECTION_TITLES[shownSection] },
                kitFor('list', rollback),
              ),
            }),
          ),
        );
      }
      const actions = cursorActionsSlot();
      const drawn = drawRow(shown, actions);
      rowDraws.push(drawn);
      const root = drawn.built.element;
      rowAction(root, () => {
        dispatch({ type: 'select', key: shown.key });
        dispatch({ type: 'focus', focus: 'items' });
      });
      const isSelected = shown.key === state.selectedKey;
      const isCursor =
        isSelected && state.focus === 'items' && filterScope === null;
      root.classList.toggle('is-selected', isSelected);
      root.classList.toggle('is-cursor', isCursor);
      if (isSelected) {
        selectedRow = { shown, actions };
      }
    }
    placeCursorPrompt(selectedRow);
    const reason = emptyReason(state, matcher);
    if (reason !== null) {
      rowDraws.push(
        parts.draw('empty', rowsList, (empty, into, rollback) => ({
          element: empty(
            into,
            { reason, filter: state.filter },
            kitFor('list', rollback),
          ),
        })),
      );
    }
    listPane.classList.toggle('is-pane-inactive', state.focus !== 'items');
    filterFrame.hidden = filterScope === null && state.filter.trim() === '';
    if (filterScope === null) {
      filterBox.value = state.filter;
    }
    rowsList
      .querySelector('.is-selected')
      ?.scrollIntoView({ block: 'nearest' });
  };

  const clearDetailBody = () => {
    detailBodyDraw?.dispose();
    detailBodyDraw = null;
    detailBody.replaceChildren();
  };

  const drawFollowupDetail = (
    shown: Extract<BacklogRow, { kind: 'followup' }>,
  ) => {
    const { item } = shown;
    clearDetailBody();
    detailBodyDraw = parts.draw(
      'followupDetail',
      detailBody,
      (followupDetail, into, rollback) => ({
        element: followupDetail(
          into,
          {
            title: item.title,
            oneLine: item.oneLine,
            tags: item.tags,
            body: item.body,
          },
          kitFor('detail', rollback),
        ),
      }),
    );
  };

  // Draws a read doc: its rendered `html`, through a markdown mount the
  // draw's rollback disposes, or `problem`, the read's error.
  const drawDocDetail = (
    path: string,
    html: string,
    problem: string | null,
  ) => {
    clearDetailBody();
    detailBodyDraw = parts.draw(
      'docDetail',
      detailBody,
      (docDetail, into, rollback) => {
        const kit = kitFor('detail', rollback);
        const mount = createMarkdownMount(deps.markdown, deps.log);
        rollback.recordAnchor(mount);
        const root = docDetail(
          into,
          { path, shownPath: tilde(path), problem },
          {
            ...kit,
            document(parent) {
              if (problem !== null) {
                return kit.emptyState(parent, problem);
              }
              const node = appended(parent, element('div', 'md'));
              mount.draw(node, html);
              return node;
            },
          },
        );
        return { element: root };
      },
    );
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

  // Reads and renders a plan, feature or task file, then scrolls the detail
  // to `scrollTop`; a read overtaken by a later selection draws nothing.
  const showDoc = (path: string, scrollTop: number) => {
    const request = ++detailRequest;
    channel
      .invoke('readDoc', path)
      .then((text) => deps.markdown.document(text))
      .then((html) => {
        if (request === detailRequest) {
          drawDocDetail(path, html, null);
          detailPane.scrollTop = scrollTop;
        }
      })
      .catch((error) => {
        deps.log(`not read ${path}: ${errorText(error)}`);
        if (request === detailRequest) {
          drawDocDetail(path, '', errorText(error));
        }
      });
  };

  // Draws the selected row's detail when the row, its text or the load it
  // came from changed since the last draw, at the top; draws it again at the
  // kept scroll when only the panes drew again.
  const drawDetail = (state: BacklogState) => {
    const shown = selectedRow(state, matcher);
    detailBody.hidden = state.editor !== null;
    let key: string | null = null;
    if (shown !== null) {
      key =
        shown.kind === 'followup'
          ? `${shown.key}\n${JSON.stringify(shown.item)}`
          : `${shown.key}\n${String(loadedCount)}`;
    }
    const isSameDetail = key === shownDetailKey;
    if (isSameDetail && keptDetailScroll === null) {
      return;
    }
    const scrollTop = isSameDetail ? (keptDetailScroll ?? 0) : 0;
    shownDetailKey = key;
    keptDetailScroll = null;
    detailRequest += 1;
    if (shown === null) {
      clearDetailBody();
    } else if (shown.kind === 'followup') {
      drawFollowupDetail(shown);
    } else {
      showDoc(docPathOf(shown), scrollTop);
    }
    detailPane.scrollTop = scrollTop;
  };

  const syncEditor = (state: BacklogState) => {
    const { editor } = state;
    if (editor !== null && editorDraw === null) {
      drawEditorPane(editor);
      deps.log(`editor open ${editor.kind}`);
      followupEditor.focus('title', { insertAtEnd: true });
    } else if (editor === null && editorDraw !== null) {
      closeEditorPane();
      deps.log('editor closed');
    }
  };

  // Moves the DOM focus to the pane the keys act on, when that changed, and
  // logs the pane that took them.
  const syncFocus = (state: BacklogState, always: boolean) => {
    const focus = state.editor === null ? state.focus : 'editor';
    const isChanged = focus !== shownFocus;
    if (!deps.isShown() || (!always && !isChanged)) {
      return;
    }
    shownFocus = focus;
    if (isChanged) {
      deps.log(`${PANE_NAMES[focus]} focused`);
    }
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
          editorSlot.focus();
        }
    }
  };

  const logChanges = (state: BacklogState) => {
    if (state.openRoot !== shownOpenRoot) {
      shownOpenRoot = state.openRoot;
      const home = openHome(state);
      deps.homeShown(home);
      if (home !== null) {
        deps.log(`opened ${home.repo} ${tilde(home.root)}`);
      }
    }
    if (state.selectedKey !== shownSelectedKey) {
      shownSelectedKey = state.selectedKey;
      const shown = selectedRow(state, matcher);
      if (shown !== null) {
        deps.log(`selected ${rowTitle(shown)}`);
      }
    }
  };

  const render = (always = false) => {
    deletePrompt.settleOwedDismiss();
    discardPrompt.settleOwedDismiss();
    const state = store.get();
    if (state.focus !== 'homes') {
      lastMainFocus = state.focus;
    }
    drawHomes(state);
    drawRows(state);
    syncEditor(state);
    drawDetail(state);
    logChanges(state);
    deletePrompt.setBaseScope(() =>
      discardPrompt.setBaseScope(() => {
        if (deps.isShown()) {
          deps.setScope(scopeOf(state));
          deps.setResizeTarget(state.focus === 'homes' ? null : split);
          deps.setFocusTarget(focusTarget);
        }
      }),
    );
    syncFocus(state, always);
  };
  drawPanes();
  store.subscribe(() => render());

  // Main's last pane takes the keys, the list when the detail refuses them
  // with no row selected; an open editor takes the DOM focus again.
  const focusMain = () => {
    if (store.get().editor === null) {
      dispatch({ type: 'focus', focus: lastMainFocus });
      if (store.get().focus !== lastMainFocus) {
        dispatch({ type: 'focus', focus: 'items' });
      }
    }
    syncFocus(store.get(), true);
  };

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
    deps.log(`loaded ${String(result.homes.length)} homes`);
  };

  // Logs and toasts a failed read in place of throwing it.
  const readQuietly = (method: 'load' | 'rescan'): Promise<void> =>
    read(method).catch((error) => {
      deps.log(`not loaded: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
    });

  // Sends `edit`, logs and toasts its result, and reloads on `applied`. On
  // `changed` the baseline of the editor that saved, if still open, moves to
  // the item on disk, so its next save overwrites it. `isDraftKept`: an open
  // editor keeps the user's draft when the write does not apply. Resolves to
  // whether it applied, a failed reload after an applied write included.
  const write = async (
    homeRoot: string,
    path: string | null,
    edit: BacklogEdit,
    isDraftKept: boolean,
  ): Promise<boolean> => {
    const result = await channel.invoke('applyEdit', homeRoot, path, edit);
    deps.log(`wrote ${path ?? tilde(homeRoot)} ${result.type}`);
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
        dispatch({
          type: 'moveEditorBaseline',
          path,
          title: result.title,
          baseline: result.item,
        });
        deps.toast(
          `${result.title} changed on disk; save again to overwrite it`,
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
      deps.log(`write failed: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
    });
  };

  const setTags = (tags: string[]) => {
    const shown = actedFollowup(store.get(), matcher);
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
      deps.log(`committed ${root}`);
      deps.toast(message, 'success');
    } catch (error) {
      deps.log(`commit failed ${root}: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
      return;
    }
    await readQuietly('load');
  };

  // ── Filter, picker and scroll ──────────────────────────────────────────
  const closeFilter = () => {
    deps.log(`filter ${store.get().filter}`);
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

  // The tag picker's `drawRow`: the layout's `pickerRow`, whose draw the
  // picker disposes.
  const drawPickerRow = (
    list: HTMLElement,
    _item: string,
    input: DrawRowInput,
  ): DrawnPickerRow => {
    const drawn = parts.draw(
      'pickerRow',
      list,
      (pickerRow, into, rollback) => ({
        element: pickerRow(
          into,
          { picker: TAGS_PICKER, label: input.label },
          { ...kitFor('picker', rollback), trailing: () => input.trailing },
        ),
      }),
    );
    return { element: drawn.built.element, dispose: drawn.dispose };
  };

  const pickTag = () => {
    const state = store.get();
    const shown = actedFollowup(state, matcher);
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
      title: TAGS_PICKER,
      items: choices,
      label: (each) =>
        current.includes(each) ? `Remove ${each}` : `Add ${each}`,
      drawRow: drawPickerRow,
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
    deps.log(scrollText('the detail', step, direction, scroll));
  };

  const openInDocs = () => {
    const shown = actedRow(store.get(), matcher);
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
    open: () => dispatch({ type: 'open' }),
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
      const shown = actedFollowup(store.get(), matcher);
      if (shown !== null) {
        setTags(withTagToggled(shown.item.tags, AGENT_READY));
      }
    },
    pickTag,
    commit() {
      commit().catch((error) => {
        deps.log(`commit failed: ${errorText(error)}`);
        deps.toast(errorText(error), 'error');
      });
    },
    toggleDone() {
      dispatch({ type: 'toggleDone' });
      deps.log(store.get().isDoneShown ? 'done shown' : 'done hidden');
    },
    toggleAgentReadyOnly() {
      dispatch({ type: 'toggleAgentReadyOnly' });
      deps.log(
        `agent-ready only ${store.get().isAgentReadyOnly ? 'on' : 'off'}`,
      );
    },
    openInDocs,
    lineDown: () => scrollDetail('line', 1),
    lineUp: () => scrollDetail('line', -1),
    halfPageDown: () => scrollDetail('halfPage', 1),
    halfPageUp: () => scrollDetail('halfPage', -1),
    save() {
      save().catch((error) => {
        deps.log(`write failed: ${errorText(error)}`);
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
      deps.log('shown');
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
    focusSideBar() {
      if (store.get().editor === null) {
        dispatch({ type: 'focusHomes' });
      }
    },
    focusMain,
    setLayouts(next) {
      parts.setLayouts(next);
      keepFocusedBox(followupEditor.boxes, FOLLOWUP_FORM_ID, () => {
        drawPanes();
        const { editor } = store.get();
        if (editor !== null && editorDraw !== null) {
          drawEditorPane(editor);
        }
      });
      render(true);
      if (filterScope !== null) {
        filterBox.focus();
      }
      picker.redraw();
      deletePrompt.redraw();
      discardPrompt.redraw();
    },
    dispose() {
      split.dispose();
    },
    commands,
  };
}

// The name each pane that takes the keys logs under.
const PANE_NAMES: Record<BacklogFocus | 'editor', string> = {
  homes: 'homes',
  items: 'list',
  detail: 'detail',
  editor: 'editor',
};

// The pane a focus move toward `direction` reaches from `from`: right from the
// list to the detail, left back; null for every other move.
function paneTo(
  from: BacklogFocus,
  direction: PaneDirection,
): BacklogFocus | null {
  if (from === 'items' && direction === 'right') {
    return 'detail';
  }
  if (from === 'detail' && direction === 'left') {
    return 'items';
  }
  return null;
}

// A row's `cursorActions` slot, which the cursor prompt moves into.
function cursorActionsSlot(): HTMLElement {
  return element('span', 'backlog-row-actions-slot');
}

// Disposes each of `draws`; returns the empty list that replaces them.
function disposeDraws(draws: readonly DrawnRoot[]): DrawnRoot[] {
  for (const draw of draws) {
    draw.dispose();
  }
  return [];
}
