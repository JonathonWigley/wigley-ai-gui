import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { Roster } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, TaskLineInput } from '../layouts/layout';
import { createRosterLines } from './roster-lines';

const NOW = 1_000_000;
const SESSION = 'row-1';

// Two running agents, 42 s and 185 s old at NOW, with one and twelve tool
// calls, and no task.
const TWO_RUNNING: Roster = {
  agents: [
    {
      agentId: 'agent-1',
      agentType: 'Explore',
      description: 'Map the callers',
      startedAt: NOW - 42_000,
      toolCalls: 1,
    },
    {
      agentId: 'agent-2',
      agentType: 'wigley:sonnet-medium',
      description: 'Read the contract',
      startedAt: NOW - 185_000,
      toolCalls: 12,
    },
  ],
  tasks: [],
};

// TWO_RUNNING with a task of `agent-2`'s, 30 s old, and the main agent's,
// 90 s old.
const WITH_TASKS: Roster = {
  ...TWO_RUNNING,
  tasks: [
    {
      taskId: 'task-1',
      agentId: 'agent-2',
      description: 'npm test --watch',
      startedAt: NOW - 30_000,
    },
    {
      taskId: 'task-2',
      agentId: MAIN_AGENT_ID,
      description: 'npm run build',
      startedAt: NOW - 90_000,
    },
  ],
};

// Lines over a clock at `now` whose timers record each `set` (its handle the
// set's count) and each `clear`; `nameOf` reads every session as `proj`.
function setUp() {
  let now = NOW;
  const sets: { run: () => void; handle: number }[] = [];
  const clears: number[] = [];
  const logged: string[] = [];
  const lines = createRosterLines({
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
      },
      keys: recordingAnchors().keys,
      commands: { exists: () => true, run: () => undefined },
      platform: 'macos',
    },
    log: (source, message) => logged.push(`[${source}] ${message}`),
    clock: { now: () => now },
    timers: {
      set(run) {
        const handle = sets.length + 1;
        sets.push({ run, handle });
        return handle;
      },
      clear: (handle) => clears.push(handle),
    },
    nameOf: () => 'proj',
  });
  const wrapper = new FakeElement('div');
  const advance = (ms: number) => {
    now += ms;
  };
  return { lines, wrapper, sets, clears, logged, advance };
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('roster lines', () => {
  it('build_TwoRunning_DrawsLineEachAndLogsCount', () => {
    const { lines, wrapper, logged } = setUp();
    lines.setRoster(SESSION, TWO_RUNNING);

    const built = lines.part.build(asHtml(wrapper), SESSION);
    built.dispose?.();
    lines.part.build(asHtml(wrapper), SESSION);

    const drawn = findAll(wrapper, 'agents-line');
    expect(drawn.map((line) => line.dataset.layoutOwner)).toEqual([
      'agents',
      'agents',
    ]);
    expect(drawn[0].textContent).toContain('3m 05s');
    expect(drawn[1].textContent).toContain('Explore');
    expect(drawn[1].textContent).toContain('42s');
    expect(drawn[1].textContent).toContain('1 tool');
    expect(logged).toEqual(['[agents] lines in proj: 2']);
  });

  it('tick_LinesShown_RedrawsElapsedAndStopsWhenEmpty', () => {
    const { lines, wrapper, sets, clears, logged, advance } = setUp();
    lines.setRoster(SESSION, TWO_RUNNING);
    lines.part.build(asHtml(wrapper), SESSION);
    expect(sets).toHaveLength(1);

    advance(1000);
    sets[0].run();
    const afterTick = {
      newest: findAll(wrapper, 'agents-line')[1].textContent,
      sets: sets.length,
    };
    lines.setRoster(SESSION, { agents: [], tasks: [] });

    expect(afterTick.newest).toContain('43s');
    expect(afterTick.sets).toBe(2);
    expect(clears).toEqual([sets[1].handle]);
    expect(sets).toHaveLength(2);
    expect(findAll(wrapper, 'agents-line')).toEqual([]);
    expect(logged).toEqual([
      '[agents] lines in proj: 2',
      '[agents] lines in proj: 0',
    ]);
  });

  it.each<{ part: keyof Layout }>([
    { part: 'agentLine' },
    { part: 'taskLine' },
  ])('build_UserPartThrows_DrawsWithDefault ($part)', ({ part }) => {
    const { lines, wrapper } = setUp();
    const throwing: Layout = {
      [part]() {
        throw new Error(`broken ${part}`);
      },
    };
    lines.setLayouts(withUser<Layout>(defaultLayout, throwing));
    lines.setRoster(SESSION, WITH_TASKS);

    lines.part.build(asHtml(wrapper), SESSION);

    expect(
      findAll(wrapper, 'agents-line').map((line) => line.dataset.layout),
    ).toEqual(['default', 'default', 'default', 'default']);
    expect(wrapper.children).toHaveLength(4);
  });

  it('build_UserTaskLine_SeesNestingAndCountsEveryLine', () => {
    const { lines, wrapper, logged } = setUp();
    const inputs: TaskLineInput[] = [];
    const recording: Layout = {
      taskLine(parent, input, kit) {
        inputs.push(input);
        return { element: kit.el(parent, 'div', 'recorded-task') };
      },
    };
    lines.setLayouts(withUser<Layout>(defaultLayout, recording));
    lines.setRoster(SESSION, WITH_TASKS);

    lines.part.build(asHtml(wrapper), SESSION);

    expect(
      inputs.map(({ description, isNested }) => [description, isNested]),
    ).toEqual([
      ['npm test --watch', true],
      ['npm run build', false],
    ]);
    expect(logged).toEqual(['[agents] lines in proj: 4']);
  });
});
