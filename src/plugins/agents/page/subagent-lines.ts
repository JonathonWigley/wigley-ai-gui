import type { Clock, Timers } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import type { ShownLayouts } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import type { SessionPart } from '../../sessions/contract';
import type { RunningAgent } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  AgentsPart,
  CompleteLayout,
  Layout,
  SubagentLineInput,
} from '../layouts/layout';
import { agentsManifest } from '../manifest';

// `nameOf` is the session's name in the page log line.
export interface SubagentLinesDeps {
  kit: OwnerKitServices;
  log: Log;
  clock: Clock;
  timers: Timers;
  nameOf(sessionId: string): string;
}

// `part` draws a session's running subagents, one line each, into the
// wrapper sessions hands it under the session's row. `setRunning` replaces a
// session's list, `[]` once none runs, and redraws its lines; `setLayouts`
// redraws every session's; `forget` drops a session that left.
export interface SubagentLines {
  part: SessionPart;
  setRunning(sessionId: string, running: RunningAgent[]): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  forget(sessionId: string): void;
}

// A wrapper sessions handed `part.build`, and the lines drawn into it last.
interface HeldWrapper {
  wrapper: HTMLElement;
  lines: DrawnPart<AgentsPart>[];
}

const TICK_MS = 1000;

// Each session's running list outlives its wrapper, which a row redraw builds
// and disposes many times. While any line shows, one tick a second redraws
// every line, since a line has no hook to update its elapsed time alone.
// After each draw it logs `lines in <name>: <count>` when the count differs
// from the last one logged for that session, so a row redraw or a tick logs
// nothing new.
export function createSubagentLines(deps: SubagentLinesDeps): SubagentLines {
  const { clock, timers } = deps;
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: agentsManifest.id,
    defaultLayout,
    log: deps.log,
  });
  const running = new Map<string, RunningAgent[]>();
  const held = new Map<string, HeldWrapper>();
  const loggedCounts = new Map<string, number>();
  let pendingTick: number | null = null;

  const disposeLines = (holder: HeldWrapper) => {
    const lines = holder.lines;
    holder.lines = [];
    callEach(lines, (line) => line.dispose());
  };

  const drawLine = (holder: HeldWrapper, input: SubagentLineInput) =>
    layoutParts.draw('line', holder.wrapper, (line, slot, rollback) =>
      line(
        slot,
        input,
        createBaseKit(
          ownerBaseKitDeps(agentsManifest, deps.kit, null, rollback),
        ),
      ),
    );

  const logCount = (sessionId: string, count: number) => {
    if (count === (loggedCounts.get(sessionId) ?? 0)) {
      return;
    }
    loggedCounts.set(sessionId, count);
    deps.log('agents', `lines in ${deps.nameOf(sessionId)}: ${count}`);
  };

  const isLineShown = () =>
    [...held.values()].some((holder) => holder.lines.length > 0);

  // Sets the tick while a line shows and none is pending; clears a pending
  // one once no line shows.
  const updateTicker = () => {
    const isShown = isLineShown();
    if (isShown && pendingTick === null) {
      pendingTick = timers.set(tick, TICK_MS);
    } else if (!isShown && pendingTick !== null) {
      timers.clear(pendingTick);
      pendingTick = null;
    }
  };

  const draw = (sessionId: string, holder: HeldWrapper) => {
    try {
      disposeLines(holder);
    } finally {
      holder.wrapper.replaceChildren();
    }
    const now = clock.now();
    for (const agent of running.get(sessionId) ?? []) {
      holder.lines.push(
        drawLine(holder, {
          agentType: agent.agentType,
          description: agent.description,
          elapsedMs: now - agent.startedAt,
          toolCalls: agent.toolCalls,
        }),
      );
    }
    logCount(sessionId, holder.lines.length);
  };

  const drawAll = () => {
    try {
      callEach([...held], ([sessionId, holder]) => draw(sessionId, holder));
    } finally {
      updateTicker();
    }
  };

  const tick = () => {
    pendingTick = null;
    drawAll();
  };

  return {
    part: {
      id: 'agents.subagentLines',
      build(wrapper, sessionId) {
        const holder: HeldWrapper = { wrapper, lines: [] };
        held.set(sessionId, holder);
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
              disposeLines(holder);
            } finally {
              updateTicker();
            }
          },
        };
      },
    },
    setRunning(sessionId, next) {
      if (next.length === 0) {
        running.delete(sessionId);
      } else {
        running.set(sessionId, next);
      }
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
      running.delete(sessionId);
      loggedCounts.delete(sessionId);
    },
  };
}
