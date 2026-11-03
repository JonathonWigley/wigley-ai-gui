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
import type { Roster, RosterAgent, RosterTask } from '../../agents/contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, TaskLineInput } from '../layouts/layout';
import { createRosterLines } from './roster-lines';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

const NOW = 1_000_000;
const SESSION = 'row-1';

// A running agent of `agentType`, `ageMs` old at NOW, with `toolCount` tool
// calls, all done.
function runningAgent(
  agentId: string,
  agentType: string,
  description: string,
  ageMs: number,
  toolCount: number,
): RosterAgent {
  return {
    agentId,
    agentType,
    name: agentType,
    description,
    startedAt: NOW - ageMs,
    model: null,
    effort: null,
    spendUsd: null,
    tools: Array.from({ length: toolCount }, (_, i) => ({
      toolUseId: `${agentId}-tool-${i + 1}`,
      tool: 'Read',
      summary: 'src/main/files/node-files.ts',
      outcome: 'done',
    })),
    outcome: 'running',
  };
}

// A running task of `agentId`'s, `ageMs` old at NOW.
function runningTask(
  taskId: string,
  agentId: string,
  description: string,
  ageMs: number,
): RosterTask {
  return {
    taskId,
    agentId,
    description,
    command: null,
    startedAt: NOW - ageMs,
    outcome: 'running',
  };
}

// Two running agents, 42 s and 185 s old at NOW, with one and twelve tool
// calls, and no task.
const TWO_RUNNING: Roster = {
  agents: [
    runningAgent('agent-1', 'Explore', 'Map the callers', 42_000, 1),
    runningAgent(
      'agent-2',
      'wigley:sonnet-medium',
      'Read the contract',
      185_000,
      12,
    ),
  ],
  tasks: [],
};

// TWO_RUNNING with a task of `agent-2`'s, 30 s old, and the main agent's,
// 90 s old.
const WITH_TASKS: Roster = {
  ...TWO_RUNNING,
  tasks: [
    runningTask('task-1', 'agent-2', 'npm test --watch', 30_000),
    runningTask('task-2', MAIN_AGENT_ID, 'npm run build', 90_000),
  ],
};

// Lines over a clock at `now` whose timers record each `set` (its handle the
// set's count) and each `clear`; `nameOf` reads every session as `proj`, and
// `roster` hands `current` for every session.
function setUp(current: Roster = { agents: [], tasks: [] }) {
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
        ...NO_FENCES,
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
    roster: () => current,
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
  // Lines in `orderRosterLines`' order: agent-2, its task-1 nested, the main
  // agent's task-2, agent-1.
  it('build_WithTasks_DrawsLineEachAndLogsCount', () => {
    const { lines, wrapper, logged } = setUp();
    lines.setRoster(SESSION, WITH_TASKS);

    const built = lines.part.build(asHtml(wrapper), SESSION);
    built.dispose?.();
    lines.part.build(asHtml(wrapper), SESSION);

    const drawn = findAll(wrapper, 'agent-lines-line');
    expect(drawn.map((line) => line.dataset.layoutOwner)).toEqual([
      'agent-lines',
      'agent-lines',
      'agent-lines',
      'agent-lines',
    ]);
    expect(
      drawn.map((line) =>
        line.classList.contains('agent-lines-task-line-nested'),
      ),
    ).toEqual([false, true, false, false]);
    expect(
      drawn.map((line) => findAll(line, 'codicon-terminal').length),
    ).toEqual([0, 1, 1, 0]);
    expect(drawn[0].textContent).toContain('3m 05s');
    expect(drawn[0].textContent).toContain('12 tools');
    expect(drawn[1].textContent).toContain('npm test --watch');
    expect(drawn[1].textContent).toContain('30s');
    expect(drawn[2].textContent).toContain('npm run build');
    expect(drawn[2].textContent).toContain('1m 30s');
    expect(drawn[3].textContent).toContain('Explore');
    expect(drawn[3].textContent).toContain('42s');
    expect(drawn[3].textContent).toContain('1 tool');
    expect(logged).toEqual(['[agent-lines] lines in proj: 4']);
  });

  // A row built before any `setRoster` named its session draws the roster
  // `deps.roster` holds: one running and one done subagent, so one line.
  it('build_NothingSet_DrawsTheDepsRoster', () => {
    const { lines, wrapper, logged } = setUp({
      agents: [
        runningAgent('agent-1', 'Explore', 'Map the callers', 42_000, 1),
        {
          ...runningAgent('agent-2', 'Plan', 'Read the contract', 9_000, 3),
          outcome: 'done',
        },
      ],
      tasks: [],
    });

    lines.part.build(asHtml(wrapper), SESSION);

    expect(
      findAll(wrapper, 'agent-lines-line').map((line) => line.textContent),
    ).toEqual([expect.stringContaining('Map the callers')]);
    expect(logged).toEqual(['[agent-lines] lines in proj: 1']);
  });

  it('tick_LinesShown_RedrawsElapsedAndStopsWhenEmpty', () => {
    const { lines, wrapper, sets, clears, logged, advance } = setUp();
    lines.setRoster(SESSION, WITH_TASKS);
    lines.part.build(asHtml(wrapper), SESSION);
    expect(sets).toHaveLength(1);

    advance(1000);
    sets[0].run();
    const afterTick = findAll(wrapper, 'agent-lines-line');
    const afterTickText = {
      nestedTask: afterTick[1].textContent,
      newestAgent: afterTick[3].textContent,
      sets: sets.length,
    };
    lines.setRoster(SESSION, { agents: [], tasks: [] });

    expect(afterTickText.nestedTask).toContain('31s');
    expect(afterTickText.newestAgent).toContain('43s');
    expect(afterTickText.sets).toBe(2);
    expect(clears).toEqual([sets[1].handle]);
    expect(sets).toHaveLength(2);
    expect(findAll(wrapper, 'agent-lines-line')).toEqual([]);
    expect(logged).toEqual([
      '[agent-lines] lines in proj: 4',
      '[agent-lines] lines in proj: 0',
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
      findAll(wrapper, 'agent-lines-line').map((line) => line.dataset.layout),
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
    expect(logged).toEqual(['[agent-lines] lines in proj: 4']);
  });
});
