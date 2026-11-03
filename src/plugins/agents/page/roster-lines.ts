import type { Clock, Timers } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import type { ShownLayouts } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
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
import type { SessionPart } from '../../sessions/contract';
import type { Roster } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  AgentLineInput,
  AgentsKit,
  AgentsPart,
  CompleteLayout,
  Layout,
  TaskLineInput,
} from '../layouts/layout';
import { agentsManifest } from '../manifest';
import { orderRosterLines, type RosterLine } from './roster-line-order';

// `nameOf` is the session's name in the page log line.
export interface RosterLinesDeps {
  kit: OwnerKitServices;
  log: Log;
  clock: Clock;
  timers: Timers;
  nameOf(sessionId: string): string;
}

// `part` draws a session's running subagents and tasks, one line each, in
// `orderRosterLines`' order, into the wrapper sessions hands it under the
// session's row. `setRoster` replaces a session's roster, both lists empty
// once nothing runs, and redraws its lines; `setLayouts` redraws every
// session's; `forget` drops a session that left.
export interface RosterLines {
  part: SessionPart;
  setRoster(sessionId: string, roster: Roster): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  forget(sessionId: string): void;
}

// A wrapper sessions handed `part.build`, and the lines drawn into it last.
interface HeldWrapper {
  wrapper: HTMLElement;
  lines: DrawnPart<AgentsPart>[];
}

const TICK_MS = 1000;

// Each session's roster outlives its wrapper, which a row redraw builds and
// disposes many times. While any line shows, one tick a second redraws
// every line, since a line has no hook to update its elapsed time alone.
// After each draw it logs `lines in <name>: <count>`, counting subagent and
// task lines together, when the count differs from the last one logged for
// that session, so a row redraw or a tick logs nothing new.
export function createRosterLines(deps: RosterLinesDeps): RosterLines {
  const { clock, timers } = deps;
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: agentsManifest.id,
    defaultLayout,
    log: deps.log,
  });
  const orderedLines = new Map<string, RosterLine[]>();
  const held = new Map<string, HeldWrapper>();
  const loggedCounts = new Map<string, number>();
  let pendingTick: number | null = null;

  const disposeLines = (holder: HeldWrapper) => {
    const lines = holder.lines;
    holder.lines = [];
    callEach(lines, (line) => line.dispose());
  };

  const kitFor = (rollback: RollbackDeps): AgentsKit =>
    createBaseKit(ownerBaseKitDeps(agentsManifest, deps.kit, null, rollback));

  const drawAgentLine = (holder: HeldWrapper, input: AgentLineInput) =>
    layoutParts.draw('agentLine', holder.wrapper, (agentLine, slot, rollback) =>
      agentLine(slot, input, kitFor(rollback)),
    );

  const drawTaskLine = (holder: HeldWrapper, input: TaskLineInput) =>
    layoutParts.draw('taskLine', holder.wrapper, (taskLine, slot, rollback) =>
      taskLine(slot, input, kitFor(rollback)),
    );

  const drawLine = (holder: HeldWrapper, line: RosterLine, now: number) =>
    line.kind === 'agent'
      ? drawAgentLine(holder, {
          agentType: line.agent.agentType,
          description: line.agent.description,
          elapsedMs: now - line.agent.startedAt,
          toolCalls: line.agent.toolCalls,
        })
      : drawTaskLine(holder, {
          description: line.task.description,
          elapsedMs: now - line.task.startedAt,
          isNested: line.isNested,
        });

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
    for (const line of orderedLines.get(sessionId) ?? []) {
      holder.lines.push(drawLine(holder, line, now));
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
      id: 'agents.rosterLines',
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
    setRoster(sessionId, roster) {
      const lines = orderRosterLines(roster);
      if (lines.length === 0) {
        orderedLines.delete(sessionId);
      } else {
        orderedLines.set(sessionId, lines);
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
      orderedLines.delete(sessionId);
      loggedCounts.delete(sessionId);
    },
  };
}
