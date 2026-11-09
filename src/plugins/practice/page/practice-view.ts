import type { CommandKey } from '../../../contracts/commands';
import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { FocusTarget, ResizeTarget } from '../../../contracts/panes';
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
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
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
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import {
  type OpenedProblem,
  type PracticeChannel,
  type PracticePlace,
  practiceOpenProblemRowCommand,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  CompletePracticeLayout,
  EmptyReason,
  ListHeaderInput,
  PracticeLayout,
} from '../layouts/layout';
import type { practiceManifest } from '../manifest';
import {
  createPracticeKit,
  type PracticeBaseScope,
} from './layout/practice-kit';
import {
  difficultyCounts,
  initialPracticeState,
  type PracticeAction,
  type PracticeFocus,
  type PracticeState,
  placeOf,
  practiceReducer,
  visibleProblems,
} from './practice-state';

const PLUGIN_ID = 'practice';

// A drawn part whose root the view keeps, and the dispose of its anchors and
// boxes.
type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

// Every page command but `showMode`, which the page part runs itself, and the
// row click, which takes an arg.
export type PracticeCommand = Exclude<
  CommandsRunIn<typeof practiceManifest, 'page'>,
  'showMode' | 'openProblemRow'
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
  pushScope(scope: 'box'): PushedScope;
  isShown(): boolean;
  // Hears each problem the user picks from the side bar, by click or Enter,
  // and main taking the keys; `l` opens one without picking it.
  picked(): void;
  // Hears each problem `open` returned, for the title bar.
  opened(problem: OpenedProblem): void;
  // Runs the command `key` with `arg`, as a click does: a row's click runs
  // `practice.openProblemRow`.
  runKey<A>(key: CommandKey<A>, arg: A): void;
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
// sets the scope and focus where the keys were left.
export interface PracticeView {
  sideBar: HTMLElement;
  sheet: HTMLElement;
  // The problem column, which holds `noProblem` while no problem is open.
  main: HTMLElement;
  load(): void;
  reload(): void;
  shown(): void;
  // The side bar was hidden: focus leaves it for main.
  sideBarHidden(): void;
  // The side bar opened over main: focus moves to it.
  sideBarOpenedOver(): void;
  // The core's area chain reached the side bar: the list takes focus.
  focusSideBar(): void;
  // Main takes the keys back.
  focusMain(): void;
  // The one setter of the focus: logs `list focused` or `main focused` when
  // the focus changes to that pane, then sets the scope, resize and focus
  // targets and DOM focus from it; while `interviewer` holds it, none of them.
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
  const kitFor = (scope: PracticeBaseScope, rollback: RollbackDeps) =>
    createPracticeKit(kitServices, scope, rollback);

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

  const scopeOf = (focus: 'list' | 'main'): PracticeBaseScope =>
    focus === 'list' ? 'list' : 'problem';

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
            { reason, filter: state.filter },
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

  // Draws `noProblem` into the column while no problem is open, and takes it
  // out once one opens; `always` draws it again when it shows.
  const drawMain = (state: PracticeState, always: boolean) => {
    const isNoProblemShown = state.openSlug === null;
    if (!always && isNoProblemShown === (noProblemDraw !== null)) {
      return;
    }
    noProblemDraw?.dispose();
    noProblemDraw?.built.element.remove();
    noProblemDraw = null;
    if (isNoProblemShown) {
      noProblemDraw = parts.draw(
        'noProblem',
        mainPane,
        (noProblem, into, rollback) => ({
          element: noProblem(into, kitFor('problem', rollback)),
        }),
      );
    }
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
        mainPane.focus();
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

  const render = (always = false) => {
    const state = store.get();
    drawHeader(state);
    drawRows(state);
    drawMain(state, false);
    logChanges(state);
    if (deps.isShown() && state.focus !== 'interviewer') {
      deps.setScope(scopeOf(state.focus));
      deps.setResizeTarget(null);
      deps.setFocusTarget(focusTarget);
    }
    syncFocus(state, always);
  };
  drawListPane();
  store.subscribe(() => render());
  store.subscribe(() => {
    const state = store.get();
    if (state.isLoaded) {
      deps.placeChanged(placeOf(state));
    }
  });

  const setFocus = (focus: PracticeFocus) => {
    const isChanged = store.get().focus !== focus;
    dispatch({ type: 'focus', focus });
    if (isChanged && focus !== 'interviewer') {
      deps.log(`${focus} focused`);
    }
    render(true);
  };

  // ── Reads ──────────────────────────────────────────────────────────────
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
    if (isPicked) {
      setFocus('main');
      deps.picked();
    }
    deps.opened(problem);
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

  const commands: Record<PracticeCommand, () => void> = {
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

  return {
    sideBar: listPane,
    sheet: contentSheet,
    main: mainPane,
    load: () => void readQuietly(),
    reload: () => void readQuietly(),
    shown() {
      render(true);
      deps.log('shown');
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
    setFocus,
    setLayouts(next) {
      parts.setLayouts(next);
      drawListPane();
      drawMain(store.get(), true);
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
  };
}

// Why the list shows no rows, or null while it shows `rowCount` of them.
function emptyReason(
  state: PracticeState,
  rowCount: number,
): EmptyReason | null {
  if (!state.isLoaded) {
    return 'loading';
  }
  if (state.problems.length === 0) {
    return 'noProblems';
  }
  return rowCount === 0 ? 'filter' : null;
}

// Disposes each of `draws`; returns the empty list that replaces them.
function disposeDraws(draws: readonly DrawnRoot[]): DrawnRoot[] {
  for (const draw of draws) {
    draw.dispose();
  }
  return [];
}
