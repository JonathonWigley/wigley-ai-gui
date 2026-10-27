import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
import type {
  PluginAreas,
  PushedScope,
  ShownLayouts,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { scrollContent } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { createConfirmPrompt } from '../../../shared/page/confirm-prompt';
import { element } from '../../../shared/page/dom';
import {
  type EditorBoxes,
  keepFocusedBox,
} from '../../../shared/page/editor-boxes';
import type { KitCommands } from '../../../shared/page/layout-host/base-kit';
import {
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
  paneView,
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
  PrimerLayout,
  PrimerLayoutCard,
  PrimerLayoutCards,
  PrimerLayoutPane,
  RailInput,
  RailRowInput,
  TaskCardInput,
} from '../layouts/layout';
import { boxKey, hasAddItemBox, type PrimerBox, shownBoxes } from './boxes';
import {
  type CardKit,
  createFeatureKit,
  createItemKit,
  createRailKit,
  createReviewKit,
  createTaskKit,
  type PrimerPartKitDeps,
} from './layout/primer-kit';
import { reviewFooter, reviewInput, taskName } from './primer-review';
import {
  includedCount,
  type OpenPrimer,
  type PrimerAction,
  type PrimerState,
  RAIL_GROUPS,
  type RailRow,
  railPosition,
  railRows,
  rowName,
  rowPrompt,
  scopeOf,
  selectedEntry,
  selectedRow,
  sessionTitle,
} from './primer-state';
import type { PrimerStore } from './primer-store';

// `beforeClose` answers whether a session may close now. `setScope` sets the
// key scope to `scopeOf` the state while a Primer tab is the visible tab;
// `pushConfirmScope` lays the cancel prompt's scope over it. `keys` anchors
// each key hint the view and its layout draw and reads the keys a layout asks
// for. `run` runs a button's command; `commands` is what a layout's
// `kit.command` reaches. `platform` is the OS the layouts' key hints draw for.
// `uiState` keeps the rail's dragged width, which every primer's rail opens
// at.
export interface PrimerViewDeps {
  areas: Pick<PluginAreas, 'overlay'>;
  sessions: Pick<SessionsPageExports, 'addTab'>;
  beforeClose(sessionId: string): boolean;
  setScope(scope: PrimerScopeName): void;
  pushConfirmScope(): PushedScope;
  store: PrimerStore;
  boxes: EditorBoxes<PrimerBox>;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
  run(command: CommandId): void;
  commands: KitCommands;
  platform: Platform;
  uiState: UiState;
  log: Log;
}

// `forgetSession` drops a session's Primer tab entry and destroys its primer
// views once sessions dropped the tab, so the next render rebuilds a primer
// still open for the session in a new Primer tab. `showPrimer` selects the
// session's Primer tab, a no-op when it has none. `scrollBy` scrolls the
// active primer's card or review, whichever shows, down for 1 and up for -1;
// null with no primer shown. `setLayouts` draws every part whose picked
// layout changed again, keeping the focused box.
export interface PrimerTab {
  forgetSession(sessionId: string): void;
  showPrimer(sessionId: string): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  setLayouts(shown: ShownLayouts<PrimerLayout>): void;
}

// One open primer's DOM in its session's Primer tab. `update` draws it for
// the primer and the view whose pane shows: under the cancel prompt, the view
// keeping the primer returns to. `dispose` disposes every anchor it named and
// destroys every box its parts mounted.
interface PrimerFormView {
  element: HTMLElement;
  update(primer: OpenPrimer, view: PrimerView): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll;
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

// The rail body a layout drew, and the row `railRow` drew at each position.
interface DrawnRail {
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

// The parts of the rail a primer view builds once: the header's save state
// and row pair, the body `drawRail` fills, and the row prompt `drawRail` moves
// to the selected row with its need, include and remove keys.
interface RailParts {
  statusLine: StatusLine;
  edge: HTMLElement;
  body: HTMLElement;
  rowPrompt: HTMLElement;
  needKeys: HTMLElement[];
  includeKey: HTMLElement;
  removeKey: HTMLElement;
}

// The whole primer UI: each primer in its session's Primer tab and the cancel
// prompt in the overlay layer, serving the active primer. Every store change
// renders it; a change a render's own dispatch makes renders again once that
// render ends. While a Primer tab is the visible tab the key scope follows
// the state; the cancel prompt pushes its own scope over it and is dismissed
// when another view sets the scope. Each part draws through the layouts the
// last `setLayouts` handed it, `default` alone until the first.
export function mountPrimerTab(deps: PrimerViewDeps): PrimerTab {
  const { areas, store, boxes } = deps;
  const tabs = createSessionFormTabs({
    addTab: (sessionId, tab) => deps.sessions.addTab(sessionId, tab),
    tabId: 'primer',
    title: 'Primer',
    className: 'primer-tab',
    idleText: "No primer open. The agent's next primer opens here.",
    beforeClose: (sessionId) => deps.beforeClose(sessionId),
    shown: () => deps.setScope(scopeOf(store.get())),
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
  const primerViews = new Map<string, PrimerFormView>();
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
      primerViews,
      tabs,
      deps,
      dispatch,
      () => shownLayouts,
    );
    tabs.sync((sessionId) => {
      const primer = formOfSession(state, sessionId);
      return primer === undefined ? null : sessionTitle(primer);
    });
    const view = state.view;
    const shown = view === 'idle' ? null : activeForm(state);
    for (const [primerId, primerView] of primerViews) {
      primerView.element.hidden = primerId !== shown?.formId;
    }
    if (shown !== null) {
      primerViews.get(shown.formId)?.update(shown, paneView(state));
    }
    confirm.setBaseScope(() => {
      if (tabs.isShown()) {
        deps.setScope(scopeOf(state));
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
          destroyPrimerView(primer.formId, primerViews, tabs, deps);
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

function isBoxShown(state: PrimerState, box: PrimerBox): boolean {
  const key = boxKey(box);
  return shownBoxes(state).some((shown) => boxKey(shown) === key);
}

// A primer view per open primer, in its session's Primer tab: built when the
// primer appears, adding the Primer tab when the session has none and taking
// over the session with it; destroyed with its editors when the primer leaves.
function syncPrimerViews(
  state: PrimerState,
  primerViews: Map<string, PrimerFormView>,
  tabs: SessionFormTabs,
  deps: PrimerViewDeps,
  dispatch: (action: PrimerAction) => void,
  shown: () => ShownLayouts<PrimerLayout>,
) {
  for (const primerId of primerViews.keys()) {
    if (!state.forms.some((primer) => primer.formId === primerId)) {
      destroyPrimerView(primerId, primerViews, tabs, deps);
    }
  }
  for (const primer of state.forms) {
    if (!primerViews.has(primer.formId)) {
      primerViews.set(
        primer.formId,
        createPrimerFormView(
          (root) => tabs.mount(primer.sessionId, root),
          primer,
          deps,
          dispatch,
          shown,
        ),
      );
      tabs.takeOver(primer.formId, primer.sessionId);
    }
  }
}

// Disposes its view's anchors and destroys its editors, removes the view, and
// releases its take over, giving its session back.
function destroyPrimerView(
  primerId: string,
  primerViews: Map<string, PrimerFormView>,
  tabs: SessionFormTabs,
  deps: Pick<PrimerViewDeps, 'boxes'>,
) {
  const primerView = primerViews.get(primerId);
  if (primerView === undefined) {
    return;
  }
  primerView.dispose();
  deps.boxes.destroyForm(primerId);
  primerView.element.remove();
  primerViews.delete(primerId);
  tabs.release(primerId);
}

// A split with the rail in its start pane and, in its end pane, the card edge
// strip over the card and the review, each scrolling on its own. The rail is
// a header, a body the layout's rail draws and a foot; its body is drawn again
// whenever the primer changes. The card is drawn again, its boxes destroyed and
// mounted again and its anchors disposed, only when `cardKeyOf` changes or the
// layout picked for its part changes; the review body is drawn again while it
// shows, when the primer or the review's pick changed, over a footer built
// once. `attach` places the root in the page once, before any editor mounts.
// `shown` reads the layouts the parts are picked from now.
function createPrimerFormView(
  attach: (root: HTMLElement) => void,
  primer: OpenPrimer,
  deps: PrimerViewDeps,
  dispatch: (action: PrimerAction) => void,
  shown: () => ShownLayouts<PrimerLayout>,
): PrimerFormView {
  const split = createSplit({
    initial: 240,
    min: 160,
    max: 400,
    uiState: deps.uiState,
    stateKey: 'primer-rail-width',
  });
  const root = split.element;
  root.classList.add('primer-form');
  split.start.classList.add('primer-rail');
  split.end.classList.add('primer-main');
  const anchors: Disposable[] = [];
  const keys = { anchor: recordingAnchor(deps.keys.anchor, anchors) };
  const rail = mountRail(split.start, keys, deps.run);
  const cardEdge = cardEdgeStrip(keys);
  const cardPane = element('div', 'primer-card');
  const reviewPane = element('div', 'primer-review-pane');
  const reviewBody = element('div', 'primer-review-body');
  reviewPane.append(reviewBody, reviewFooter({ keys, run: deps.run }));
  split.end.append(cardEdge, cardPane, reviewPane);
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
  let railPart: DrawnPrimerPart<DrawnRail> | null = null;
  let railPrimer: OpenPrimer | null = null;
  // The rowName of the selected row last drawn.
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
      // Every primer's rail shares one stored width.
      split.reloadWidth();
      split.start.classList.toggle('is-pane-inactive', current.pane === 'card');
      rail.statusLine.update(true, saveStatus(current));
      rail.edge.classList.toggle('is-no-target', railRows(current).length < 2);
      const layouts = shown();
      const shownRow = rowName(selectedRow(current));
      const isRowChanged = shownRow !== drawnRow;
      const railPick = pickPart(layouts, RAIL_PART);
      if (current !== railPrimer || !isSamePick(railPart?.pick, railPick)) {
        railPrimer = current;
        railPart?.dispose();
        railPart = drawRail(rail, current, railPick, partDeps, isRowChanged);
      }
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
    dispose() {
      card.dispose();
      railPart?.dispose();
      reviewPart?.dispose();
      disposeAnchors(anchors);
    },
  };
}

// A `span` of `className` anchored to the primer `command`.
function anchoredSpan(
  keys: AnchorKeys,
  className: string,
  command: PrimerCommandName,
  options: AnchorOptions,
): HTMLElement {
  const node = element('span', className);
  keys.anchor(node, primerCommand(command), options);
  return node;
}

// Fills `rail` with its header, its body and its foot, and builds the row
// prompt `drawRail` places. The header holds the save state, the row pair
// `⌃H ▲ ▼ ⌃L` and `⌥L card ›` at the split's edge; the foot the Review
// button, whose keys show in the rail and the card scope alike.
function mountRail(
  rail: HTMLElement,
  keys: AnchorKeys,
  run: (command: CommandId) => void,
): RailParts {
  const scope = primerScope('rail');
  const statusLine = createStatusLine();
  const edge = keyEdge('primer-rail-edge', [
    anchoredSpan(keys, 'primer-rail-key', 'prevRow', { scope }),
    keyChevron('▲'),
    keyChevron('▼'),
    anchoredSpan(keys, 'primer-rail-key', 'nextRow', { scope }),
  ]);
  const head = element('header', 'primer-rail-head');
  head.append(
    statusLine.element,
    edge,
    anchoredSpan(keys, 'primer-rail-key', 'focusCard', {
      scope,
      label: 'card',
    }),
    keyChevron('›'),
  );
  const body = element('div', 'primer-rail-body');
  const needKeys = [
    anchoredSpan(keys, 'primer-row-key', 'needYes', { scope, label: 'yes' }),
    anchoredSpan(keys, 'primer-row-key', 'needNo', { scope, label: 'no' }),
    anchoredSpan(keys, 'primer-row-key', 'needUnclear', {
      scope,
      label: 'unclear',
    }),
  ];
  const includeKey = anchoredSpan(keys, 'primer-row-key', 'toggleInclude', {
    scope,
    label: 'include',
  });
  const removeKey = anchoredSpan(keys, 'primer-row-key', 'removeExtraTask', {
    scope,
    label: 'remove',
  });
  const prompt = element('span', 'primer-row-prompt');
  prompt.append(...needKeys, includeKey, removeKey);
  const reviewKeys = keyStack('primer-review-keys', [
    anchoredSpan(keys, 'primer-review-key', 'openReview', { scope }),
    anchoredSpan(keys, 'primer-review-key', 'openReview', {
      scope: primerScope('card'),
    }),
  ]);
  const foot = element('footer', 'primer-rail-foot');
  foot.append(
    textButton('Review', () => run(primerCommand('openReview')), {
      variant: 'ghost',
      hint: reviewKeys,
    }),
  );
  rail.append(head, body, foot);
  return {
    statusLine,
    edge,
    body,
    rowPrompt: prompt,
    needKeys,
    includeKey,
    removeKey,
  };
}

// The strip over the card: `‹ rail ⌥H` at the split's edge.
function cardEdgeStrip(keys: AnchorKeys): HTMLElement {
  const strip = element('div', 'primer-card-edge');
  strip.append(
    keyChevron('‹ rail'),
    anchoredSpan(keys, 'primer-card-edge-key', 'focusRail', {
      scope: primerScope('card'),
    }),
  );
  return strip;
}

// The save state the rail header shows: `Sending…` while the primer sends.
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

const RAIL_PART = (layout: PrimerLayout) => layout.rail;
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

// The card part the selected row shows.
function cardPartOf(primer: OpenPrimer): PartOf {
  return CARD_PARTS[cardKindOf(primer)];
}

// The Feature card while no task is selected, else the selected row's kind.
function cardKindOf(primer: OpenPrimer): keyof PrimerLayoutCards {
  if (selectedEntry(primer) === null) {
    return 'feature';
  }
  return selectedRow(primer).kind === 'item' ? 'item' : 'task';
}

// The rail body through the layout's rail: the rows it drew with `railRow`
// marked `is-selected` for the selected row, which holds the row prompt, with
// its need, include and remove keys shown as `rowPrompt` says; the prompt
// sits at the end of the rail's element when the rail drew no row for the
// selected row, and leaves the rail on the Feature row. The selected row
// scrolls into view when `isRowChanged`.
function drawRail(
  rail: RailParts,
  primer: OpenPrimer,
  pick: PartPick<PrimerLayout>,
  deps: PartDeps,
  isRowChanged: boolean,
): DrawnPrimerPart<DrawnRail> {
  rail.body.replaceChildren();
  const drawn = drawPart({
    owner: 'primer',
    parent: rail.body,
    pick,
    defaultLayout,
    part: (layout: PrimerLayout) => layout.rail,
    build(builder, parent, rollback) {
      const { kit, rows } = createRailKit(deps, primer, rollback);
      const pane = builder(parent, railInput(primer), kit);
      return { element: paneElement(parent, pane, 'rail'), rows };
    },
    log: deps.log,
    logSource: 'primer',
    partName: 'rail',
  });
  const { rows, element: railElement } = drawn.built;
  const selectedPosition = railPosition(primer);
  const prompt = rowPrompt(primer);
  for (const [position, node] of rows) {
    node.classList.toggle('is-selected', position === selectedPosition);
  }
  const selectedNode = rows.get(selectedPosition);
  if (prompt === null) {
    rail.rowPrompt.remove();
  } else {
    (selectedNode ?? railElement).append(rail.rowPrompt);
  }
  for (const needKey of rail.needKeys) {
    needKey.hidden = prompt?.need !== true;
  }
  rail.includeKey.hidden = prompt?.include !== true;
  rail.removeKey.hidden = prompt?.remove !== true;
  if (isRowChanged) {
    selectedNode?.scrollIntoView({ block: 'nearest' });
  }
  return { built: drawn.built, pick, dispose: drawn.dispose };
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
  const selected = selectedRow(primer);
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

// The selected row's card, the Feature card, the task card or the item card,
// through the layout picked for its part.
function drawCard(
  parent: HTMLElement,
  primer: OpenPrimer,
  shown: ShownLayouts<PrimerLayout>,
  deps: PartDeps,
): DrawnCard {
  const selected = selectedRow(primer);
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
function railInput(primer: OpenPrimer): RailInput {
  const rows = railRows(primer);
  const groups = RAIL_GROUPS.flatMap(([group, header]) => {
    const entries = primer.entries.filter((entry) => entry.group === group);
    if (entries.length === 0 && group !== 'extra') {
      return [];
    }
    return [
      {
        group,
        header,
        rows: entries.flatMap((entry) => taskRows(rows, entry)),
      },
    ];
  });
  return {
    feature: { position: 0, kind: 'feature', name: primer.feature.name },
    groups,
  };
}

// The task's row, then its item rows when the rail expands it.
function taskRows(rows: RailRow[], entry: PrimerEntry): RailRowInput[] {
  const position = rows.findIndex(
    (candidate) => candidate.kind === 'task' && candidate.entryId === entry.id,
  );
  const isExpanded = rows[position + 1]?.kind === 'item';
  const task: RailRowInput = {
    position,
    kind: 'task',
    entryId: entry.id,
    group: entry.group,
    name: taskName(entry),
    need: entry.need,
    included: includedCount(entry),
    total: entry.items.length,
    expanded: isExpanded,
  };
  if (!isExpanded) {
    return [task];
  }
  return [
    task,
    ...entry.items.map((item, i): RailRowInput => ({
      position: position + 1 + i,
      kind: 'item',
      entryId: entry.id,
      number: i + 1,
      text: item.text,
      include: item.include,
      added: item.added,
    })),
  ];
}
