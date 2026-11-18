import type { Clock, Timers } from '../../../contracts/ambient';
import type { PluginLog } from '../../../contracts/log';
import type { ShownLayouts } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { createPendingTick } from '../../../shared/pending-tick';
import type { SessionPart } from '../../sessions/contract';
import type { Roster } from '../../agents/contract';
import defaultLayout from '../layouts/default/layout.js';
import type { AgentLinesPart, CompleteLayout, Layout } from '../layouts/layout';
import { agentLinesManifest } from '../manifest';
import { type RunningWork, runningWork } from './running-work';

// `nameOf` is the session's name in the page log line; `roster` is a
// session's current roster, drawn by a row built before any `setRoster` named
// it.
export interface WorkingLinesDeps {
  kit: OwnerKitServices;
  log: PluginLog;
  clock: Clock;
  timers: Timers;
  nameOf(sessionId: string): string;
  roster(sessionId: string): Roster;
}

// `part` draws a session's working line, while it runs any subagent or task,
// into the wrapper sessions hands it under the session's row. `setRoster`
// replaces a session's roster and redraws its line; `setLayouts` redraws
// every session's; `forget` drops a session that left.
export interface WorkingLines {
  part: SessionPart;
  setRoster(sessionId: string, roster: Roster): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  forget(sessionId: string): void;
}

// A wrapper sessions handed `part.build`, and the line drawn into it last.
interface HeldWrapper {
  wrapper: HTMLElement;
  line: DrawnPart<AgentLinesPart> | null;
}

const TICK_MS = 1000;

// Each session's running work outlives its wrapper, which a row redraw builds
// and disposes many times. While any line shows, one tick a second redraws
// every line, since a line has no hook to update its elapsed time alone.
// After each draw it logs `running in <name>: <count>`, counting running
// subagents and tasks together, when the count differs from the last one
// logged for that session, so a row redraw or a tick logs nothing new.
export function createWorkingLines(deps: WorkingLinesDeps): WorkingLines {
  const { clock, timers } = deps;
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: agentLinesManifest.id,
    defaultLayout,
    log: deps.log,
  });
  const works = new Map<string, RunningWork>();
  const held = new Map<string, HeldWrapper>();
  const loggedCounts = new Map<string, number>();
  const ticker = createPendingTick(timers, TICK_MS, () => tick());

  const disposeLine = (holder: HeldWrapper) => {
    const line = holder.line;
    holder.line = null;
    line?.dispose();
  };

  const drawLine = (holder: HeldWrapper, work: RunningWork, now: number) =>
    layoutParts.draw(
      'workingLine',
      holder.wrapper,
      (workingLine, slot, rollback) =>
        workingLine(
          slot,
          {
            elapsedMs: now - work.startedAt,
            agentCount: work.agentCount,
            taskCount: work.taskCount,
          },
          createBaseKit(
            ownerBaseKitDeps(agentLinesManifest, deps.kit, null, rollback),
          ),
        ),
    );

  const logCount = (sessionId: string, count: number) => {
    if (count === (loggedCounts.get(sessionId) ?? 0)) {
      return;
    }
    loggedCounts.set(sessionId, count);
    deps.log(`running in ${deps.nameOf(sessionId)}: ${count}`);
  };

  const isLineShown = () =>
    [...held.values()].some((holder) => holder.line !== null);

  // Sets the tick while a line shows and none is pending; clears a pending
  // one once no line shows.
  const updateTicker = () => ticker.setNeeded(isLineShown());

  const draw = (sessionId: string, holder: HeldWrapper) => {
    try {
      disposeLine(holder);
    } finally {
      holder.wrapper.replaceChildren();
    }
    const work = works.get(sessionId);
    if (work !== undefined) {
      holder.line = drawLine(holder, work, clock.now());
    }
    logCount(
      sessionId,
      work === undefined ? 0 : work.agentCount + work.taskCount,
    );
  };

  const drawAll = () => {
    try {
      callEach([...held], ([sessionId, holder]) => draw(sessionId, holder));
    } finally {
      updateTicker();
    }
  };

  const tick = () => {
    drawAll();
  };

  const storeWork = (sessionId: string, roster: Roster) => {
    const work = runningWork(roster);
    if (work === null) {
      works.delete(sessionId);
    } else {
      works.set(sessionId, work);
    }
  };

  return {
    part: {
      id: 'agent-lines.workingLine',
      build(wrapper, sessionId) {
        const holder: HeldWrapper = { wrapper, line: null };
        held.set(sessionId, holder);
        if (!works.has(sessionId)) {
          storeWork(sessionId, deps.roster(sessionId));
        }
        try {
          draw(sessionId, holder);
        } finally {
          updateTicker();
        }
        return {
          dispose() {
            if (held.get(sessionId) === holder) {
              held.delete(sessionId);
            }
            try {
              disposeLine(holder);
            } finally {
              updateTicker();
            }
          },
        };
      },
    },
    setRoster(sessionId, roster) {
      storeWork(sessionId, roster);
      const holder = held.get(sessionId);
      if (holder === undefined) {
        return;
      }
      try {
        draw(sessionId, holder);
      } finally {
        updateTicker();
      }
    },
    setLayouts(shown) {
      layoutParts.setLayouts(shown);
      drawAll();
    },
    forget(sessionId) {
      works.delete(sessionId);
      loggedCounts.delete(sessionId);
    },
  };
}
