import type { ActiveTime } from '../../../contracts/active-time';
import type { Clock, Timers } from '../../../contracts/ambient';
import type { PluginLog } from '../../../contracts/log';
import { activeMsAt } from '../../../shared/active-time';
import { callEach } from '../../../shared/call-each';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { createPendingTick } from '../../../shared/pending-tick';
import type { SessionPart } from '../../sessions/contract';
import type { PartView, RowClockInput } from '../layouts/layout';
import {
  type ChatLayouts,
  chatPartDraws,
  surfaceBaseKit,
  type SurfaceKitDeps,
} from './chat-layouts';

// `activeTime` reads a session's clock, null for a session chat does not hold.
export interface RowClockDeps {
  layouts: ChatLayouts;
  kit: SurfaceKitDeps;
  clock: Clock;
  timers: Timers;
  log: PluginLog;
  activeTime(sessionId: string): ActiveTime | null;
}

// `part` is the row part sessions draws under each session row. `changed` shows
// the session's current clock in its row, after the clock changed; a session
// with no row drawn is ignored.
export interface RowClock {
  part: SessionPart;
  changed(sessionId: string): void;
}

// A row sessions has drawn the part in: the wrapper it handed the part, and the
// layout part drawn into it, null while the row shows nothing.
interface KeptRow {
  sessionId: string;
  wrapper: HTMLElement;
  drawn: DrawnPart<DrawnClock> | null;
}

interface DrawnClock {
  element: HTMLElement;
  view: PartView<RowClockInput>;
}

const TICK_MS = 1000;

// Each session's run time under its row, through chat's `rowClock` layout part.
// A row shows nothing for a session chat does not hold; a clock paused at 0 shows
// its zero text.
// While any kept row's clock runs, one tick a second updates each running row in
// place, through its part's `update`, else by drawing the part again; once an
// `update` throws, the part draws with `default` until the layouts change. A
// layout change draws every kept row again.
export function createRowClock(deps: RowClockDeps): RowClock {
  const { clock, timers } = deps;
  const rows = new Map<string, KeptRow>();
  const draws = chatPartDraws(deps.layouts, 'rowClock', deps.log);
  // `duration` names no key, so one kit formats every row's text.
  const { duration } = surfaceBaseKit(deps.kit, 'chat', {
    recordAnchor: () => undefined,
  });
  const ticker = createPendingTick(timers, TICK_MS, () => tick());

  const isRunning = (sessionId: string) => {
    const time = deps.activeTime(sessionId);
    return time !== null && time.since !== null;
  };

  // What the session's row draws now; null for nothing.
  const inputOf = (sessionId: string): RowClockInput | null => {
    const time = deps.activeTime(sessionId);
    if (time === null) {
      return null;
    }
    return {
      text: duration(activeMsAt(time, clock.now())),
      isRunning: time.since !== null,
    };
  };

  const clear = (row: KeptRow) => {
    const { drawn } = row;
    row.drawn = null;
    drawn?.built.element.remove();
    drawn?.dispose();
  };

  // Draws the part in place of the row's last draw.
  const draw = (row: KeptRow, input: RowClockInput) => {
    const next = draws.draw(row.wrapper, (builder, at, rollback) => {
      const kit = surfaceBaseKit(deps.kit, 'chat', rollback);
      const view = builder(at, input, kit);
      return { element: view.element, view };
    });
    clear(row);
    row.drawn = next;
  };

  // Updates the row's drawn part, or draws it when there is none, it has no
  // update or its update threw.
  const show = (row: KeptRow) => {
    const input = inputOf(row.sessionId);
    if (input === null) {
      clear(row);
    } else if (row.drawn === null || draws.update(row.drawn, input) !== 'ran') {
      draw(row, input);
    }
  };

  const drawAgain = (row: KeptRow) => {
    const input = inputOf(row.sessionId);
    if (input === null) {
      clear(row);
    } else {
      draw(row, input);
    }
  };

  // Sets the tick while a kept row's clock runs and none is pending; clears a
  // pending one once none runs.
  const updateTick = () => ticker.setNeeded([...rows.keys()].some(isRunning));

  const tick = () => {
    try {
      const running = [...rows.values()].filter((row) =>
        isRunning(row.sessionId),
      );
      callEach(running, show);
    } finally {
      updateTick();
    }
  };

  deps.layouts.onChange(() => {
    try {
      callEach([...rows.values()], drawAgain);
    } finally {
      updateTick();
    }
  });

  return {
    part: {
      id: 'chat.rowClock',
      build(wrapper, sessionId) {
        const earlier = rows.get(sessionId);
        const row: KeptRow = { sessionId, wrapper, drawn: null };
        rows.set(sessionId, row);
        try {
          if (earlier !== undefined) {
            clear(earlier);
          }
          show(row);
        } finally {
          updateTick();
        }
        return {
          dispose() {
            if (rows.get(sessionId) === row) {
              rows.delete(sessionId);
            }
            try {
              clear(row);
            } finally {
              updateTick();
            }
          },
        };
      },
    },
    changed(sessionId) {
      const row = rows.get(sessionId);
      if (row === undefined) {
        return;
      }
      try {
        show(row);
      } finally {
        updateTick();
      }
    },
  };
}
