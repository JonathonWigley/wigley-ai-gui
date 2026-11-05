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
import type { Layout, WorkingLineInput } from '../layouts/layout';
import { createWorkingLines } from './working-lines';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

const NOW = 1_000_000;
const SESSION = 'row-1';

// A running agent `ageMs` old at NOW.
function runningAgent(agentId: string, ageMs: number): RosterAgent {
  return {
    agentId,
    agentType: 'Explore',
    name: agentId,
    description: 'Map the callers',
    startedAt: NOW - ageMs,
    model: null,
    effort: null,
    spendUsd: null,
    isBackground: false,
    contextTokens: null,
    contextWindow: null,
    autocompactLimit: null,
    tools: [],
  };
}

// A running task of the main agent's, `ageMs` old at NOW.
function runningTask(taskId: string, ageMs: number): RosterTask {
  return {
    taskId,
    agentId: MAIN_AGENT_ID,
    ownerName: 'main',
    description: 'npm run build',
    command: null,
    startedAt: NOW - ageMs,
  };
}

// Two running agents, 42 s and 185 s old, and a task 90 s old: three running
// items, the oldest 185 s.
const RUNNING: Roster = {
  agents: [runningAgent('agent-1', 42_000), runningAgent('agent-2', 185_000)],
  tasks: [runningTask('task-1', 90_000)],
  skills: [],
};

// Lines over a clock at `now` whose timers record each `set` (its handle the
// set's count) and each `clear`; `nameOf` reads every session as `proj`, and
// `roster` hands `current` for every session.
function setUp(current: Roster = { agents: [], tasks: [], skills: [] }) {
  let now = NOW;
  const sets: { run: () => void; handle: number }[] = [];
  const clears: number[] = [];
  const logged: string[] = [];
  const lines = createWorkingLines({
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
      state: noLayoutState,
    },
    log: (line: string) => logged.push(line),
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

describe('working lines', () => {
  it('build_Running_DrawsOneLineWithOldestElapsedAndLogsCount', () => {
    const { lines, wrapper, logged } = setUp();
    lines.setRoster(SESSION, RUNNING);

    const built = lines.part.build(asHtml(wrapper), SESSION);
    built.dispose?.();
    lines.part.build(asHtml(wrapper), SESSION);

    const drawn = findAll(wrapper, 'agent-lines-line');
    expect(drawn).toHaveLength(1);
    expect(drawn[0].dataset.layoutOwner).toBe('agent-lines');
    expect(drawn[0].textContent).toContain('3m 05s');
    expect(drawn[0].textContent).not.toContain('Map the callers');
    expect(logged).toEqual(['running in proj: 3']);
  });

  // A row built before any `setRoster` named its session draws the roster
  // `deps.roster` holds.
  it('build_NothingSet_DrawsTheDepsRoster', () => {
    const { lines, wrapper, logged } = setUp({
      agents: [runningAgent('agent-1', 42_000)],
      tasks: [],
      skills: [],
    });

    lines.part.build(asHtml(wrapper), SESSION);

    expect(
      findAll(wrapper, 'agent-lines-line').map((line) => line.textContent),
    ).toEqual([expect.stringContaining('42s')]);
    expect(logged).toEqual(['running in proj: 1']);
  });

  it('tick_LineShown_RedrawsElapsedAndStopsWhenEmpty', () => {
    const { lines, wrapper, sets, clears, logged, advance } = setUp();
    lines.setRoster(SESSION, RUNNING);
    lines.part.build(asHtml(wrapper), SESSION);
    expect(sets).toHaveLength(1);

    advance(1000);
    sets[0].run();
    const afterTickText = findAll(wrapper, 'agent-lines-line')[0].textContent;
    const setsAfterTick = sets.length;
    lines.setRoster(SESSION, { agents: [], tasks: [], skills: [] });

    expect(afterTickText).toContain('3m 06s');
    expect(setsAfterTick).toBe(2);
    expect(clears).toEqual([sets[1].handle]);
    expect(sets).toHaveLength(2);
    expect(findAll(wrapper, 'agent-lines-line')).toEqual([]);
    expect(logged).toEqual(['running in proj: 3', 'running in proj: 0']);
  });

  it('build_UserPartThrows_DrawsWithDefault', () => {
    const { lines, wrapper } = setUp();
    const throwing: Layout = {
      workingLine() {
        throw new Error('broken workingLine');
      },
    };
    lines.setLayouts(withUser<Layout>(defaultLayout, throwing));
    lines.setRoster(SESSION, RUNNING);

    lines.part.build(asHtml(wrapper), SESSION);

    expect(
      findAll(wrapper, 'agent-lines-line').map((line) => line.dataset.layout),
    ).toEqual(['default']);
    expect(wrapper.children).toHaveLength(1);
  });

  it('build_UserWorkingLine_SeesCounts', () => {
    const { lines, wrapper } = setUp();
    const inputs: WorkingLineInput[] = [];
    const recording: Layout = {
      workingLine(parent, input, kit) {
        inputs.push(input);
        return { element: kit.el(parent, 'div', 'recorded-line') };
      },
    };
    lines.setLayouts(withUser<Layout>(defaultLayout, recording));
    lines.setRoster(SESSION, RUNNING);

    lines.part.build(asHtml(wrapper), SESSION);

    expect(inputs).toEqual([
      { elapsedMs: 185_000, agentCount: 2, taskCount: 1 },
    ]);
  });
});
