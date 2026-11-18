import type { Timers } from '../../../contracts/ambient';
import type { CommandId, CommandKey } from '../../../contracts/commands';
import type { ScrollStep } from '../../../contracts/editor';
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
  OuterPanes,
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
import {
  edgeText,
  type ScrollEdge,
  scrollContent,
  scrollText,
  scrollToEdge,
} from '../../../shared/content-scroll';
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
} from '../../../shared/page/layout-host/draw-part';
import type { PromptActionInput } from '../../../shared/page/layout-host/kit';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { listPickerCommands } from '../../../shared/page/list-picker';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { textBoxInput } from '../../../shared/page/text-box';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { createHScroller } from '../../../shared/page/ui/h-scroller';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { createSplit } from '../../../shared/page/ui/split';
import { qualify } from '../../../shared/plugin-manifests';
import type { AgentPane, AgentPaneSpec } from '../../scoped-agents/contract';
import { sessionsSelectRowCommand } from '../../sessions/contract';
import {
  type BacklogChannel,
  type BacklogChunk,
  type BacklogPlace,
  type BacklogStaleness,
  backlogSelectChunkCommand,
  backlogSelectRowCommand,
  type ChunkEdit,
  type RowKey,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  BacklogLayout,
  CommitsInput,
  CompleteBacklogLayout,
} from '../layouts/layout';
import type { backlogManifest } from '../manifest';
import { isReady } from '../ready';
import { rowKey } from '../row-key';
import {
  actedChunk,
  actedKeys,
  addEdit,
  type BacklogAction,
  type BacklogFocus,
  type BacklogRow,
  type BacklogState,
  backlogReducer,
  type CursorCommand,
  cursorCommands,
  emptyReason,
  initialBacklogState,
  placeOf,
  repos,
  selectedRow,
  shownChunks,
  stalenessNote,
  stripChunk,
  visibleRows,
} from './backlog-state';
import {
  type BacklogBaseScope,
  type BacklogKitScope,
  createBacklogKit,
} from './layout/backlog-kit';

const PLUGIN_ID = 'backlog';

// The repo picker's title, which its rows' input carries.
const REPOS_PICKER = 'Repos';

const ALL_REPOS = 'All repos';

// The agent id and scope of the Backlog assistant main registers.
const ASSISTANT_ID = 'assistant';
const ASSISTANT_SCOPE = 'global';

const ASSISTANT_HINT =
  'Ask to add, rewrite or drop follow-ups in any repo, or to group them into chunks.';

// A drawn part whose root the view keeps, and the dispose of its anchors and
// boxes.
type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

// The panes Backlog draws itself: every focus but the assistant's.
type HostFocus = Exclude<BacklogFocus, 'assistant'>;

// Every page command but `showMode`, which the page part runs itself, and
// the row and chunk clicks, which take an arg.
export type BacklogCommand = Exclude<
  CommandsRunIn<typeof backlogManifest, 'page'>,
  'showMode' | 'selectRow' | 'selectChunk'
>;

// The splits' limits in CSS pixels: the sized pane's opening and least sizes,
// and the least size it leaves the pane beside it.
const TABLE_SPLIT = { initial: 640, min: 400, endMin: 280 };
const STRIP_SPLIT = { initial: 120, min: 72, endMin: 200 };
const ASSISTANT_SPLIT = { initial: 380, min: 280, endMin: 520 };

// Each cursor prompt action's label.
const CURSOR_LABELS: Record<CursorCommand, string> = {
  activate: 'session',
  mark: 'mark',
  addToChunk: 'chunk',
  removeFromChunk: 'unchunk',
  startChunk: 'start',
  toggleHeadless: 'headless',
  renameChunk: 'rename',
  toggleCommits: 'commits',
  openInDocs: 'docs',
};

export interface BacklogViewDeps {
  channel: PageChannel<BacklogChannel>;
  markdown: MarkdownRenderer;
  matcher: FuzzyMatcher;
  paths: Paths;
  homeDir: string;
  // Holds the splits' sizes.
  uiState: UiState;
  // Runs the splits' resize prompt linger.
  timers: Timers;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  keys: KeyHints;
  platform: OsName;
  // The slots a layout's kit reads.
  state: LayoutState;
  // The commands a layout's kit runs by qualified id.
  commands: KitCommands;
  openDoc(path: string, line?: number): void;
  setScope(scope: BacklogBaseScope): void;
  // Sets the divider the resize keys move, after each `setScope`.
  setResizeTarget(target: ResizeTarget | null): void;
  // Sets the panes the focus keys move between, after each `setScope`.
  setFocusTarget(target: FocusTarget | null): void;
  // Sets the panes around the view, the assistant pane's, while Backlog
  // shows; null as it hides.
  setOuterPanes(panes: OuterPanes | null): void;
  pushScope(scope: 'box' | 'picker'): PushedScope;
  picker: ListPickerService;
  run(command: CommandId): void;
  // Runs the command `key` with `arg`, as a click does: a row's click runs
  // `backlog.selectRow` and a chunk card's `backlog.selectChunk`.
  runKey<A>(key: CommandKey<A>, arg: A): void;
  isShown(): boolean;
  // Adds scoped-agents' pane for the assistant.
  addAgentPane(spec: AgentPaneSpec): AgentPane;
  // The title bar's detail: the repo filter, or `All repos`.
  setContext(detail: string): void;
  // The last page's place, put back once the first load lands; null for none.
  savedPlace: BacklogPlace | null;
  // Hears the place after each change, from the first load on.
  placeChanged(place: BacklogPlace): void;
}

// Backlog mode's view, logging under `backlog`: the table of every repo's
// follow-ups beside the review pane of the cursor row, over the chunk strip,
// with scoped-agents' assistant pane in a column at the right. Every decision
// about what shows lives in `backlogReducer`; the view draws its state after
// each change, every pane, row, card, picker row and the review through the
// layout picked for that part, and draws with `default` until the first
// `setLayouts`. `load` reads the homes, and the first read to land puts
// `savedPlace` back and reads the chunks; every read asks for the staleness
// main holds. `shown` sets the scope and focus where the keys were left. Each
// change of the pane holding the keys logs `table focused`, `review focused`,
// `strip focused` or `assistant focused`. The view never writes a chunk:
// every change goes to main, which answers with the chunks after it, and a
// rejection logs `<invoke> failed: <text>` and toasts the text.
export interface BacklogView {
  sheet: HTMLElement;
  load(): void;
  reload(): void;
  // Main's staleness entries since its last message.
  stalenessRead(entries: Record<RowKey, BacklogStaleness>): void;
  // Main's chunks after a change.
  chunksChanged(chunks: BacklogChunk[]): void;
  shown(): void;
  // Backlog hid: the assistant pane gives the keys back.
  hidden(): void;
  // Main takes the keys back: the pane that held them last takes them.
  focusMain(): void;
  // Draws every pane, the rows, the strip, the review, an open picker's rows
  // and the assistant's ask box again with `shown`, keeping an open box, the
  // scroll, the selection and the focus.
  setLayouts(shown: ShownLayouts<BacklogLayout>): void;
  // Disposes the assistant pane, the splits, the strip's scroller and every
  // part draw.
  dispose(): void;
  commands: Record<BacklogCommand, () => void>;
  // Selects the row `key` keys and focuses the table; a key no shown row holds
  // logs `no row <key>` and changes nothing.
  selectRow(key: RowKey): void;
  // Puts the strip cursor on the chunk `id` names and focuses the strip; an id
  // no shown chunk holds logs `no chunk <id>` and changes nothing.
  selectChunk(id: string): void;
}

export function createBacklogView(deps: BacklogViewDeps): BacklogView {
  const { channel, paths, homeDir, matcher } = deps;
  const tilde = (path: string) => paths.tilde(path, homeDir);

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
  const tablePane = element('div', 'backlog-table');
  tablePane.tabIndex = -1;
  // The slot `tableStatus` draws into, kept across a render that changes only
  // the status text.
  const status = element('div', 'backlog-status-slot');
  const filterBar = element('div', 'backlog-filter-bar');
  const filterFrame = inputFrame();
  filterFrame.classList.add('backlog-filter');
  filterFrame.hidden = true;
  const filterBox = textBoxInput('backlog-filter-input');
  filterFrame.append(filterBox);
  const rowsList = element('ol', 'backlog-rows');

  const reviewPane = element('div', 'backlog-review');
  reviewPane.tabIndex = -1;
  const reviewBody = element('div', 'backlog-review-body');

  const stripPane = element('div', 'backlog-strip');
  stripPane.tabIndex = -1;
  const scroller = createHScroller();
  scroller.element.classList.add('backlog-chunks');
  const renameFrame = inputFrame();
  renameFrame.classList.add('backlog-rename');
  renameFrame.hidden = true;
  const renameBox = textBoxInput('backlog-rename-input');
  renameFrame.append(renameBox);

  const splitDeps = {
    uiState: deps.uiState,
    anchor: deps.keys.anchor,
    timers: deps.timers,
  };
  const tableSplit = createSplit({
    ...TABLE_SPLIT,
    ...splitDeps,
    stateKey: 'tableWidth',
  });
  tableSplit.element.classList.add('backlog-table-split');
  tableSplit.start.append(tablePane);
  tableSplit.end.append(reviewPane);
  const stripSplit = createSplit({
    ...STRIP_SPLIT,
    ...splitDeps,
    axis: 'column',
    sizedPane: 'end',
    stateKey: 'stripHeight',
  });
  stripSplit.element.classList.add('backlog-strip-split');
  stripSplit.start.append(tableSplit.element);
  stripSplit.end.append(stripPane);
  const assistantSplit = createSplit({
    ...ASSISTANT_SPLIT,
    ...splitDeps,
    sizedPane: 'end',
    stateKey: 'assistantWidth',
  });
  assistantSplit.element.classList.add('backlog-assistant-split');
  const assistantSlot = element('div', 'backlog-assistant');
  assistantSplit.start.append(stripSplit.element);
  assistantSplit.end.append(assistantSlot);
  assistantSplit.setEndHidden(true);
  const contentSheet = sheet();
  contentSheet.classList.add('backlog-sheet');
  contentSheet.append(assistantSplit.element);

  // The divider each pane's resize keys move first.
  const resizeTargets: Record<HostFocus, ResizeTarget> = {
    table: tableSplit,
    review: {
      nudge: (direction) =>
        assistantSplit.nudge(direction) || tableSplit.nudge(direction),
    },
    strip: {
      nudge: (direction) =>
        stripSplit.nudge(direction) || assistantSplit.nudge(direction),
    },
  };

  const picker = deps.picker.create({ filter: true });

  // ── Drawing ────────────────────────────────────────────────────────────
  // The one box open over the base scope: the filter or a chunk's rename.
  let openBox:
    | { kind: 'filter'; scope: PushedScope }
    | { kind: 'rename'; scope: PushedScope; chunkId: string }
    | null = null;
  // The input the open box types into.
  const openBoxInput = (box: NonNullable<typeof openBox>) =>
    box.kind === 'filter' ? filterBox : renameBox;
  let loadCount = 0;
  let loadedCount = 0;
  // The saved place's assistant pane waits to open: at the end of the first
  // load while Backlog shows, else on the next `shown`.
  let isOpenPending = false;
  let shownSelectedKey: RowKey | null = null;
  let shownFocus: BacklogFocus | null = null;
  let shownRepo: string | null = null;
  // The pane that last held the keys, which `focusMain` focuses again.
  let lastHostFocus: HostFocus = 'table';
  // True while a click's `focusin` hands a pane the keys: the click already
  // put the DOM focus where it belongs, so `syncFocus` leaves it there.
  let isFocusFromClick = false;
  // The strip cursor the last strip draw revealed; undefined before the
  // first.
  let revealedCursor: string | null | undefined;
  // The review's last draw: what it drew, the row it drew, and the scroll a
  // pane draw found, which the review draws again at.
  let reviewDrawKey: string | null = null;
  let reviewRowKey: RowKey | null = null;
  let keptReviewScroll: number | null = null;
  // The commits since the selected row was written: the row asked for while
  // they show, the read's number, and what draws.
  let commitsKey: RowKey | null = null;
  let commitsRequest = 0;
  let commitsShown: CommitsInput = { commits: null, problem: null };
  let rowDraws: DrawnRoot[] = [];
  let reviewDraws: DrawnRoot[] = [];
  let stripDraws: DrawnRoot[] = [];
  // The status text the `tableStatus` draw shows; undefined before the first
  // render draws it.
  let shownStatus: string | null | undefined;
  let statusDraw: DrawnRoot | null = null;

  // Draws `text` through `tableStatus` into the status slot, in place of the
  // last draw.
  const drawStatusPart = (text: string | null) => {
    shownStatus = text;
    statusDraw?.dispose();
    status.replaceChildren();
    statusDraw = parts.draw(
      'tableStatus',
      status,
      (tableStatus, into, rollback) => ({
        element: tableStatus(into, { text }, kitFor('table', rollback)),
      }),
    );
  };

  // Draws the three panes again. The rows keep their scroll; the review
  // draws again at its scroll.
  const drawPanes = () => {
    const rowsScroll = rowsList.scrollTop;
    keptReviewScroll = reviewPane.scrollTop;
    reviewDrawKey = null;
    parts.redraw('table', tablePane, (table, into, rollback) => {
      const slots = [
        appSlot(status, 'status', rollback),
        appSlot(filterBar, 'filterBar', rollback),
        appSlot(filterFrame, 'filterBox', rollback),
        appSlot(rowsList, 'rows', rollback),
      ] as const;
      const [statusSlot, filterBarSlot, filterSlot, rowsSlot] = slots;
      const pane = table(into, {
        ...kitFor('table', rollback),
        status: statusSlot.place,
        filterBar: filterBarSlot.place,
        filterBox: filterSlot.place,
        rows: rowsSlot.place,
      });
      for (const slot of slots) {
        slot.placeIfLeftOut(pane.element);
      }
      return pane;
    });
    parts.redraw('review', reviewPane, (review, into, rollback) => {
      const bodySlot = appSlot(reviewBody, 'body', rollback);
      const pane = review(into, {
        ...kitFor('review', rollback),
        body: bodySlot.place,
      });
      bodySlot.placeIfLeftOut(pane.element);
      return pane;
    });
    parts.redraw('strip', stripPane, (strip, into, rollback) => {
      const chunksSlot = appSlot(scroller.element, 'chunks', rollback);
      const renameSlot = appSlot(renameFrame, 'renameBox', rollback);
      const pane = strip(into, {
        ...kitFor('strip', rollback),
        chunks: chunksSlot.place,
        renameBox: renameSlot.place,
      });
      chunksSlot.placeIfLeftOut(pane.element);
      renameSlot.placeIfLeftOut(pane.element);
      return pane;
    });
    if (shownStatus !== undefined) {
      drawStatusPart(shownStatus);
    }
    rowsList.scrollTop = rowsScroll;
  };

  // Draws `tableStatus` again only when the text changed, so a load message
  // arriving under the filter box leaves the `table` pane in place.
  const drawStatus = (state: BacklogState) => {
    const statusText =
      state.message ??
      (state.isLoaded && state.homes.length === 0
        ? 'No features homes found'
        : null);
    if (statusText !== shownStatus) {
      drawStatusPart(statusText);
    }
  };

  const drawFilters = (state: BacklogState) => {
    parts.redraw('filters', filterBar, (filters, into, rollback) => ({
      element: filters(
        into,
        {
          repo: state.repo,
          isReadyOnly: state.isReadyOnly,
          isChunkedHidden: state.isChunkedHidden,
          isStaleFirst: state.isStaleFirst,
          isDoneShown: state.isDoneShown,
          marked: state.marked.length,
        },
        kitFor('table', rollback),
      ),
    }));
  };

  // The actions that act on `shown` while it is the cursor row, in prompt
  // order; none for any other row.
  const promptOf = (
    state: BacklogState,
    shown: BacklogRow,
  ): PromptActionInput[] =>
    shown.key === state.selectedKey
      ? cursorCommands(shown).map((command) => ({
          command: qualify(PLUGIN_ID, command),
          label: CURSOR_LABELS[command],
        }))
      : [];

  // Draws `shown`'s row into the rows slot.
  const drawRow = (state: BacklogState, shown: BacklogRow): DrawnRoot =>
    parts.draw('tableRow', rowsList, (tableRow, into, rollback) => {
      const { item, chunk } = shown;
      const root = tableRow(
        into,
        {
          repo: shown.repo,
          title: item.title,
          oneLine: item.oneLine,
          tags: item.tags,
          done: item.done,
          isReady: isReady(item.tags),
          staleness: state.staleness[shown.key]?.level ?? null,
          chunk:
            chunk === null
              ? null
              : { name: chunk.name, isStarted: chunk.sessionId !== null },
          isMarked: state.marked.includes(shown.key),
          prompt: promptOf(state, shown),
        },
        kitFor('table', rollback),
      );
      return { element: root };
    });

  const drawRows = (state: BacklogState) => {
    rowDraws = disposeDraws(rowDraws);
    rowsList.replaceChildren();
    for (const shown of visibleRows(state, matcher)) {
      const drawn = drawRow(state, shown);
      rowDraws.push(drawn);
      const root = drawn.built.element;
      rowAction(root, () => deps.runKey(backlogSelectRowCommand, shown.key));
      const isSelected = shown.key === state.selectedKey;
      const isCursor =
        isSelected && state.focus === 'table' && openBox === null;
      root.classList.toggle('is-selected', isSelected);
      root.classList.toggle('is-cursor', isCursor);
      root.classList.toggle('is-marked', state.marked.includes(shown.key));
      root.classList.toggle(
        'is-started',
        (shown.chunk?.sessionId ?? null) !== null,
      );
    }
    const reason = emptyReason(state, matcher);
    if (reason !== null) {
      rowDraws.push(
        parts.draw('empty', rowsList, (empty, into, rollback) => ({
          element: empty(
            into,
            { reason, filter: state.filter },
            kitFor('table', rollback),
          ),
        })),
      );
    }
    tablePane.classList.toggle('is-pane-inactive', state.focus !== 'table');
    filterFrame.hidden =
      openBox?.kind !== 'filter' && state.filter.trim() === '';
    if (openBox?.kind !== 'filter') {
      filterBox.value = state.filter;
    }
    rowsList
      .querySelector('.is-selected')
      ?.scrollIntoView({ block: 'nearest' });
  };

  // Asks for the selected row's commits once per row while they show; a
  // reply overtaken by another row, or by `gl` hiding them, draws nothing.
  const syncCommits = (state: BacklogState) => {
    const row = selectedRow(state, matcher);
    const wanted = state.isCommitsShown && row !== null ? row.key : null;
    if (wanted === commitsKey) {
      return;
    }
    commitsKey = wanted;
    commitsRequest += 1;
    commitsShown = { commits: null, problem: null };
    if (wanted === null) {
      return;
    }
    const request = commitsRequest;
    channel.invoke('commitsSince', wanted).then(
      (commits) => {
        if (request !== commitsRequest) {
          return;
        }
        commitsShown = {
          commits: commits.map((commit) => ({
            shortSha: commit.sha.slice(0, 7),
            subject: commit.subject,
            date: commit.at.slice(0, 10),
          })),
          problem: null,
        };
        drawReview(store.get());
      },
      (error: unknown) => {
        deps.log(`commitsSince failed: ${errorText(error)}`);
        if (request !== commitsRequest) {
          return;
        }
        commitsShown = { commits: [], problem: errorText(error) };
        drawReview(store.get());
      },
    );
  };

  // Draws the selected row's item, then its commits while they show, when
  // any of them changed since the last draw: at the top for another row, at
  // the kept scroll for the same one.
  const drawReview = (state: BacklogState) => {
    const row = selectedRow(state, matcher);
    const staleness = row === null ? undefined : state.staleness[row.key];
    const drawKey = JSON.stringify([
      row,
      staleness,
      state.isCommitsShown,
      commitsShown,
    ]);
    if (drawKey === reviewDrawKey) {
      return;
    }
    const rowKeyShown = row?.key ?? null;
    const scrollTop =
      rowKeyShown === reviewRowKey
        ? (keptReviewScroll ?? reviewPane.scrollTop)
        : 0;
    reviewDrawKey = drawKey;
    reviewRowKey = rowKeyShown;
    keptReviewScroll = null;
    reviewDraws = disposeDraws(reviewDraws);
    reviewBody.replaceChildren();
    if (row !== null) {
      reviewDraws.push(drawReviewItem(row, staleness));
      if (state.isCommitsShown) {
        const shownCommits = commitsShown;
        reviewDraws.push(
          parts.draw('commits', reviewBody, (commits, into, rollback) => ({
            element: commits(into, shownCommits, kitFor('review', rollback)),
          })),
        );
      }
    }
    reviewPane.scrollTop = scrollTop;
  };

  const drawReviewItem = (
    row: BacklogRow,
    staleness: BacklogStaleness | undefined,
  ): DrawnRoot =>
    parts.draw('reviewItem', reviewBody, (reviewItem, into, rollback) => ({
      element: reviewItem(
        into,
        {
          repo: row.repo,
          title: row.item.title,
          oneLine: row.item.oneLine,
          shownPath: tilde(row.path),
          body: row.item.body,
          tags: row.item.tags,
          done: row.item.done,
          level: staleness?.level ?? null,
          note: stalenessNote(staleness),
          chunk:
            row.chunk === null
              ? null
              : {
                  name: row.chunk.name,
                  isStarted: row.chunk.sessionId !== null,
                },
        },
        kitFor('review', rollback),
      ),
    }));

  // Draws one card per shown chunk, then New chunk, into the scroller's
  // track; reveals the cursor card when the cursor moved since the last draw.
  const drawStrip = (state: BacklogState) => {
    stripDraws = disposeDraws(stripDraws);
    scroller.track.replaceChildren();
    let cursorCard: HTMLElement | null = null;
    for (const chunk of shownChunks(state)) {
      const drawn = parts.draw(
        'chunkCard',
        scroller.track,
        (chunkCard, into, rollback) => ({
          element: chunkCard(
            into,
            {
              repo: chunk.repo,
              name: chunk.name,
              count: chunk.titles.length,
              isHeadless: chunk.headless,
              isStarted: chunk.sessionId !== null,
            },
            kitFor('strip', rollback),
          ),
        }),
      );
      stripDraws.push(drawn);
      const card = drawn.built.element;
      rowAction(card, () => deps.runKey(backlogSelectChunkCommand, chunk.id));
      const isCursor = chunk.id === state.stripCursor;
      card.classList.toggle('is-cursor', isCursor);
      if (isCursor) {
        cursorCard = card;
      }
    }
    const newDraw = parts.draw(
      'newChunk',
      scroller.track,
      (newChunk, into, rollback) => ({
        element: newChunk(into, kitFor('strip', rollback)),
      }),
    );
    stripDraws.push(newDraw);
    const newCard = newDraw.built.element;
    rowAction(newCard, () => selectNewChunk());
    newCard.classList.toggle('is-cursor', state.stripCursor === null);
    stripPane.classList.toggle('is-pane-inactive', state.focus !== 'strip');
    scroller.refresh();
    if (state.stripCursor !== revealedCursor) {
      revealedCursor = state.stripCursor;
      scroller.reveal(cursorCard ?? newCard);
    }
  };

  // Moves the DOM focus to the pane the keys act on, when that changed, and
  // logs the pane that took them. The assistant pane focuses itself, and a
  // click's own focus stays put.
  const syncFocus = (state: BacklogState, always: boolean) => {
    const isChanged = state.focus !== shownFocus;
    if (!deps.isShown() || (!always && !isChanged)) {
      return;
    }
    shownFocus = state.focus;
    if (isChanged) {
      deps.log(`${state.focus} focused`);
    }
    if (isFocusFromClick) {
      return;
    }
    switch (state.focus) {
      case 'table':
        tablePane.focus();
        return;
      case 'review':
        reviewPane.focus();
        return;
      case 'strip':
        stripPane.focus();
        return;
      case 'assistant':
        return;
    }
  };

  // Sets the scope and the resize and focus targets from the focus; none of
  // them while the assistant holds the keys.
  const syncTargets = (state: BacklogState) => {
    if (!deps.isShown() || state.focus === 'assistant') {
      return;
    }
    deps.setScope(state.focus);
    deps.setResizeTarget(resizeTargets[state.focus]);
    deps.setFocusTarget(focusTarget);
  };

  const logChanges = (state: BacklogState) => {
    if (state.selectedKey !== shownSelectedKey) {
      shownSelectedKey = state.selectedKey;
      const shown = selectedRow(state, matcher);
      if (shown !== null) {
        deps.log(`selected ${shown.item.title}`);
      }
    }
    if (state.repo !== shownRepo) {
      shownRepo = state.repo;
      deps.setContext(state.repo ?? ALL_REPOS);
    }
  };

  const render = (always = false) => {
    const state = store.get();
    if (state.focus !== 'assistant') {
      lastHostFocus = state.focus;
    }
    drawStatus(state);
    drawFilters(state);
    drawRows(state);
    syncCommits(state);
    drawReview(state);
    drawStrip(state);
    logChanges(state);
    syncTargets(state);
    syncFocus(state, always);
  };

  // Sets the focus, telling the assistant pane when it lost the keys, and
  // sets the scope, targets and DOM focus from it.
  const setFocus = (focus: BacklogFocus) => {
    const before = store.get().focus;
    dispatch({ type: 'focus', focus });
    if (before === 'assistant' && store.get().focus !== 'assistant') {
      pane.hostTookKeys();
    }
    render(true);
  };

  // A focus that lands inside a pane the keys are not on, a click on its
  // contents, hands that pane the keys and leaves the click's DOM focus. The
  // open box's input takes the focus without the keys moving: the rename box
  // sits in the strip while the table may hold them. A pane the reducer
  // refuses (the review with no row selected) leaves the keys where they
  // were, so the DOM focus goes back to the pane that holds them, the
  // assistant's included.
  for (const [paneElement, focus] of [
    [tablePane, 'table'],
    [reviewPane, 'review'],
    [stripPane, 'strip'],
  ] as const) {
    paneElement.addEventListener('focusin', (event) => {
      const isHeldPane = store.get().focus === focus;
      const isOpenBoxInput =
        openBox !== null && event.target === openBoxInput(openBox);
      if (isHeldPane || isOpenBoxInput) {
        return;
      }
      isFocusFromClick = true;
      try {
        setFocus(focus);
      } finally {
        isFocusFromClick = false;
      }
      const heldFocus = store.get().focus;
      if (heldFocus === 'assistant') {
        pane.element.focus();
      } else if (heldFocus !== focus) {
        syncFocus(store.get(), true);
      }
    });
  }

  // The pane that held the keys last takes them; the table when the review
  // refuses them with no row selected.
  const focusHost = () => {
    setFocus(lastHostFocus);
    if (store.get().focus === 'assistant') {
      setFocus('table');
    }
  };

  // The focus keys: right from the table to the review, left back, down from
  // either to the strip and up from the strip to the table. Every other move
  // goes on to the outer panes, so right reaches a shown assistant.
  const focusTarget: FocusTarget = {
    move(direction) {
      const to = paneTo(store.get().focus, direction);
      if (to === null) {
        return false;
      }
      setFocus(to);
      return store.get().focus === to;
    },
  };

  // ── Assistant ──────────────────────────────────────────────────────────
  const pane = deps.addAgentPane({
    owner: PLUGIN_ID,
    agentId: ASSISTANT_ID,
    heading: () => 'Backlog assistant',
    hint: ASSISTANT_HINT,
    setShown(shown) {
      assistantSplit.setEndHidden(!shown);
      const state = store.get();
      if (state.isLoaded) {
        deps.placeChanged(placeOf(state, shown));
      }
    },
    isAlwaysShown: false,
    entersFrom: 'right',
    resizeTarget: assistantSplit,
    tookKeys: () => setFocus('assistant'),
    leave: focusHost,
  });
  assistantSlot.append(pane.element);
  pane.scopeOpened(ASSISTANT_SCOPE);

  const isAssistantShown = () => pane.isShown() || isOpenPending;

  drawPanes();
  deps.setContext(ALL_REPOS);
  store.subscribe(() => render());
  store.subscribe(() => {
    const state = store.get();
    if (state.isLoaded) {
      deps.placeChanged(placeOf(state, isAssistantShown()));
    }
  });

  // ── Reads and writes ───────────────────────────────────────────────────
  // Logs a rejected invoke; a write's text toasts too.
  const failed = (invoke: string, error: unknown, isWrite: boolean) => {
    deps.log(`${invoke} failed: ${errorText(error)}`);
    if (isWrite) {
      deps.toast(errorText(error), 'error');
    }
  };

  const readStaleness = () => {
    channel.invoke('staleness').then(
      (entries) => dispatch({ type: 'stalenessRead', entries }),
      (error: unknown) => failed('staleness', error, false),
    );
  };

  const readChunks = () => {
    channel.invoke('chunks').then(
      (chunks) => dispatch({ type: 'chunksChanged', chunks }),
      (error: unknown) => failed('chunks', error, false),
    );
  };

  // Opens the assistant pane a restored place left pending.
  const openPendingPane = () => {
    if (isOpenPending) {
      isOpenPending = false;
      if (!pane.isShown()) {
        pane.toggle();
      }
    }
  };

  // A read overtaken by a later one is dropped. The saved place's assistant
  // pane is pending before the first load's dispatches, so the place they
  // write keeps it, and opens now while Backlog shows, else on the next
  // `shown`, since opening takes the keys.
  const read = async (method: 'load' | 'rescan') => {
    const count = ++loadCount;
    const result = await channel.invoke(method);
    if (count !== loadCount) {
      return;
    }
    loadedCount += 1;
    const isFirstLoad = loadedCount === 1;
    const isRestoringPane =
      isFirstLoad && deps.savedPlace?.isAssistantShown === true;
    if (isRestoringPane) {
      isOpenPending = true;
    }
    dispatch({ type: 'loaded', read: result });
    if (isFirstLoad && deps.savedPlace !== null) {
      dispatch({ type: 'placeRestored', place: deps.savedPlace });
    }
    if (isRestoringPane && deps.isShown()) {
      openPendingPane();
    }
    deps.log(`loaded ${String(result.homes.length)} homes`);
    readStaleness();
    if (isFirstLoad) {
      readChunks();
    }
  };

  // Logs and toasts a failed read in place of throwing it.
  const readQuietly = (method: 'load' | 'rescan'): Promise<void> =>
    read(method).catch((error) => {
      deps.log(`not loaded: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
    });

  // Sends `edit`; on success shows main's chunks, then runs `applied` with
  // them.
  const editChunks = (
    edit: ChunkEdit,
    applied: (chunks: BacklogChunk[]) => void,
  ) => {
    channel.invoke('editChunks', edit).then(
      (chunks) => {
        dispatch({ type: 'chunksChanged', chunks });
        applied(chunks);
      },
      (error: unknown) => failed('editChunks', error, true),
    );
  };

  // Starts each chunk of `chunks` and tells each one's result.
  const startChunks = (chunks: readonly BacklogChunk[]) => {
    if (chunks.length === 0) {
      return;
    }
    const names = new Map<string, string>(
      chunks.map((chunk) => [chunk.id, chunk.name]),
    );
    channel
      .invoke(
        'startChunks',
        chunks.map((chunk) => chunk.id),
      )
      .then(
        (starts) => {
          for (const start of starts) {
            const name = names.get(start.chunkId) ?? start.chunkId;
            if ('sessionId' in start) {
              deps.log(`started ${name}`);
              deps.toast(`Started ${name}`, 'success');
            } else {
              deps.log(`start refused ${name}`);
              deps.toast(start.refusal, 'error');
            }
          }
        },
        (error: unknown) => failed('startChunks', error, true),
      );
  };

  // Opens the session of `chunk` when it started; else returns false.
  const openSession = (chunk: BacklogChunk | null): boolean => {
    const sessionId = chunk?.sessionId ?? null;
    if (chunk === null || sessionId === null) {
      return false;
    }
    deps.runKey(sessionsSelectRowCommand, sessionId);
    deps.log(`opened session ${chunk.name}`);
    return true;
  };

  // ── Boxes, picker and scroll ───────────────────────────────────────────
  const closeBox = () => {
    if (openBox === null) {
      return;
    }
    const closed = openBox;
    openBox = null;
    closed.scope.pop();
    if (closed.kind === 'filter') {
      deps.log(`filter ${store.get().filter}`);
    } else {
      renameFrame.hidden = true;
    }
    render(true);
  };

  // Pushes the box scope, closing the box when the base scope changes under
  // it.
  const pushBox = (): PushedScope => {
    const scope = deps.pushScope('box');
    scope.onBaseChanged(() => {
      if (openBox?.scope === scope) {
        closeBox();
      }
    });
    return scope;
  };

  const openFilter = () => {
    if (openBox !== null) {
      return;
    }
    setFocus('table');
    openBox = { kind: 'filter', scope: pushBox() };
    render();
    filterBox.focus();
    filterBox.select();
  };

  filterBox.addEventListener('input', () => {
    dispatch({ type: 'setFilter', text: filterBox.value });
  });

  const openRename = () => {
    const chunk = actedChunk(store.get(), matcher);
    if (chunk === null || openBox !== null) {
      return;
    }
    openBox = { kind: 'rename', scope: pushBox(), chunkId: chunk.id };
    renameFrame.hidden = false;
    renameBox.value = chunk.name;
    render();
    renameBox.focus();
    renameBox.select();
    deps.log(`renaming ${chunk.name}`);
  };

  // Sends the rename box's trimmed text as the chunk's name; an empty text
  // renames nothing.
  const acceptRename = (chunkId: string) => {
    const name = renameBox.value.trim();
    closeBox();
    if (name === '') {
      return;
    }
    editChunks({ type: 'rename', chunkId, name }, () =>
      deps.log(`renamed ${name}`),
    );
  };

  // Gives the focus back to the pane the keys act on once the picker closed.
  const pickerClosed = () => render(true);

  // The repo picker's `drawRow`: the layout's `pickerRow`, whose draw the
  // picker disposes.
  const drawPickerRow = (
    list: HTMLElement,
    _item: string | null,
    input: DrawRowInput,
  ): DrawnPickerRow => {
    const drawn = parts.draw(
      'pickerRow',
      list,
      (pickerRow, into, rollback) => ({
        element: pickerRow(
          into,
          { picker: REPOS_PICKER, label: input.label },
          { ...kitFor('picker', rollback), trailing: () => input.trailing },
        ),
      }),
    );
    return { element: drawn.built.element, dispose: drawn.dispose };
  };

  const pickRepo = () => {
    const state = store.get();
    const choices: (string | null)[] = [null, ...repos(state)];
    picker.open({
      title: REPOS_PICKER,
      items: choices,
      label: (repo) => repo ?? ALL_REPOS,
      selected: Math.max(choices.indexOf(state.repo), 0),
      drawRow: drawPickerRow,
      chosen(repo) {
        dispatch({ type: 'setRepo', repo });
        deps.log(`repo ${repo ?? 'all'}`);
        pickerClosed();
      },
      cancelled: pickerClosed,
    });
  };

  const scrollReview = (step: ScrollStep, direction: 1 | -1) => {
    const scroll = scrollContent(
      reviewPane,
      step,
      direction,
      textLineHeightPx(reviewPane),
    );
    deps.log(scrollText('the review', step, direction, scroll));
  };
  const scrollReviewTo = (edge: ScrollEdge) => {
    scrollToEdge(reviewPane, edge);
    deps.log(edgeText('the review', edge));
  };

  const selectNewChunk = () => {
    dispatch({ type: 'stripSelect', chunkId: null });
    setFocus('strip');
  };

  // ── Commands ───────────────────────────────────────────────────────────
  const listMove = (to: 'down' | 'up' | 'top' | 'bottom') => () =>
    dispatch({ type: 'move', to });

  const stripStep = (by: 1 | -1) => () => {
    dispatch({ type: 'stripMove', by });
    const chunk = stripChunk(store.get());
    deps.log(`strip on ${chunk === null ? 'new chunk' : chunk.name}`);
  };

  const toggleAssistant = () => {
    pane.toggle();
    deps.log(pane.isShown() ? 'assistant shown' : 'assistant hidden');
  };

  // The view keys bound everywhere (`Space v …`) act on Backlog alone: in
  // another mode the key belongs to that mode, so they do nothing there.
  const whileShown = (command: BacklogCommand, run: () => void) => () => {
    if (!deps.isShown()) {
      deps.log(`${command} ignored: Backlog is hidden`);
      return;
    }
    run();
  };

  const commands: Record<BacklogCommand, () => void> = {
    listDown: listMove('down'),
    listUp: listMove('up'),
    listTop: listMove('top'),
    listBottom: listMove('bottom'),
    activate() {
      const state = store.get();
      if (state.focus === 'table') {
        const row = selectedRow(state, matcher);
        if (row !== null && !openSession(row.chunk)) {
          setFocus('review');
        }
      } else if (state.focus === 'strip') {
        openSession(stripChunk(state));
      }
    },
    filter: openFilter,
    rescan: () => void readQuietly('rescan'),
    mark() {
      const before = store.get();
      const row =
        before.focus === 'table' ? selectedRow(before, matcher) : null;
      if (row === null) {
        return;
      }
      dispatch({ type: 'toggleMark' });
      const isMarked = store.get().marked.includes(row.key);
      deps.log(`${isMarked ? 'marked' : 'unmarked'} ${row.item.title}`);
    },
    addToChunk() {
      const edit = addEdit(store.get(), matcher);
      if (edit === null) {
        return;
      }
      const [firstKey] = edit.keys;
      editChunks(edit, (chunks) => {
        dispatch({ type: 'clearMarks' });
        const chunk = chunks.find((each) =>
          each.titles.some((title) => rowKey(each.repo, title) === firstKey),
        );
        if (chunk !== undefined) {
          dispatch({ type: 'stripSelect', chunkId: chunk.id });
          deps.log(`added ${String(edit.keys.length)} to ${chunk.name}`);
        }
      });
    },
    removeFromChunk() {
      const keys = actedKeys(store.get(), matcher);
      if (keys.length === 0) {
        return;
      }
      editChunks({ type: 'remove', keys }, () => {
        dispatch({ type: 'clearMarks' });
        deps.log(`took ${String(keys.length)} out of chunks`);
      });
    },
    renameChunk: openRename,
    startChunk() {
      const chunk = actedChunk(store.get(), matcher);
      if (chunk !== null) {
        startChunks([chunk]);
      }
    },
    startAllChunks() {
      startChunks(
        shownChunks(store.get()).filter(
          (chunk) => chunk.sessionId === null && chunk.titles.length > 0,
        ),
      );
    },
    toggleHeadless() {
      const chunk = actedChunk(store.get(), matcher);
      if (chunk === null) {
        return;
      }
      const headless = !chunk.headless;
      editChunks({ type: 'setHeadless', chunkId: chunk.id, headless }, () =>
        deps.log(`headless ${chunk.name} ${headless ? 'on' : 'off'}`),
      );
    },
    toggleCommits() {
      dispatch({ type: 'toggleCommits' });
      deps.log(store.get().isCommitsShown ? 'commits shown' : 'commits hidden');
    },
    sweep() {
      const { repo } = store.get();
      if (repo === null) {
        deps.toast('Filter to one repo first', 'error');
        return;
      }
      channel.invoke('sweep', repo).then(
        () => {
          if (!pane.isShown()) {
            pane.toggle();
          }
          pane.refresh();
          deps.log(`sweep sent ${repo}`);
        },
        (error: unknown) => failed('sweep', error, true),
      );
    },
    toggleDone: whileShown('toggleDone', () => {
      dispatch({ type: 'toggleDone' });
      deps.log(store.get().isDoneShown ? 'done shown' : 'done hidden');
    }),
    toggleAgentReadyOnly: whileShown('toggleAgentReadyOnly', () => {
      dispatch({ type: 'toggleReadyOnly' });
      deps.log(`agent-ready only ${store.get().isReadyOnly ? 'on' : 'off'}`);
    }),
    toggleAssistant: whileShown('toggleAssistant', toggleAssistant),
    pickRepo: whileShown('pickRepo', pickRepo),
    toggleChunkedHidden: whileShown('toggleChunkedHidden', () => {
      dispatch({ type: 'toggleChunkedHidden' });
      deps.log(
        store.get().isChunkedHidden ? 'chunked hidden' : 'chunked shown',
      );
    }),
    toggleStaleFirst: whileShown('toggleStaleFirst', () => {
      dispatch({ type: 'toggleStaleFirst' });
      deps.log(`stale first ${store.get().isStaleFirst ? 'on' : 'off'}`);
    }),
    openInDocs() {
      const row = selectedRow(store.get(), matcher);
      if (row !== null) {
        deps.openDoc(row.path, row.item.line);
      }
    },
    lineDown: () => scrollReview('line', 1),
    lineUp: () => scrollReview('line', -1),
    halfPageDown: () => scrollReview('halfPage', 1),
    halfPageUp: () => scrollReview('halfPage', -1),
    scrollTop: () => scrollReviewTo('top'),
    scrollEnd: () => scrollReviewTo('end'),
    stripLeft: stripStep(-1),
    stripRight: stripStep(1),
    ...listPickerCommands(picker),
    boxAccept() {
      if (openBox?.kind === 'filter') {
        closeBox();
      } else if (openBox?.kind === 'rename') {
        acceptRename(openBox.chunkId);
      }
    },
    boxCancel() {
      if (openBox?.kind === 'filter') {
        dispatch({ type: 'setFilter', text: '' });
      }
      closeBox();
    },
  };

  return {
    sheet: contentSheet,
    load: () => void readQuietly('load'),
    reload: () => void readQuietly('load'),
    stalenessRead: (entries) => dispatch({ type: 'stalenessRead', entries }),
    chunksChanged: (chunks) => dispatch({ type: 'chunksChanged', chunks }),
    shown() {
      deps.setOuterPanes(pane.outerPanes);
      render(true);
      deps.log('shown');
      readStaleness();
      openPendingPane();
    },
    hidden() {
      pane.modeHidden();
      deps.setOuterPanes(null);
    },
    focusMain: focusHost,
    setLayouts(next) {
      parts.setLayouts(next);
      drawPanes();
      render(true);
      if (openBox !== null) {
        openBoxInput(openBox).focus();
      }
      picker.redraw();
      pane.redraw();
    },
    dispose() {
      rowDraws = disposeDraws(rowDraws);
      reviewDraws = disposeDraws(reviewDraws);
      stripDraws = disposeDraws(stripDraws);
      statusDraw?.dispose();
      statusDraw = null;
      parts.dispose();
      pane.dispose();
      scroller.dispose();
      tableSplit.dispose();
      stripSplit.dispose();
      assistantSplit.dispose();
    },
    commands,
    selectRow(key) {
      if (!visibleRows(store.get(), matcher).some((row) => row.key === key)) {
        deps.log(`no row ${key}`);
        return;
      }
      dispatch({ type: 'select', key });
      setFocus('table');
    },
    selectChunk(id) {
      if (!shownChunks(store.get()).some((chunk) => chunk.id === id)) {
        deps.log(`no chunk ${id}`);
        return;
      }
      dispatch({ type: 'stripSelect', chunkId: id });
      setFocus('strip');
    },
  };
}

// The pane a focus move toward `direction` reaches from `from`: right from
// the table to the review, left back, down from either to the strip, up from
// the strip to the table; null for every other move.
function paneTo(
  from: BacklogFocus,
  direction: PaneDirection,
): HostFocus | null {
  switch (`${from} ${direction}`) {
    case 'table right':
      return 'review';
    case 'review left':
    case 'strip up':
      return 'table';
    case 'table down':
    case 'review down':
      return 'strip';
    default:
      return null;
  }
}
