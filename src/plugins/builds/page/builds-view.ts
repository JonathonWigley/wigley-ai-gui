import type { CommandKey } from '../../../contracts/commands';
import type { ListPicker } from '../../../contracts/list-picker';
import type { PluginLog } from '../../../contracts/log';
import type { FocusTarget, ResizeTarget } from '../../../contracts/panes';
import type {
  CommandsRunIn,
  PageChannel,
  ToastTone,
} from '../../../contracts/plugin';
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
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import type {
  BuildRecord,
  BuildsChannel,
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
  buildDetailInput,
  buildKey,
  type CursorMove,
  emptyReason,
  type FeedFilter,
  feedRows,
  type GameListItem,
  gameHeaderInput,
  gameKey,
  gameRows,
  heldKey,
  isFeedFilter,
  linkedBuilds,
  movedKey,
  queueChoices,
  queuedBy,
  sideBarEntries,
} from './builds-view-model';
import type { BuildsDemoSample } from './demo-sample';
import { createQueuePicker, type QueueTarget } from './queue-picker';

// The base scopes the view sets: the side bar's game list and the sheet's build list. The picker's is pushed over
// them.
export type BuildsScope = 'games' | 'list';

// The page commands the view runs on a key: the two lists', the build's, the queue picker's and the list picker's.
export type BuildsViewCommand = Extract<
  CommandsRunIn<typeof buildsManifest, 'page'>,
  | 'pickQueue'
  | 'openDetail'
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
  // `builds.snapshot` and `builds.sessions` as they are now, and each session row's label by session id.
  snapshot(): BuildsSnapshot;
  sessions(): ReadonlyMap<string, SessionBuilds>;
  sessionLabels(): ReadonlyMap<string, string>;
  setScope(scope: BuildsScope): void;
  setResizeTarget(target: ResizeTarget | null): void;
  setFocusTarget(target: FocusTarget | null): void;
  isShown(): boolean;
  // Hears each entry the user shows from the side bar.
  picked(): void;
  // Runs a click's command, logging a throw.
  runKey<A>(key: CommandKey<A>, arg: A): void;
}

// Builds mode's view: the side bar's entries and the sheet's head and build list, each drawn through the layout
// picked for its part, logging under `builds`. It holds the side-bar cursor, the shown entry, the list cursor and the
// open detail by key, each kept across a redraw while its key is still drawn: the list cursor moves to the nearest
// row still drawn, the detail closes, and the shown entry falls back to All. A page load shows All. `showSample`
// draws a sample's snapshot and session links in place of the slots' until it is dropped; while it shows, the queue,
// cancel, with-agent and open commands do nothing. Once disposed, it draws and toasts nothing.
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

const selectEntryCommand: CommandKey<string, 'builds.selectEntry'> = {
  id: 'builds.selectEntry',
};
const selectBuildCommand: CommandKey<string, 'builds.selectBuild'> = {
  id: 'builds.selectBuild',
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
  const contentSheet = sheet();
  contentSheet.classList.add('builds-sheet');
  contentSheet.append(mainPane);

  // ── State ──────────────────────────────────────────────────────────────
  let sample: BuildsDemoSample | null = null;
  let focus: BuildsScope = 'games';
  let selected: BuildsEntryKey = 'all';
  let sideCursor: BuildsEntryKey | null = null;
  let listCursor: string | null = null;
  let detailKey: string | null = null;
  let filter: FeedFilter = 'all';
  let isDisposed = false;
  let lookup: Lookup = { games: new Map(), builds: new Map() };
  // The cursor stops of each list, in the drawn order.
  let sideKeys: BuildsEntryKey[] = [];
  let listKeys: string[] = [];

  let entryDraws: DrawnRoot[] = [];
  let bodyDraws: DrawnRoot[] = [];
  const entryRoots = new Map<BuildsEntryKey, HTMLElement>();
  const rowRoots = new Map<string, HTMLElement>();

  const snapshot = (): BuildsSnapshot => sample?.snapshot ?? deps.snapshot();
  const kitFor = (
    scope: BuildsScope | 'picker',
    rollback: RollbackDeps,
  ): BaseKit =>
    createBaseKit(
      ownerBaseKitDeps(buildsManifest, deps.kitServices, scope, rollback),
    );

  const queuePicker = createQueuePicker({
    picker,
    channel,
    toast(text, tone) {
      if (!isDisposed) {
        deps.toast(text, tone);
      }
    },
    log,
    drawRow(list, title, input) {
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
    },
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

  const drawDetail = (parent: HTMLElement, key: string) => {
    const listed = lookup.builds.get(key);
    if (listed === undefined) {
      return;
    }
    bodyDraws.push(
      parts.draw('buildDetail', parent, (part, into, rollback) => ({
        element: part(
          into,
          buildDetailInput(listed.record),
          kitFor('list', rollback),
        ),
      })),
    );
  };

  const drawRow = (parent: HTMLElement, row: BuildRowInput) => {
    const drawn = parts.draw('buildRow', parent, (part, into, rollback) => ({
      element: part(into, row, kitFor('list', rollback)),
    }));
    bodyDraws.push(drawn);
    const root = drawn.built.element;
    rowAction(root, () => deps.runKey(selectBuildCommand, row.key));
    rowRoots.set(row.key, root);
    if (row.key === detailKey) {
      drawDetail(parent, row.key);
    }
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

  const drawBody = () => {
    const target =
      selected === 'all' ? null : (lookup.games.get(selected) ?? null);
    const items = listItems(target);
    const keys = items.flatMap((item) =>
      item.kind === 'build' ? [item.row.key] : item.rows.map((row) => row.key),
    );
    listCursor = heldKey(listKeys, keys, listCursor);
    if (detailKey !== null && !keys.includes(detailKey)) {
      detailKey = null;
    }
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
  };

  // Indexes the shown snapshot, keeps the shown entry and the side-bar cursor on what is still drawn, and draws the
  // entries and the list again.
  const drawSnapshot = () => {
    lookup = indexSnapshot(snapshot());
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
    drawBody();
  };

  const drawAll = () => {
    drawSideBarPane();
    drawMainPane();
    drawSnapshot();
  };

  // ── Focus ──────────────────────────────────────────────────────────────
  // The one setter of the keys' pane: sets the scope and the targets and moves the DOM focus there while the mode
  // shows, then marks the cursors.
  const setFocus = (next: BuildsScope, movesFocus = true) => {
    focus = next;
    if (deps.isShown()) {
      deps.setScope(next);
      deps.setResizeTarget(null);
      deps.setFocusTarget(focusTarget);
      if (movesFocus) {
        (next === 'games' ? sidePane : mainPane).focus();
      }
    }
    markEntries();
    markRows();
  };

  // The list takes the keys; `picked` closes a narrow window's side bar overlay, so the keys never sit in the list
  // under it.
  const focusMain = () => {
    setFocus('list');
    deps.picked();
  };

  // `right` from the game list moves to the build list here; every other move goes on to the core, so Alt+h from
  // the list reaches the side bar.
  const focusTarget: FocusTarget = {
    move(direction) {
      if (focus !== 'games' || direction !== 'right') {
        return false;
      }
      focusMain();
      return true;
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
    sideCursor = key;
    if (key === selected) {
      markEntries();
      return;
    }
    selected = key;
    listCursor = null;
    detailKey = null;
    listKeys = [];
    log(`shown ${key}`);
    markEntries();
    drawBody();
  };

  const moveSide = (move: CursorMove) => () => {
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
    mainPane.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
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

  const openUrl = (url: string) => {
    deps.openExternal(url).catch((error: unknown) => {
      log(`not opened: ${url}: ${errorText(error)}`);
    });
  };

  const toastProblem =
    (method: 'cancel' | 'launchSetAgent') =>
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

  const openWeb = () => {
    if (isDemoBlocked('openWeb')) {
      return;
    }
    const listed = cursorBuild();
    if (listed === null) {
      return;
    }
    if (listed.record.webUrl === null) {
      toast('This build has no link in the backend', 'info');
      return;
    }
    openUrl(listed.record.webUrl);
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
    openDetail() {
      if (listCursor === null) {
        log('no build under the cursor');
        return;
      }
      detailKey = detailKey === listCursor ? null : listCursor;
      log(detailKey === null ? 'detail closed' : `detail open on ${detailKey}`);
      drawBody();
    },
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
    ...listPickerCommands(picker),
  };

  drawAll();

  return {
    sideBar: sidePane,
    sheet: contentSheet,
    shown() {
      sideCursor ??= selected;
      setFocus('games');
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
      if (!isDisposed) {
        drawSnapshot();
      }
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
      listCursor = key;
      setFocus('list');
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
      entryDraws = [];
      bodyDraws = [];
      callEach<() => void>(
        [() => disposeDraws(draws), () => parts.dispose()],
        (step) => step(),
      );
    },
  };
}
