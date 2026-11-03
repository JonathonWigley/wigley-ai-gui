import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { HScroller } from '../../../shared/page/ui/h-scroller';
import type {
  Roster,
  RosterAgent,
  RosterOutcome,
  RosterTask,
} from '../../agents/contract';
import type { ComposerStopExits } from '../../chat/contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { createAgentStrip } from './agent-strip';

const NOW = 1_000_000;
const SESSION = 'row-1';
const EMPTY: Roster = { agents: [], tasks: [] };

function agent(
  agentId: string,
  ageMs: number,
  outcome: RosterOutcome = 'running',
  toolCount = 1,
): RosterAgent {
  return {
    agentId,
    agentType: 'Explore',
    name: `name-${agentId}`,
    description: `Task of ${agentId}`,
    startedAt: NOW - ageMs,
    model: null,
    effort: null,
    spendUsd: null,
    tools: Array.from({ length: toolCount }, (_, i) => ({
      toolUseId: `${agentId}-tool-${i + 1}`,
      tool: 'Read',
      summary: `file-${i + 1}.ts`,
      outcome: 'done',
    })),
    outcome,
  };
}

function task(
  taskId: string,
  ageMs: number,
  outcome: RosterOutcome = 'running',
): RosterTask {
  return {
    taskId,
    agentId: MAIN_AGENT_ID,
    description: `Run ${taskId}`,
    command: null,
    startedAt: NOW - ageMs,
    outcome,
  };
}

// A done subagent, then a running one, then a running task, 30 s old.
const MIXED: Roster = {
  agents: [agent('a1', 90_000, 'done'), agent('a2', 60_000)],
  tasks: [task('t1', 30_000)],
};

// Three running subagents, oldest first.
const THREE_AGENTS: Roster = {
  agents: [agent('a1', 90_000), agent('a2', 60_000), agent('a3', 30_000)],
  tasks: [],
};

// A scroller double whose track is a plain fake element: `reveals` holds each
// revealed item, `refreshes` counts each refresh, `disposed` each disposed
// scroller.
function fakeScrollers() {
  const made: { scroller: HScroller; disposed: boolean }[] = [];
  const reveals: HTMLElement[] = [];
  let refreshes = 0;
  const create = (): HScroller => {
    const element = new FakeElement('div');
    const track = new FakeElement('div');
    element.append(track);
    const entry = {
      scroller: {
        element: asHtml(element),
        track: asHtml(track),
        reveal: (item: HTMLElement) => reveals.push(item),
        refresh: () => {
          refreshes += 1;
        },
        dispose: () => {
          entry.disposed = true;
        },
      },
      disposed: false,
    };
    made.push(entry);
    return entry.scroller;
  };
  return { create, made, reveals, refreshes: () => refreshes };
}

// A strip over agents whose rosters `setRoster` changes, announcing each
// change; timers record each `set` and `clear`; `exits` records each exit
// called; every session is named `proj`.
function setUp(initial: Roster = EMPTY) {
  let now = NOW;
  const rosters = new Map<string, Roster>([[SESSION, initial]]);
  const listeners: ((sessionId: string) => void)[] = [];
  const sets: { run: () => void; handle: number }[] = [];
  const clears: number[] = [];
  const logged: string[] = [];
  const exitCalls: string[] = [];
  let scopeSets = 0;
  const scrollers = fakeScrollers();
  const strip = createAgentStrip({
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
    agents: {
      roster: (sessionId) => rosters.get(sessionId) ?? EMPTY,
      onRosterChanged(listener) {
        listeners.push(listener);
        return { dispose: () => undefined };
      },
    },
    setScope: () => {
      scopeSets += 1;
    },
    nameOf: () => 'proj',
    createScroller: scrollers.create,
  });
  const exits: ComposerStopExits = {
    toEntries: () => exitCalls.push('toEntries'),
    toBox: (how) => exitCalls.push(`toBox ${how}`),
  };
  const wrapper = new FakeElement('div');
  const setRoster = (roster: Roster) => {
    rosters.set(SESSION, roster);
    for (const listener of listeners) {
      listener(SESSION);
    }
  };
  const build = () => strip.part.build(asHtml(wrapper), SESSION);
  const enter = () => strip.part.stop!.enter(SESSION, exits);
  const boxes = () => findAll(wrapper, 'agent-strip-box');
  const selected = () =>
    boxes().flatMap((box, index) =>
      box.classList.contains('is-selected') ? [index] : [],
    );
  const opened = () =>
    boxes().flatMap((box, index) =>
      box.classList.contains('is-open') ? [index] : [],
    );
  return {
    strip,
    wrapper,
    sets,
    clears,
    logged,
    exitCalls,
    scopeSets: () => scopeSets,
    scrollers,
    setRoster,
    build,
    enter,
    boxes,
    selected,
    opened,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agent strip', () => {
  it('enter_NoBoxes_ReturnsFalse', () => {
    const { build, enter, scopeSets, logged, wrapper } = setUp();
    build();

    const entered = enter();

    expect(entered).toBe(false);
    expect(scopeSets()).toBe(0);
    expect(logged).toEqual([]);
    expect(wrapper.children).toEqual([]);
  });

  it('enter_WithBoxes_SelectsAndSetsScope', () => {
    const { build, enter, scopeSets, logged, selected, boxes, scrollers } =
      setUp(MIXED);
    build();

    const entered = enter();

    expect(entered).toBe(true);
    expect(scopeSets()).toBe(1);
    expect(selected()).toEqual([1]);
    expect(scrollers.reveals).toEqual([boxes()[1]]);
    expect(logged.at(-1)).toBe('[agent-strip] selected box 2 of 3 in proj');
  });

  it.each<{ key: string; leave: 'leave' | 'insert' | 'append'; exit: string }>([
    { key: 'k', leave: 'leave', exit: 'toEntries' },
    { key: 'i', leave: 'insert', exit: 'toBox insert' },
    { key: 'a', leave: 'append', exit: 'toBox append' },
  ])('leave_HandsCursorBackThroughExits ($key)', ({ leave, exit }) => {
    const { strip, build, enter, exitCalls, selected, logged } = setUp(MIXED);
    build();
    enter();

    if (leave === 'leave') {
      strip.leave();
    } else {
      strip.toBox(leave);
    }
    strip.nextBox();

    expect(exitCalls).toEqual([exit]);
    expect(selected()).toEqual([]);
    expect(logged.at(-1)).toBe('[agent-strip] left strip in proj');
  });

  // `enter` selects box 2 of MIXED, a2; `revealed` is the box index each
  // reveal after the roster change scrolled to.
  it.each<{
    case: string;
    roster: Roster;
    selected: number[];
    revealed: number[];
    exitCalls: string[];
  }>([
    {
      case: 'empties: returns to entries',
      roster: EMPTY,
      selected: [],
      revealed: [],
      exitCalls: ['toEntries'],
    },
    {
      case: 'drops an earlier box: follows and reveals its box',
      roster: { ...MIXED, agents: MIXED.agents.slice(1) },
      selected: [0],
      revealed: [0],
      exitCalls: [],
    },
  ])('rosterChangedWhileSelected_$case', (row) => {
    const { build, enter, setRoster, exitCalls, scrollers, boxes, selected } =
      setUp(MIXED);
    build();
    enter();
    const revealsBefore = scrollers.reveals.length;

    setRoster(row.roster);

    expect(selected()).toEqual(row.selected);
    expect(scrollers.reveals.slice(revealsBefore)).toEqual(
      row.revealed.map((index) => boxes()[index]),
    );
    expect(exitCalls).toEqual(row.exitCalls);
  });

  it('toggleBox_DrawsToolListInOpenAgentBox', () => {
    const { strip, build, enter, boxes, opened } = setUp({
      agents: [agent('a1', 60_000, 'running', 5)],
      tasks: [],
    });
    build();
    enter();

    strip.toggleBox();

    expect(opened()).toEqual([0]);
    const lists = findAll(boxes()[0], 'agent-strip-toolList');
    expect(lists).toHaveLength(1);
    expect(
      findAll(lists[0], 'agent-strip-tool').map((line) => line.textContent),
    ).toEqual([
      'Read file-1.ts',
      'Read file-2.ts',
      'Read file-3.ts',
      'Read file-4.ts',
      'Read file-5.ts',
    ]);
  });

  it('tick_RunningTaskShown_RedrawsAndStopsWhenNone', () => {
    const { build, boxes, sets, clears, advance, setRoster } = setUp(MIXED);
    build();
    expect(sets).toHaveLength(1);
    const before = boxes()[2].textContent;

    advance(1000);
    sets[0].run();
    const afterTick = { text: boxes()[2].textContent, sets: sets.length };
    setRoster({ ...MIXED, tasks: [task('t1', 30_000, 'done')] });

    expect(before).toContain('main · 30s');
    expect(afterTick).toEqual({
      text: expect.stringContaining('main · 31s'),
      sets: 2,
    });
    expect(clears).toEqual([sets[1].handle]);
    expect(sets).toHaveLength(2);
  });

  it.each<{ part: keyof Layout }>([
    { part: 'agentBox' },
    { part: 'taskBox' },
    { part: 'toolList' },
  ])('build_UserLayoutThrows_DrawsDefault ($part)', ({ part }) => {
    const { strip, build, enter, wrapper, boxes } = setUp(MIXED);
    const throwing: Layout = {
      [part]() {
        throw new Error(`broken ${part}`);
      },
    };
    strip.setLayouts(withUser<Layout>(defaultLayout, throwing));
    build();
    enter();

    strip.toggleBox();

    expect(boxes().map((box) => box.dataset.layout)).toEqual([
      'default',
      'default',
      'default',
    ]);
    expect(
      findAll(wrapper, 'agent-strip-toolList').map(
        (list) => list.dataset.layout,
      ),
    ).toEqual(['default']);
  });

  it('prevBox_AtFirst_LogsNothing', () => {
    const { strip, build, enter, selected, logged } = setUp(THREE_AGENTS);
    build();
    enter();
    const loggedBefore = [...logged];

    strip.prevBox();

    expect(selected()).toEqual([0]);
    expect(logged).toEqual(loggedBefore);
  });

  it('toggleBox_OpensOneAtATime', () => {
    const { strip, build, enter, opened, selected, boxes, logged } =
      setUp(THREE_AGENTS);
    build();
    enter();

    strip.toggleBox();
    strip.nextBox();
    strip.toggleBox();
    const afterKeys = { opened: opened(), selected: selected() };
    boxes()[2].click();

    expect(afterKeys).toEqual({ opened: [1], selected: [1] });
    expect(opened()).toEqual([2]);
    expect(selected()).toEqual([1]);
    expect(logged.filter((line) => /opened|closed/.test(line))).toEqual([
      '[agent-strip] opened box 1 in proj',
      '[agent-strip] opened box 2 in proj',
      '[agent-strip] opened box 3 in proj',
    ]);
  });

  it('rosterDropsOpenBox_Closes', () => {
    const { build, boxes, opened, setRoster } = setUp(THREE_AGENTS);
    build();
    boxes()[0].click();

    setRoster({ ...THREE_AGENTS, agents: THREE_AGENTS.agents.slice(1) });
    const afterDrop = opened();
    setRoster(THREE_AGENTS);

    expect(afterDrop).toEqual([]);
    expect(opened()).toEqual([]);
  });

  it('stopLeave_ClearsWithoutScope', () => {
    const { strip, build, enter, selected, logged, scopeSets, exitCalls } =
      setUp(MIXED);
    build();
    enter();

    strip.part.stop!.leave(SESSION);
    strip.nextBox();

    expect(selected()).toEqual([]);
    expect(logged.at(-1)).toBe('[agent-strip] left strip in proj');
    expect(scopeSets()).toBe(1);
    expect(exitCalls).toEqual([]);
  });

  it('redraw_KeepsScrollerAndItsScrollLeft', () => {
    const { build, setRoster, sets, scrollers, wrapper } = setUp(MIXED);
    build();
    const first = scrollers.made[0].scroller;
    (first.track as unknown as { scrollLeft: number }).scrollLeft = 120;

    setRoster({ ...MIXED, agents: [...MIXED.agents, agent('a3', 10_000)] });
    sets[0].run();
    const kept = {
      made: scrollers.made.length,
      shown: wrapper.children,
      scrollLeft: (first.track as unknown as { scrollLeft: number }).scrollLeft,
    };
    setRoster(EMPTY);
    const emptied = {
      shown: [...wrapper.children],
      disposed: scrollers.made[0].disposed,
    };
    setRoster(MIXED);

    expect(kept).toEqual({
      made: 1,
      shown: [first.element],
      scrollLeft: 120,
    });
    expect(emptied).toEqual({ shown: [], disposed: true });
    expect(scrollers.made).toHaveLength(2);
    expect(wrapper.children).toEqual([scrollers.made[1].scroller.element]);
  });

  it.each<{ case: string; rosters: Roster[]; lines: string[] }>([
    { case: 'first empty draw logs nothing', rosters: [], lines: [] },
    {
      case: 'four then none logs the empty count',
      rosters: [
        { agents: THREE_AGENTS.agents, tasks: [task('t1', 5_000)] },
        EMPTY,
      ],
      lines: [
        '[agent-strip] boxes in proj: 4 (4 running)',
        '[agent-strip] boxes in proj: 0 (0 running)',
      ],
    },
    {
      case: 'unchanged text across a tick logs once',
      rosters: [MIXED, MIXED],
      lines: ['[agent-strip] boxes in proj: 3 (2 running)'],
    },
  ])('log_$case', ({ rosters, lines }) => {
    const { build, setRoster, sets, logged } = setUp();
    build();

    for (const roster of rosters) {
      setRoster(roster);
      sets.at(-1)?.run();
    }

    expect(logged.filter((line) => line.includes('boxes in'))).toEqual(lines);
  });

  it('log_LeftStripTwice_LogsTwice', () => {
    const { strip, build, enter, logged } = setUp(MIXED);
    build();

    enter();
    strip.leave();
    enter();
    strip.leave();

    expect(logged.filter((line) => line.includes('left strip'))).toEqual([
      '[agent-strip] left strip in proj',
      '[agent-strip] left strip in proj',
    ]);
  });
});
