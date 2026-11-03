import type { Timers } from '../../../contracts/ambient';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { PageDrops } from '../../../contracts/drops';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { ViewScope } from '../../../contracts/keymap';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import {
  type FocusTarget,
  PANE_FOCUS_COMMANDS,
  type ResizeTarget,
} from '../../../contracts/panes';
import type { Platform } from '../../../contracts/platform';
import type {
  PluginAreas,
  PushedScope,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { scrollContent } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { createConfirmPrompt } from '../../../shared/page/confirm-prompt';
import { element } from '../../../shared/page/dom';
import {
  boxDropTake,
  type EditorBoxes,
  keepFocusedBox,
} from '../../../shared/page/editor-boxes';
import type { KitCommands } from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  drawPart,
  type PartPick,
  requireElementIn,
  type RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { pickLayout } from '../../../shared/page/layout-host/pick';
import { saveLabel, saveState } from '../../../shared/page/autosave';
import {
  createSessionFormTabs,
  type SessionFormTabs,
} from '../../../shared/page/session-form-tabs';
import {
  activeForm,
  formOfSession,
  sessionPaneView,
} from '../../../shared/page/session-forms';
import {
  createStatusLine,
  type StatusLine,
  type StatusLineContent,
} from '../../../shared/page/status-line';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { textButton } from '../../../shared/page/ui/button';
import {
  disposeAnchors,
  keyChevron,
  keyEdge,
  keyStack,
  recordingAnchor,
} from '../../../shared/page/ui/key-anchors';
import { createSplit } from '../../../shared/page/ui/split';
import type { AnchorOptions, KeysPageExports } from '../../keys/contract';
import type { SessionsPageExports } from '../../sessions/contract';
import type { PrimerEntry, PrimerView } from '../contract';
import {
  type PrimerCommandName,
  primerCommand,
  primerScope,
  type PrimerScopeName,
} from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type {
  FeatureCardInput,
  ItemCardInput,
  ItemsInput,
  PrimerLayout,
  PrimerLayoutCard,
  PrimerLayoutCards,
  PrimerLayoutPane,
  TaskCardInput,
  TaskRowInput,
  TasksInput,
} from '../layouts/layout';
import {
  boxKey,
  hasAddItemBox,
  type PrimerBox,
  primerViewBoxes,
  shownBoxes,
} from './boxes';
import {
  type CardKit,
  createFeatureKit,
  createItemKit,
  createItemsKit,
  createReviewKit,
  createTaskKit,
  createTasksKit,
  type PrimerPartKitDeps,
} from './layout/primer-kit';
import { primerFocusTarget } from './primer-commands';
import { reviewFooter, reviewInput, taskName } from './primer-review';
import {
  cardRow,
  includedCount,
  type OpenPrimer,
  type PrimerAction,
  type PrimerColumn,
  type PrimerPane,
  type PrimerState,
  rowName,
  type RowPrompt,
  rowPrompt,
  scopeOf,
  selectedEntry,
  sessionTitle,
  TASK_GROUPS,
  type TaskRow,
  taskPosition,
  taskRows,
} from './primer-state';
import type { PrimerStore } from './primer-store';

// `beforeClose` answers whether a session may close now. `setScope` sets the
// key scope to `scopeOf` the state while a Primer tab is the visible tab;
// `pushConfirmScope` lays the cancel prompt's scope over it. `keys` anchors
// each key hint the view and its layout draw and reads the keys a layout asks
// for. `run` runs a button's command; `commands` is what a layout's
// `kit.command` reaches. `platform` is the OS the layouts' key hints draw for.
// `uiState` keeps the tasks and items columns' widths, which every primer's
// columns open at. `timers` runs the splits' resize prompt linger. Each primer
// view is a drop target through `drops`, typing files into the primer's box
// used last.
export interface PrimerViewDeps {
  areas: Pick<PluginAreas, 'overlay'>;
  sessions: Pick<SessionsPageExports, 'addTab'>;
  beforeClose(sessionId: string): boolean;
  setScope(scope: PrimerScopeName): void;
  // Hands the resize keys the split of the focused pane, and the focus keys
  // the primer's panes; both called after each setScope.
  setResizeTarget(target: ResizeTarget | null): void;
  setFocusTarget(target: FocusTarget | null): void;
  pushConfirmScope(): PushedScope;
  store: PrimerStore;
  boxes: EditorBoxes<PrimerBox>;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
  run(command: CommandId): void;
  commands: KitCommands;
  platform: Platform;
  uiState: UiState;
  timers: Timers;
  drops: Pick<PageDrops, 'addTarget' | 'savePasted'>;
  toast(text: string, tone: ToastTone): void;
  log: Log;
}

// `forgetSession` drops a session's Primer tab entry and destroys its primer
// views once sessions dropped the tab, so the next render rebuilds a primer
// still open for the session in a new Primer tab. `showPrimer` selects the
// session's Primer tab, a no-op when it has none. `scrollBy` scrolls the
// active primer's card or review, whichever shows, down for 1 and up for -1;
// null with no active primer. `setLayouts` draws every part whose picked
// layout changed again, keeping the focused box.
export interface PrimerTab {
  forgetSession(sessionId: string): void;
  showPrimer(sessionId: string): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  setLayouts(shown: ShownLayouts<PrimerLayout>): void;
}

// One open primer's DOM in its session's Primer tab. `update` draws it for
// the primer and the view whose pane shows: under the cancel prompt, the view
// keeping the primer returns to. `resizeTarget` is the split the resize keys
// move while `pane` has focus: the outer split for the tasks column, the inner
// split for the items column and the card. `dispose` disposes every anchor it
// named and both splits, and destroys every box its parts mounted.
interface PrimerFormView {
  element: HTMLElement;
  update(primer: OpenPrimer, view: PrimerView): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll;
  resizeTarget(pane: PrimerPane): ResizeTarget;
  dispose(): void;
}

// What the view's parts draw through: the kits' deps and the log a part's
// failure goes to.
type PartDeps = PrimerPartKitDeps & { log: Log };

// A part the view drew: what its build returned, the pick it was drawn from,
// and the dispose of the anchors and boxes it recorded.
interface DrawnPrimerPart<R> {
  built: R;
  pick: PartPick<PrimerLayout>;
  dispose(): void;
}

// A column body a layout drew, and the row its row function drew at each
// position.
interface DrawnColumn {
  element: HTMLElement;
  rows: Map<number, HTMLElement>;
}

// A drawn card: the pick it was drawn from, `update` redraws what changes
// without a rebuild, and `dispose` disposes its anchors and destroys its
// boxes.
interface DrawnCard {
  pick: PartPick<PrimerLayout>;
  update(primer: OpenPrimer): void;
  dispose(): void;
}

type AnchorKeys = Pick<KeysPageExports, 'anchor'>;

// The parts of a column a primer view builds once: the column, its header's
// row pair, the body its layout part fills, and the row prompt `drawColumn`
// moves to the selected row, with each of its keys and the RowPrompt field
// that shows it.
interface ColumnParts {
  element: HTMLElement;
  edge: HTMLElement;
  body: HTMLElement;
  rowPrompt: HTMLElement;
  promptKeys: [HTMLElement, keyof RowPrompt][];
}

// One column of a primer view: its parts, the part last drawn into its body,
// the primer that draw was for, and the selection it showed.
interface ShownColumn {
  name: PrimerColumn;
  parts: ColumnParts;
  drawn: DrawnPrimerPart<DrawnColumn> | null;
  primer: OpenPrimer | null;
  selection: string | null;
}

// A row prompt key: its command, its label and the RowPrompt field that shows
// it.
type PromptKey = [PrimerCommandName, string, keyof RowPrompt];

const NEED_PROMPT_KEYS: PromptKey[] = [
  ['needYes', 'yes', 'need'],
  ['needNo', 'no', 'need'],
  ['needUnclear', 'unclear', 'need'],
];

const TASKS_PROMPT_KEYS: PromptKey[] = [
  ...NEED_PROMPT_KEYS,
  ['removeExtraTask', 'remove', 'remove'],
];

const ITEMS_PROMPT_KEYS: PromptKey[] = [
  ...NEED_PROMPT_KEYS,
  ['toggleInclude', 'include', 'include'],
];

// The uiState keys of the columns' widths, and the rail width the tasks
// column's width replaces.
const TASKS_WIDTH_KEY = 'tasks-width';
const ITEMS_WIDTH_KEY = 'items-width';
const RAIL_WIDTH_KEY = 'primer-rail-width';

const NO_TASK_ITEMS = 'Select a task to see its items.';
const NO_ITEMS = 'No items. Press a on the task card to add one.';

// The whole primer UI: each primer drawn in its session's Primer tab, focused
// or not, and the cancel prompt in the overlay layer, serving the active
// primer, which alone takes keys. Every store change
// renders it; a change a render's own dispatch makes renders again once that
// render ends. While a Primer tab is the visible tab the key scope follows
// the state; the cancel prompt pushes its own scope over it and is dismissed
// when another view sets the scope. Each part draws through the layouts the
// last `setLayouts` handed it, `default` alone until the first.
export function mountPrimerTab(deps: PrimerViewDeps): PrimerTab {
  const { areas, store, boxes } = deps;
  moveRailWidth(deps.uiState);
  const primerViews = new Map<string, PrimerFormView>();
  const shownPrimers: PrimerViews = {
    views: primerViews,
    dropTargets: new Map(),
  };
  const focusTarget = primerFocusTarget(deps);
  const setScopeFor = (state: PrimerState) => {
    deps.setScope(scopeOf(state));
    deps.setResizeTarget(resizeTargetOf(state, primerViews));
    deps.setFocusTarget(hasPanes(state) ? focusTarget : null);
  };
  const tabs = createSessionFormTabs({
    addTab: (sessionId, tab) => deps.sessions.addTab(sessionId, tab),
    tabId: 'primer',
    title: 'Primer',
    icon: 'lightbulb',
    className: 'primer-tab',
    idleText: "No primer open. The agent's next primer opens here.",
    beforeClose: (sessionId) => deps.beforeClose(sessionId),
    shown: () => setScopeFor(store.get()),
  });
  const dispatch = (action: PrimerAction) => store.dispatch(action);
  const confirm = createConfirmPrompt({
    title: 'Cancel this primer?',
    body: 'The agent is told the primer was cancelled. Your edits stay saved.',
    keep: { label: 'Keep editing', command: primerCommand('dismissConfirm') },
    confirm: {
      label: 'Cancel primer',
      command: primerCommand('confirmCancel'),
    },
    scope: primerScope('confirm'),
    keys: deps.keys,
    run: (command) => deps.run(command),
    pushScope: () => deps.pushConfirmScope(),
    isAsked: () => store.get().view === 'confirm',
    isSending: () => (activeForm(store.get())?.sending ?? null) !== null,
    dismiss: () => dispatch({ type: 'dismissConfirm' }),
    log: deps.log,
    logSource: 'primer',
  });
  areas.overlay.contribute(confirm.element);
  let shownLayouts: ShownLayouts<PrimerLayout> = {
    layouts: new Map([['default', defaultLayout]]),
    user: 'default',
  };

  const renderOnce = () => {
    if (!confirm.settleOwedDismiss()) {
      return;
    }
    const state = store.get();
    syncPrimerViews(
      state,
      shownPrimers,
      tabs,
      deps,
      dispatch,
      () => shownLayouts,
    );
    tabs.sync((sessionId) => {
      const primer = formOfSession(state, sessionId);
      return primer === undefined ? null : sessionTitle(primer);
    });
    for (const primer of state.forms) {
      primerViews
        .get(primer.formId)
        ?.update(primer, sessionPaneView(state, primer.sessionId, 'primer'));
    }
    confirm.setBaseScope(() => {
      if (tabs.isShown()) {
        setScopeFor(state);
      }
    });
    const box = boxes.active();
    if (box !== null && !isBoxShown(state, box)) {
      boxes.leave();
    }
  };
  // A card rebuild refocuses its box, whose focus can dispatch.
  let isRendering = false;
  let isRenderOwed = false;
  const render = () => {
    if (isRendering) {
      isRenderOwed = true;
      return;
    }
    isRendering = true;
    try {
      do {
        isRenderOwed = false;
        renderOnce();
      } while (isRenderOwed);
    } finally {
      isRendering = false;
    }
  };
  store.subscribe(render);
  render();
  return {
    forgetSession(sessionId) {
      tabs.forget(sessionId);
      for (const primer of store.get().forms) {
        if (primer.sessionId === sessionId) {
          destroyPrimerView(primer.formId, shownPrimers, tabs, deps);
        }
      }
    },
    showPrimer: (sessionId) => tabs.select(sessionId),
    setLayouts(shown) {
      shownLayouts = shown;
      render();
    },
    scrollBy(step, direction) {
      const state = store.get();
      const primer = state.view === 'idle' ? null : activeForm(state);
      const primerView =
        primer === null ? undefined : primerViews.get(primer.formId);
      return primerView?.scrollBy(step, direction) ?? null;
    },
  };
}

// The tasks column opens at the old rail width when only that is stored, and
// the old key goes.
function moveRailWidth(uiState: UiState) {
  const railWidth = uiState.get(RAIL_WIDTH_KEY);
  const isMovable =
    uiState.get(TASKS_WIDTH_KEY) === undefined &&
    typeof railWidth === 'number' &&
    Number.isFinite(railWidth);
  if (!isMovable) {
    return;
  }
  uiState.set(TASKS_WIDTH_KEY, railWidth);
  uiState.set(RAIL_WIDTH_KEY, undefined);
}

// Whether the primer view shows a primer's panes: tasks, items and card.
function hasPanes(state: PrimerState): boolean {
  return state.view === 'primer' && activeForm(state) !== null;
}

// The split the resize keys move: the shown primer view's split of the
// focused pane in view 'primer', null in every other view.
function resizeTargetOf(
  state: PrimerState,
  primerViews: Map<string, PrimerFormView>,
): ResizeTarget | null {
  const primer = state.view === 'primer' ? activeForm(state) : null;
  if (primer === null) {
    return null;
  }
  return primerViews.get(primer.formId)?.resizeTarget(primer.pane) ?? null;
}

function isBoxShown(state: PrimerState, box: PrimerBox): boolean {
  return hasBox(shownBoxes(state), box);
}

// Whether a drop on the box's primer view may type into it: drawn by the view,
// and not under the cancel prompt.
function isBoxInPrimerView(state: PrimerState, box: PrimerBox): boolean {
  return hasBox(primerViewBoxes(state, box.primerId), box);
}

function hasBox(boxes: PrimerBox[], box: PrimerBox): boolean {
  const key = boxKey(box);
  return boxes.some((shown) => boxKey(shown) === key);
}

// The open primers' views, and the drop target each view's element is, by
// primer.
interface PrimerViews {
  views: Map<string, PrimerFormView>;
  dropTargets: Map<string, Disposable>;
}

// A primer view per open primer, in its session's Primer tab: built when the
// primer appears, adding the Primer tab when the session has none and taking
// over the session with it, and registered as a drop target; destroyed with
// its editors when the primer leaves.
function syncPrimerViews(
  state: PrimerState,
  primerViews: PrimerViews,
  tabs: SessionFormTabs,
  deps: PrimerViewDeps,
  dispatch: (action: PrimerAction) => void,
  shown: () => ShownLayouts<PrimerLayout>,
) {
  for (const primerId of primerViews.views.keys()) {
    if (!state.forms.some((primer) => primer.formId === primerId)) {
      destroyPrimerView(primerId, primerViews, tabs, deps);
    }
  }
  for (const primer of state.forms) {
    if (!primerViews.views.has(primer.formId)) {
      const primerView = createPrimerFormView(
        (root) => tabs.mount(primer.sessionId, root),
        primer,
        deps,
        dispatch,
        shown,
      );
      primerViews.views.set(primer.formId, primerView);
      primerViews.dropTargets.set(
        primer.formId,
        addPrimerDropTarget(primer.formId, primerView, deps),
      );
      tabs.takeOver(primer.formId, primer.sessionId);
    }
  }
}

// Files dropped or pasted on the primer view go into the primer's box used
// last, else its first box mounted, whether or not its pane has focus.
function addPrimerDropTarget(
  primerId: string,
  primerView: PrimerFormView,
  deps: PrimerViewDeps,
): Disposable {
  const isShown = (box: PrimerBox) => isBoxInPrimerView(deps.store.get(), box);
  return deps.drops.addTarget({
    element: primerView.element,
    take: boxDropTake(() => deps.boxes.fileEditor(primerId, isShown), {
      savePasted: (file) => deps.drops.savePasted(file),
      toast: (text, tone) => deps.toast(text, tone),
      log: deps.log,
      logSource: 'primer',
    }),
  });
}

// Disposes its drop target and its view's anchors, destroys its editors and
// forgets its boxes, removes the view, and releases its take over, giving its
// session back.
function destroyPrimerView(
  primerId: string,
  primerViews: PrimerViews,
  tabs: SessionFormTabs,
  deps: Pick<PrimerViewDeps, 'boxes'>,
) {
  const primerView = primerViews.views.get(primerId);
  if (primerView === undefined) {
    return;
  }
  primerViews.dropTargets.get(primerId)?.dispose();
  primerViews.dropTargets.delete(primerId);
  primerView.dispose();
  deps.boxes.destroyForm(primerId);
  deps.boxes.forgetForm(primerId);
  primerView.element.remove();
  primerViews.views.delete(primerId);
  tabs.release(primerId);
}

// Two nested splits, tasks | (items | card): the outer split holds the tasks
// column and the inner split, which holds the items column and, in its end
// pane, the card edge strip over the card and the review, each scrolling on
// its own. Each column is a header, a body its layout part draws and, for the
// tasks column, a foot; its body is drawn again whenever the primer changes.
// The card is drawn again, its boxes destroyed and mounted again and its
// anchors disposed, only when `cardKeyOf` changes or the layout picked for its
// part changes; the review body is drawn again while it shows, when the
// primer or the review's pick changed, over a footer built once. `attach`
// places the root in the page once, before any editor mounts. `shown` reads
// the layouts the parts are picked from now.
function createPrimerFormView(
  attach: (root: HTMLElement) => void,
  primer: OpenPrimer,
  deps: PrimerViewDeps,
  dispatch: (action: PrimerAction) => void,
  shown: () => ShownLayouts<PrimerLayout>,
): PrimerFormView {
  const splitDeps = {
    uiState: deps.uiState,
    anchor: deps.keys.anchor,
    timers: deps.timers,
  };
  const outer = createSplit({
    initial: 240,
    min: 160,
    endMin: 480,
    stateKey: TASKS_WIDTH_KEY,
    ...splitDeps,
  });
  const inner = createSplit({
    initial: 240,
    min: 160,
    endMin: 320,
    stateKey: ITEMS_WIDTH_KEY,
    ...splitDeps,
  });
  const root = outer.element;
  root.classList.add('primer-form');
  inner.element.classList.add('primer-inner');
  inner.end.classList.add('primer-main');
  outer.end.append(inner.element);
  const anchors: Disposable[] = [];
  const keys = { anchor: recordingAnchor(deps.keys.anchor, anchors) };
  const tasksColumn = mountTasksColumn(outer.start, keys, deps.run);
  const tasks = shownColumn('tasks', tasksColumn.parts);
  const items = shownColumn('items', mountItemsColumn(inner.start, keys));
  const cardEdge = cardEdgeStrip(keys);
  const cardPane = element('div', 'primer-card');
  const reviewPane = element('div', 'primer-review-pane');
  const reviewBody = element('div', 'primer-review-body');
  reviewPane.append(reviewBody, reviewFooter({ keys, run: deps.run }));
  inner.end.append(cardEdge, cardPane, reviewPane);
  // Editors mount into attached elements, so they can measure themselves.
  attach(root);
  const partDeps: PartDeps = {
    markdown: deps.markdown,
    keys: deps.keys,
    commands: deps.commands,
    platform: deps.platform,
    boxes: deps.boxes,
    dispatch,
    log: deps.log,
  };
  const primerId = primer.formId;
  let cardKey = cardKeyOf(primer);
  let card = drawCard(cardPane, primer, shown(), partDeps);
  // The rowName of the card row last drawn.
  let drawnRow: string | null = null;
  let reviewPart: DrawnPrimerPart<{ element: HTMLElement }> | null = null;
  let reviewPrimer: OpenPrimer | null = null;

  const rebuildCard = (current: OpenPrimer) => {
    keepFocusedBox(deps.boxes, primerId, () => {
      card.dispose();
      cardPane.replaceChildren();
      card = drawCard(cardPane, current, shown(), partDeps);
    });
  };

  return {
    element: root,
    update(current, viewName) {
      // Every primer's columns share their stored widths.
      outer.reloadWidth();
      inner.reloadWidth();
      tasksColumn.statusLine.update(true, saveStatus(current));
      const layouts = shown();
      updateColumn(tasks, current, layouts, partDeps);
      updateColumn(items, current, layouts, partDeps);
      const shownRow = rowName(cardRow(current));
      const isRowChanged = shownRow !== drawnRow;
      const nextCardKey = cardKeyOf(current);
      const cardPick = pickPart(layouts, cardPartOf(current));
      if (nextCardKey !== cardKey || !isSamePick(card.pick, cardPick)) {
        cardKey = nextCardKey;
        rebuildCard(current);
      }
      if (isRowChanged) {
        cardPane.scrollTop = 0;
      }
      card.update(current);
      drawnRow = shownRow;
      const isReview = viewName === 'review';
      cardEdge.hidden = isReview;
      cardPane.hidden = viewName !== 'primer';
      reviewPane.hidden = !isReview;
      const reviewPick = pickPart(layouts, REVIEW_PART);
      const isReviewStale =
        current !== reviewPrimer || !isSamePick(reviewPart?.pick, reviewPick);
      if (isReview && isReviewStale) {
        reviewPrimer = current;
        reviewPart?.dispose();
        reviewBody.replaceChildren();
        reviewPart = drawReview(reviewBody, current, reviewPick, partDeps);
      }
    },
    scrollBy(step, direction) {
      const pane = reviewPane.hidden ? cardPane : reviewPane;
      return scrollContent(pane, step, direction, textLineHeightPx(pane));
    },
    resizeTarget: (pane) => (pane === 'tasks' ? outer : inner),
    dispose() {
      card.dispose();
      tasks.drawn?.dispose();
      items.drawn?.dispose();
      reviewPart?.dispose();
      disposeAnchors(anchors);
      inner.dispose();
      outer.dispose();
    },
  };
}

function shownColumn(name: PrimerColumn, parts: ColumnParts): ShownColumn {
  return { name, parts, drawn: null, primer: null, selection: null };
}

// A `span` of `className` anchored to `command`.
function anchoredSpan(
  keys: AnchorKeys,
  className: string,
  command: CommandId,
  options: AnchorOptions,
): HTMLElement {
  const node = element('span', className);
  keys.anchor(node, command, options);
  return node;
}

// `⌃H ▲ ▼ ⌃L`, the row pair at a column header, its keys in `scope`.
function rowStepEdge(keys: AnchorKeys, scope: ViewScope): HTMLElement {
  return keyEdge('primer-column-edge', [
    anchoredSpan(keys, 'primer-column-key', primerCommand('prevRow'), {
      scope,
    }),
    keyChevron('▲'),
    keyChevron('▼'),
    anchoredSpan(keys, 'primer-column-key', primerCommand('nextRow'), {
      scope,
    }),
  ]);
}

// A column's row prompt, each of `promptKeys` anchored in `scope`.
function columnRowPrompt(
  keys: AnchorKeys,
  scope: ViewScope,
  promptKeys: PromptKey[],
): Pick<ColumnParts, 'rowPrompt' | 'promptKeys'> {
  const placed = promptKeys.map(
    ([command, label, field]): [HTMLElement, keyof RowPrompt] => [
      anchoredSpan(keys, 'primer-row-key', primerCommand(command), {
        scope,
        label,
      }),
      field,
    ],
  );
  const rowPrompt = element('span', 'primer-row-prompt');
  rowPrompt.append(...placed.map(([node]) => node));
  return { rowPrompt, promptKeys: placed };
}

// Fills `column` with the tasks column's header, its body and its foot. The
// header holds the save state, the row pair `⌃H ▲ ▼ ⌃L` and `⌥L items ›` at
// the split's edge; the foot the Review button, whose keys show in the tasks,
// items and card scopes alike.
function mountTasksColumn(
  column: HTMLElement,
  keys: AnchorKeys,
  run: (command: CommandId) => void,
): { parts: ColumnParts; statusLine: StatusLine } {
  const scope = primerScope('tasks');
  const statusLine = createStatusLine();
  const edge = rowStepEdge(keys, scope);
  const head = element('header', 'primer-column-head');
  head.append(
    statusLine.element,
    edge,
    anchoredSpan(keys, 'primer-column-key', PANE_FOCUS_COMMANDS.right, {
      scope,
      label: 'items',
    }),
    keyChevron('›'),
  );
  const body = element('div', 'primer-column-body');
  const reviewKeys = keyStack(
    'primer-review-keys',
    (['tasks', 'items', 'card'] as const).map((pane) =>
      anchoredSpan(keys, 'primer-review-key', primerCommand('openReview'), {
        scope: primerScope(pane),
      }),
    ),
  );
  const foot = element('footer', 'primer-tasks-foot');
  foot.append(
    textButton('Review', () => run(primerCommand('openReview')), {
      variant: 'ghost',
      hint: reviewKeys,
    }),
  );
  column.classList.add('primer-column', 'primer-tasks');
  column.append(head, body, foot);
  return {
    parts: {
      element: column,
      edge,
      body,
      ...columnRowPrompt(keys, scope, TASKS_PROMPT_KEYS),
    },
    statusLine,
  };
}

// Fills `column` with the items column's header and its body. The header
// holds `‹ tasks ⌥H`, the row pair `⌃H ▲ ▼ ⌃L` and `⌥L card ›` at the split's
// edges.
function mountItemsColumn(column: HTMLElement, keys: AnchorKeys): ColumnParts {
  const scope = primerScope('items');
  const edge = rowStepEdge(keys, scope);
  const head = element('header', 'primer-column-head');
  head.append(
    keyChevron('‹ tasks'),
    anchoredSpan(keys, 'primer-column-key', PANE_FOCUS_COMMANDS.left, {
      scope,
    }),
    edge,
    anchoredSpan(keys, 'primer-column-key', PANE_FOCUS_COMMANDS.right, {
      scope,
      label: 'card',
    }),
    keyChevron('›'),
  );
  const body = element('div', 'primer-column-body');
  column.classList.add('primer-column', 'primer-items');
  column.append(head, body);
  return {
    element: column,
    edge,
    body,
    ...columnRowPrompt(keys, scope, ITEMS_PROMPT_KEYS),
  };
}

// The strip over the card: `‹ items ⌥H` at the split's edge.
function cardEdgeStrip(keys: AnchorKeys): HTMLElement {
  const strip = element('div', 'primer-card-edge');
  strip.append(
    keyChevron('‹ items'),
    anchoredSpan(keys, 'primer-card-edge-key', PANE_FOCUS_COMMANDS.left, {
      scope: primerScope('card'),
    }),
  );
  return strip;
}

// The save state the tasks column header shows: `Sending…` while the primer
// sends.
function saveStatus(primer: OpenPrimer): StatusLineContent {
  if (primer.sending !== null) {
    return { save: 'Sending…', saveState: 'sending' };
  }
  const shownState = saveState(primer);
  return {
    save: saveLabel(shownState, primer.saveError),
    saveState: shownState,
  };
}

// The layout part a pick tests a layout for.
type PartOf = (layout: PrimerLayout) => unknown;

const REVIEW_PART = (layout: PrimerLayout) => layout.review;
const CARD_PARTS: { [P in keyof PrimerLayoutCards]: PartOf } = {
  feature: (layout) => layout.cards?.feature,
  task: (layout) => layout.cards?.task,
  item: (layout) => layout.cards?.item,
};

// The part names each card draws under, in logs.
const CARD_PART_NAMES: { [P in keyof PrimerLayoutCards]: string } = {
  feature: 'feature card',
  task: 'task card',
  item: 'item card',
};

// The card update failures logged, by the layout object that drew the card.
// The loader makes a new layout object for each revision, so a new revision
// logs again.
const loggedUpdateFailures = new WeakMap<object, Set<string>>();

// The layout the user's setting names, then `default`, for the first that
// defines `part`.
function pickPart(
  shown: ShownLayouts<PrimerLayout>,
  part: PartOf,
): PartPick<PrimerLayout> {
  return pickLayout([shown.user, 'default'], shown.layouts, (layout) => {
    return part(layout) !== undefined;
  });
}

function isSamePick(
  drawn: PartPick<PrimerLayout> | undefined,
  next: PartPick<PrimerLayout>,
): boolean {
  return drawn?.name === next.name && drawn.layout === next.layout;
}

// The card part the card row shows.
function cardPartOf(primer: OpenPrimer): PartOf {
  return CARD_PARTS[cardRow(primer).kind];
}

// What differs between the two columns: the layout part each draws, how many
// rows it holds now, its selected row's position (-1 for none), what names
// its selection, and the draw of its part.
interface ColumnSpec {
  part: PartOf;
  rowCount(primer: OpenPrimer): number;
  selectedPosition(primer: OpenPrimer): number;
  selectionName(primer: OpenPrimer): string;
  draw(
    parent: HTMLElement,
    primer: OpenPrimer,
    pick: PartPick<PrimerLayout>,
    deps: PartDeps,
  ): DrawnPart<DrawnColumn>;
}

const COLUMNS: Record<PrimerColumn, ColumnSpec> = {
  tasks: {
    part: (layout) => layout.tasks,
    rowCount: (primer) => taskRows(primer).length,
    selectedPosition: taskPosition,
    selectionName: (primer) => rowName(primer.selectedTask),
    draw: drawTasksPart,
  },
  items: {
    part: (layout) => layout.items,
    rowCount: (primer) => selectedEntry(primer)?.items.length ?? 0,
    selectedPosition: (primer) => (primer.selectedItem ?? 0) - 1,
    selectionName: (primer) =>
      `${rowName(primer.selectedTask)} item ${primer.selectedItem}`,
    draw: drawItemsPart,
  },
};

// Marks the column `is-pane-inactive` while another pane has focus and its
// row pair `is-no-target` while it holds fewer than two rows, and draws its
// body again when the primer or the pick of its part changed.
function updateColumn(
  column: ShownColumn,
  current: OpenPrimer,
  layouts: ShownLayouts<PrimerLayout>,
  deps: PartDeps,
) {
  const spec = COLUMNS[column.name];
  const { parts } = column;
  parts.element.classList.toggle(
    'is-pane-inactive',
    current.pane !== column.name,
  );
  parts.edge.classList.toggle('is-no-target', spec.rowCount(current) < 2);
  const pick = pickPart(layouts, spec.part);
  if (current === column.primer && isSamePick(column.drawn?.pick, pick)) {
    return;
  }
  const selection = spec.selectionName(current);
  column.primer = current;
  column.drawn?.dispose();
  column.drawn = drawColumn(
    column,
    current,
    pick,
    deps,
    selection !== column.selection,
  );
  column.selection = selection;
}

// The column body through its layout part: the rows it drew marked
// `is-selected` for the selected row, which holds the row prompt, with its
// keys shown as `rowPrompt` says; the prompt sits at the end of the part's
// element when the part drew no row for the selected row, and leaves the
// column when `rowPrompt` is null. The selected row scrolls into view when
// `isRowChanged`.
function drawColumn(
  column: ShownColumn,
  primer: OpenPrimer,
  pick: PartPick<PrimerLayout>,
  deps: PartDeps,
  isRowChanged: boolean,
): DrawnPrimerPart<DrawnColumn> {
  const spec = COLUMNS[column.name];
  const { parts } = column;
  parts.body.replaceChildren();
  const drawn = spec.draw(parts.body, primer, pick, deps);
  const { rows, element: partElement } = drawn.built;
  const selectedPosition = spec.selectedPosition(primer);
  const prompt = rowPrompt(primer, column.name);
  for (const [position, node] of rows) {
    node.classList.toggle('is-selected', position === selectedPosition);
  }
  const selectedNode = rows.get(selectedPosition);
  if (prompt === null) {
    parts.rowPrompt.remove();
  } else {
    (selectedNode ?? partElement).append(parts.rowPrompt);
  }
  for (const [key, field] of parts.promptKeys) {
    key.hidden = prompt?.[field] !== true;
  }
  if (isRowChanged) {
    selectedNode?.scrollIntoView({ block: 'nearest' });
  }
  return { built: drawn.built, pick, dispose: drawn.dispose };
}

function drawTasksPart(
  parent: HTMLElement,
  primer: OpenPrimer,
  pick: PartPick<PrimerLayout>,
  deps: PartDeps,
): DrawnPart<DrawnColumn> {
  return drawPart({
    owner: 'primer',
    parent,
    pick,
    defaultLayout,
    part: (layout: PrimerLayout) => layout.tasks,
    build(builder, buildParent, rollback) {
      const { kit, rows } = createTasksKit(deps, primer, rollback);
      const pane = builder(buildParent, tasksInput(primer), kit);
      return { element: paneElement(buildParent, pane, 'tasks'), rows };
    },
    log: deps.log,
    logSource: 'primer',
    partName: 'tasks',
  });
}

function drawItemsPart(
  parent: HTMLElement,
  primer: OpenPrimer,
  pick: PartPick<PrimerLayout>,
  deps: PartDeps,
): DrawnPart<DrawnColumn> {
  return drawPart({
    owner: 'primer',
    parent,
    pick,
    defaultLayout,
    part: (layout: PrimerLayout) => layout.items,
    build(builder, buildParent, rollback) {
      const { kit, rows } = createItemsKit(deps, primer, rollback);
      const pane = builder(buildParent, itemsInput(primer), kit);
      return { element: paneElement(buildParent, pane, 'items'), rows };
    },
    log: deps.log,
    logSource: 'primer',
    partName: 'items',
  });
}

// The review body through the layout's review.
function drawReview(
  parent: HTMLElement,
  primer: OpenPrimer,
  pick: PartPick<PrimerLayout>,
  deps: PartDeps,
): DrawnPrimerPart<{ element: HTMLElement }> {
  const drawn = drawPart({
    owner: 'primer',
    parent,
    pick,
    defaultLayout,
    part: (layout: PrimerLayout) => layout.review,
    build(builder, buildParent, rollback) {
      const kit = createReviewKit(deps, rollback);
      const pane = builder(buildParent, reviewInput(primer), kit);
      return { element: paneElement(buildParent, pane, 'review') };
    },
    log: deps.log,
    logSource: 'primer',
    partName: 'review',
  });
  return { built: drawn.built, pick, dispose: drawn.dispose };
}

// The pane's element, checked to be appended to `parent`.
function paneElement(
  parent: HTMLElement,
  pane: PrimerLayoutPane | null | undefined,
  partName: string,
): HTMLElement {
  return requireElementIn(parent, pane?.element, partName);
}

// What a card is built for: the Feature row; a task row and whether its card
// holds the add-item box; or an item row.
function cardKeyOf(primer: OpenPrimer): string {
  const selected = cardRow(primer);
  switch (selected.kind) {
    case 'feature':
      return 'feature';
    case 'item':
      return `item ${selected.entryId} ${selected.item}`;
    case 'task': {
      const entry = selectedEntry(primer);
      const isOpen = entry !== null && hasAddItemBox(entry);
      return `task ${selected.entryId} ${isOpen ? 'open' : 'full'}`;
    }
  }
}

// The card row's card, the Feature card, the task card or the item card,
// through the layout picked for its part.
function drawCard(
  parent: HTMLElement,
  primer: OpenPrimer,
  shown: ShownLayouts<PrimerLayout>,
  deps: PartDeps,
): DrawnCard {
  const selected = cardRow(primer);
  const entry = selectedEntry(primer);
  const pick = pickPart(shown, cardPartOf(primer));
  if (entry === null) {
    return drawCardPart(parent, primer, pick, deps, {
      kind: 'feature',
      part: (layout) => layout.cards?.feature,
      kit: (rollback) => createFeatureKit(deps, primer, rollback),
      input: featureInput,
    });
  }
  const entryId = entry.id;
  if (selected.kind === 'item') {
    const number = selected.item;
    return drawCardPart(parent, primer, pick, deps, {
      kind: 'item',
      part: (layout) => layout.cards?.item,
      kit: (rollback) => createItemKit(deps, primer, entry, number, rollback),
      input: (current) => itemInput(current, entryId, number),
    });
  }
  return drawCardPart(parent, primer, pick, deps, {
    kind: 'task',
    part: (layout) => layout.cards?.task,
    kit: (rollback) => createTaskKit(deps, primer, entry, rollback),
    input: (current) => taskInput(current, entryId),
  });
}

// One card kind's builder, kit and input. `input` is null once the card's
// task or item is gone.
interface CardSpec<Kit, Input> {
  kind: keyof PrimerLayoutCards;
  part(layout: PrimerLayout): CardBuilder<Kit, Input> | undefined;
  kit(rollback: RollbackDeps): CardKit<Kit, Input>;
  input(primer: OpenPrimer): Input | null;
}

type CardBuilder<Kit, Input> = (
  parent: HTMLElement,
  input: Input,
  kit: Kit,
) => PrimerLayoutCard<Input>;

// The card the spec builds through `pick`: the layout's card, then each box it
// left out at its end. `update` brings the kit's own parts up to date, then
// runs the card's own `update`, whose throw is logged once per layout object
// and part and keeps the card.
function drawCardPart<Kit, Input>(
  parent: HTMLElement,
  primer: OpenPrimer,
  pick: PartPick<PrimerLayout>,
  deps: PartDeps,
  spec: CardSpec<Kit, Input>,
): DrawnCard {
  const partName = CARD_PART_NAMES[spec.kind];
  const input = spec.input(primer);
  if (input === null) {
    throw new Error(`primer ${primer.formId} has no ${partName} to draw`);
  }
  const drawn = drawPart({
    owner: 'primer',
    parent,
    pick,
    defaultLayout,
    part: spec.part,
    build(builder, buildParent, rollback) {
      const kit = spec.kit(rollback);
      const card: PrimerLayoutCard<Input> | null | undefined = builder(
        buildParent,
        input,
        kit.kit,
      );
      const element = requireElementIn(buildParent, card?.element, partName);
      kit.appendUnmountedBoxes(element);
      return { element, card: card as PrimerLayoutCard<Input>, kit };
    },
    log: deps.log,
    logSource: 'primer',
    partName,
  });
  const layout = drawn.layoutName === pick.name ? pick.layout : defaultLayout;
  const { card, kit } = drawn.built;
  return {
    pick,
    update(current) {
      const next = spec.input(current);
      if (next === null) {
        return;
      }
      kit.update(next);
      try {
        card.update?.(next);
      } catch (error) {
        logUpdateFailureOnce(
          deps.log,
          layout,
          drawn.layoutName,
          partName,
          error,
        );
      }
    },
    dispose: drawn.dispose,
  };
}

function logUpdateFailureOnce(
  log: Log,
  layout: object,
  layoutName: string,
  partName: string,
  error: unknown,
): void {
  const logged = loggedUpdateFailures.get(layout) ?? new Set<string>();
  loggedUpdateFailures.set(layout, logged);
  if (logged.has(partName)) {
    return;
  }
  logged.add(partName);
  log(
    'primer',
    `layout ${layoutName} ${partName} update failed: ${errorText(error)}`,
  );
}

function featureInput(primer: OpenPrimer): FeatureCardInput {
  return { ...primer.feature };
}

// Null once the task is gone.
function taskInput(primer: OpenPrimer, entryId: string): TaskCardInput | null {
  const entry = entryById(primer, entryId);
  if (entry === undefined) {
    return null;
  }
  return {
    id: entry.id,
    group: entry.group,
    number: entry.number,
    area: entry.area,
    name: taskName(entry),
    need: entry.need,
    question: entry.question,
    evidence: entry.evidence,
    probes: entry.probes,
    pointer: entry.pointer,
    itemCount: entry.items.length,
    canAddItem: hasAddItemBox(entry),
  };
}

// Item `number` (1-based) of the task; null once the task or item is gone.
function itemInput(
  primer: OpenPrimer,
  entryId: string,
  number: number,
): ItemCardInput | null {
  const entry = entryById(primer, entryId);
  const item = entry?.items[number - 1];
  if (entry === undefined || item === undefined) {
    return null;
  }
  return {
    entryId,
    taskName: taskName(entry),
    number,
    count: entry.items.length,
    text: item.text,
    include: item.include,
    added: item.added,
  };
}

function entryById(
  primer: OpenPrimer,
  entryId: string,
): PrimerEntry | undefined {
  return primer.entries.find((entry) => entry.id === entryId);
}

// The Feature row, then each group's rows: Primer and Every feature only over
// tasks, Extra tasks always.
function tasksInput(primer: OpenPrimer): TasksInput {
  const rows = taskRows(primer);
  const groups = TASK_GROUPS.flatMap(([group, header]) => {
    const entries = primer.entries.filter((entry) => entry.group === group);
    if (entries.length === 0 && group !== 'extra') {
      return [];
    }
    return [
      {
        group,
        header,
        rows: entries.map((entry) => taskRowInput(rows, entry)),
      },
    ];
  });
  return {
    feature: { position: 0, kind: 'feature', name: primer.feature.name },
    groups,
  };
}

function taskRowInput(rows: TaskRow[], entry: PrimerEntry): TaskRowInput {
  return {
    position: rows.findIndex(
      (candidate) =>
        candidate.kind === 'task' && candidate.entryId === entry.id,
    ),
    kind: 'task',
    entryId: entry.id,
    group: entry.group,
    name: taskName(entry),
    need: entry.need,
    included: includedCount(entry),
    total: entry.items.length,
  };
}

// The selected task's items, or the empty state on the Feature row and on a
// task with none.
function itemsInput(primer: OpenPrimer): ItemsInput {
  const entry = selectedEntry(primer);
  if (entry === null) {
    return { task: null, rows: [], empty: NO_TASK_ITEMS };
  }
  const rows = entry.items.map((item, i) => ({
    position: i,
    entryId: entry.id,
    number: i + 1,
    text: item.text,
    include: item.include,
    added: item.added,
  }));
  return {
    task: { entryId: entry.id, name: taskName(entry) },
    rows,
    empty: rows.length === 0 ? NO_ITEMS : null,
  };
}
