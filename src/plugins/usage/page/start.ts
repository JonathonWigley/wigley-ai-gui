import './usage.css';
import type { Disposable } from '../../../contracts/disposable';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { chatPageKey } from '../../chat/contract';
import { keysPageKey } from '../../keys/contract';
import {
  type SessionsPageEvents,
  sessionsPageKey,
} from '../../sessions/contract';
import type {
  UsageChannel,
  UsagePageExports,
  UsageSnapshot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { usageManifest } from '../manifest';
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

type UsageApi = PageApi<
  typeof usageManifest,
  UsageChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// The `uiState` key holding `true` while the details are open.
const DETAILS_OPEN_KEY = 'details-open';
const REDRAW_MS = 60_000;

// Draws the usage status-bar line at the status bar's end until the part
// stops, each session's context line above its Chat box (a chat composer part),
// its spend in its Chat status line (a chat status part), its context and its
// cache mark under its side-bar row (two sessions row parts), and the usage
// details in the right bar while they are open (`toggleDetails`, kept in
// `uiState`), all through the `usage.layout` layout. Exports `sessionLinePart`,
// the whole session line as a part for a tab bar; every part it made redraws
// with the page's own until the dependent that asked for it stops. Hears main's
// `changed` snapshots (after
// one `snapshot` read) and `sessions.activeChanged` for the shown session, and
// redraws all on each, on each layouts set and once a minute for the
// countdowns; hears `sessions.sessionAdded` for each session's name in the log
// and `sessions.sessionRemoved` to forget a session's lines. Draws nothing
// until the first snapshot lands, or after the part stops. Logs the status line's
// and each session's lines' text when it changes, and the details' states when
// they show, hide or change.
export const usagePagePart: PagePart<typeof usageManifest> = {
  manifest: usageManifest,
  start(api: UsageApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsPageKey);
    const chat = api.dependency(chatPageKey);
    const keys = api.dependency(keysPageKey);
    const parts = createUsageParts({
      defaultLayout,
      kit: {
        markdown: services.markdown,
        keys: { anchor: keys.anchor, keysFor: keys.keysFor },
        commands: {
          exists: (id) => api.keys.command(id) !== undefined,
          run: (id) => api.commands.run(id),
        },
        platform: api.platform,
      },
      log: services.log,
    });

    // Null until the `snapshot` reply or a `changed` lands.
    let snapshot: UsageSnapshot | null = null;
    // Whether the details are open, wanted before the first snapshot too.
    let detailsOpen = services.uiState.get(DETAILS_OPEN_KEY) === true;
    let shownSessionId = sessions.selectedSessionId();
    const statusSlot = element('span', 'usage-status-slot');
    api.areas.statusBar.contribute(statusSlot, { align: 'end' });
    const detailsSlot = element('div', 'usage-details-slot');
    // The right-bar contribution while the details are drawn, null otherwise.
    let detailsContribution: Disposable | null = null;
    let statusLine: Drawn | null = null;
    let details: Drawn | null = null;
    let lastStatusText: string | null = null;
    let lastDetailsText: string | null = null;
    let isDisposed = false;
    // Each session's name in the log, its side-bar label (`gamma 2`).
    const names = new Map<string, string>();
    const lineParts = createSessionLineParts();
    const nameOf = (sessionId: string) => names.get(sessionId) ?? sessionId;
    const latest = () =>
      snapshot === null ? null : { snapshot, now: services.clock.now() };
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
    chat.addComposerPart(
      ownLinePart('usage.contextLine', contextLineKind(parts), services.log),
    );
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
      const input = statusLineInput(current, shownSessionId);
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
      const input = detailsInput(current, shownSessionId, now);
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
      if (isDisposed || snapshot === null) {
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

    api.channel.on('changed', (next) => {
      snapshot = next;
      redraw();
    });
    api.channel.invoke('snapshot').then(
      (first) => {
        if (snapshot === null) {
          snapshot = first;
          redraw();
        }
      },
      (error: unknown) =>
        services.log(`snapshot not read: ${errorText(error)}`),
    );
    api.events.on('sessions.activeChanged', ({ sessionId }) => {
      shownSessionId = sessionId;
      redraw();
    });
    api.events.on('sessions.sessionAdded', ({ sessionId, label }) => {
      names.set(sessionId, label);
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      names.delete(sessionId);
      lineParts.forget(sessionId);
    });
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
      exports: (consumer) =>
        ({
          sessionLinePart(id, partLog) {
            const lines = makeSessionLines(id, sessionLineKind(parts), partLog);
            consumer.track(lineParts.add(lines));
            return lines.part;
          },
        }) satisfies UsagePageExports,
      dispose() {
        isDisposed = true;
        callEach([statusLine, details], (drawn) => drawn?.dispose());
      },
    };
  },
};
