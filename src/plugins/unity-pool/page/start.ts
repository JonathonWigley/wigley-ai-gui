import type { Disposable } from '../../../contracts/disposable';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type {
  DrawnPart,
  RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type { PoolAction, PoolState, UnityPoolChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type {
  CompleteLayout,
  Layout,
  PanelInput,
  RowBadgeInput,
  UnityPoolPart,
} from '../layouts/layout';
import { unityPoolManifest } from '../manifest';
import { readUnityPoolLayout } from './layout/read-unity-pool-layout';
import {
  type PendingAction,
  type PoolRow,
  panelInput,
  poolOfRow,
  rowBadges,
} from './pool-view-model';

type UnityPoolApi = PageApi<
  typeof unityPoolManifest,
  UnityPoolChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

const REDRAW_MS = 60_000;
// After usage's details, which take the default order 0.
const PANEL_ORDER = 10;

const DONE_WORDS: Record<PoolAction, string> = {
  hold: 'Held',
  release: 'Released',
};

// A folder's origin repo name: asked of main and not answered yet, or read.
type OriginEntry = { kind: 'pending' } | { kind: 'read'; name: string | null };

// A wrapper sessions handed the row part, and the badges drawn into it last.
interface HeldWrapper {
  wrapper: HTMLElement;
  badges: DrawnPart<UnityPoolPart>[];
}

// Draws a badge under each session row for each clone it holds or queue it
// waits in, and the right-bar panel of the shown session's pool, through the
// `unity-pool.layout` layout. Reads main's `snapshot` once and applies each
// `changed` after it; keeps each row's match keys from the sessions events and
// the shown session from `sessions.activeChanged`; asks main for the shown
// session's folder's origin name once per folder while any pool exists. Hold
// and Release run through main, one at a time per clone, each clone's last
// result kept until the page reloads. Redraws all on each of those, on each
// layouts set and once a minute for the times. Logs each row's badges and the
// panel's showing, hiding and counts when they change.
export const unityPoolPagePart: PagePart<typeof unityPoolManifest> = {
  manifest: unityPoolManifest,
  start(api: UnityPoolApi) {
    const { services } = api;
    const log = (line: string) => services.log(unityPoolManifest.id, line);
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const keys = api.dependency<KeysPageExports>('keys');
    const kitServices: OwnerKitServices = {
      markdown: services.markdown,
      keys: { anchor: keys.anchor, keysFor: keys.keysFor },
      commands: {
        exists: (id) => api.keys.command(id) !== undefined,
        run: (id) => api.commands.run(id),
      },
      platform: api.platform,
    };
    const kitFor = (rollback: RollbackDeps) =>
      createBaseKit(
        ownerBaseKitDeps(unityPoolManifest, kitServices, null, rollback),
      );
    const layoutParts = createLayoutParts<Layout, CompleteLayout>({
      owner: unityPoolManifest.id,
      defaultLayout,
      log: services.log,
    });

    let pools: readonly PoolState[] = [];
    // False until the `snapshot` reply or a `changed` lands.
    let hasSnapshot = false;
    let shownSessionId = sessions.selectedSessionId();
    const rows = new Map<string, PoolRow>();
    const originNames = new Map<string, OriginEntry>();
    // Each pool's Hold and Release runs, by clone number.
    const pendingByPool = new Map<string, Map<number, PendingAction>>();
    const held = new Map<string, HeldWrapper>();
    // Each row's badge text last logged; a row never logged reads `none`.
    const loggedBadges = new Map<string, string>();
    const panelSlot = element('div', 'unity-pool-panel-slot');
    let panelContribution: Disposable | null = null;
    let panel: DrawnPart<UnityPoolPart> | null = null;
    let shownPool: string | null = null;
    let lastCountsText: string | null = null;

    const pendingOf = (pool: string) => {
      let pending = pendingByPool.get(pool);
      if (pending === undefined) {
        pending = new Map();
        pendingByPool.set(pool, pending);
      }
      return pending;
    };

    const disposeBadges = (holder: HeldWrapper) => {
      const drawn = holder.badges;
      holder.badges = [];
      callEach(drawn, (badge) => badge.dispose());
    };

    const logBadges = (row: PoolRow, badges: readonly RowBadgeInput[]) => {
      const text =
        badges.length === 0
          ? 'none'
          : badges.map((badge) => badge.text).join(', ');
      if (text === (loggedBadges.get(row.sessionId) ?? 'none')) {
        return;
      }
      loggedBadges.set(row.sessionId, text);
      log(`badge in ${row.label}: ${text}`);
    };

    const drawRow = (sessionId: string, holder: HeldWrapper) => {
      try {
        disposeBadges(holder);
      } finally {
        holder.wrapper.replaceChildren();
      }
      const row = rows.get(sessionId);
      if (row === undefined) {
        return;
      }
      const badges = rowBadges(pools, row);
      for (const badge of badges) {
        holder.badges.push(
          layoutParts.draw(
            'rowBadge',
            holder.wrapper,
            (rowBadge, slot, rollback) =>
              rowBadge(slot, badge, kitFor(rollback)),
          ),
        );
      }
      logBadges(row, badges);
    };

    const shownRow = () =>
      shownSessionId === null ? undefined : rows.get(shownSessionId);

    // Asks main once for the shown session's folder's origin name while any
    // pool exists; a rejection clears the entry so a later redraw asks again.
    const askOriginName = () => {
      const folder = shownRow()?.projectDir ?? null;
      if (folder === null || pools.length === 0 || originNames.has(folder)) {
        return;
      }
      originNames.set(folder, { kind: 'pending' });
      api.channel.invoke('originName', folder).then(
        (name) => {
          originNames.set(folder, { kind: 'read', name });
          redraw();
        },
        (error: unknown) => {
          originNames.delete(folder);
          log(`originName ${folder} not read: ${errorText(error)}`);
        },
      );
    };

    const shownPoolState = (): PoolState | null => {
      const row = shownRow();
      if (row === undefined) {
        return null;
      }
      const entry =
        row.projectDir === null ? undefined : originNames.get(row.projectDir);
      const originName = entry?.kind === 'read' ? entry.name : null;
      return poolOfRow(pools, row, originName, services.paths);
    };

    // The panel's clone folders shown through `~`.
    const withShownPaths = (input: PanelInput): PanelInput => ({
      ...input,
      clones: input.clones.map((clone) => ({
        ...clone,
        path: services.paths.tilde(clone.path, services.homeDir),
      })),
    });

    const hidePanel = () => {
      if (panelContribution === null) {
        return;
      }
      const contribution = panelContribution;
      const last = panel;
      panelContribution = null;
      panel = null;
      shownPool = null;
      lastCountsText = null;
      callEach<() => void>(
        [
          () => contribution.dispose(),
          () => last?.dispose(),
          () => panelSlot.replaceChildren(),
        ],
        (step) => step(),
      );
      log('panel hidden');
    };

    const drawPanel = (pool: PoolState, now: number) => {
      const input = withShownPaths(
        panelInput(pool, [...rows.values()], now, pendingOf(pool.pool), {
          run: (action, clone) => runAction(pool.pool, action, clone),
          select: (sessionId) => sessions.activate(sessionId),
        }),
      );
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
      panelContribution ??= api.areas.rightBar.contribute(panelSlot, {
        order: PANEL_ORDER,
      });
      if (pool.pool !== shownPool) {
        shownPool = pool.pool;
        lastCountsText = null;
        log(`panel shown: ${pool.pool}`);
      }
      const text = countsText(input);
      if (text !== lastCountsText) {
        lastCountsText = text;
        log(`panel ${input.pool}: ${text}`);
      }
    };

    const updatePanel = () => {
      const pool = shownPoolState();
      if (pool === null) {
        hidePanel();
      } else {
        drawPanel(pool, services.clock.now());
      }
    };

    const redraw = () => {
      askOriginName();
      callEach<() => void>(
        [
          () =>
            callEach([...held], ([sessionId, holder]) =>
              drawRow(sessionId, holder),
            ),
          updatePanel,
        ],
        (step) => step(),
      );
    };

    const runAction = (pool: string, action: PoolAction, clone: number) => {
      const pending = pendingOf(pool);
      if (pending.get(clone)?.running === true) {
        return;
      }
      pending.set(clone, { action, running: true, result: null });
      redraw();
      const finish = (result: { ok: boolean; text: string }) => {
        pending.set(clone, { action, running: false, result });
        log(`${action} ${pool} ${clone}: ${result.ok ? 'ok' : result.text}`);
        redraw();
      };
      api.channel.invoke('run', action, pool, clone).then(
        (result) =>
          finish(
            result.ok
              ? { ok: true, text: `${DONE_WORDS[action]} Unity ${clone}` }
              : { ok: false, text: result.message },
          ),
        (error: unknown) => finish({ ok: false, text: errorText(error) }),
      );
    };

    sessions.addRowPart({
      id: 'unity-pool.badge',
      build(wrapper, sessionId) {
        const holder: HeldWrapper = { wrapper, badges: [] };
        held.set(sessionId, holder);
        drawRow(sessionId, holder);
        return {
          dispose() {
            if (held.get(sessionId) === holder) {
              held.delete(sessionId);
            }
            disposeBadges(holder);
          },
        };
      },
    });

    api.channel.on('changed', (next) => {
      hasSnapshot = true;
      pools = next.pools;
      redraw();
    });
    api.channel.invoke('snapshot').then(
      (first) => {
        if (!hasSnapshot) {
          hasSnapshot = true;
          pools = first.pools;
          redraw();
        }
      },
      (error: unknown) => log(`snapshot not read: ${errorText(error)}`),
    );
    api.events.on(
      'sessions.sessionAdded',
      ({ sessionId, label, projectDir, hostSessionId }) => {
        rows.set(sessionId, { sessionId, label, projectDir, hostSessionId });
        redraw();
      },
    );
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      rows.delete(sessionId);
      loggedBadges.delete(sessionId);
      redraw();
    });
    api.events.on(
      'sessions.sessionHostChanged',
      ({ sessionId, hostSessionId }) => {
        const row = rows.get(sessionId);
        if (row !== undefined) {
          rows.set(sessionId, { ...row, hostSessionId });
        }
        redraw();
      },
    );
    api.events.on('sessions.activeChanged', ({ sessionId }) => {
      shownSessionId = sessionId;
      redraw();
    });
    const tick = () => {
      redraw();
      services.timers.set(tick, REDRAW_MS);
    };
    services.timers.set(tick, REDRAW_MS);

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readUnityPoolLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        layoutParts.setLayouts(shown);
        redraw();
      },
    });

    return { commands: {} };
  },
};

// `<h> held, <f> free, <q> queued`, with `, <b> blocking` while a ticket waits
// long.
function countsText(input: PanelInput): string {
  const { held, free, queued, blocking } = input.counts;
  const text = `${held} held, ${free} free, ${queued} queued`;
  return input.longWait ? `${text}, ${blocking} blocking` : text;
}
