import type { Disposable } from '../../../contracts/disposable';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import {
  createBaseKit,
  kitCommandsOf,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type {
  DrawnPart,
  RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import {
  type StatsSnapshot,
  type StatsSortColumn,
  type SystemStatsChannel,
  systemStatsSnapshotSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type {
  CompleteLayout,
  Layout,
  PanelInput,
  SystemStatsPart,
} from '../layouts/layout';
import { systemStatsManifest } from '../manifest';
import { readSystemStatsLayout } from './layout/read-system-stats-layout';
import {
  type CursorMove,
  closeTarget,
  isGroup,
  movedCursor,
  nextSort,
  panelInput,
  type VisibleRow,
  visibleRows,
} from './stats-view-model';

type SystemStatsApi = PageApi<typeof systemStatsManifest, SystemStatsChannel>;

// After usage's details (0) and the unity-pool panel (10): the panels that come and go stay at the top.
const PANEL_ORDER = 20;
// The `uiState` key: true while the panel is hidden.
const HIDDEN_KEY = 'hidden';

// When a draw logs `cursor on <name>`: on a change of the cursor row's name while the panel holds the keys, or always
// (a move, the keys' arrival).
type CursorLog = 'changed' | 'always';

// What a draw scrolls into view while the panel holds the keys: nothing, so a wheel scroll stays; the cursor's row; or
// the cursor's opened group's last visible child, then the group.
type Reveal = 'none' | 'cursor' | 'openedGroup';

// Draws the right-bar system stats panel through the `system-stats.layout` layout while it is shown, from the
// `system-stats.snapshot` slot, and tells main over the channel when it shows or hides, so main samples only then.
// Hidden is kept in `uiState`; with none kept the panel shows, except under the self-test, where it starts hidden so
// other plugins' scripts see the right bar as before. The panel is a right-bar stop: given the keys, it walks a
// cursor over the rows, cycles the sort and opens and closes groups, its view state kept for the page's life. Redraws
// on each snapshot, settings change, layouts set, key, focus and leave, and logs the panel's showing and hiding, its
// keys' results and each change of the snapshot's error.
export const systemStatsPagePart: PagePart<typeof systemStatsManifest> = {
  manifest: systemStatsManifest,
  start(api: SystemStatsApi) {
    const { services } = api;
    const log = services.log;
    const isSelfTest = services.runMode === 'selfTest';
    const kitServices: OwnerKitServices = {
      markdown: services.markdown,
      keys: api.keys,
      commands: kitCommandsOf(api),
      platform: api.platform.os,
      state: api.state.forLayouts,
    };
    const kitFor = (rollback: RollbackDeps) =>
      createBaseKit(
        ownerBaseKitDeps(systemStatsManifest, kitServices, 'panel', rollback),
      );
    const layoutParts = createLayoutParts<Layout, CompleteLayout>({
      owner: systemStatsManifest.id,
      defaultLayout,
      log,
    });
    const snapshotSlot = api.state.read(systemStatsSnapshotSlot);
    const snapshot = (): StatsSnapshot | null => snapshotSlot.get() ?? null;

    const panelSlot = element('div', 'system-stats-panel-slot');
    panelSlot.tabIndex = -1;
    // The cursor's row draws the focus ring, so the slot draws none.
    panelSlot.style.outline = 'none';
    const storedHidden = services.uiState.get(HIDDEN_KEY);
    let isShown =
      storedHidden === undefined ? !isSelfTest : storedHidden !== true;
    let panelContribution: Disposable | null = null;
    let panel: DrawnPart<SystemStatsPart> | null = null;
    // False from each show until the draw that logs `panel shown`.
    let isAnnounced = false;
    let sort: StatsSortColumn = 'cpu';
    const openIds = new Set<string>();
    let cursorId: string | null = null;
    // The cursor's group at the last draw that showed it, and its index there.
    let cursorParentId: string | null = null;
    let lastIndex = 0;
    let hasKeys = false;
    let visible: VisibleRow[] = [];
    let loggedCursorName: string | null = null;
    let lastError: string | null = null;
    let isDisposed = false;

    const reportShown = () => {
      api.channel
        .invoke('setShown', isShown)
        .catch((error: unknown) => log(`setShown failed: ${errorText(error)}`));
    };

    const topNames = () => {
      const current = snapshot();
      if (current === null) {
        return 'reading';
      }
      const names = visible
        .filter(({ depth }) => depth === 0)
        .map(({ row }) => row.name);
      return names.length === 0 ? 'no processes' : names.join(', ');
    };

    const cursorEntry = () =>
      cursorId === null
        ? undefined
        : visible.find(({ row }) => row.id === cursorId);

    const placeCursorAt = (index: number) => {
      const entry = visible[index];
      cursorId = entry.row.id;
      cursorParentId = entry.parentId;
      lastIndex = index;
    };

    // Keeps the cursor on its row id; a row gone moves it to its group while that shows, else to the row at its last
    // index, else to none. While the panel holds the keys, a cursor on no row takes the first.
    const followCursor = () => {
      if (cursorId === null) {
        if (hasKeys && visible.length > 0) {
          placeCursorAt(0);
        }
        return;
      }
      const index = visible.findIndex(({ row }) => row.id === cursorId);
      if (index !== -1) {
        placeCursorAt(index);
        return;
      }
      const groupIndex =
        cursorParentId === null
          ? -1
          : visible.findIndex(({ row }) => row.id === cursorParentId);
      if (groupIndex !== -1) {
        placeCursorAt(groupIndex);
      } else if (visible.length > 0) {
        placeCursorAt(Math.min(lastIndex, visible.length - 1));
      } else {
        cursorId = null;
        cursorParentId = null;
      }
    };

    const logCursor = () => {
      const entry = cursorEntry();
      if (entry !== undefined) {
        loggedCursorName = entry.row.name;
        log(`cursor on ${entry.row.name}`);
      }
    };

    const logErrorChange = (current: StatsSnapshot) => {
      if (current.error === lastError) {
        return;
      }
      lastError = current.error;
      log(lastError === null ? 'error cleared' : `error: ${lastError}`);
    };

    const drawPanel = (input: PanelInput) => {
      const last = panel;
      panel = null;
      callEach<() => void>(
        [
          () => last?.dispose(),
          () => {
            panelSlot.replaceChildren();
            panel = layoutParts.draw(
              'panel',
              panelSlot,
              (part, slot, rollback) => part(slot, input, kitFor(rollback)),
            );
          },
        ],
        (step) => step(),
      );
    };

    const scrollCursorRowIntoView = () => {
      panelSlot
        .querySelector('.is-cursor')
        ?.scrollIntoView({ block: 'nearest' });
    };

    const draw = (
      reveal: Reveal = 'none',
      cursorLog: CursorLog = 'changed',
    ) => {
      if (!isShown || isDisposed) {
        return;
      }
      const current = snapshot();
      // A null snapshot is a reading in progress: the open groups and the cursor wait for the next rows.
      if (current !== null) {
        const heldIds = new Set(current.rows.map(({ id }) => id));
        for (const id of openIds) {
          if (!heldIds.has(id)) {
            openIds.delete(id);
          }
        }
      }
      const shown = visibleRows(
        current?.rows ?? [],
        sort,
        openIds,
        api.settings().processRows,
      );
      visible = shown.rows;
      if (current !== null) {
        followCursor();
        logErrorChange(current);
      }
      const isRevealed = hasKeys && reveal !== 'none';
      // The layout marks only the cursor's row, so the last child is drawn as the cursor to scroll it into view.
      const lastChild =
        isRevealed && reveal === 'openedGroup'
          ? visible.findLast(({ parentId }) => parentId === cursorId)
          : undefined;
      if (lastChild !== undefined) {
        drawPanel(panelInput(current, shown, sort, lastChild.row.id));
        scrollCursorRowIntoView();
      }
      drawPanel(panelInput(current, shown, sort, hasKeys ? cursorId : null));
      panelContribution ??= api.areas.rightBar.contribute(panelSlot, {
        order: PANEL_ORDER,
        focus: focusPanel,
        left: leavePanel,
      });
      if (isRevealed) {
        scrollCursorRowIntoView();
      }
      if (!isAnnounced) {
        isAnnounced = true;
        log(`panel shown: ${topNames()}`);
      }
      const cursorName = cursorEntry()?.row.name ?? null;
      const isCursorLogged =
        hasKeys && (cursorLog === 'always' || cursorName !== loggedCursorName);
      if (isCursorLogged) {
        logCursor();
      }
    };

    // The core gives the panel the keys: the cursor stays on a visible row, else takes the first.
    const focusPanel = () => {
      if (cursorEntry() === undefined) {
        cursorId = null;
      }
      hasKeys = true;
      api.keys.setScope('panel');
      panelSlot.focus();
      log('panel focused');
      draw('cursor', 'always');
    };

    // The core ended the panel's turn.
    const leavePanel = () => {
      hasKeys = false;
      draw();
    };

    const hidePanel = () => {
      const contribution = panelContribution;
      const last = panel;
      hasKeys = false;
      isAnnounced = false;
      panelContribution = null;
      panel = null;
      callEach<() => void>(
        [
          () => contribution?.dispose(),
          () => last?.dispose(),
          () => panelSlot.replaceChildren(),
        ],
        (step) => step(),
      );
      log('panel hidden');
    };

    const togglePanel = () => {
      isShown = !isShown;
      let stored: boolean | undefined;
      if (!isShown) {
        stored = true;
      } else if (isSelfTest) {
        stored = false;
      }
      services.uiState.set(HIDDEN_KEY, stored);
      reportShown();
      if (isShown) {
        draw();
      } else {
        hidePanel();
      }
    };

    const moveCursor = (move: CursorMove) => {
      if (visible.length === 0) {
        log('no rows');
        return;
      }
      const index =
        cursorId === null
          ? -1
          : visible.findIndex(({ row }) => row.id === cursorId);
      placeCursorAt(movedCursor(index, visible.length, move));
      draw('cursor', 'always');
    };

    const cycleSort = () => {
      sort = nextSort(sort);
      draw('cursor');
      log(`sorted by ${sort}: ${topNames()}`);
    };

    const openGroup = () => {
      const entry = cursorEntry();
      if (entry === undefined) {
        log('no rows');
        return;
      }
      const { row } = entry;
      if (!isGroup(row)) {
        log(`no group: ${row.name}`);
        return;
      }
      if (openIds.has(row.id)) {
        log(`already open: ${row.name}`);
        return;
      }
      openIds.add(row.id);
      draw('openedGroup');
      const children = visible
        .filter(({ parentId }) => parentId === row.id)
        .map((child) => child.row.name);
      log(`opened ${row.name}: ${children.join(', ')}`);
    };

    const closeGroup = () => {
      const entry = cursorEntry();
      if (entry === undefined) {
        log('no rows');
        return;
      }
      const target = closeTarget(visible, entry.row.id);
      if (target === null) {
        log(`no open group: ${entry.row.name}`);
        return;
      }
      const group = visible.find(({ row }) => row.id === target);
      openIds.delete(target);
      cursorId = target;
      cursorParentId = null;
      draw('cursor');
      log(`closed ${group?.row.name ?? target}`);
    };

    api.channel.on('seeded', (variant) => log(`seeded ${variant}`));
    api.onSettingsChanged(() => draw());
    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readSystemStatsLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        layoutParts.setLayouts(shown);
        draw();
      },
    });
    reportShown();

    return {
      commands: {
        togglePanel,
        cursorDown: () => moveCursor('down'),
        cursorUp: () => moveCursor('up'),
        cursorTop: () => moveCursor('top'),
        cursorBottom: () => moveCursor('bottom'),
        cycleSort,
        openGroup,
        closeGroup,
      },
      ready() {
        snapshotSlot.on(() => draw());
        draw();
      },
      dispose() {
        isDisposed = true;
        panel?.dispose();
      },
    };
  },
};
