import type { Timers } from '../../../contracts/ambient';
import type { CommandId, CommandKey } from '../../../contracts/commands';
import type { EditorHost } from '../../../contracts/editor';
import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type {
  FocusTarget,
  OuterPanes,
  ResizeTarget,
} from '../../../contracts/panes';
import type { OsName } from '../../../contracts/platform';
import type {
  CommandsRunIn,
  KeyHints,
  PageChannel,
  PushedScope,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import type { LayoutState } from '../../../contracts/state';
import type { UiState } from '../../../contracts/ui-state';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import type {
  KitCommands,
  OwnerKitServices,
} from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  disposeDraws,
  type RollbackDeps,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { textBoxInput } from '../../../shared/page/text-box';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { qualify } from '../../../shared/plugin-manifests';
import type { AgentPane, AgentPaneSpec } from '../../scoped-agents/contract';
import {
  type OpenedProblem,
  type PracticeChannel,
  type PracticePlace,
  practiceOpenProblemRowCommand,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  CompletePracticeLayout,
  ListHeaderInput,
  PracticeLayout,
} from '../layouts/layout';
import type { practiceManifest } from '../manifest';
import { createImportBox } from './import-box';
import {
  createPracticeKit,
  type PracticeBaseScope,
  type PracticeKitScope,
} from './layout/practice-kit';
import {
  difficultyCounts,
  emptyReason,
  initialPracticeState,
  type PracticeAction,
  type PracticeFocus,
  type PracticeState,
  placeOf,
  practiceReducer,
  visibleProblems,
} from './practice-state';
import {
  createProblemWorkspace,
  type WorkspaceCommand,
  type WorkspacePlace,
} from './problem-workspace';

const PLUGIN_ID = 'practice';

const ASK_HINT =
  'Ask about the problem. The interviewer asks guiding questions and gives no answers.';

// A drawn part whose root the view keeps, and the dispose of its anchors and
// boxes.
type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

// Every page command but `showMode`, which the page part runs itself, and the
// clicks, which take an arg.
export type PracticeCommand = Exclude<
  CommandsRunIn<typeof practiceManifest, 'page'>,
  'showMode' | 'openProblemRow' | 'showTab' | 'openSubmissionRow'
>;

// The interviewer's keys toggle and the commands the import box handles.
type InterviewerCommand =
  | 'toggleInterviewer'
  | 'importStart'
  | 'importAccept'
  | 'importCancel';

// The commands the list handles; the workspace and the interviewer handle the
// rest.
type ListCommand = Exclude<
  PracticeCommand,
  WorkspaceCommand | InterviewerCommand
>;

const DIFFICULTY_LABELS: Record<
  ListHeaderInput['counts'][number]['difficulty'],
  ListHeaderInput['counts'][number]['label']
> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export interface PracticeViewDeps {
  channel: PageChannel<PracticeChannel>;
  markdown: MarkdownRenderer;
  matcher: FuzzyMatcher;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  keys: KeyHints;
  platform: OsName;
  // The slots a layout's kit reads.
  state: LayoutState;
  // The commands a layout's kit runs by qualified id.
  commands: KitCommands;
  setScope(scope: PracticeBaseScope): void;
  // Sets the divider the resize keys move, after each `setScope`; null moves
  // the side bar.
  setResizeTarget(target: ResizeTarget | null): void;
  // Sets the panes the focus keys move between, after each `setScope`.
  setFocusTarget(target: FocusTarget | null): void;
  pushScope(scope: 'box' | 'confirm' | 'import'): PushedScope;
  isShown(): boolean;
  // Shows Practice mode.
  showMode(): void;
  // Sets the panes around the column, the interviewer's pane's, while
  // Practice shows; null as it hides.
  setOuterPanes(panes: OuterPanes | null): void;
  // Adds scoped-agents' pane for the interviewer.
  addAgentPane(spec: AgentPaneSpec): AgentPane;
  // Hears each problem the user picks from the side bar, by click or Enter,
  // and main taking the keys; `l` opens one without picking it.
  picked(): void;
  // Hears each problem `open` returned, for the title bar.
  opened(problem: OpenedProblem): void;
  // Runs the command `key` with `arg`, as a click does: a row's click runs
  // `practice.openProblemRow`.
  runKey<A>(key: CommandKey<A>, arg: A): void;
  // The workspace's code editor and boxes.
  editor: EditorHost;
  // Holds the workspace's divider sizes.
  uiState: UiState;
  timers: Timers;
  // Runs a command by its qualified id, as a button does.
  run(command: CommandId): void;
  // Adds the solution confirm and the import box to the page's overlay area.
  addOverlay(element: HTMLElement): void;
  // The last page's place, put back once the first list loads; null for none.
  savedPlace: PracticePlace | null;
  // Hears the place after each change, from the first load on.
  placeChanged(place: PracticePlace): void;
}

// Practice mode's view: the problem list for the side bar and the problem
// column in the sheet, logging under `practice`. Every decision about what
// shows lives in `practiceReducer`; the view draws its state after each
// change, the list pane, its header, rows and empty state and the column's
// `noProblem` through the layout picked for that part. It draws with
// `default` until the first `setLayouts`. `load` reads the list, and the first
// read to land puts `savedPlace` back and opens its problem again, keeping the
// list's focus; `reload` reads it again (the channel's `changed`); `shown`
// sets the scope and focus where the keys were left. An opened problem shows
// in the workspace, which fills the column from then on, with the
// interviewer's agent pane always shown under the editor and console, opened
// on each shown attempt; the import box opens over the page. Run and Submit do
// nothing while Practice is hidden.
export interface PracticeView {
  sideBar: HTMLElement;
  sheet: HTMLElement;
  // The problem column, which holds `noProblem` while no problem is open.
  main: HTMLElement;
  load(): void;
  reload(): void;
  shown(): void;
  // Practice hid: the interviewer's pane gives the column its keys back.
  hidden(): void;
  // The side bar was hidden: focus leaves it for main.
  sideBarHidden(): void;
  // The side bar opened over main: focus moves to it.
  sideBarOpenedOver(): void;
  // The core's area chain reached the side bar: the list takes focus.
  focusSideBar(): void;
  // Main takes the keys back.
  focusMain(): void;
  // Gives the column its keys back, in the pane that held them last.
  focusColumn(): void;
  // The one function that applies an `open` result: the shown problem is
  // refreshed in place, keeping its tabs, pane and unsaved drafts; another
  // shows once the shown one's drafts saved. A draft that fails to save keeps
  // the shown problem open and selected, logs `kept <slug>` and toasts.
  applyOpened(problem: OpenedProblem): void;
  // The one setter of the focus: logs `list focused` or `main focused` when
  // the focus changes to that pane, then sets the scope, resize and focus
  // targets and DOM focus from it; while `interviewer` holds it, none of them,
  // and focus leaving `interviewer` tells the pane first.
  setFocus(focus: PracticeFocus): void;
  // Draws the list pane, the rows and the column's part again with `shown`,
  // keeping an open filter, the selection and the focus.
  setLayouts(shown: ShownLayouts<PracticeLayout>): void;
  // Disposes every part draw the view keeps.
  dispose(): void;
  commands: Record<PracticeCommand, () => void>;
  // Selects and opens the problem `slug` names and focuses main; a slug no
  // shown row holds logs `no problem <slug>` and changes nothing.
  openProblemRow(slug: string): void;
  // The tab clicks and the submission row clicks.
  showTab(tab: string): void;
  openSubmissionRow(time: string): void;
  // Why the page may not stop now: a draft still unsaved; else null.
  mayStop(): string | null;
}

export function createPracticeView(deps: PracticeViewDeps): PracticeView {
  const { channel, matcher } = deps;
  const store = createReducerStore(
    initialPracticeState(),
    (state: PracticeState, action: PracticeAction) =>
      practiceReducer(state, action, matcher),
  );
  const dispatch = store.dispatch;

  // ── Layouts ────────────────────────────────────────────────────────────
  const parts = createLayoutParts<PracticeLayout, CompletePracticeLayout>({
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
  const kitFor = (scope: PracticeKitScope, rollback: RollbackDeps) =>
    createPracticeKit(kitServices, scope, rollback);

  // ── Workspace ──────────────────────────────────────────────────────────
  // The slug the workspace shows or is about to show, or null before the
  // first open lands; `shownSlug` the one it shows.
  let workspaceSlug: string | null = null;
  let shownSlug: string | null = null;
  let workspacePlace: WorkspacePlace | null = null;
  const workspace = createProblemWorkspace({
    channel,
    editor: deps.editor,
    markdown: deps.markdown,
    kitServices,
    keys: deps.keys,
    uiState: deps.uiState,
    timers: deps.timers,
    log: deps.log,
    toast: deps.toast,
    runKey: deps.runKey,
    run: deps.run,
    pushScope: (scope) => deps.pushScope(scope),
    addOverlay: deps.addOverlay,
    hasKeys: () => deps.isShown() && store.get().focus === 'main',
    paneChanged: () => syncTargets(store.get()),
    applyOpened: (problem) => applyOpened(problem),
    savedPlace: deps.savedPlace,
    placeChanged(place) {
      workspacePlace = place;
      notePlace();
    },
  });

  // ── Interviewer and import ─────────────────────────────────────────────
  // The open problem's title, for the ask box.
  let openTitle = '';
  // The problem and attempt shown, null before the first shows; the
  // interviewer's scope changes with the pair.
  let shownPair: { slug: string; attemptId: string } | null = null;
  const interviewer = deps.addAgentPane({
    owner: PLUGIN_ID,
    agentId: 'interviewer',
    heading: () => openTitle,
    hint: ASK_HINT,
    setShown: (shown) => workspace.setInterviewerShown(shown),
    isAlwaysShown: true,
    entersFrom: 'down',
    resizeTarget: workspace.interviewerResizeTarget,
    tookKeys: () => setFocus('interviewer'),
    leave: () => focusColumn(),
  });
  workspace.interviewerSlot.append(interviewer.element);
  // The pane takes `down` whenever it lacks the keys; Practice gives it only
  // from the console, the pane right over it. A resize from outside the
  // column moves only the pane's divider.
  const outerPanes: OuterPanes = {
    focus: {
      move(direction) {
        const isAtConsole =
          store.get().focus === 'main' && workspace.pane() === 'console';
        return direction === 'down' && !isAtConsole
          ? false
          : interviewer.outerPanes.focus.move(direction);
      },
    },
    resize: workspace.interviewerDivider,
  };

  const importBox = createImportBox({
    channel,
    log: deps.log,
    toast: deps.toast,
    pushScope: () => deps.pushScope('import'),
    drawBody: (parent, input, frame) =>
      parts.draw('importBox', parent, (importPart, into, rollback) => {
        const slot = appSlot(frame, 'textBox', rollback);
        const box = importPart(into, input, {
          ...kitFor('import', rollback),
          textBox: slot.place,
        });
        slot.placeIfLeftOut(
          requireElementIn(into, box.element, 'importBox'),
          'start',
        );
        return box;
      }),
  });
  deps.addOverlay(importBox.element);

  // ── Elements ───────────────────────────────────────────────────────────
  // The containers stay app-owned; the list part draws inside the side bar's
  // and places the slots below.
  const listPane = element('div', 'practice-list');
  listPane.tabIndex = -1;
  const headerSlot = element('div', 'practice-list-header-slot');
  const filterFrame = inputFrame();
  filterFrame.classList.add('practice-filter');
  filterFrame.hidden = true;
  const filterBox = textBoxInput('practice-filter-input');
  filterFrame.append(filterBox);
  const rowsList = element('ol', 'practice-rows');
  const importHint = element('span', 'practice-import-hint');
  const importAnchor = deps.keys.anchor(
    importHint,
    qualify(PLUGIN_ID, 'importStart'),
    { scope: 'practice.list', label: 'import' },
  );

  const mainPane = element('div', 'practice-main');
  mainPane.tabIndex = -1;
  const contentSheet = sheet();
  contentSheet.classList.add('practice-sheet');
  contentSheet.append(mainPane);

  // No panes of its own yet: every focus move goes on to the core, so Alt+h
  // from main reaches the side bar.
  const focusTarget: FocusTarget = { move: () => false };

  // ── Drawing ────────────────────────────────────────────────────────────
  let filterScope: PushedScope | null = null;
  let loadCount = 0;
  let loadedCount = 0;
  let openRequest = 0;
  let shownSelectedSlug: string | null = null;
  let shownFocus: PracticeFocus | null = null;
  let headerDraw: DrawnRoot | null = null;
  let rowDraws: DrawnRoot[] = [];
  // Null while a problem is open.
  let noProblemDraw: DrawnRoot | null = null;

  const isWorkspaceShown = () => workspaceSlug !== null;

  const scopeOf = (focus: 'list' | 'main'): PracticeBaseScope => {
    if (focus === 'list') {
      return 'list';
    }
    return isWorkspaceShown() ? workspace.pane() : 'problem';
  };

  const drawListPane = () => {
    const rowsScroll = rowsList.scrollTop;
    parts.redraw('list', listPane, (list, into, rollback) => {
      const slots = [
        appSlot(headerSlot, 'header', rollback),
        appSlot(filterFrame, 'filterBox', rollback),
        appSlot(rowsList, 'rows', rollback),
        appSlot(importHint, 'importHint', rollback),
      ] as const;
      const [header, filter, rows, hint] = slots;
      const pane = list(into, {
        ...kitFor('list', rollback),
        header: header.place,
        filterBox: filter.place,
        rows: rows.place,
        importHint: hint.place,
      });
      for (const slot of slots) {
        slot.placeIfLeftOut(pane.element);
      }
      return pane;
    });
    rowsList.scrollTop = rowsScroll;
  };

  const drawHeader = (state: PracticeState) => {
    headerDraw?.dispose();
    headerSlot.replaceChildren();
    const counts = difficultyCounts(state.problems).map((count) => ({
      ...count,
      label: DIFFICULTY_LABELS[count.difficulty],
    }));
    headerDraw = parts.draw(
      'listHeader',
      headerSlot,
      (listHeader, into, rollback) => ({
        element: listHeader(into, { counts }, kitFor('list', rollback)),
      }),
    );
  };

  const drawRows = (state: PracticeState) => {
    const rows = visibleProblems(state, matcher);
    rowDraws = disposeDraws(rowDraws);
    rowsList.replaceChildren();
    for (const problem of rows) {
      const drawn = parts.draw(
        'problemRow',
        rowsList,
        (problemRow, into, rollback) => ({
          element: problemRow(
            into,
            {
              slug: problem.slug,
              title: problem.title,
              difficulty: problem.difficulty,
              status: problem.status,
              isDue: problem.due,
              isOpen: problem.slug === state.openSlug,
            },
            kitFor('list', rollback),
          ),
        }),
      );
      rowDraws.push(drawn);
      const root = drawn.built.element;
      rowAction(root, () =>
        deps.runKey(practiceOpenProblemRowCommand, problem.slug),
      );
      const isSelected = problem.slug === state.selectedSlug;
      root.classList.toggle('is-selected', isSelected);
      root.classList.toggle(
        'is-cursor',
        isSelected && state.focus === 'list' && filterScope === null,
      );
      root.classList.toggle('is-open', problem.slug === state.openSlug);
    }
    const reason = emptyReason(state, rows.length);
    if (reason !== null) {
      rowDraws.push(
        parts.draw('empty', rowsList, (empty, into, rollback) => ({
          element: empty(
            into,
            {
              reason,
              filter: state.filter,
              message: reason === 'failed' ? state.message : null,
            },
            kitFor('list', rollback),
          ),
        })),
      );
    }
    listPane.classList.toggle('is-pane-inactive', state.focus !== 'list');
    filterFrame.hidden = filterScope === null && state.filter.trim() === '';
    if (filterScope === null) {
      filterBox.value = state.filter;
    }
    rowsList
      .querySelector('.is-selected')
      ?.scrollIntoView({ block: 'nearest' });
  };

  // Draws `noProblem` into the column until a problem shows, then the
  // workspace in its place; `always` draws `noProblem` again when it shows.
  const drawMain = (always: boolean) => {
    const isNoProblemShown = !isWorkspaceShown();
    if (!always && isNoProblemShown === (noProblemDraw !== null)) {
      return;
    }
    noProblemDraw?.dispose();
    noProblemDraw?.built.element.remove();
    noProblemDraw = null;
    if (!isNoProblemShown) {
      if (workspace.element.parentNode !== mainPane) {
        mainPane.append(workspace.element);
      }
      return;
    }
    noProblemDraw = parts.draw(
      'noProblem',
      mainPane,
      (noProblem, into, rollback) => ({
        element: noProblem(into, kitFor('problem', rollback)),
      }),
    );
  };

  // Moves the DOM focus to the pane the keys act on, when that changed.
  const syncFocus = (state: PracticeState, always: boolean) => {
    const isChanged = state.focus !== shownFocus;
    if (!deps.isShown() || (!always && !isChanged)) {
      return;
    }
    shownFocus = state.focus;
    switch (state.focus) {
      case 'list':
        listPane.focus();
        return;
      case 'main':
        if (isWorkspaceShown()) {
          workspace.focus();
        } else {
          mainPane.focus();
        }
        return;
      case 'interviewer':
        return;
    }
  };

  const logChanges = (state: PracticeState) => {
    if (state.selectedSlug !== shownSelectedSlug) {
      shownSelectedSlug = state.selectedSlug;
      if (state.selectedSlug !== null) {
        deps.log(`selected ${state.selectedSlug}`);
      }
    }
  };

  // Sets the scope, the resize target and the focus target from the focus
  // and the workspace's pane.
  const syncTargets = (state: PracticeState) => {
    if (!deps.isShown() || state.focus === 'interviewer') {
      return;
    }
    const isColumn = state.focus === 'main' && isWorkspaceShown();
    deps.setScope(scopeOf(state.focus));
    deps.setResizeTarget(isColumn ? workspace.resizeTarget : null);
    deps.setFocusTarget(isColumn ? workspace.focusTarget : focusTarget);
  };

  const render = (always = false) => {
    const state = store.get();
    drawHeader(state);
    drawRows(state);
    drawMain(false);
    logChanges(state);
    syncTargets(state);
    syncFocus(state, always);
  };

  // The list's place with the workspace's pane and tabs, from the first load
  // on.
  const notePlace = () => {
    const state = store.get();
    if (!state.isLoaded) {
      return;
    }
    deps.placeChanged({
      ...placeOf(state),
      pane: workspacePlace?.pane ?? deps.savedPlace?.pane ?? 'problem',
      problemTab:
        workspacePlace?.problemTab ??
        deps.savedPlace?.problemTab ??
        'description',
      consoleTab:
        workspacePlace?.consoleTab ?? deps.savedPlace?.consoleTab ?? 'testcase',
    });
  };
  drawListPane();
  store.subscribe(() => render());
  store.subscribe(notePlace);

  // Sets the focus; `movesFocus` moves the DOM focus to it too, else the DOM
  // focus is already there.
  const changeFocus = (focus: PracticeFocus, movesFocus: boolean) => {
    const before = store.get().focus;
    const isChanged = before !== focus;
    if (!movesFocus) {
      shownFocus = focus;
    }
    dispatch({ type: 'focus', focus });
    if (before === 'interviewer' && isChanged) {
      interviewer.hostTookKeys();
    }
    if (isChanged && focus !== 'interviewer') {
      deps.log(`${focus} focused`);
    }
    render(movesFocus);
  };
  const setFocus = (focus: PracticeFocus) => changeFocus(focus, true);

  // A click or a box's focus into the list or the column hands it the keys;
  // the interviewer's pane takes them itself.
  for (const [pane, focus] of [
    [listPane, 'list'],
    [mainPane, 'main'],
  ] as const) {
    pane.addEventListener('focusin', (event) => {
      const isInInterviewer =
        event.target instanceof HTMLElement &&
        interviewer.element.contains(event.target);
      if (!isInInterviewer && store.get().focus !== focus) {
        changeFocus(focus, false);
      }
    });
  }

  // ── Reads ──────────────────────────────────────────────────────────────
  // Tells the title bar, the ask box and the interviewer which problem shows.
  // A new pair closes the interviewer's scope and opens it again, so a fresh
  // attempt of the same problem drops the mount and the typed text.
  const noteShown = (problem: OpenedProblem) => {
    deps.opened(problem);
    openTitle = problem.summary.title;
    const slug = problem.summary.slug;
    const attemptId = problem.attempt.id;
    if (shownPair?.slug === slug && shownPair.attemptId === attemptId) {
      return;
    }
    shownPair = { slug, attemptId };
    interviewer.scopeOpened(null);
    interviewer.scopeOpened(slug);
  };

  const applyOpened = (problem: OpenedProblem) => {
    const slug = problem.summary.slug;
    // The shown problem refreshes in place, dropping a show of another one
    // that waits on a save.
    if (slug === shownSlug) {
      workspaceSlug = slug;
      noteShown(problem);
      workspace.refresh(problem);
      return;
    }
    // A read landing while its show waits on a save is dropped: the show
    // draws what it read.
    if (slug === workspaceSlug) {
      return;
    }
    workspaceSlug = slug;
    void workspace.show(problem).then((result) => {
      if (result === 'overtaken') {
        return;
      }
      if (result === 'kept' && shownSlug !== null) {
        workspaceSlug = shownSlug;
        dispatch({ type: 'opened', slug: shownSlug });
        deps.log(`kept ${shownSlug}: a draft did not save`);
        deps.toast(
          `${problem.summary.title} not opened: a draft did not save`,
          'error',
        );
        return;
      }
      shownSlug = slug;
      noteShown(problem);
      render(true);
    });
  };

  // Opens `slug`; `isPicked` moves focus to main and tells `picked`, else the
  // list keeps the keys. An open overtaken by a later one is dropped.
  const openProblem = async (slug: string, isPicked: boolean) => {
    const request = ++openRequest;
    let problem: OpenedProblem;
    try {
      problem = await channel.invoke('open', slug);
    } catch (error) {
      deps.log(`not opened ${slug}: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
      return;
    }
    if (request !== openRequest) {
      return;
    }
    dispatch({ type: 'opened', slug });
    deps.log(`opened ${slug}`);
    applyOpened(problem);
    if (isPicked) {
      setFocus('main');
      deps.picked();
    }
  };

  // Reads the open problem again after a `changed`, so its summary and every
  // saved draft show what is on disk. Dropped when overtaken by an open.
  const refreshOpen = async () => {
    const { openSlug } = store.get();
    if (openSlug === null || openSlug !== workspaceSlug) {
      return;
    }
    const request = openRequest;
    let problem: OpenedProblem;
    try {
      problem = await channel.invoke('open', openSlug);
    } catch (error) {
      deps.log(`not refreshed ${openSlug}: ${errorText(error)}`);
      return;
    }
    const isOvertaken =
      request !== openRequest || store.get().openSlug !== openSlug;
    if (!isOvertaken) {
      applyOpened(problem);
    }
  };

  // A read overtaken by a later one is dropped.
  const read = async () => {
    const count = ++loadCount;
    const problems = await channel.invoke('list');
    if (count !== loadCount) {
      return;
    }
    loadedCount += 1;
    dispatch({ type: 'loaded', problems });
    const isFirstLoad = loadedCount === 1;
    if (isFirstLoad && deps.savedPlace !== null) {
      dispatch({ type: 'placeRestored', place: deps.savedPlace });
    }
    deps.log(`loaded ${String(problems.length)} problems`);
    const { openSlug } = store.get();
    if (isFirstLoad && openSlug !== null) {
      await openProblem(openSlug, false);
    }
  };

  // Logs and toasts a failed read in place of throwing it.
  const readQuietly = (): Promise<void> =>
    read().catch((error) => {
      dispatch({ type: 'loadFailed', message: errorText(error) });
      deps.log(`not loaded: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
    });

  const openSelected = (isPicked: boolean) => () => {
    const { selectedSlug } = store.get();
    if (selectedSlug !== null) {
      void openProblem(selectedSlug, isPicked);
    }
  };

  // ── Filter ─────────────────────────────────────────────────────────────
  const closeFilter = () => {
    deps.log(`filter ${store.get().filter}`);
    filterScope?.pop();
    filterScope = null;
    render(true);
  };

  const openFilter = () => {
    if (filterScope !== null) {
      return;
    }
    setFocus('list');
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

  const listMove = (to: 'down' | 'up' | 'top' | 'bottom') => () =>
    dispatch({ type: 'move', to });

  const listCommands: Record<ListCommand, () => void> = {
    listDown: listMove('down'),
    listUp: listMove('up'),
    listTop: listMove('top'),
    listBottom: listMove('bottom'),
    openProblem: openSelected(true),
    openKeepingFocus: openSelected(false),
    filter: openFilter,
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
  };
  // Moves the keys into the interviewer's pane, or back to the column from
  // it; entering needs a shown problem, else it toasts. Leaving is never
  // refused.
  const toggleInterviewerKeys = () => {
    const entersPane = store.get().focus !== 'interviewer';
    if (entersPane && shownPair === null) {
      deps.toast('Open a problem first', 'info');
      deps.log('interviewer needs an open problem');
      return;
    }
    interviewer.toggle();
  };
  const interviewerCommands: Record<InterviewerCommand, () => void> = {
    toggleInterviewer() {
      if (deps.isShown()) {
        toggleInterviewerKeys();
        return;
      }
      deps.showMode();
      if (store.get().focus !== 'interviewer') {
        toggleInterviewerKeys();
      }
    },
    importStart: () => importBox.open(),
    importAccept: () => importBox.accept(),
    importCancel: () => importBox.cancel(),
  };
  // Run and Submit are bound in `scoped-agents.ask`, which Backlog's
  // assistant box shares, so they act only while Practice shows.
  const judgeWhileShown = (command: 'run' | 'submit') => () => {
    if (!deps.isShown()) {
      deps.log(`${command} ignored: practice hidden`);
      return;
    }
    workspace.commands[command]();
  };
  const commands: Record<PracticeCommand, () => void> = {
    ...listCommands,
    ...workspace.commands,
    run: judgeWhileShown('run'),
    submit: judgeWhileShown('submit'),
    ...interviewerCommands,
  };

  const focusColumn = () => {
    setFocus('main');
    if (deps.isShown() && isWorkspaceShown()) {
      workspace.focus();
    }
  };

  return {
    sideBar: listPane,
    sheet: contentSheet,
    main: mainPane,
    load: () => void readQuietly(),
    reload() {
      void readQuietly();
      void refreshOpen();
    },
    shown() {
      deps.setOuterPanes(outerPanes);
      render(true);
      deps.log('shown');
    },
    hidden() {
      interviewer.modeHidden();
      deps.setOuterPanes(null);
    },
    sideBarHidden() {
      if (store.get().focus === 'list') {
        setFocus('main');
      }
    },
    sideBarOpenedOver: () => setFocus('list'),
    focusSideBar: () => setFocus('list'),
    focusMain() {
      setFocus('main');
      deps.picked();
    },
    focusColumn,
    applyOpened,
    setFocus,
    setLayouts(next) {
      parts.setLayouts(next);
      drawListPane();
      drawMain(true);
      workspace.setLayouts(next);
      importBox.redraw();
      render(true);
      if (filterScope !== null) {
        filterBox.focus();
      }
    },
    dispose() {
      headerDraw?.dispose();
      headerDraw = null;
      rowDraws = disposeDraws(rowDraws);
      noProblemDraw?.dispose();
      noProblemDraw = null;
      importAnchor.dispose();
      importBox.cancel();
      interviewer.dispose();
      workspace.dispose();
      parts.dispose();
    },
    commands,
    openProblemRow(slug) {
      const isShown = visibleProblems(store.get(), matcher).some(
        (problem) => problem.slug === slug,
      );
      if (!isShown) {
        deps.log(`no problem ${slug}`);
        return;
      }
      dispatch({ type: 'select', slug });
      void openProblem(slug, true);
    },
    showTab: (tab) => workspace.showTab(tab),
    openSubmissionRow: (time) => workspace.openSubmissionRow(time),
    mayStop: () => workspace.mayStop(),
  };
}
