import type { Timers } from '../../../contracts/ambient';
import type { CommandKey } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type {
  DrawnPickerRow,
  DrawRowInput,
  ListPicker,
} from '../../../contracts/list-picker';
import type { PluginLog } from '../../../contracts/log';
import type { FocusTarget, ResizeTarget } from '../../../contracts/panes';
import type {
  CommandsRunIn,
  PageChannel,
  ToastTone,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import type { ListPickerCommand } from '../../../shared/list-picker-commands';
import { element } from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  disposeDraws,
  type RollbackDeps,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import type { LayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { listPickerCommands } from '../../../shared/page/list-picker';
import type { PlaceWrites } from '../../../shared/page/place-slot';
import type { AnchorNamer } from '../../../shared/page/ui/key-anchors';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { createSplit } from '../../../shared/page/ui/split';
import type {
  BuildDownload,
  BuildFile,
  BuildRecord,
  BuildsChannel,
  BuildsPlace,
  BuildsSnapshot,
  SessionBuilds,
} from '../contract';
import type {
  BaseKit,
  BuildRowInput,
  BuildsLayout,
  CompleteBuildsLayout,
} from '../layouts/layout';
import { buildsManifest } from '../manifest';
import {
  type BuildsEntryKey,
  buildHeaderInput,
  buildKey,
  type CursorMove,
  downloadId,
  emptyReason,
  type FeedFilter,
  feedRows,
  fileBaseName,
  type GameListItem,
  gameHeaderInput,
  gameKey,
  gameRows,
  heldKey,
  isFeedFilter,
  jobGraphInput,
  jobPanelInput,
  linkedBuilds,
  movedKey,
  queueChoices,
  queuedBy,
  sideBarEntries,
} from './builds-view-model';
import type { BuildsDemoSample } from './demo-sample';
import {
  defaultJob,
  type GraphMove,
  type JobGraph,
  jobGraph,
  movedJob,
} from './job-graph';
import { createQueuePicker, type QueueTarget } from './queue-picker';

// The base scopes the view sets: the side bar's game list, the sheet's build list and the detail pane's job graph.
// The picker's is pushed over them.
export type BuildsScope = 'games' | 'list' | 'graph';

// The page commands the view runs on a key: the two lists', the build's, the graph's, the queue picker's and the list
// picker's.
export type BuildsViewCommand = Extract<
  CommandsRunIn<typeof buildsManifest, 'page'>,
  | 'pickQueue'
  | 'focusGraph'
  | 'download'
  | 'openWeb'
  | 'cancel'
  | 'listDown'
  | 'listUp'
  | 'listTop'
  | 'listBottom'
  | 'gameDown'
  | 'gameUp'
  | 'gameTop'
  | 'gameBottom'
  | 'openGame'
  | 'leaveGraph'
  | 'graphLeft'
  | 'graphRight'
  | 'graphUp'
  | 'graphDown'
  | 'saveLog'
  | 'openJob'
  | ListPickerCommand
>;

export interface BuildsViewDeps {
  channel: PageChannel<BuildsChannel>;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  openExternal(url: string): Promise<void>;
  // Epoch ms, read at each draw.
  now(): number;
  kitServices: OwnerKitServices;
  parts: LayoutParts<BuildsLayout, CompleteBuildsLayout>;
  picker: ListPicker;
  // The split's stored width, its resize prompt's anchor and the prompt's linger.
  uiState: UiState;
  timers: Timers;
  anchor: AnchorNamer<never>;
  // `builds.snapshot`, `builds.sessions` and `builds.downloads` as they are now, and each session row's label by
  // session id.
  snapshot(): BuildsSnapshot;
  sessions(): ReadonlyMap<string, SessionBuilds>;
  downloads(): ReadonlyMap<string, BuildDownload>;
  sessionLabels(): ReadonlyMap<string, string>;
  // The writes of `builds.place`, and the place the last page wrote, null with none.
  place: PlaceWrites<BuildsPlace>;
  restoredPlace: BuildsPlace | null;
  setScope(scope: BuildsScope): void;
  setResizeTarget(target: ResizeTarget | null): void;
  setFocusTarget(target: FocusTarget | null): void;
  isShown(): boolean;
  // Hears each entry the user shows from the side bar.
  picked(): void;
  // Runs a click's command, logging a throw.
  runKey<A>(key: CommandKey<A>, arg: A): void;
}

// Builds mode's view: the side bar's entries, and in the sheet a split of the head and build list beside the detail
// pane, which shows the list cursor's build: its head, its job graph and the job cursor's panel. Each part is drawn
// through the layout picked for it, logging under `builds`. It holds the side-bar cursor, the shown entry, the list
// cursor and the job cursor by key, each kept across a redraw while its key is still drawn: the list cursor moves to
// the nearest row still drawn, the job cursor to the build's default job, and the shown entry falls back to All.
// It writes the entry and both cursors to `builds.place` after each change, and puts back the place the last page
// wrote once a snapshot holds it, unless the user moved first. It logs each download state `builds.downloads` reaches.
// `showSample` draws a sample's snapshot and session links in place of the slots' until it is dropped; while it
// shows, the queue, cancel, with-agent, save, download and open commands do nothing and no place is written. Once
// disposed, it draws and toasts nothing.
export interface BuildsView {
  sideBar: HTMLElement;
  sheet: HTMLElement;
  shown(): void;
  hidden(): void;
  sideBarHidden(): void;
  sideBarOpenedOver(): void;
  focusSideBar(): void;
  focusMain(): void;
  // A slot the view draws changed.
  changed(): void;
  // Draws every part again, the open picker's rows included, after a layouts set.
  redraw(): void;
  commands: Record<BuildsViewCommand, () => void>;
  selectEntry(key: string): void;
  selectBuild(key: string): void;
  // Shows the build's game and puts the list cursor on it with the keys in the list; false when the shown snapshot
  // lacks it. While the mode does not show, the next `shown` keeps the keys in the list.
  showBuild(arg: { backend: string; build: string }): boolean;
  selectJob(jobId: string): void;
  // Downloads the shown build's file whose `BuildFile.entry` is `entry`.
  downloadFile(entry: number): void;
  queueButton(arg: { backend: string; game: string; kind: string }): void;
  withAgent(arg: { backend: string; game: string; set: string }): void;
  setFilter(filter: string): void;
  openLink(url: string): void;
  // Shows `sample` in place of the slots; null drops it.
  showSample(sample: BuildsDemoSample | null): void;
  dispose(): void;
}

type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

interface ListedBuild {
  target: QueueTarget;
  record: BuildRecord;
}

// What each draw looks keys up in: every game by its side-bar key, every build by its key.
interface Lookup {
  games: Map<string, QueueTarget>;
  builds: Map<string, ListedBuild>;
}

const NO_GRAPH: JobGraph = { columns: [], edges: [] };
const DOWNLOAD_TITLE = 'Download a file';

const selectEntryCommand: CommandKey<string, 'builds.selectEntry'> = {
  id: 'builds.selectEntry',
};
const selectBuildCommand: CommandKey<string, 'builds.selectBuild'> = {
  id: 'builds.selectBuild',
};
const selectJobCommand: CommandKey<string, 'builds.selectJob'> = {
  id: 'builds.selectJob',
};

export function createBuildsView(deps: BuildsViewDeps): BuildsView {
  const { channel, log, parts, picker, toast } = deps;

  // ── Elements ───────────────────────────────────────────────────────────
  // The containers stay app-owned; the panes draw inside them and place the slots below.
  const sidePane = element('div', 'builds-side');
  sidePane.tabIndex = -1;
  const entriesList = element('ol', 'builds-entries');
  const mainPane = element('div', 'builds-main');
  mainPane.tabIndex = -1;
  const body = element('div', 'builds-body');
  const buildList = element('ol', 'builds-list');
  const detailHolder = element('div', 'builds-detail-holder');
  detailHolder.tabIndex = -1;
  const detailBody = element('div', 'builds-detail-body');
  const split = createSplit({
    initial: 480,
    min: 280,
    endMin: 360,
    uiState: deps.uiState,
    anchor: deps.anchor,
    timers: deps.timers,
    stateKey: 'listWidth',
  });
  split.element.classList.add('builds-split');
  split.start.append(mainPane);
  split.end.append(detailHolder);
  const contentSheet = sheet();
  contentSheet.classList.add('builds-sheet');
  contentSheet.append(split.element);

  // ── State ──────────────────────────────────────────────────────────────
  let sample: BuildsDemoSample | null = null;
  let focus: BuildsScope = 'games';
  // The last of `list` and `graph` to hold the keys, which `focusMain` gives them back to.
  let lastMain: 'list' | 'graph' = 'list';
  // Set by a `showBuild` while the mode hides: the next `shown` keeps the keys in the list.
  let keepsListOnShow = false;
  let selected: BuildsEntryKey = 'all';
  let sideCursor: BuildsEntryKey | null = null;
  let listCursor: string | null = null;
  // The build the detail pane shows, its graph and the job cursor in it.
  let shownKey: string | null = null;
  let shownGraph: JobGraph = NO_GRAPH;
  let jobCursor: string | null = null;
  let filter: FeedFilter = 'all';
  let isDisposed = false;
  let lookup: Lookup = { games: new Map(), builds: new Map() };
  // The cursor stops of each list, in the drawn order.
  let sideKeys: BuildsEntryKey[] = [];
  let listKeys: string[] = [];
  // The place the last page wrote, until a snapshot puts it back or the user moves first; writes wait while it does.
  let pendingPlace: BuildsPlace | null = deps.restoredPlace;
  let pendingHold: Disposable | null =
    pendingPlace === null ? null : deps.place.hold();
  // Each download's state at the last change heard, by id.
  let heardDownloads = downloadStates(deps.downloads());

  let entryDraws: DrawnRoot[] = [];
  let bodyDraws: DrawnRoot[] = [];
  let headerDraw: DrawnRoot | null = null;
  let graphDraw: DrawnRoot | null = null;
  let panelDraw: DrawnRoot | null = null;
  let emptyDraw: DrawnRoot | null = null;
  // The JSON of the drawn graph's input; null draws the graph again.
  let graphInputJson: string | null = null;
  const entryRoots = new Map<BuildsEntryKey, HTMLElement>();
  const rowRoots = new Map<string, HTMLElement>();
  const jobRoots = new Map<string, HTMLElement>();

  const snapshot = (): BuildsSnapshot => sample?.snapshot ?? deps.snapshot();
  const kitFor = (
    scope: BuildsScope | 'picker',
    rollback: RollbackDeps,
  ): BaseKit =>
    createBaseKit(
      ownerBaseKitDeps(buildsManifest, deps.kitServices, scope, rollback),
    );

  const drawPickerRow = (
    list: HTMLElement,
    title: string,
    input: DrawRowInput,
  ): DrawnPickerRow => {
    const drawn = parts.draw(
      'pickerRow',
      list,
      (pickerRow, into, rollback) => ({
        element: pickerRow(
          into,
          { picker: title, label: input.label },
          { ...kitFor('picker', rollback), trailing: () => input.trailing },
        ),
      }),
    );
    return { element: drawn.built.element, dispose: drawn.dispose };
  };

  const queuePicker = createQueuePicker({
    picker,
    channel,
    toast(text, tone) {
      if (!isDisposed) {
        deps.toast(text, tone);
      }
    },
    log,
    drawRow: drawPickerRow,
  });

  // ── Lookups ────────────────────────────────────────────────────────────
  const indexSnapshot = (shown: BuildsSnapshot): Lookup => {
    const next: Lookup = { games: new Map(), builds: new Map() };
    for (const backend of shown.backends) {
      for (const view of backend.games) {
        const target: QueueTarget = { backend, view };
        next.games.set(gameKey(backend.id, view.game.id), target);
        for (const record of view.builds) {
          next.builds.set(buildKey(backend.id, record.id), { target, record });
        }
      }
    }
    return next;
  };

  const linked = (): Map<string, string> =>
    linkedBuilds(sample === null ? deps.sessions() : sample.sessions);

  const shownBuild = (): ListedBuild | null =>
    shownKey === null ? null : (lookup.builds.get(shownKey) ?? null);

  // ── Place ──────────────────────────────────────────────────────────────
  const writePlace = () => {
    if (sample === null) {
      deps.place.write({ entry: selected, build: listCursor, job: jobCursor });
    }
  };

  // Forgets the pending place, releases the hold and writes the current place.
  const dropPending = () => {
    if (pendingPlace === null) {
      return;
    }
    pendingPlace = null;
    pendingHold?.dispose();
    pendingHold = null;
    writePlace();
  };

  // The pending place once the shown snapshot holds its entry; null otherwise or while a sample shows.
  const restorablePlace = (): BuildsPlace | null => {
    if (pendingPlace === null || sample !== null) {
      return null;
    }
    const holdsEntry =
      pendingPlace.entry === 'all' || lookup.games.has(pendingPlace.entry);
    return holdsEntry ? pendingPlace : null;
  };

  // ── Drawing ────────────────────────────────────────────────────────────
  const drawSideBarPane = () => {
    parts.redraw('sideBar', sidePane, (sideBar, into, rollback) => {
      const entries = appSlot(entriesList, 'entries', rollback);
      const pane = sideBar(into, {
        ...kitFor('games', rollback),
        entries: entries.place,
      });
      entries.placeIfLeftOut(requireElementIn(into, pane.element, 'sideBar'));
      return pane;
    });
  };

  const drawMainPane = () => {
    parts.redraw('main', mainPane, (main, into, rollback) => {
      const slot = appSlot(body, 'body', rollback);
      const pane = main(into, {
        ...kitFor('list', rollback),
        body: slot.place,
      });
      slot.placeIfLeftOut(requireElementIn(into, pane.element, 'main'));
      return pane;
    });
  };

  const drawDetailPane = () => {
    parts.redraw('detail', detailHolder, (detail, into, rollback) => {
      const slot = appSlot(detailBody, 'body', rollback);
      const pane = detail(into, {
        ...kitFor('list', rollback),
        body: slot.place,
      });
      slot.placeIfLeftOut(requireElementIn(into, pane.element, 'detail'));
      return pane;
    });
  };

  const markEntries = () => {
    for (const [key, root] of entryRoots) {
      root.classList.toggle('is-selected', key === selected);
      root.classList.toggle(
        'is-cursor',
        key === sideCursor && focus === 'games',
      );
    }
    sidePane.classList.toggle('is-pane-inactive', focus !== 'games');
  };

  const markRows = () => {
    for (const [key, root] of rowRoots) {
      root.classList.toggle('is-selected', key === listCursor);
      root.classList.toggle(
        'is-cursor',
        key === listCursor && focus === 'list',
      );
    }
    mainPane.classList.toggle('is-pane-inactive', focus !== 'list');
    detailHolder.classList.toggle('is-pane-inactive', focus !== 'graph');
  };

  const markJobs = () => {
    for (const [id, root] of jobRoots) {
      root.classList.toggle('is-selected', id === jobCursor);
      root.classList.toggle('is-cursor', id === jobCursor && focus === 'graph');
    }
  };

  const scrollToJob = () => {
    const root = jobCursor === null ? undefined : jobRoots.get(jobCursor);
    root?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const entryDrawn = (drawn: DrawnRoot, key: BuildsEntryKey) => {
    entryDraws.push(drawn);
    const root = drawn.built.element;
    rowAction(root, () => deps.runKey(selectEntryCommand, key));
    entryRoots.set(key, root);
  };

  const drawEntries = () => {
    const held = entryDraws;
    entryDraws = [];
    entryRoots.clear();
    disposeDraws(held);
    entriesList.replaceChildren();
    for (const entry of sideBarEntries(snapshot())) {
      switch (entry.kind) {
        case 'all':
          entryDrawn(
            parts.draw('allEntry', entriesList, (part, into, rollback) => ({
              element: part(into, kitFor('games', rollback)),
            })),
            'all',
          );
          break;
        case 'backend':
          entryDraws.push(
            parts.draw(
              'backendHeading',
              entriesList,
              (part, into, rollback) => ({
                element: part(
                  into,
                  { label: entry.label, problem: entry.problem },
                  kitFor('games', rollback),
                ),
              }),
            ),
          );
          break;
        case 'game':
          entryDrawn(
            parts.draw('gameEntry', entriesList, (part, into, rollback) => ({
              element: part(
                into,
                { label: entry.label, dot: entry.dot },
                kitFor('games', rollback),
              ),
            })),
            entry.key,
          );
          break;
      }
    }
    markEntries();
  };

  // ── Detail pane ────────────────────────────────────────────────────────
  const dropGraph = () => {
    dropDraw(graphDraw);
    graphDraw = null;
    graphInputJson = null;
    jobRoots.clear();
  };

  // The head goes first in the body, before a graph the redraw kept.
  const drawHeader = (listed: ListedBuild) => {
    const { target, record } = listed;
    headerDraw = parts.draw(
      'buildHeader',
      detailBody,
      (part, into, rollback) => ({
        element: part(
          into,
          buildHeaderInput(
            record,
            target.view,
            target.backend,
            deps.downloads(),
            deps.now(),
          ),
          kitFor('list', rollback),
        ),
      }),
    );
    detailBody.prepend(headerDraw.built.element);
  };

  // Keeps the drawn graph of the same build while its input is unchanged; else draws it again, keeping its sideways
  // scroll for the same build. A build with no jobs draws none.
  const drawGraph = (listed: ListedBuild, isNewBuild: boolean) => {
    if (listed.record.jobs.length === 0) {
      dropGraph();
      return;
    }
    const input = jobGraphInput(listed.record, shownGraph);
    const json = JSON.stringify(input);
    const keepsGraph =
      !isNewBuild && graphDraw !== null && json === graphInputJson;
    if (keepsGraph) {
      return;
    }
    const scrollLeft =
      isNewBuild || graphDraw === null ? 0 : graphDraw.built.element.scrollLeft;
    dropGraph();
    const drawn = parts.draw(
      'jobGraph',
      detailBody,
      (part, into, rollback) => ({
        element: part(into, input, kitFor('graph', rollback)),
      }),
    );
    graphDraw = drawn;
    graphInputJson = json;
    const root = drawn.built.element;
    root.scrollLeft = scrollLeft;
    for (const box of root.querySelectorAll<HTMLElement>('[data-job-id]')) {
      const id = box.dataset.jobId;
      if (id !== undefined) {
        rowAction(box, () => deps.runKey(selectJobCommand, id));
        jobRoots.set(id, box);
      }
    }
  };

  const drawPanel = (listed: ListedBuild) => {
    const { target, record } = listed;
    dropDraw(panelDraw);
    panelDraw = parts.draw('jobPanel', detailBody, (part, into, rollback) => ({
      element: part(
        into,
        jobPanelInput(
          record,
          jobCursor,
          target.view,
          target.backend,
          deps.downloads(),
        ),
        kitFor('graph', rollback),
      ),
    }));
  };

  // The job cursor of `record`: a restored job the build lists, else the held cursor of the same build while it is
  // still listed, else the build's default job.
  const nextJobCursor = (
    record: BuildRecord,
    isNewBuild: boolean,
    restoredJob: string | null | undefined,
  ): string | null => {
    const lists = (id: string | null) =>
      id !== null && record.jobs.some((job) => job.id === id);
    if (restoredJob !== undefined) {
      return lists(restoredJob)
        ? restoredJob
        : defaultJob(record.jobs, shownGraph);
    }
    if (!isNewBuild && lists(jobCursor)) {
      return jobCursor;
    }
    return defaultJob(record.jobs, shownGraph);
  };

  // Shows the list cursor's build in the detail pane: its head, its graph while it lists jobs and the job cursor's
  // panel; `detailEmpty` with none. `restoredJob` is the restored place's job, for a restore that put the cursor on
  // its build.
  const drawDetail = (restoredJob?: string | null) => {
    const listed =
      listCursor === null ? undefined : lookup.builds.get(listCursor);
    const lastKey = shownKey;
    shownKey = listed === undefined ? null : listCursor;
    const isNewBuild = shownKey !== lastKey;
    dropDraw(headerDraw);
    dropDraw(panelDraw);
    dropDraw(emptyDraw);
    headerDraw = null;
    panelDraw = null;
    emptyDraw = null;
    if (listed === undefined) {
      dropGraph();
      shownGraph = NO_GRAPH;
      jobCursor = null;
      emptyDraw = parts.draw(
        'detailEmpty',
        detailBody,
        (part, into, rollback) => ({
          element: part(into, { reason: 'noBuild' }, kitFor('list', rollback)),
        }),
      );
    } else {
      shownGraph = jobGraph(listed.record.jobs);
      jobCursor = nextJobCursor(listed.record, isNewBuild, restoredJob);
      drawHeader(listed);
      drawGraph(listed, isNewBuild);
      drawPanel(listed);
    }
    markJobs();
    if (isNewBuild) {
      scrollToJob();
    }
    if (isNewBuild && focus === 'graph') {
      log(`build ${lastKey} gone`);
      setFocus('list');
    }
    writePlace();
  };

  // ── List ───────────────────────────────────────────────────────────────
  const drawRow = (parent: HTMLElement, row: BuildRowInput) => {
    const drawn = parts.draw('buildRow', parent, (part, into, rollback) => ({
      element: part(into, row, kitFor('list', rollback)),
    }));
    bodyDraws.push(drawn);
    const root = drawn.built.element;
    rowAction(root, () => deps.runKey(selectBuildCommand, row.key));
    rowRoots.set(row.key, root);
  };

  const drawItem = (item: GameListItem) => {
    if (item.kind === 'build') {
      drawRow(buildList, item.row);
      return;
    }
    const setRows = element('ol', 'builds-set-rows');
    bodyDraws.push(
      parts.draw('setGroup', buildList, (part, into, rollback) => {
        const rows = appSlot(setRows, 'rows', rollback);
        const root = part(into, item.group, {
          ...kitFor('list', rollback),
          rows: rows.place,
        });
        rows.placeIfLeftOut(requireElementIn(into, root, 'setGroup'));
        return { element: root };
      }),
    );
    for (const row of item.rows) {
      drawRow(setRows, row);
    }
  };

  // The shown entry's list items, each a build of the All feed or an item of the shown game's list.
  const listItems = (target: QueueTarget | null): GameListItem[] => {
    const links = linked();
    const labels = deps.sessionLabels();
    const queuedByOf = (backendId: string, buildId: string) =>
      queuedBy(buildKey(backendId, buildId), links, labels);
    const now = deps.now();
    if (target !== null) {
      return gameRows(target.view, queuedByOf, now);
    }
    return feedRows(
      snapshot(),
      filter,
      new Set(links.keys()),
      queuedByOf,
      now,
    ).map((row): GameListItem => ({ kind: 'build', row }));
  };

  // Draws the shown entry's head and list, then the detail pane. `restored` is a place being put back.
  const drawBody = (restored: BuildsPlace | null = null) => {
    const target =
      selected === 'all' ? null : (lookup.games.get(selected) ?? null);
    const items = listItems(target);
    const keys = items.flatMap((item) =>
      item.kind === 'build' ? [item.row.key] : item.rows.map((row) => row.key),
    );
    listCursor = heldKey(listKeys, keys, listCursor);
    listKeys = keys;
    const reason = emptyReason(snapshot(), selected, keys.length);

    const held = bodyDraws;
    bodyDraws = [];
    rowRoots.clear();
    disposeDraws(held);
    body.replaceChildren();
    buildList.replaceChildren();
    if (target !== null) {
      bodyDraws.push(
        parts.draw('gameHeader', body, (part, into, rollback) => ({
          element: part(
            into,
            gameHeaderInput(target.backend, target.view),
            kitFor('list', rollback),
          ),
        })),
      );
    } else if (reason === null || reason === 'noMatches') {
      bodyDraws.push(
        parts.draw('feedHeader', body, (part, into, rollback) => ({
          element: part(into, { filter }, kitFor('list', rollback)),
        })),
      );
    }
    body.append(buildList);
    for (const item of items) {
      drawItem(item);
    }
    if (reason !== null) {
      bodyDraws.push(
        parts.draw('empty', body, (part, into, rollback) => ({
          element: part(into, { reason }, kitFor('list', rollback)),
        })),
      );
    }
    markRows();
    const restoresJob = restored !== null && listCursor === restored.build;
    drawDetail(restoresJob ? restored.job : undefined);
  };

  // Indexes the shown snapshot, puts back the pending place once the snapshot holds it, keeps the shown entry and the
  // side-bar cursor on what is still drawn, and draws the entries, the list and the detail pane again.
  const drawSnapshot = () => {
    lookup = indexSnapshot(snapshot());
    const restored = restorablePlace();
    if (restored !== null) {
      selected = restored.entry as BuildsEntryKey;
      sideCursor = selected;
      listKeys = [];
      listCursor = restored.build;
    }
    if (selected !== 'all' && !lookup.games.has(selected)) {
      selected = 'all';
      log('shown game gone: showing all');
    }
    const nextSideKeys = sideBarEntries(snapshot()).flatMap(
      (entry): BuildsEntryKey[] =>
        entry.kind === 'all'
          ? ['all']
          : entry.kind === 'game'
            ? [entry.key]
            : [],
    );
    if (sideCursor !== null) {
      sideCursor = heldKey(
        sideKeys,
        nextSideKeys,
        sideCursor,
      ) as BuildsEntryKey | null;
    }
    sideKeys = nextSideKeys;
    drawEntries();
    drawBody(restored);
    if (restored !== null) {
      dropPending();
    }
  };

  const drawAll = () => {
    drawSideBarPane();
    drawMainPane();
    drawDetailPane();
    // A layouts set may change the graph's look, so its input no longer stands for what is drawn.
    graphInputJson = null;
    drawSnapshot();
  };

  // Logs each download that reached a state it did not have at the last change heard.
  const logDownloads = () => {
    const downloads = deps.downloads();
    for (const [id, download] of downloads) {
      if (heardDownloads.get(id) !== download.state) {
        log(`download ${id} ${downloadLine(download)}`);
      }
    }
    heardDownloads = downloadStates(downloads);
  };

  // ── Focus ──────────────────────────────────────────────────────────────
  // The one setter of the keys' pane: logs a change, sets the scope and the targets and moves the DOM focus there
  // while the mode shows, then marks the cursors.
  const setFocus = (next: BuildsScope, movesFocus = true) => {
    if (next !== focus) {
      log(`focus ${next}`);
    }
    focus = next;
    if (next !== 'games') {
      lastMain = next;
    }
    if (deps.isShown()) {
      deps.setScope(next);
      deps.setResizeTarget(next === 'games' ? null : split);
      deps.setFocusTarget(focusTarget);
      if (movesFocus) {
        paneOf(next).focus();
      }
    }
    markEntries();
    markRows();
    markJobs();
  };

  const paneOf = (scope: BuildsScope): HTMLElement => {
    switch (scope) {
      case 'games':
        return sidePane;
      case 'list':
        return mainPane;
      case 'graph':
        return detailHolder;
    }
  };

  // Gives the keys to the graph of the shown build; false, after logging, with none shown.
  const enterGraph = (): boolean => {
    if (shownKey === null) {
      log('no build under the cursor');
      return false;
    }
    setFocus('graph');
    log(`graph on ${shownKey} job ${jobCursor ?? 'build'}`);
    return true;
  };

  // Main takes the keys back where they last were, the list or the graph; `picked` closes a narrow window's side bar
  // overlay, so the keys never sit in main under it.
  const focusMain = () => {
    setFocus(lastMain === 'graph' && shownKey !== null ? 'graph' : 'list');
    deps.picked();
  };

  // `right` moves from the game list to the build list and from the build list to the graph, `left` back from the
  // graph; while the split stacks, `down` and `up` move between the list and the graph too. Every other move goes on
  // to the core, so Alt+h from the list reaches the side bar.
  const focusTarget: FocusTarget = {
    move(direction) {
      const isStacked = split.element.classList.contains('is-stacked');
      if (focus === 'games' && direction === 'right') {
        setFocus('list');
        deps.picked();
        return true;
      }
      const entersGraph =
        focus === 'list' &&
        (direction === 'right' || (direction === 'down' && isStacked));
      if (entersGraph) {
        return enterGraph();
      }
      const leavesGraph =
        focus === 'graph' &&
        (direction === 'left' || (direction === 'up' && isStacked));
      if (leavesGraph) {
        setFocus('list');
        return true;
      }
      return false;
    },
  };

  sidePane.addEventListener('focusin', () => {
    if (focus !== 'games') {
      setFocus('games', false);
    }
  });
  mainPane.addEventListener('focusin', () => {
    if (focus !== 'list') {
      setFocus('list', false);
    }
  });
  detailHolder.addEventListener('focusin', () => {
    const next: BuildsScope = shownKey === null ? 'list' : 'graph';
    if (focus !== next) {
      setFocus(next, false);
    }
  });

  // ── Commands ───────────────────────────────────────────────────────────
  // True, after logging, while the sample shows: the command acts on nothing real.
  const isDemoBlocked = (command: string): boolean => {
    if (sample === null) {
      return false;
    }
    log(`demo: ${command} does nothing`);
    return true;
  };

  const showEntry = (key: BuildsEntryKey) => {
    dropPending();
    sideCursor = key;
    if (key === selected) {
      markEntries();
      return;
    }
    selected = key;
    listCursor = null;
    listKeys = [];
    log(`shown ${key}`);
    markEntries();
    drawBody();
  };

  const moveSide = (move: CursorMove) => () => {
    dropPending();
    const next = movedKey(sideKeys, sideCursor, move) as BuildsEntryKey | null;
    if (next === null || next === sideCursor) {
      return;
    }
    sideCursor = next;
    log(`game cursor on ${next}`);
    markEntries();
    sidePane.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  const moveList = (move: CursorMove) => () => {
    dropPending();
    const next = movedKey(listKeys, listCursor, move);
    if (next === null) {
      log('no builds');
      return;
    }
    if (next === listCursor) {
      return;
    }
    listCursor = next;
    log(`list cursor on ${next}`);
    markRows();
    drawDetail();
    mainPane.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  const moveJobCursor = (id: string) => {
    jobCursor = id;
    log(`job cursor on ${id}`);
    markJobs();
    const listed = shownBuild();
    if (listed !== null) {
      drawPanel(listed);
    }
    scrollToJob();
    writePlace();
  };

  const moveGraph = (move: GraphMove) => () => {
    dropPending();
    if (shownGraph.columns.length === 0) {
      log('no jobs');
      return;
    }
    const next = movedJob(shownGraph, jobCursor, move);
    if (next !== null && next !== jobCursor) {
      moveJobCursor(next);
    }
  };

  const cursorBuild = (): ListedBuild | null => {
    const listed =
      listCursor === null ? undefined : lookup.builds.get(listCursor);
    if (listed === undefined) {
      log('no build under the cursor');
      return null;
    }
    return listed;
  };

  const detailBuild = (): ListedBuild | null => {
    const listed = shownBuild();
    if (listed === null) {
      log('no build under the cursor');
    }
    return listed;
  };

  const openUrl = (url: string) => {
    deps.openExternal(url).catch((error: unknown) => {
      log(`not opened: ${url}: ${errorText(error)}`);
    });
  };

  const toastProblem =
    (method: 'cancel' | 'launchSetAgent' | 'saveLog' | 'download') =>
    (answer: { ok: true } | { problem: string }) => {
      if (!('problem' in answer)) {
        return;
      }
      log(`${method} refused: ${answer.problem}`);
      if (!isDisposed) {
        toast(answer.problem, 'error');
      }
    };
  const toastFailure = (error: unknown) => {
    if (!isDisposed) {
      toast(errorText(error), 'error');
    }
  };

  const cancelBuild = () => {
    if (isDemoBlocked('cancel')) {
      return;
    }
    const listed = cursorBuild();
    if (listed === null) {
      return;
    }
    const { target, record } = listed;
    const canCancel = target.backend.capabilities?.cancel === true;
    if (!canCancel) {
      toast(`${target.backend.label} cannot cancel builds`, 'info');
      return;
    }
    if (record.state === 'finished') {
      toast('The build has ended', 'info');
      return;
    }
    channel
      .invoke('cancel', {
        backend: target.backend.id,
        game: target.view.game.id,
        build: record.id,
      })
      .then(toastProblem('cancel'), toastFailure);
  };

  const openBuildWeb = (listed: ListedBuild) => {
    if (listed.record.webUrl === null) {
      toast('This build has no link in the backend', 'info');
      return;
    }
    openUrl(listed.record.webUrl);
  };

  const openWeb = () => {
    if (isDemoBlocked('openWeb')) {
      return;
    }
    const listed = cursorBuild();
    if (listed !== null) {
      openBuildWeb(listed);
    }
  };

  // The cursor job's page; the build's own for a build with no jobs.
  const openJob = () => {
    if (isDemoBlocked('openJob')) {
      return;
    }
    const listed = detailBuild();
    if (listed === null) {
      return;
    }
    if (listed.record.jobs.length === 0) {
      openBuildWeb(listed);
      return;
    }
    const job = listed.record.jobs.find((held) => held.id === jobCursor);
    if (job === undefined || job.webUrl === null) {
      toast('This job has no link in the backend', 'info');
      return;
    }
    openUrl(job.webUrl);
  };

  // Saves the cursor job's log, or the build's own for a build with no jobs.
  const saveLog = () => {
    if (isDemoBlocked('saveLog')) {
      return;
    }
    const listed = detailBuild();
    if (listed === null) {
      return;
    }
    const { target, record } = listed;
    if (target.backend.capabilities?.saveLog !== true) {
      toast(`${target.backend.label} cannot save logs`, 'info');
      return;
    }
    const job = record.jobs.length === 0 ? null : jobCursor;
    log(`saving ${downloadId(target.backend.id, record.id, { log: job })}`);
    channel
      .invoke('saveLog', {
        backend: target.backend.id,
        game: target.view.game.id,
        build: record.id,
        job,
      })
      .then(toastProblem('saveLog'), toastFailure);
  };

  const startDownload = (listed: ListedBuild, entry: number) => {
    const { target, record } = listed;
    log(`saving ${downloadId(target.backend.id, record.id, { file: entry })}`);
    channel
      .invoke('download', {
        backend: target.backend.id,
        game: target.view.game.id,
        build: record.id,
        file: entry,
      })
      .then(toastProblem('download'), toastFailure);
  };

  // Downloads the cursor build's only file, or opens the picker over its files.
  const download = () => {
    if (isDemoBlocked('download')) {
      return;
    }
    const listed = cursorBuild();
    if (listed === null) {
      return;
    }
    const files = buildFiles(listed);
    if (files.length === 0) {
      toast('This build has no files to download', 'info');
      return;
    }
    if (files.length === 1) {
      startDownload(listed, files[0].entry);
      return;
    }
    queuePicker.dropPending();
    picker.open<BuildFile>({
      title: DOWNLOAD_TITLE,
      items: files,
      label: (file) => file.label,
      drawRow: (list, _file, input) =>
        drawPickerRow(list, DOWNLOAD_TITLE, input),
      chosen: (file) => startDownload(listed, file.entry),
    });
  };

  // `q` in the side bar queues the game under its cursor; anywhere else the shown game; All picks the game first.
  const pickQueue = () => {
    if (isDemoBlocked('pickQueue')) {
      return;
    }
    const entry = deps.isShown() && focus === 'games' ? sideCursor : selected;
    const target =
      entry === null || entry === 'all' ? undefined : lookup.games.get(entry);
    if (target === undefined) {
      queuePicker.pickGame([...lookup.games.values()]);
      return;
    }
    queuePicker.pickChoice(target);
  };

  const commands: Record<BuildsViewCommand, () => void> = {
    pickQueue,
    focusGraph() {
      enterGraph();
    },
    download,
    openWeb,
    cancel: cancelBuild,
    listDown: moveList('down'),
    listUp: moveList('up'),
    listTop: moveList('top'),
    listBottom: moveList('bottom'),
    gameDown: moveSide('down'),
    gameUp: moveSide('up'),
    gameTop: moveSide('top'),
    gameBottom: moveSide('bottom'),
    openGame() {
      if (sideCursor === null) {
        log('no entry under the cursor');
        return;
      }
      showEntry(sideCursor);
      deps.picked();
    },
    leaveGraph: () => setFocus('list'),
    graphLeft: moveGraph('left'),
    graphRight: moveGraph('right'),
    graphUp: moveGraph('up'),
    graphDown: moveGraph('down'),
    saveLog,
    openJob,
    ...listPickerCommands(picker),
  };

  drawAll();

  return {
    sideBar: sidePane,
    sheet: contentSheet,
    shown() {
      sideCursor ??= selected;
      if (keepsListOnShow) {
        keepsListOnShow = false;
        setFocus('list');
      } else {
        setFocus('games');
      }
      log('shown');
    },
    hidden() {
      queuePicker.dropPending();
    },
    sideBarHidden() {
      if (focus === 'games') {
        setFocus('list');
      }
    },
    sideBarOpenedOver: () => setFocus('games'),
    focusSideBar: () => setFocus('games'),
    focusMain,
    changed() {
      if (isDisposed) {
        return;
      }
      logDownloads();
      drawSnapshot();
    },
    redraw() {
      if (isDisposed) {
        return;
      }
      drawAll();
      picker.redraw();
    },
    commands,
    selectEntry(key) {
      const isEntry = key === 'all' || lookup.games.has(key);
      if (!isEntry) {
        log(`no entry ${key}`);
        return;
      }
      showEntry(key as BuildsEntryKey);
      deps.picked();
    },
    selectBuild(key) {
      if (!lookup.builds.has(key)) {
        log(`no build ${key}`);
        return;
      }
      dropPending();
      listCursor = key;
      setFocus('list');
      drawDetail();
    },
    showBuild(arg) {
      const key = buildKey(arg.backend, arg.build);
      const listed = lookup.builds.get(key);
      if (listed === undefined) {
        log(`no build ${key}`);
        if (!isDisposed) {
          toast('The build is no longer listed', 'info');
        }
        return false;
      }
      dropPending();
      if (!deps.isShown()) {
        keepsListOnShow = true;
      }
      // The keys leave the graph first, so the build changing under it logs no `gone`.
      setFocus('list');
      showEntry(gameKey(listed.target.backend.id, listed.target.view.game.id));
      listCursor = key;
      markRows();
      drawDetail();
      mainPane
        .querySelector('.is-cursor')
        ?.scrollIntoView({ block: 'nearest' });
      log(`shown build ${key}`);
      return true;
    },
    selectJob(jobId) {
      const listed = shownBuild();
      const listsJob =
        listed !== null && listed.record.jobs.some((job) => job.id === jobId);
      if (!listsJob) {
        log(`no job ${jobId}`);
        return;
      }
      dropPending();
      setFocus('graph');
      moveJobCursor(jobId);
    },
    downloadFile(entry) {
      if (isDemoBlocked('downloadFile')) {
        return;
      }
      const listed = detailBuild();
      if (listed !== null) {
        startDownload(listed, entry);
      }
    },
    queueButton(arg) {
      if (isDemoBlocked('queueButton')) {
        return;
      }
      const target = lookup.games.get(gameKey(arg.backend, arg.game));
      const choice =
        target === undefined
          ? undefined
          : queueChoices(target.view.game).find((held) => held.id === arg.kind);
      if (target === undefined || choice === undefined) {
        log(`no ${arg.kind} in ${arg.backend}/${arg.game}`);
        return;
      }
      queuePicker.choose(target, choice);
    },
    withAgent(arg) {
      if (isDemoBlocked('withAgent')) {
        return;
      }
      queuePicker.dropPending();
      channel
        .invoke('launchSetAgent', arg)
        .then(toastProblem('launchSetAgent'), toastFailure);
    },
    setFilter(next) {
      if (!isFeedFilter(next)) {
        log(`no filter ${next}`);
        return;
      }
      filter = next;
      log(`filter ${next}`);
      drawBody();
    },
    openLink(url) {
      if (isDemoBlocked('openLink')) {
        return;
      }
      openUrl(url);
    },
    showSample(next) {
      sample = next;
      if (!isDisposed) {
        drawSnapshot();
      }
    },
    dispose() {
      isDisposed = true;
      queuePicker.dropPending();
      const draws = [...entryDraws, ...bodyDraws];
      const detailDraws = [headerDraw, graphDraw, panelDraw, emptyDraw].filter(
        (draw): draw is DrawnRoot => draw !== null,
      );
      entryDraws = [];
      bodyDraws = [];
      headerDraw = null;
      graphDraw = null;
      panelDraw = null;
      emptyDraw = null;
      callEach<() => void>(
        [
          () => disposeDraws(draws),
          () => disposeDraws(detailDraws),
          () => parts.dispose(),
          () => split.dispose(),
          () => pendingHold?.dispose(),
        ],
        (step) => step(),
      );
    },
  };
}

// Disposes `draw` and removes its root; nothing for null.
function dropDraw(draw: DrawnRoot | null): void {
  if (draw === null) {
    return;
  }
  try {
    draw.dispose();
  } finally {
    draw.built.element.remove();
  }
}

// The files the last check found for the build.
function buildFiles(listed: ListedBuild): BuildFile[] {
  const { files } = listed.target.view;
  return Object.hasOwn(files, listed.record.id) ? files[listed.record.id] : [];
}

function downloadStates(
  downloads: ReadonlyMap<string, BuildDownload>,
): Map<string, BuildDownload['state']> {
  return new Map(
    [...downloads].map(([id, download]) => [id, download.state] as const),
  );
}

// A download's log line after its id: `running`, `saved <file name>` or `failed: <problem>`.
function downloadLine(download: BuildDownload): string {
  switch (download.state) {
    case 'running':
      return 'running';
    case 'saved':
      return `saved ${fileBaseName(download.path ?? '')}`;
    case 'failed':
      return `failed: ${download.problem ?? ''}`;
  }
}
