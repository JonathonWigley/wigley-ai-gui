import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { scrollContent } from '../../../shared/content-scroll';
import { createConfirmPrompt } from '../../../shared/page/confirm-prompt';
import { element, markdownElement } from '../../../shared/page/dom';
import {
  type EditorBoxes,
  keepFocusedBox,
} from '../../../shared/page/editor-boxes';
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
import { emptyState } from '../../../shared/page/ui/empty-state';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import {
  boxHint,
  disposeAnchors,
  keyChevron,
  keyEdge,
  keyStack,
  recordingAnchor,
} from '../../../shared/page/ui/key-anchors';
import { row } from '../../../shared/page/ui/row';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { createSplit } from '../../../shared/page/ui/split';
import { tag } from '../../../shared/page/ui/tag';
import { setToggleMark, toggleMark } from '../../../shared/page/ui/toggle-mark';
import type { AnchorOptions, KeysPageExports } from '../../keys/contract';
import type { SessionsPageExports } from '../../sessions/contract';
import type { PrimerEntry, PrimerItem, PrimerView } from '../contract';
import {
  type PrimerCommandName,
  primerCommand,
  primerScope,
  type PrimerScopeName,
} from '../ids';
import {
  boxKey,
  boxText,
  hasAddItemBox,
  type PrimerBox,
  shownBoxes,
} from './boxes';
import { needTag, renderReview, reviewFooter, taskName } from './primer-review';
import {
  FEATURE_FIELDS,
  includedCount,
  type OpenPrimer,
  type PrimerAction,
  type PrimerState,
  RAIL_GROUPS,
  railPosition,
  railRows,
  rowName,
  rowPrompt,
  scopeOf,
  selectedEntry,
  selectedRow,
  sessionTitle,
  type TextTarget,
} from './primer-state';
import type { PrimerStore } from './primer-store';

// `beforeClose` answers whether a session may close now. `setScope` sets the
// key scope to `scopeOf` the state while a Primer tab is the visible tab;
// `pushConfirmScope` lays the cancel prompt's scope over it. `keys` anchors
// each key hint the view draws. `run` runs a button's command. `uiState`
// keeps the rail's dragged width, which every primer's rail opens at.
export interface PrimerViewDeps {
  areas: Pick<PluginAreas, 'overlay'>;
  sessions: Pick<SessionsPageExports, 'addTab'>;
  beforeClose(sessionId: string): boolean;
  setScope(scope: PrimerScopeName): void;
  pushConfirmScope(): PushedScope;
  store: PrimerStore;
  boxes: EditorBoxes<PrimerBox>;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'anchor'>;
  run(command: CommandId): void;
  uiState: UiState;
  log: Log;
}

// `forgetSession` drops a session's Primer tab entry and destroys its primer
// views once sessions dropped the tab, so the next render rebuilds a primer
// still open for the session in a new Primer tab. `showPrimer` selects the
// session's Primer tab, a no-op when it has none. `scrollBy` scrolls the
// active primer's card or review, whichever shows, down for 1 and up for -1;
// null with no primer shown.
export interface PrimerTab {
  forgetSession(sessionId: string): void;
  showPrimer(sessionId: string): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
}

// One open primer's DOM in its session's Primer tab. `update` draws it for
// the primer and the view whose pane shows: under the cancel prompt, the view
// keeping the primer returns to. `dispose` disposes every anchor it named.
interface PrimerFormView {
  element: HTMLElement;
  update(primer: OpenPrimer, view: PrimerView): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll;
  dispose(): void;
}

// A built card: `update` redraws what changes without a rebuild, and
// `dispose` disposes the anchors its build named.
interface PrimerCard {
  update(primer: OpenPrimer): void;
  dispose(): void;
}

type AnchorKeys = Pick<KeysPageExports, 'anchor'>;

type CardDeps = Pick<PrimerViewDeps, 'boxes' | 'markdown' | 'keys'> & {
  dispatch(action: PrimerAction): void;
};

// The parts of the rail a primer view builds once: the header's save state
// and row pair, the body `drawRail` fills, the row prompt `drawRail` moves to
// the selected row with its need, include and remove keys, and the Extra
// tasks header's prompt.
interface RailParts {
  statusLine: StatusLine;
  edge: HTMLElement;
  body: HTMLElement;
  rowPrompt: HTMLElement;
  needKeys: HTMLElement[];
  includeKey: HTMLElement;
  removeKey: HTMLElement;
  addPrompt: HTMLElement;
}

// The whole primer UI: each primer in its session's Primer tab and the cancel
// prompt in the overlay layer, serving the active primer. Every store change
// renders it; a change a render's own dispatch makes renders again once that
// render ends. While a Primer tab is the visible tab the key scope follows
// the state; the cancel prompt pushes its own scope over it and is dismissed
// when another view sets the scope.
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

  const renderOnce = () => {
    if (!confirm.settleOwedDismiss()) {
      return;
    }
    const state = store.get();
    syncPrimerViews(state, primerViews, tabs, deps, dispatch);
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
        ),
      );
      tabs.takeOver(primer.formId, primer.sessionId);
    }
  }
}

// Destroys the primer's editors, removes its view and disposes its anchors,
// and releases its take over, giving its session back.
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
  deps.boxes.destroyForm(primerId);
  primerView.dispose();
  primerView.element.remove();
  primerViews.delete(primerId);
  tabs.release(primerId);
}

// A split with the rail in its start pane and, in its end pane, the card edge
// strip over the card and the review, each scrolling on its own. The rail is
// a header, a scrolling body and a foot; its body redraws whenever the primer
// changes. The card is rebuilt, its boxes destroyed and mounted again and its
// anchors disposed, only when `cardKeyOf` changes; the review body is drawn again while it shows, when the primer changed, over a
// footer built once. `attach` places the root in the page once, before any
// editor mounts.
function createPrimerFormView(
  attach: (root: HTMLElement) => void,
  primer: OpenPrimer,
  deps: PrimerViewDeps,
  dispatch: (action: PrimerAction) => void,
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
  const cardDeps: CardDeps = {
    boxes: deps.boxes,
    markdown: deps.markdown,
    keys: deps.keys,
    dispatch,
  };
  const primerId = primer.formId;
  let cardKey = cardKeyOf(primer);
  let card = buildCard(cardPane, primer, cardDeps);
  let railPrimer: OpenPrimer | null = null;
  // The rowName of the selected row last drawn.
  let drawnRow: string | null = null;
  let reviewPrimer: OpenPrimer | null = null;

  const rebuildCard = (current: OpenPrimer) => {
    keepFocusedBox(deps.boxes, primerId, () => {
      deps.boxes.destroyForm(primerId);
      card.dispose();
      cardPane.replaceChildren();
      card = buildCard(cardPane, current, cardDeps);
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
      const shownRow = rowName(selectedRow(current));
      const isRowChanged = shownRow !== drawnRow;
      if (current !== railPrimer) {
        railPrimer = current;
        drawRail(rail, current, dispatch, isRowChanged);
      }
      const nextCardKey = cardKeyOf(current);
      if (nextCardKey !== cardKey) {
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
      if (isReview && current !== reviewPrimer) {
        reviewPrimer = current;
        reviewBody.replaceChildren(renderReview(current));
      }
    },
    scrollBy(step, direction) {
      const pane = reviewPane.hidden ? cardPane : reviewPane;
      return scrollContent(pane, step, direction, textLineHeightPx(pane));
    },
    dispose() {
      card.dispose();
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

// Fills `rail` with its header, its body and its foot, and builds the
// prompts `drawRail` places. The header holds the save state, the row pair
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
  const addPrompt = anchoredSpan(keys, 'primer-add-prompt', 'addExtraTask', {
    scope,
    label: 'add',
  });
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
    addPrompt,
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

// The rail body: the Feature row, then each group's tasks under its header,
// the Primer and Every feature headers only over tasks and Extra tasks always,
// holding the add prompt, with a line saying so while it holds none. The
// selected row's task has its items as rows under its task row. The row
// prompt sits under the selected task or item row's label and leaves the
// Feature row, showing the include key on an item row and the remove key on
// an extra task's rows. Each row's click selects it; the selected row scrolls
// into view when `isRowChanged`.
function drawRail(
  rail: RailParts,
  primer: OpenPrimer,
  dispatch: (action: PrimerAction) => void,
  isRowChanged: boolean,
) {
  const list = element('div', 'primer-rail-list');
  const rows = railRows(primer);
  const selectedPosition = railPosition(primer);
  const prompt = rowPrompt(primer);
  const select = (position: number) => () =>
    dispatch({ type: 'selectRow', row: position });
  // The row drawn at `position`, selected and holding the prompt when it is
  // the selected row.
  const placed = (position: number, node: HTMLElement) => {
    const isSelected = position === selectedPosition;
    node.classList.toggle('is-selected', isSelected);
    if (isSelected && prompt !== null) {
      node.append(rail.rowPrompt);
    }
    return node;
  };
  if (prompt === null) {
    rail.rowPrompt.remove();
  }
  for (const needKey of rail.needKeys) {
    needKey.hidden = prompt?.need !== true;
  }
  rail.includeKey.hidden = prompt?.include !== true;
  rail.removeKey.hidden = prompt?.remove !== true;
  list.append(
    placed(
      0,
      row({
        density: 'list',
        label: 'Feature',
        detail: primer.feature.name,
        onClick: select(0),
      }),
    ),
  );
  for (const [group, header] of RAIL_GROUPS) {
    const entries = primer.entries.filter((entry) => entry.group === group);
    const isExtra = group === 'extra';
    if (entries.length === 0 && !isExtra) {
      continue;
    }
    list.append(sectionHeader(header, isExtra ? rail.addPrompt : null));
    for (const entry of entries) {
      const position = rows.findIndex(
        (candidate) =>
          candidate.kind === 'task' && candidate.entryId === entry.id,
      );
      list.append(
        placed(
          position,
          row({
            density: 'list',
            label: taskName(entry),
            trailing: railTrailing(entry),
            onClick: select(position),
          }),
        ),
      );
      const isExpanded = rows[position + 1]?.kind === 'item';
      if (isExpanded) {
        entry.items.forEach((item, i) => {
          const itemPosition = position + 1 + i;
          list.append(
            placed(
              itemPosition,
              railItemRow(item, i + 1, select(itemPosition), () => {
                select(itemPosition)();
                dispatch({ type: 'toggleInclude' });
              }),
            ),
          );
        });
      }
    }
    if (entries.length === 0) {
      list.append(emptyState('No extra tasks.'));
    }
  }
  rail.body.replaceChildren(list);
  if (isRowChanged) {
    list
      .querySelector('.ui-row.is-selected')
      ?.scrollIntoView({ block: 'nearest' });
  }
}

// A task row's need tag and `<included>/<total>` count of its items.
function railTrailing(entry: PrimerEntry): HTMLElement {
  const trailing = element('span', 'primer-rail-trailing');
  trailing.append(
    needTag(entry.need),
    element(
      'span',
      'primer-count',
      `${includedCount(entry)}/${entry.items.length}`,
    ),
  );
  return trailing;
}

// An item row: its include mark and its number leading the item text.
// `onToggle` runs on a click on the mark.
function railItemRow(
  item: PrimerItem,
  number: number,
  onSelect: () => void,
  onToggle: () => void,
): HTMLElement {
  const lead = element('span', 'primer-rail-item-lead');
  lead.append(
    toggleMark({ isOn: item.include, label: 'Include the item', onToggle }),
    element('span', 'primer-item-number', String(number)),
  );
  return row({
    density: 'list',
    depth: 1,
    label: item.text,
    leading: lead,
    onClick: onSelect,
  });
}

// The selected row's card, the Feature card, the task card or the item card,
// its anchors kept for its `dispose`.
function buildCard(
  parent: HTMLElement,
  primer: OpenPrimer,
  deps: CardDeps,
): PrimerCard {
  const anchors: Disposable[] = [];
  const cardDeps: CardDeps = {
    ...deps,
    keys: { anchor: recordingAnchor(deps.keys.anchor, anchors) },
  };
  const selected = selectedRow(primer);
  const entry = selectedEntry(primer);
  let update: (primer: OpenPrimer) => void;
  if (entry === null) {
    update = buildFeatureCard(parent, primer, cardDeps);
  } else if (selected.kind === 'item') {
    update = buildItemCard(parent, primer, entry, selected.item, cardDeps);
  } else {
    update = buildTaskCard(parent, primer, entry, cardDeps);
  }
  return { update, dispose: () => disposeAnchors(anchors) };
}

// The Feature card's fields; it redraws nothing without a rebuild.
function buildFeatureCard(
  parent: HTMLElement,
  primer: OpenPrimer,
  deps: CardDeps,
): (primer: OpenPrimer) => void {
  parent.append(element('h2', 'primer-card-heading', 'Feature'));
  for (const [name, label] of FEATURE_FIELDS) {
    appendField(
      parent,
      label,
      { field: 'feature', name },
      name === 'name' ? 'editFirstField' : null,
      primer,
      deps,
    );
  }
  return () => undefined;
}

// The task as heading, its tags, an extra task's name box, its markdown
// sections, the add-item box unless the task is full, and the task's comment
// box; its items are rows in the rail, each with a card of its own. Returns
// the redraw of what changes without a rebuild.
function buildTaskCard(
  parent: HTMLElement,
  primer: OpenPrimer,
  entry: PrimerEntry,
  deps: CardDeps,
): (primer: OpenPrimer) => void {
  const entryId = entry.id;
  const heading = element('h2', 'primer-card-heading', taskName(entry));
  const tags = element('div', 'primer-card-tags');
  if (entry.area.trim() !== '') {
    tags.append(tag(entry.area));
  }
  if (entry.number !== null) {
    tags.append(tag(`#${entry.number}`));
  }
  let shownNeed = entry.need;
  let need = needTag(shownNeed);
  tags.append(need);
  parent.append(heading, tags);
  if (entry.group === 'extra') {
    appendField(
      parent,
      'Name',
      { field: 'taskName', entryId },
      'editFirstField',
      primer,
      deps,
    );
  }
  const sections: [string, string][] = [
    ['Question', entry.question],
    ['Evidence', entry.evidence],
    ['Probes', entry.probes],
    ['Pointer', entry.pointer],
  ];
  for (const [label, text] of sections) {
    if (text.trim() !== '') {
      const section = element('section', 'primer-card-section');
      section.append(
        sectionHeader(label),
        markdownElement(
          'div',
          'primer-card-section-body md',
          deps.markdown.block(text),
        ),
      );
      parent.append(section);
    }
  }
  if (hasAddItemBox(entry)) {
    appendField(
      parent,
      'New item',
      { field: 'newItem', entryId },
      'addItem',
      primer,
      deps,
    );
  }
  appendField(
    parent,
    'Comment',
    { field: 'taskComment', entryId },
    'editTaskComment',
    primer,
    deps,
  );
  return (current) => {
    const shownEntry = current.entries.find(
      (candidate) => candidate.id === entryId,
    );
    if (shownEntry === undefined) {
      return;
    }
    heading.textContent = taskName(shownEntry);
    if (shownEntry.need !== shownNeed) {
      shownNeed = shownEntry.need;
      const next = needTag(shownNeed);
      need.replaceWith(next);
      need = next;
    }
  };
}

// The item card: the `⌃H ‹ n of m › ⌃L` header, the item text as heading,
// its include mark with its key, an Added tag on an item the user added, and
// the item's comment box. `number` is the item's 1-based number. Returns the
// redraw of the mark and the header's place.
function buildItemCard(
  parent: HTMLElement,
  primer: OpenPrimer,
  entry: PrimerEntry,
  number: number,
  deps: CardDeps,
): (primer: OpenPrimer) => void {
  const entryId = entry.id;
  const item = entry.items[number - 1];
  if (item === undefined) {
    throw new Error(`task ${entryId} has no item ${number}`);
  }
  const scope = primerScope('card');
  const place = element('span', 'primer-item-place', placeText(number, entry));
  const step = element('div', 'primer-item-step');
  step.append(
    anchoredSpan(deps.keys, 'primer-item-step-key', 'prevRow', { scope }),
    keyChevron('‹'),
    place,
    keyChevron('›'),
    anchoredSpan(deps.keys, 'primer-item-step-key', 'nextRow', { scope }),
  );
  const mark = toggleMark({
    isOn: item.include,
    label: 'Include the item',
    onToggle: () => deps.dispatch({ type: 'toggleInclude' }),
  });
  const include = element('div', 'primer-item-include');
  include.append(
    mark,
    element('span', '', 'Include'),
    anchoredSpan(deps.keys, 'primer-field-hint', 'toggleInclude', { scope }),
  );
  parent.append(step, element('h2', 'primer-card-heading', item.text), include);
  if (item.added) {
    const tags = element('div', 'primer-card-tags');
    tags.append(tag('Added'));
    parent.append(tags);
  }
  appendField(
    parent,
    'Comment',
    { field: 'itemComment', entryId, item: number },
    'editItemComment',
    primer,
    deps,
  );
  return (current) => {
    const shownEntry = current.entries.find(
      (candidate) => candidate.id === entryId,
    );
    const shownItem = shownEntry?.items[number - 1];
    if (shownEntry === undefined || shownItem === undefined) {
      return;
    }
    setToggleMark(mark, shownItem.include);
    place.textContent = placeText(number, shownEntry);
  };
}

// An item's place among its task's items: `<n> of <m>`.
function placeText(number: number, entry: PrimerEntry): string {
  return `${number} of ${entry.items.length}`;
}

// A labelled box: its label over its input frame, an anchor for `command` in
// the card scope beside the label.
function appendField(
  parent: HTMLElement,
  label: string,
  target: TextTarget,
  command: PrimerCommandName | null,
  primer: OpenPrimer,
  deps: CardDeps,
) {
  const field = element('div', 'primer-field');
  const hint =
    command === null
      ? null
      : anchoredSpan(deps.keys, 'primer-field-hint', command, {
          scope: primerScope('card'),
        });
  field.append(sectionHeader(label, hint));
  parent.append(field);
  mountFrame(field, target, primer, deps);
}

// The box's input frame, then its `⌃P ⌃N` keys, which show on the frame's
// bottom edge while the box has focus.
function mountFrame(
  parent: HTMLElement,
  target: TextTarget,
  primer: OpenPrimer,
  deps: CardDeps,
) {
  const frame = inputFrame();
  frame.classList.add('primer-box');
  const scope = primerScope('card');
  const boxKeys = boxHint('box-keys', [
    anchoredSpan(deps.keys, 'primer-box-key', 'prevBox', { scope }),
    anchoredSpan(deps.keys, 'primer-box-key', 'nextBox', { scope }),
  ]);
  parent.append(frame, boxKeys);
  deps.boxes.mount(
    frame,
    { primerId: primer.formId, target },
    boxText(primer, target),
  );
}
