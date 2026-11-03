import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import {
  recordingAnchors,
  USER_LAYOUT,
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
const OTHER_SESSION = 'row-2';
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

// The indexes of the boxes in `wrapper` that carry `className`.
function boxesWith(wrapper: FakeElement, className: string): number[] {
  return findAll(wrapper, 'agent-strip-box').flatMap((box, index) =>
    box.classList.contains(className) ? [index] : [],
  );
}

// A strip over agents whose rosters `setRoster` changes, announcing each
// change; timers record each `set` and `clear`; `exits` records each exit
// called; every session is named `proj`; `onSetScope` runs on each scope set.
// `OTHER_SESSION` lists `initial` too and never changes.
function setUp(initial: Roster = EMPTY, onSetScope: () => void = () => {}) {
  let now = NOW;
  const rosters = new Map<string, Roster>([
    [SESSION, initial],
    [OTHER_SESSION, initial],
  ]);
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
    log: (...parts: string[]) => logged.push(parts.at(-1) ?? ''),
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
      onSetScope();
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
  const selected = () => boxesWith(wrapper, 'is-selected');
  const opened = () => boxesWith(wrapper, 'is-open');
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
    expect(logged.at(-1)).toBe('selected box 2 of 3 in proj');
  });

  // `calls` holds the other session's exits and every scope set, in order.
  it('enter_WhileOtherSessionSelected_HandsItsCursorBack', () => {
    const calls: string[] = [];
    const { strip, build, enter, exitCalls, selected } = setUp(MIXED, () =>
      calls.push('setScope'),
    );
    build();
    const otherWrapper = new FakeElement('div');
    strip.part.build(asHtml(otherWrapper), OTHER_SESSION);
    strip.part.stop!.enter(OTHER_SESSION, {
      toEntries: () => calls.push('toEntries'),
      toBox: (how) => calls.push(`toBox ${how}`),
    });
    const callsBefore = calls.length;

    enter();

    expect({
      calls: calls.slice(callsBefore),
      otherSelected: boxesWith(otherWrapper, 'is-selected'),
      selected: selected(),
      exitCalls,
    }).toEqual({
      calls: ['toEntries', 'setScope'],
      otherSelected: [],
      selected: [1],
      exitCalls: [],
    });
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
    expect(logged.at(-1)).toBe('left strip in proj');
  });

  // `enter` selects box 2 of MIXED, a2; `revealed` is the box index each
  // reveal after the roster change scrolled to; `nextBox` is what `nextBox`
  // logs after the change, nothing once the selection is gone.
  it.each<{
    case: string;
    roster: Roster;
    selected: number[];
    revealed: number[];
    exitCalls: string[];
    nextBox: string[];
  }>([
    {
      case: 'empties: returns to entries',
      roster: EMPTY,
      selected: [],
      revealed: [],
      exitCalls: ['toEntries'],
      nextBox: [],
    },
    {
      case: 'drops an earlier box: follows and reveals its box',
      roster: { ...MIXED, agents: MIXED.agents.slice(1) },
      selected: [0],
      revealed: [0],
      exitCalls: [],
      nextBox: ['selected box 2 of 2 in proj'],
    },
    {
      case: 'adds a later box: keeps its place unrevealed',
      roster: { ...MIXED, agents: [...MIXED.agents, agent('a3', 10_000)] },
      selected: [1],
      revealed: [],
      exitCalls: [],
      nextBox: ['selected box 3 of 4 in proj'],
    },
  ])('rosterChangedWhileSelected_$case', (row) => {
    const {
      strip,
      build,
      enter,
      setRoster,
      exitCalls,
      scrollers,
      boxes,
      selected,
      logged,
    } = setUp(MIXED);
    build();
    enter();
    const revealsBefore = scrollers.reveals.length;

    setRoster(row.roster);
    const afterChange = {
      selected: selected(),
      revealed: scrollers.reveals
        .slice(revealsBefore)
        .map((element) => boxes().findIndex((box) => asHtml(box) === element)),
      loggedCount: logged.length,
    };
    strip.nextBox();

    expect(afterChange.selected).toEqual(row.selected);
    expect(afterChange.revealed).toEqual(row.revealed);
    expect(exitCalls).toEqual(row.exitCalls);
    expect(logged.slice(afterChange.loggedCount)).toEqual(row.nextBox);
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

  // Box 1 of MIXED, a2, is open; box 2 is the running task. A layout whose
  // taskBox has no `update`, or an `update` that throws, gets that box drawn
  // again in its place each tick; the throw is logged once. Each tick
  // refreshes the scroller once.
  it.each<{
    case: string;
    update: 'none' | 'throws' | null;
    taskBoxKept: boolean;
    updateFailures: string[];
  }>([
    {
      case: 'default updates the task box in place',
      update: null,
      taskBoxKept: true,
      updateFailures: [],
    },
    {
      case: 'a taskBox with no update is replaced',
      update: 'none',
      taskBoxKept: false,
      updateFailures: [],
    },
    {
      case: 'a throwing update is logged once and replaced',
      update: 'throws',
      taskBoxKept: false,
      updateFailures: [
        `layout ${USER_LAYOUT} taskBox update failed: broken update`,
      ],
    },
  ])('tick_RunningTaskShown_$case', (row) => {
    const {
      strip,
      build,
      boxes,
      sets,
      clears,
      advance,
      setRoster,
      logged,
      scrollers,
    } = setUp(MIXED);
    if (row.update !== null) {
      const update = row.update;
      const userTaskBox: Layout = {
        taskBox: (parent, input, kit) => ({
          element: defaultLayout.taskBox(parent, input, kit).element,
          ...(update === 'throws' && {
            update() {
              throw new Error('broken update');
            },
          }),
        }),
      };
      strip.setLayouts(withUser<Layout>(defaultLayout, userTaskBox));
    }
    build();
    boxes()[1].click();
    expect(sets).toHaveLength(1);
    const before = boxes();
    const toolList = findAll(before[1], 'agent-strip-toolList')[0];
    const beforeText = before[2].textContent;
    const refreshesBefore = scrollers.refreshes();

    const texts: (string | null)[] = [];
    for (const index of [0, 1]) {
      advance(1000);
      sets[index].run();
      texts.push(boxes()[2].textContent);
    }
    const after = boxes();
    const afterTicks = {
      agentBoxesKept: [after[0] === before[0], after[1] === before[1]],
      toolListKept: findAll(after[1], 'agent-strip-toolList')[0] === toolList,
      taskBoxKept: after[2] === before[2],
      texts,
      refreshes: scrollers.refreshes() - refreshesBefore,
      updateFailures: logged.filter((line) => line.includes('update failed')),
      sets: sets.length,
    };
    setRoster({ ...MIXED, tasks: [task('t1', 30_000, 'done')] });

    expect(beforeText).toContain('main · 30s');
    expect(afterTicks).toEqual({
      agentBoxesKept: [true, true],
      toolListKept: true,
      taskBoxKept: row.taskBoxKept,
      texts: [
        expect.stringContaining('main · 31s'),
        expect.stringContaining('main · 32s'),
      ],
      refreshes: 2,
      updateFailures: row.updateFailures,
      sets: 3,
    });
    expect(clears).toEqual([sets[2].handle]);
    expect(sets).toHaveLength(3);
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
      'opened box 1 in proj',
      'opened box 2 in proj',
      'opened box 3 in proj',
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
    expect(logged.at(-1)).toBe('left strip in proj');
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
      lines: ['boxes in proj: 4 (4 running)', 'boxes in proj: 0 (0 running)'],
    },
    {
      case: 'unchanged text across a tick logs once',
      rosters: [MIXED, MIXED],
      lines: ['boxes in proj: 3 (2 running)'],
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
      'left strip in proj',
      'left strip in proj',
    ]);
  });
});
