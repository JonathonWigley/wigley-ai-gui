import type { CommandId } from '../../../contracts/commands';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
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
import { appendKeyHint } from '../../../shared/page/key-hint';
import {
  createSessionFormTabs,
  type SessionFormTabs,
} from '../../../shared/page/session-form-tabs';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { emptyState } from '../../../shared/page/ui/empty-state';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { row } from '../../../shared/page/ui/row';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { createSplit } from '../../../shared/page/ui/split';
import { tag } from '../../../shared/page/ui/tag';
import { setToggleMark, toggleMark } from '../../../shared/page/ui/toggle-mark';
import { modeLabel } from '../../../shared/vim-mode-label';
import type { KeysPageExports } from '../../keys/contract';
import type { SessionsPageExports } from '../../sessions/contract';
import type { PrimerEntry, PrimerGroup, PrimerView } from '../contract';
import {
  type PrimerCommandName,
  primerCommand,
  primerScope,
  type PrimerScopeName,
} from './ids';
import { boxKey, boxText, type PrimerBox, shownBoxes } from './boxes';
import { needTag, renderReview, taskName } from './primer-review';
import {
  activePrimer,
  type FeatureField,
  includedCount,
  type OpenPrimer,
  type PrimerAction,
  primerOfSession,
  type PrimerState,
  railRows,
  scopeOf,
  selectedEntry,
  selectedRow,
  sessionTitle,
  type TextTarget,
} from './primer-state';
import type { PrimerStore } from './primer-store';

// `beforeClose` answers whether a session may close now. `setScope` sets the
// key scope to `scopeOf` the state while a Primer tab is the visible tab;
// `pushConfirmScope` lays the cancel prompt's scope over it. `onViewChanged`
// hears each change that can move the visible view off or onto a Primer tab:
// a key scope or mode change. `run` runs a button's command. `platform` is the
// OS key hints are drawn for; `uiState` keeps the rail's dragged width, which
// every primer's rail opens at.
export interface PrimerViewDeps {
  areas: Pick<PluginAreas, 'statusBar' | 'overlay'>;
  sessions: Pick<SessionsPageExports, 'addTab'>;
  beforeClose(sessionId: string): boolean;
  setScope(scope: PrimerScopeName): void;
  onViewChanged(listener: () => void): void;
  pushConfirmScope(): PushedScope;
  store: PrimerStore;
  boxes: EditorBoxes<PrimerBox>;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  run(command: CommandId): void;
  platform: Platform;
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
// the primer and view shown; `dispose` stops it following keymap changes.
interface PrimerFormView {
  element: HTMLElement;
  update(primer: OpenPrimer, view: PrimerView): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll;
  dispose(): void;
}

// A built card: `update` redraws what changes without a rebuild, and
// `redrawKeys` shows each box's keys as the keymap binds them now.
interface PrimerCard {
  update(primer: OpenPrimer): void;
  redrawKeys(): void;
}

type CardDeps = Pick<
  PrimerViewDeps,
  'boxes' | 'markdown' | 'keys' | 'platform'
> & {
  dispatch(action: PrimerAction): void;
};

const FEATURE_FIELDS: [FeatureField, string][] = [
  ['name', 'Name'],
  ['slug', 'Slug'],
  ['spec', 'Spec'],
  ['summary', 'Summary'],
  ['notes', 'Notes'],
];

const RAIL_HEADERS: [PrimerGroup, string][] = [
  ['primer', 'Primer'],
  ['standing', 'Every feature'],
  ['extra', 'Extra tasks'],
];

// The whole primer UI: each primer in its session's Primer tab, the status
// line in the status bar, the cancel prompt in the overlay layer, all serving
// the active primer. Every store change renders it; a change a render's own
// dispatch makes renders again once that render ends. While a Primer tab is
// the visible tab the status line shows and the key scope follows the state;
// the cancel prompt pushes its own scope over it and is dismissed when another
// view sets the scope.
export function mountPrimerTab(deps: PrimerViewDeps): PrimerTab {
  const { areas, store, boxes } = deps;
  const status = buildStatusLine(boxes);
  const tabs = createSessionFormTabs({
    addTab: (sessionId, tab) => deps.sessions.addTab(sessionId, tab),
    tabId: 'primer',
    title: 'Primer',
    className: 'primer-tab',
    idleText: "No primer open. The agent's next primer opens here.",
    beforeClose: (sessionId) => deps.beforeClose(sessionId),
    shown: () => deps.setScope(scopeOf(store.get())),
  });
  const updateStatus = () => status.update(store.get(), tabs.isShown());
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
    platform: deps.platform,
    pushScope: () => deps.pushConfirmScope(),
    isAsked: () => store.get().view === 'confirm',
    isSending: () => (activePrimer(store.get())?.sending ?? null) !== null,
    dismiss: () => dispatch({ type: 'dismissConfirm' }),
    // Under the pushed scope a base change reaches no onViewChanged.
    onBaseChanged: updateStatus,
    log: deps.log,
    logSource: 'primer',
  });
  areas.statusBar.contribute(status.element);
  areas.overlay.contribute(confirm.element);
  const primerViews = new Map<string, PrimerFormView>();

  const renderOnce = () => {
    if (!confirm.settleOwedDismiss()) {
      return;
    }
    const state = store.get();
    syncPrimerViews(state, primerViews, tabs, deps, dispatch);
    tabs.sync((sessionId) => {
      const primer = primerOfSession(state, sessionId);
      return primer === undefined ? null : sessionTitle(primer);
    });
    const view = state.view;
    const shown = view === 'idle' ? null : activePrimer(state);
    for (const [primerId, primerView] of primerViews) {
      primerView.element.hidden = primerId !== shown?.primerId;
    }
    if (shown !== null) {
      primerViews.get(shown.primerId)?.update(shown, view);
    }
    // The prompt's scope comes off before the base changes, so the primer's
    // own view change never reaches its listener, and goes on after.
    confirm.hideIfDone();
    if (tabs.isShown()) {
      deps.setScope(scopeOf(state));
    }
    confirm.showIfAsked();
    status.update(state, tabs.isShown());
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
  boxes.onChange(updateStatus);
  deps.onViewChanged(updateStatus);
  render();
  return {
    forgetSession(sessionId) {
      tabs.forget(sessionId);
      for (const primer of store.get().primers) {
        if (primer.sessionId === sessionId) {
          destroyPrimerView(primer.primerId, primerViews, tabs, deps);
        }
      }
    },
    showPrimer: (sessionId) => tabs.select(sessionId),
    scrollBy(step, direction) {
      const state = store.get();
      const primer = state.view === 'idle' ? null : activePrimer(state);
      const primerView =
        primer === null ? undefined : primerViews.get(primer.primerId);
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
    if (!state.primers.some((primer) => primer.primerId === primerId)) {
      destroyPrimerView(primerId, primerViews, tabs, deps);
    }
  }
  for (const primer of state.primers) {
    if (!primerViews.has(primer.primerId)) {
      primerViews.set(
        primer.primerId,
        createPrimerFormView(
          (root) => tabs.mount(primer.sessionId, root),
          primer,
          deps,
          dispatch,
        ),
      );
      tabs.takeOver(primer.primerId, primer.sessionId);
    }
  }
}

// Destroys the primer's editors, removes its view and stops it following
// keymap changes, and releases its take over, giving its session back.
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

// A split with the rail in its start pane and the card and the review, each
// scrolling on its own, in its end pane. The rail redraws whenever the primer
// changes; the card is rebuilt, its boxes destroyed and mounted again, only
// when the selected row or its item count changes; the review is drawn again
// while it shows, when the primer or the keymap changed. `attach` places the
// root in the page once, before any editor mounts.
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
  const cardPane = element('div', 'primer-card');
  const reviewPane = element('div', 'primer-review-pane');
  split.end.append(cardPane, reviewPane);
  // Editors mount into attached elements, so they can measure themselves.
  attach(root);
  const cardDeps: CardDeps = { ...deps, dispatch };
  const { primerId } = primer;
  let cardKey = cardKeyOf(primer);
  let card = buildCard(cardPane, primer, cardDeps);
  let railPrimer: OpenPrimer | null = null;
  let railCursor = -1;
  let itemCursor = -1;
  let reviewPrimer: OpenPrimer | null = null;
  let shownPrimer: OpenPrimer | null = null;
  let shownView: PrimerView = 'primer';

  const rebuildCard = (current: OpenPrimer) => {
    keepFocusedBox(deps.boxes, primerId, () => {
      deps.boxes.destroyForm(primerId);
      cardPane.replaceChildren();
      card = buildCard(cardPane, current, cardDeps);
    });
  };

  const view: PrimerFormView = {
    element: root,
    update(current, viewName) {
      // Every primer's rail shares one stored width.
      split.reloadWidth();
      shownPrimer = current;
      shownView = viewName;
      split.start.classList.toggle('is-pane-inactive', current.pane === 'card');
      const isRowChanged = current.railCursor !== railCursor;
      if (current !== railPrimer) {
        railPrimer = current;
        drawRail(split.start, current, dispatch, isRowChanged);
      }
      const nextCardKey = cardKeyOf(current);
      if (nextCardKey !== cardKey) {
        cardKey = nextCardKey;
        rebuildCard(current);
        if (isRowChanged) {
          cardPane.scrollTop = 0;
        }
        itemCursor = -1;
      }
      card.update(current);
      if (current.itemCursor !== itemCursor) {
        itemCursor = current.itemCursor;
        if (current.pane === 'card') {
          cardPane
            .querySelector('.primer-item.is-cursor')
            ?.scrollIntoView({ block: 'nearest' });
        }
      }
      railCursor = current.railCursor;
      const isReview = viewName === 'review' || viewName === 'confirm';
      cardPane.hidden = viewName !== 'primer';
      reviewPane.hidden = !isReview;
      if (isReview && current !== reviewPrimer) {
        reviewPrimer = current;
        reviewPane.replaceChildren(renderReview(current, deps));
      }
    },
    scrollBy(step, direction) {
      const pane = reviewPane.hidden ? cardPane : reviewPane;
      return scrollContent(pane, step, direction, textLineHeightPx(pane));
    },
    dispose() {
      keysChange.dispose();
    },
  };
  const keysChange = deps.keys.onChanged(() => {
    card.redrawKeys();
    reviewPrimer = null;
    if (shownPrimer !== null && !root.hidden) {
      view.update(shownPrimer, shownView);
    }
  });
  return view;
}

// What a card is built for: the selected row and its item count.
function cardKeyOf(primer: OpenPrimer): string {
  const selected = selectedRow(primer);
  if (selected.kind === 'feature') {
    return 'feature';
  }
  const items = selectedEntry(primer)?.items.length ?? 0;
  return `task ${selected.entryId} ${items}`;
}

// The Feature row, then each group's tasks under its header, the Primer and
// Every feature headers only over tasks and Extra tasks always, with a line
// saying how to add one while it holds none. Each row's click selects it;
// the selected row scrolls into view when `isRowChanged`.
function drawRail(
  rail: HTMLElement,
  primer: OpenPrimer,
  dispatch: (action: PrimerAction) => void,
  isRowChanged: boolean,
) {
  const list = element('div', 'primer-rail-list');
  const rows = railRows(primer);
  const railRow = (
    position: number,
    label: string,
    detail: string | null,
    trailing: HTMLElement | null,
  ) => {
    const node = row({
      density: 'list',
      label,
      detail,
      trailing,
      onClick: () => dispatch({ type: 'selectRow', row: position }),
    });
    node.classList.toggle('is-selected', position === primer.railCursor);
    return node;
  };
  list.append(railRow(0, 'Feature', primer.feature.name, null));
  for (const [group, header] of RAIL_HEADERS) {
    const entries = primer.entries.filter((entry) => entry.group === group);
    if (entries.length === 0 && group !== 'extra') {
      continue;
    }
    list.append(sectionHeader(header));
    for (const entry of entries) {
      const position = rows.findIndex(
        (candidate) =>
          candidate.kind === 'task' && candidate.entryId === entry.id,
      );
      list.append(
        railRow(position, taskName(entry), null, railTrailing(entry)),
      );
    }
    if (entries.length === 0) {
      list.append(emptyState('No extra tasks. Press A to add one.'));
    }
  }
  rail.replaceChildren(list);
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

// The selected row's card: the Feature card or the selected task's.
function buildCard(
  parent: HTMLElement,
  primer: OpenPrimer,
  deps: CardDeps,
): PrimerCard {
  const entry = selectedEntry(primer);
  return entry === null
    ? buildFeatureCard(parent, primer, deps)
    : buildTaskCard(parent, primer, entry, deps);
}

// The redraws of the key hints one card build drew.
type KeyRedraws = (() => void)[];

function buildFeatureCard(
  parent: HTMLElement,
  primer: OpenPrimer,
  deps: CardDeps,
): PrimerCard {
  const redraws: KeyRedraws = [];
  parent.append(element('h2', 'primer-card-heading', 'Feature'));
  for (const [name, label] of FEATURE_FIELDS) {
    appendField(
      parent,
      label,
      { field: 'feature', name },
      name === 'name' ? 'editFirstField' : null,
      primer,
      deps,
      redraws,
    );
  }
  return {
    update() {},
    redrawKeys: () => redraws.forEach((redraw) => redraw()),
  };
}

// The task as heading, its tags, an extra task's name box, its markdown
// sections, its items each with an include mark and a comment box, the
// add-item box, and the task's comment box.
function buildTaskCard(
  parent: HTMLElement,
  primer: OpenPrimer,
  entry: PrimerEntry,
  deps: CardDeps,
): PrimerCard {
  const redraws: KeyRedraws = [];
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
      redraws,
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
  const itemsSection = element('section', 'primer-card-section');
  itemsSection.append(sectionHeader('Items'));
  const items = entry.items.map((item, position) => {
    const block = element('div', 'primer-item');
    const mark = toggleMark({
      isOn: item.include,
      label: 'Include the item',
      onToggle: () => {
        deps.dispatch({ type: 'selectItem', item: position });
        deps.dispatch({ type: 'toggleInclude' });
      },
    });
    block.append(
      row({
        density: 'list',
        label: item.text,
        leading: mark,
        trailing: item.added ? tag('Added') : null,
      }),
    );
    const comment = element('div', 'primer-item-comment');
    block.append(comment);
    mountBox(
      comment,
      { field: 'itemComment', entryId, item: position + 1 },
      'editItemComment',
      primer,
      deps,
      redraws,
    );
    itemsSection.append(block);
    return { block, mark };
  });
  parent.append(itemsSection);
  appendField(
    parent,
    'New item',
    { field: 'newItem', entryId },
    'addItem',
    primer,
    deps,
    redraws,
  );
  appendField(
    parent,
    'Comment',
    { field: 'taskComment', entryId },
    'editTaskComment',
    primer,
    deps,
    redraws,
  );
  return {
    update(current) {
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
      const isCardPane = current.pane === 'card';
      items.forEach(({ block, mark }, position) => {
        const item = shownEntry.items[position];
        if (item !== undefined) {
          setToggleMark(mark, item.include);
        }
        block.classList.toggle(
          'is-cursor',
          isCardPane && position === current.itemCursor,
        );
      });
    },
    redrawKeys: () => redraws.forEach((redraw) => redraw()),
  };
}

// A labelled box: its label over its input frame, the card scope's keys for
// `command` beside the label.
function appendField(
  parent: HTMLElement,
  label: string,
  target: TextTarget,
  command: PrimerCommandName | null,
  primer: OpenPrimer,
  deps: CardDeps,
  redraws: KeyRedraws,
) {
  const field = element('div', 'primer-field');
  const hint = element('span', 'primer-field-hint');
  field.append(sectionHeader(label, hint));
  parent.append(field);
  mountFrame(field, target, primer, deps);
  if (command !== null) {
    redraws.push(cardKeyHint(hint, command, deps));
  }
}

// A box with no label: its input frame, then the card scope's keys for
// `command`.
function mountBox(
  parent: HTMLElement,
  target: TextTarget,
  command: PrimerCommandName,
  primer: OpenPrimer,
  deps: CardDeps,
  redraws: KeyRedraws,
) {
  mountFrame(parent, target, primer, deps);
  const hint = element('span', 'primer-field-hint');
  parent.append(hint);
  redraws.push(cardKeyHint(hint, command, deps));
}

function mountFrame(
  parent: HTMLElement,
  target: TextTarget,
  primer: OpenPrimer,
  deps: CardDeps,
) {
  const frame = inputFrame();
  frame.classList.add('primer-box');
  parent.append(frame);
  deps.boxes.mount(
    frame,
    { primerId: primer.primerId, target },
    boxText(primer, target),
  );
}

function cardKeyHint(
  hint: HTMLElement,
  command: PrimerCommandName,
  deps: CardDeps,
): () => void {
  return appendKeyHint(
    hint,
    () => deps.keys.keysFor(primerCommand(command), primerScope('card')),
    deps.platform,
  );
}

// The status line, hidden while no Primer tab is the visible tab: the box's
// vim mode, then `Sending…` while the active primer sends, else its save
// state.
function buildStatusLine(boxes: Pick<EditorBoxes<PrimerBox>, 'activeMode'>): {
  element: HTMLElement;
  update(state: PrimerState, isShown: boolean): void;
} {
  const bar = element('footer', 'primer-status-line');
  const mode = element('span', 'primer-status-mode');
  const save = element('span', 'primer-status-save');
  bar.append(mode, save);
  return {
    element: bar,
    update(state, isShown) {
      bar.hidden = !isShown;
      mode.textContent = modeLabel(boxes.activeMode());
      const primer = activePrimer(state);
      if (primer === null) {
        save.textContent = '';
        save.dataset.state = '';
        return;
      }
      if (primer.sending !== null) {
        save.textContent = 'Sending…';
        save.dataset.state = 'sending';
        return;
      }
      const shownState = saveState(primer);
      save.textContent = saveLabel(shownState, primer.saveError);
      save.dataset.state = shownState;
    },
  };
}
