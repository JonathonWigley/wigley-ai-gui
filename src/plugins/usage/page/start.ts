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
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type { UsageChannel, UsageSnapshot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { usageManifest } from '../manifest';
import { readUsageLayout } from './layout/read-usage-layout';
import { createUsageParts, type Drawn } from './layout/usage-parts';
import { createSessionLines } from './session-lines';
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

// Draws the usage status-bar line at the status bar's end for the page's
// life, each session's line in its tab bar (a sessions bar part), and the
// usage details in the right bar while they are open (`toggleDetails`, kept
// in `uiState`), all through the `usage.layout` layout. Hears main's
// `changed` snapshots (after one `snapshot` read) and
// `sessions.activeChanged` for the shown session, and redraws all on each,
// on each layouts set and once a minute for the countdowns. Draws nothing
// until the first snapshot lands. Logs the status line's and each session
// line's text when it changes, and the details' states when they show, hide
// or change.
export const usagePagePart: PagePart<typeof usageManifest> = {
  manifest: usageManifest,
  start(api: UsageApi) {
    const { services } = api;
    const log = (line: string) => services.log('usage', line);
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const keys = api.dependency<KeysPageExports>('keys');
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
    const lines = createSessionLines({
      parts,
      log,
      latest: () =>
        snapshot === null ? null : { snapshot, now: services.clock.now() },
    });
    sessions.addBarPart(lines.part);

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
        log(`status line ${text}`);
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
      if (snapshot === null) {
        return;
      }
      const now = services.clock.now();
      drawStatusLine(snapshot);
      lines.redraw(snapshot, now);
      if (!detailsOpen) {
        return;
      }
      if (detailsContribution === null) {
        detailsContribution = api.areas.rightBar.contribute(detailsSlot);
        lastDetailsText = drawDetails(snapshot, now);
        log(`details shown: ${lastDetailsText}`);
        return;
      }
      const text = drawDetails(snapshot, now);
      if (text !== lastDetailsText) {
        lastDetailsText = text;
        log(`details drawn: ${text}`);
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
      log('details hidden');
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
      (error: unknown) => log(`snapshot not read: ${errorText(error)}`),
    );
    api.events.on('sessions.activeChanged', ({ sessionId }) => {
      shownSessionId = sessionId;
      redraw();
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) =>
      lines.forget(sessionId),
    );
    const tick = () => {
      redraw();
      services.timers.set(tick, REDRAW_MS);
    };
    services.timers.set(tick, REDRAW_MS);

    api.layouts.show<Layout>({
      defaultLayout,
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
    };
  },
};
