import './usage.css';
import type { Disposable } from '../../../contracts/disposable';
import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { element } from '../../../shared/page/dom';
import { chatPageKey } from '../../chat/contract';
import {
  followRows,
  sessionsActiveSlot,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type UsagePageExports,
  type UsageSnapshot,
  usageSnapshotSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { usageManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { readUsageLayout } from './layout/read-usage-layout';
import { createUsageParts, type Drawn } from './layout/usage-parts';
import { createSessionLineParts } from './session-line-parts';
import {
  contextLineKind,
  createSessionLines,
  rowCacheKind,
  rowLineKind,
  type SessionLineKind,
  sessionLineKind,
  spendLineKind,
} from './session-lines';
import {
  detailsInput,
  detailsStatesText,
  statusLineInput,
  statusLineText,
} from './usage-view-model';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';

type UsageApi = PageApi<typeof usageManifest, ChannelShape>;

// The `uiState` key holding `true` while the details are open.
const DETAILS_OPEN_KEY = 'details-open';
const REDRAW_MS = 60_000;
// Under the build offer (10) and the agent strip (20), over the workflow strip (40).
const CONTEXT_LINE_ORDER = 30;

// Draws the usage status-bar line at the status bar's end until the part
// stops, each session's context line above its Chat box (a chat composer part),
// its spend in its Chat status line (a chat status part), its context and its
// cache mark under its side-bar row (two sessions row parts), and the usage
// details in the right bar while they are open (`toggleDetails`, kept in
// `uiState`), all through the `usage.layout` layout. Exports `sessionLinePart`,
// the whole session line as a part for a tab bar; every part it made redraws
// with the page's own until the dependent that asked for it stops. Reads
// `usage.snapshot` and `sessions.active` for the shown session, and redraws all
// at `ready`, on each change of either, on each layouts set and once a
// minute for the countdowns; reads `sessions.rows` for each session's name in the
// log and to forget a removed session's lines. Draws nothing while the slot holds
// no snapshot. Logs the status line's
// and each session's lines' text when it changes, and the details' states when
// they show, hide or change. Registers the Usage demo step, which opens and
// closes the details without writing `uiState`.
export const usagePagePart: PagePart<typeof usageManifest> = {
  manifest: usageManifest,
  start(api: UsageApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsPageKey);
    const chat = api.dependency(chatPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const active = api.state.read(sessionsActiveSlot);
    const usage = api.state.read(usageSnapshotSlot);
    const parts = createUsageParts({
      defaultLayout,
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      log: services.log,
    });

    // Whether the details are open, wanted before the first snapshot too.
    let detailsOpen = services.uiState.get(DETAILS_OPEN_KEY) === true;
    const statusSlot = element('span', 'usage-status-slot');
    api.areas.statusBar.contribute(statusSlot, { align: 'end' });
    const detailsSlot = element('div', 'usage-details-slot');
    // The right-bar contribution while the details are drawn, null otherwise.
    let detailsContribution: Disposable | null = null;
    let statusLine: Drawn | null = null;
    let details: Drawn | null = null;
    let lastStatusText: string | null = null;
    let lastDetailsText: string | null = null;
    const lineParts = createSessionLineParts();
    const nameOf = (sessionId: string) =>
      rows.get(sessionId)?.label ?? sessionId;
    const latest = () => {
      const snapshot = usage.get();
      return snapshot === undefined
        ? null
        : { snapshot, now: services.clock.now() };
    };
    const makeSessionLines = <I>(
      id: string,
      line: SessionLineKind<I>,
      partLog: (text: string) => void,
    ) =>
      createSessionLines({
        id,
        line,
        log: partLog,
        nameOf,
        latest,
      });
    // A part of the page's own drawing `line`, which redraws and forgets with
    // the rest.
    const ownLinePart = <I>(
      id: string,
      line: SessionLineKind<I>,
      partLog: (text: string) => void,
    ) => {
      const lines = makeSessionLines(id, line, partLog);
      lineParts.add(lines);
      return lines.part;
    };
    chat.addComposerPart({
      ...ownLinePart('usage.contextLine', contextLineKind(parts), services.log),
      order: CONTEXT_LINE_ORDER,
    });
    chat.addStatusPart(
      ownLinePart('usage.spend', spendLineKind(parts), services.log),
    );
    sessions.addRowPart(
      ownLinePart('usage.rowLine', rowLineKind(parts), (line) =>
        services.log(`row ${line}`),
      ),
    );
    sessions.addRowPart(
      ownLinePart('usage.rowCache', rowCacheKind(parts), (line) =>
        services.log(`row cache ${line}`),
      ),
    );

    // Draws the line again, the last draw disposed first.
    const drawStatusLine = (current: UsageSnapshot) => {
      const input = statusLineInput(current, active.get() ?? null);
      const last = statusLine;
      statusLine = null;
      callEach<() => void>(
        [
          () => last?.dispose(),
          () => {
            statusLine = parts.statusLine(statusSlot, input);
          },
        ],
        (step) => step(),
      );
      const text = statusLineText(input);
      if (text !== lastStatusText) {
        lastStatusText = text;
        services.log(`status line ${text}`);
      }
    };
    // Draws the details again, the last draw disposed first, and returns
    // their states text.
    const drawDetails = (current: UsageSnapshot, now: number): string => {
      const input = detailsInput(current, active.get() ?? null, now);
      const last = details;
      details = null;
      callEach<() => void>(
        [
          () => last?.dispose(),
          () => {
            details = parts.details(detailsSlot, input);
          },
        ],
        (step) => step(),
      );
      return detailsStatesText(input);
    };
    // Draws the line, and the details while open, at one `now`; shows the
    // details on their first draw.
    const redraw = () => {
      const snapshot = usage.get();
      if (snapshot === undefined) {
        return;
      }
      const now = services.clock.now();
      drawStatusLine(snapshot);
      lineParts.redraw();
      if (!detailsOpen) {
        return;
      }
      if (detailsContribution === null) {
        detailsContribution = api.areas.rightBar.contribute(detailsSlot);
        lastDetailsText = drawDetails(snapshot, now);
        services.log(`details shown: ${lastDetailsText}`);
        return;
      }
      const text = drawDetails(snapshot, now);
      if (text !== lastDetailsText) {
        lastDetailsText = text;
        services.log(`details drawn: ${text}`);
      }
    };
    const closeDetails = () => {
      if (detailsContribution === null) {
        return;
      }
      const contribution = detailsContribution;
      const last = details;
      detailsContribution = null;
      details = null;
      lastDetailsText = null;
      callEach<() => void>(
        [() => contribution.dispose(), () => last?.dispose()],
        (step) => step(),
      );
      services.log('details hidden');
    };
    // Opens or closes the details as `toggleDetails` does, writing no
    // `uiState`.
    const setDetailsShown = (shown: boolean) => {
      detailsOpen = shown;
      if (shown) {
        redraw();
      } else {
        closeDetails();
      }
    };
    registerDemoSteps(services, {
      activate: (sessionId) => sessions.activate(sessionId),
      setDetailsShown,
      detailsShown: () => detailsOpen,
    });

    active.on(() => redraw());
    followRows(rows, { removed: (sessionId) => lineParts.forget(sessionId) });
    const tick = () => {
      redraw();
      services.timers.set(tick, REDRAW_MS);
    };
    services.timers.set(tick, REDRAW_MS);

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readUsageLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        parts.setLayouts(shown);
        redraw();
      },
    });

    return {
      commands: {
        toggleDetails() {
          detailsOpen = !detailsOpen;
          services.uiState.set(
            DETAILS_OPEN_KEY,
            detailsOpen ? true : undefined,
          );
          if (detailsOpen) {
            redraw();
          } else {
            closeDetails();
          }
        },
      },
      ready() {
        usage.on(() => redraw());
        redraw();
      },
      exports: (consumer) =>
        ({
          sessionLinePart(id, partLog) {
            const lines = makeSessionLines(id, sessionLineKind(parts), partLog);
            consumer.track(lineParts.add(lines));
            return lines.part;
          },
        }) satisfies UsagePageExports,
      dispose() {
        callEach([statusLine, details], (drawn) => drawn?.dispose());
      },
    };
  },
};
