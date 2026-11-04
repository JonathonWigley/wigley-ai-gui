import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import { type ChatEntry, MAIN_AGENT_ID } from '../../../contracts/agent';
import type { SessionCompaction } from '../contract';
import type { StepInput, WorkingInput } from '../layouts/layout';
import { createActivityDock } from './activity-dock';

const NOW = 5000;

// Timers that run only when the test fires them.
function fakeTimers() {
  let nextHandle = 1;
  const armed = new Map<number, () => void>();
  const timers: Timers = {
    set: (run) => {
      armed.set(nextHandle, run);
      return nextHandle++;
    },
    clear: (handle) => {
      armed.delete(handle);
    },
  };
  const fireAll = () => {
    const runs = [...armed.values()];
    armed.clear();
    for (const run of runs) {
      run();
    }
  };
  return { timers, armed, fireAll };
}

// A dock over fake timers and a clock whose `time` the test sets, and every
// input it sent.
function setUpDock() {
  const sent: (WorkingInput | null)[] = [];
  const { timers, armed, fireAll } = fakeTimers();
  const clock = { time: NOW, now: () => clock.time };
  const dock = createActivityDock({
    clock,
    timers,
    changed: (input) => sent.push(input),
  });
  return { dock, sent, armed, fireAll, clock };
}

const user = (id: string, at: number): ChatEntry => ({
  kind: 'user',
  id,
  at,
  text: 'ask',
  images: [],
  raw: [],
});

const tool = (
  id: string,
  at: number,
  { running = false, agentId = MAIN_AGENT_ID } = {},
): ChatEntry => ({
  kind: 'tool',
  id,
  at,
  agentId,
  toolUseId: `use-${id}`,
  name: 'Read',
  input: {},
  summary: 'Read a file',
  result: running ? null : { text: 'done', isError: false },
  raw: [],
});

const result = (
  id: string,
  at: number,
  costUsd: number | null = null,
  stopReason = 'end_turn',
): ChatEntry => ({
  kind: 'result',
  id,
  at,
  stopReason,
  costUsd,
  durationMs: null,
  raw: [],
});

const live = (
  state: 'thinking' | 'working',
  steps: ChatEntry[],
  startedAt: number,
): WorkingInput => ({
  state,
  steps: steps as StepInput[],
  startedAt,
  now: NOW,
  compaction: null,
});

const APP_REASON = 'auto · cache cold · 182k';

const app: SessionCompaction = {
  trigger: 'app',
  reason: APP_REASON,
  startedAt: 700,
};

const compacting = (steps: ChatEntry[], now = NOW): WorkingInput => ({
  state: 'compacting',
  steps: steps as StepInput[],
  startedAt: 700,
  now,
  compaction: APP_REASON,
});

const done = (
  steps: ChatEntry[],
  startedAt: number,
  endedAt: number,
  costUsd: number | null = null,
  stopReason = 'end_turn',
): WorkingInput => ({
  state: 'done',
  steps: steps as StepInput[],
  startedAt,
  endedAt,
  stopReason,
  costUsd,
});

type SetCall = [
  entries: ChatEntry[],
  working: boolean,
  compaction: SessionCompaction | null,
];

const u = user('u', 100);
const running = tool('t', 110, { running: true });
const finished = tool('t', 110);
const second = tool('t2', 120, { running: true });
const r900 = result('r1', 900, 0.25);
const r1500 = result('r2', 1500, null, 'success');
const u2 = user('u2', 2000);
const late = tool('t3', 1000, { running: true });
const lateDone = tool('t3', 1000);
const agentCall = tool('agent', 110);
const subagentTool = tool('s', 120, { running: true, agentId: 'agent-1' });

describe('activity dock', () => {
  it.each<{ case: string; calls: SetCall[]; sent: (WorkingInput | null)[] }>([
    {
      case: 'working with a running main tool',
      calls: [[[u, running], true, null]],
      sent: [live('working', [running], 100)],
    },
    {
      case: 'a result lands while still working',
      calls: [
        [[u, running], true, null],
        [[u, finished, r900], true, null],
      ],
      sent: [live('working', [running], 100)],
    },
    {
      case: 'working again after a done line, the turn still empty',
      calls: [
        [[u, finished, r900], false, null],
        [[u, finished, r900], true, null],
      ],
      sent: [done([finished], 100, 900, 0.25), live('thinking', [], NOW)],
    },
    {
      case: 'idle with two results, the later one cost null',
      calls: [[[u, finished, r900, r1500], false, null]],
      sent: [done([finished], 100, 1500, 0.25, 'success')],
    },
    {
      case: 'idle with no result after the last user entry',
      calls: [
        [[u, running], true, null],
        [[u, finished], false, null],
      ],
      sent: [live('working', [running], 100), null],
    },
    {
      case: 'live, then a result lands and the session goes idle',
      calls: [
        [[u, running], true, null],
        [[u, finished, r900], false, null],
      ],
      sent: [live('working', [running], 100), done([finished], 100, 900, 0.25)],
    },
    {
      case: 'done, then the user sends',
      calls: [
        [[u, finished, r900], false, null],
        [[u, finished, r900, u2], false, null],
      ],
      sent: [done([finished], 100, 900, 0.25), null],
    },
    {
      case: 'the same entries and flag again',
      calls: (() => {
        const list = [u, finished, r900];
        return [
          [list, false, null],
          [list, false, null],
        ] satisfies SetCall[];
      })(),
      sent: [done([finished], 100, 900, 0.25)],
    },
    {
      case: 'live with one more main tool step',
      calls: [
        [[u, running], true, null],
        [[u, running, second], true, null],
      ],
      sent: [
        live('working', [running], 100),
        live('working', [running, second], 100),
      ],
    },
    {
      case: 'live with a new array of the same steps',
      calls: [
        [[u, running], true, null],
        [[u, running], true, null],
      ],
      sent: [live('working', [running], 100)],
    },
    {
      case: 'a later result while still idle',
      calls: [
        [[u, finished, r900], false, null],
        [[u, finished, r900, r1500], false, null],
      ],
      sent: [
        done([finished], 100, 900, 0.25),
        done([finished], 100, 1500, 0.25, 'success'),
      ],
    },
    {
      case: 'a live turn after a result, then done from the user entry',
      calls: [
        [[u, r900, late], true, null],
        [[u, r900, lateDone, r1500], false, null],
      ],
      sent: [
        live('working', [late], 1000),
        done([lateDone], 100, 1500, 0.25, 'success'),
      ],
    },
    {
      case: "an answered Agent call and its subagent's running tool",
      calls: [[[u, agentCall, subagentTool], true, null]],
      sent: [live('thinking', [agentCall], 100)],
    },
    {
      case: 'compacting while idle after a done turn',
      calls: [[[u, finished, r900], false, app]],
      sent: [compacting([])],
    },
    {
      case: 'compaction ends while idle',
      calls: [
        [[u, finished, r900], false, app],
        [[u, finished, r900], false, null],
      ],
      sent: [compacting([]), done([finished], 100, 900, 0.25)],
    },
    {
      case: 'compaction starts during an empty live turn',
      calls: [
        [[u, finished, r900], true, null],
        [[u, finished, r900], true, app],
      ],
      sent: [live('thinking', [], NOW), compacting([])],
    },
    {
      case: 'compaction ends during an empty live turn',
      calls: [
        [[u, finished, r900], true, app],
        [[u, finished, r900], true, null],
      ],
      sent: [compacting([]), live('thinking', [], NOW)],
    },
    {
      case: 'the same compaction again',
      calls: [
        [[u, running], true, app],
        [[u, running], true, app],
      ],
      sent: [compacting([running])],
    },
  ])('dock_Set ($case)', ({ calls, sent }) => {
    const setUp = setUpDock();

    for (const [entries, working, compaction] of calls) {
      setUp.dock.set(entries, working, compaction);
    }

    expect(setUp.sent).toEqual(sent);
    expect(setUp.dock.input()).toEqual(sent.at(-1));
  });

  it('dock_Tick_LiveSendsNowEachSecondAndStopsWhenIdle', () => {
    const { dock, sent, armed, fireAll, clock } = setUpDock();
    clock.time = 1000;
    dock.set([u, running], true, null);

    clock.time = 2000;
    fireAll();
    clock.time = 3000;
    fireAll();

    expect(
      sent.map((input) => input?.state === 'working' && input.now),
    ).toEqual([1000, 2000, 3000]);
    expect(dock.input()).toEqual(sent.at(-1));

    dock.set([u, finished, r900], false, null);
    expect(armed.size).toBe(0);

    dock.set([u, running], true, null);
    expect(armed.size).toBe(1);
    dock.dispose();
    expect(armed.size).toBe(0);
  });

  it('dock_Tick_CompactingWhileIdle_SendsNowEachSecond', () => {
    const { dock, sent, fireAll, clock } = setUpDock();
    dock.set([u, finished, r900], false, app);

    clock.time = NOW + 1000;
    fireAll();

    expect(sent).toEqual([compacting([]), compacting([], NOW + 1000)]);
  });
});
