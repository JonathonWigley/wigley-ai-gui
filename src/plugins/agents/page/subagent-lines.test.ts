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
import type { RunningAgent } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { createSubagentLines } from './subagent-lines';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

const NOW = 1_000_000;
const SESSION = 'row-1';

// Two running agents, 42 s and 185 s old at NOW, with one and twelve tool
// calls.
const TWO_RUNNING: RunningAgent[] = [
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
];

// Lines over a clock at `now` whose timers record each `set` (its handle the
// set's count) and each `clear`; `nameOf` reads every session as `proj`.
function setUp() {
  let now = NOW;
  const sets: { run: () => void; handle: number }[] = [];
  const clears: number[] = [];
  const logged: string[] = [];
  const lines = createSubagentLines({
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

describe('subagent lines', () => {
  it('build_TwoRunning_DrawsLineEachAndLogsCount', () => {
    const { lines, wrapper, logged } = setUp();
    lines.setRunning(SESSION, TWO_RUNNING);

    const built = lines.part.build(asHtml(wrapper), SESSION);
    built.dispose?.();
    lines.part.build(asHtml(wrapper), SESSION);

    const drawn = findAll(wrapper, 'agents-line');
    expect(drawn.map((line) => line.dataset.layoutOwner)).toEqual([
      'agents',
      'agents',
    ]);
    expect(drawn[0].textContent).toContain('Explore');
    expect(drawn[0].textContent).toContain('42s');
    expect(drawn[0].textContent).toContain('1 tool');
    expect(drawn[1].textContent).toContain('3m 05s');
    expect(logged).toEqual(['[agents] lines in proj: 2']);
  });

  it('tick_LinesShown_RedrawsElapsedAndStopsWhenEmpty', () => {
    const { lines, wrapper, sets, clears, logged, advance } = setUp();
    lines.setRunning(SESSION, TWO_RUNNING);
    lines.part.build(asHtml(wrapper), SESSION);
    expect(sets).toHaveLength(1);

    advance(1000);
    sets[0].run();
    const afterTick = {
      first: findAll(wrapper, 'agents-line')[0].textContent,
      sets: sets.length,
    };
    lines.setRunning(SESSION, []);

    expect(afterTick.first).toContain('43s');
    expect(afterTick.sets).toBe(2);
    expect(clears).toEqual([sets[1].handle]);
    expect(sets).toHaveLength(2);
    expect(findAll(wrapper, 'agents-line')).toEqual([]);
    expect(logged).toEqual([
      '[agents] lines in proj: 2',
      '[agents] lines in proj: 0',
    ]);
  });

  it('build_UserLineThrows_DrawsWithDefault', () => {
    const { lines, wrapper } = setUp();
    const throwing: Layout = {
      line() {
        throw new Error('broken line');
      },
    };
    lines.setLayouts(withUser<Layout>(defaultLayout, throwing));
    lines.setRunning(SESSION, TWO_RUNNING);

    lines.part.build(asHtml(wrapper), SESSION);

    expect(
      findAll(wrapper, 'agents-line').map((line) => line.dataset.layout),
    ).toEqual(['default', 'default']);
    expect(wrapper.children).toHaveLength(2);
  });
});
