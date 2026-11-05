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
import type {
  PageStage,
  SessionFlow,
  WorkflowActionRequest,
} from '../contract';
import { newFlow } from '../flow';
import defaultLayout from '../layouts/default/layout.js';
import type {
  Layout,
  MarkState,
  SidePaneInput,
  StripInput,
} from '../layouts/layout';
import type { PlanProgress } from '../plan-reader';
import { createStageList } from '../stage-list';
import { BUILT_IN_PAGE_STAGES } from '../stages';
import { createWorkflowView, type WorkflowView } from './workflow-view';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

const NO_SECTION = { setSummary: () => undefined };

// A section that records each summary set on it.
function recordingSection() {
  const summaries: (string | null)[] = [];
  return {
    summaries,
    setSummary: (text: string | null) => void summaries.push(text),
  };
}

const NOW = 1_000_000;
const PLAN_DIR = '/p/proj/docs/features/x/plan-x';

// A plan of `waves` tasks per wave (`[3, 3, 1]` is seven tasks over waves 1
// to 3), the first `checked` ticked; `wave` is the first wave holding an
// open box.
function progressOf(
  checked: number,
  waves: number[],
  reviewRounds = 0,
): PlanProgress {
  const tasks = waves.flatMap((count, index) =>
    Array.from({ length: count }, (_, at) => ({
      wave: index + 1,
      text: `task ${index + 1}.${at + 1}`,
      done: false,
    })),
  );
  tasks.forEach((task, index) => {
    task.done = index < checked;
  });
  return {
    checked,
    total: tasks.length,
    wave: tasks.find((task) => !task.done)?.wave ?? null,
    reviewRounds,
    title: 'Plan x',
    tasks,
  };
}

function flowIn(
  stage: string,
  fields: Partial<SessionFlow> = {},
  sessionId = 'a',
): SessionFlow {
  const isIdle = stage === 'idle';
  return {
    ...newFlow(sessionId, '/p/proj'),
    stage,
    planDir: isIdle ? null : PLAN_DIR,
    progress: isIdle ? null : progressOf(0, [3, 3, 1]),
    ...fields,
  };
}

const BUSY: Record<string, Partial<SessionFlow>> = {
  none: {},
  turn: { turnRunning: true },
  subagent: { runningSubagents: ['agent-1'] },
};

// A plan of `tasks`, `[wave, done]` each, its tasks named by position
// (`w3.2` is wave 3's second task; `t.1` the first under no wave heading).
function planOf(tasks: [wave: number | null, done: boolean][]): PlanProgress {
  const seen = new Map<number | null, number>();
  const lines = tasks.map(([wave, done]) => {
    const at = (seen.get(wave) ?? 0) + 1;
    seen.set(wave, at);
    return { wave, done, text: `${wave === null ? 't' : `w${wave}`}.${at}` };
  });
  return {
    checked: lines.filter((line) => line.done).length,
    total: lines.length,
    wave: lines.find((line) => !line.done)?.wave ?? null,
    reviewRounds: 0,
    title: 'Plan x',
    tasks: lines,
  };
}

// A view over the built-in page stages whose timers record each `set` (its
// handle the set's count) and each `clear`, whose channel records each
// `runAction`, and whose `nameOf` reads every session as `proj`. Every session
// in `previews` shows the preview.
function setUp(previews: readonly string[] = []) {
  let now = NOW;
  const sets: { run: () => void; handle: number }[] = [];
  const clears: number[] = [];
  const logged: string[] = [];
  const invoked: WorkflowActionRequest[] = [];
  const flows = new Map<string, SessionFlow>();
  let isFlowOfBroken = false;
  const stages = createStageList<PageStage>();
  for (const stage of BUILT_IN_PAGE_STAGES) {
    stages.add(stage);
  }
  const view = createWorkflowView({
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
    toast: () => undefined,
    paths: { join: (folder, ...segments) => [folder, ...segments].join('/') },
    stages,
    flowOf(sessionId) {
      if (isFlowOfBroken) {
        throw new Error('no flow');
      }
      return flows.get(sessionId) ?? newFlow(sessionId, '/p');
    },
    nameOf: () => 'proj',
    isPreview: (sessionId) => previews.includes(sessionId),
    openDoc: () => undefined,
    runAction: async (request) => {
      invoked.push(request);
    },
  });
  const put = (flow: SessionFlow) => {
    flows.set(flow.sessionId, flow);
    view.setFlow(flow);
  };
  const advance = (ms: number) => {
    now += ms;
  };
  const breakFlowOf = (broken: boolean) => {
    isFlowOfBroken = broken;
  };
  return {
    view,
    stages,
    put,
    breakFlowOf,
    advance,
    sets,
    clears,
    logged,
    invoked,
  };
}

// A user layout whose strip and side pane record each input they draw.
function recordingLayout() {
  const strips: StripInput[] = [];
  const sidePanes: SidePaneInput[] = [];
  const layout: Layout = {
    strip(parent, input, kit) {
      strips.push(input);
      return { element: kit.el(parent, 'div') };
    },
    sidePane(parent, input, kit) {
      sidePanes.push(input);
      return { element: kit.el(parent, 'div') };
    },
  };
  return { layout, strips, sidePanes };
}

function stepTexts(input: { steps: StripInput['steps'] }): string[] {
  return input.steps.map((step) => `${step.label}:${step.state}`);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Whether every BoxedElement has a layout box.
let hasBox = true;

// An element scrolled as a browser scrolls it: with no layout box it reports no
// client rect, reads `scrollTop` 0 and drops a write.
class BoxedElement extends FakeElement {
  private scrolled = 0;

  constructor(tagName: string) {
    super(tagName);
    Object.defineProperty(this, 'scrollTop', {
      get: () => (hasBox ? this.scrolled : 0),
      set: (value: number) => {
        if (hasBox) {
          this.scrolled = value;
        }
      },
    });
  }

  getClientRects() {
    return hasBox ? [this.getBoundingClientRect()] : [];
  }
}

// What a scroll row does to a side pane whose list scrolled to 120. `scrollTo`
// sets the list's value and fires its `scroll` event. `resize` runs the observers
// still observing, and `loseBox` and `regainBox` run them too, as a box coming or
// going reports; `boxBackUnreported` gives the box back before they report.
interface ScrollScene {
  view: WorkflowView;
  scrollTo(value: number): void;
  push(): void;
  resize(): void;
  loseBox(): void;
  regainBox(): void;
  boxBackUnreported(): void;
}

// Each ResizeObserver the code builds from here on: its callback and the
// elements it observes now.
function stubResizeObservers() {
  const observers: { callback: () => void; observed: Set<unknown> }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private record;
      constructor(callback: () => void) {
        this.record = { callback, observed: new Set<unknown>() };
        observers.push(this.record);
      }
      observe(target: unknown) {
        this.record.observed.add(target);
      }
      disconnect() {
        this.record.observed.clear();
      }
    },
  );
  return observers;
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
  hasBox = true;
  vi.stubGlobal('document', {
    createElement: (tag: string) => new BoxedElement(tag),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workflow view', () => {
  it.each([
    {
      stage: 'planReady',
      busy: 'none',
      countdownMs: null,
      fields: {},
      actions: ['clearAndMake:true', 'makeInNewSession:true'],
    },
    {
      stage: 'planReady',
      busy: 'turn',
      countdownMs: null,
      fields: {},
      actions: ['clearAndMake:false', 'makeInNewSession:true'],
    },
    {
      stage: 'planReady',
      busy: 'subagent',
      countdownMs: null,
      fields: {},
      actions: ['clearAndMake:false', 'makeInNewSession:true'],
    },
    {
      stage: 'planReady',
      busy: 'none',
      countdownMs: 10_000,
      fields: {},
      actions: [
        'cancelCountdown:true',
        'clearAndMake:true',
        'makeInNewSession:true',
      ],
    },
    {
      stage: 'make',
      busy: 'subagent',
      countdownMs: null,
      fields: { progress: progressOf(1, [3]) },
      actions: [],
    },
    {
      stage: 'feature',
      busy: 'none',
      countdownMs: null,
      fields: {},
      actions: [],
    },
    {
      stage: 'closed',
      busy: 'none',
      countdownMs: null,
      fields: {},
      actions: ['retro:true'],
    },
    {
      stage: 'primer',
      busy: 'none',
      countdownMs: null,
      fields: {},
      actions: [],
    },
  ])(
    'actions_TableOfFlows_ListsAvailableActionsMainFirst $stage $busy $countdownMs',
    ({ stage, busy, countdownMs, fields, actions }) => {
      const { view, put } = setUp();
      const recording = recordingLayout();
      view.setLayouts(withUser<Layout>(defaultLayout, recording.layout));
      view.stripPart.build(asHtml(new FakeElement('div')), 'a');

      put(
        flowIn(stage, {
          ...BUSY[busy],
          countdownEndsAt: countdownMs === null ? null : NOW + countdownMs,
          ...fields,
        }),
      );

      const drawn = recording.strips.at(-1)!.actions;
      expect(
        drawn.map((action) => `${action.command}:${action.enabled}`),
      ).toEqual(actions);
      expect(drawn.map((action) => action.main)).toEqual(
        actions.map((_, index) => index === 0),
      );
    },
  );

  it.each([
    {
      case: 'PlanReadyMainAction_RunsClearAndMake',
      flow: flowIn('planReady'),
      command: 'mainAction',
      invoked: [{ sessionId: 'a', command: 'clearAndMake' }],
      line: 'ran clearAndMake in proj',
    },
    {
      case: 'PlanReadyBusyMainAction_RunsNothing',
      flow: flowIn('planReady', { turnRunning: true }),
      command: 'mainAction',
      invoked: [],
      line: 'nothing to run for mainAction in proj',
    },
    {
      case: 'PlanReadyBusyMakeInNewSession_RunsIt',
      flow: flowIn('planReady', { turnRunning: true }),
      command: 'makeInNewSession',
      invoked: [{ sessionId: 'a', command: 'makeInNewSession' }],
      line: 'ran makeInNewSession in proj',
    },
    {
      case: 'MakeAllTickedResumeMake_RunsNothing',
      flow: flowIn('make', { progress: progressOf(3, [3]) }),
      command: 'resumeMake',
      invoked: [],
      line: 'nothing to run for resumeMake in proj',
    },
    {
      case: 'MakeResumeKey_RunsTheKeyOnlyAction',
      flow: flowIn('make', { progress: progressOf(1, [3]) }),
      command: 'resumeMake',
      invoked: [{ sessionId: 'a', command: 'resumeMake' }],
      line: 'ran resumeMake in proj',
    },
    {
      case: 'MakeMainAction_RunsNoKeyOnlyAction',
      flow: flowIn('make', { progress: progressOf(1, [3]) }),
      command: 'mainAction',
      invoked: [],
      line: 'nothing to run for mainAction in proj',
    },
    {
      case: 'IdleMainAction_RunsNothing',
      flow: flowIn('idle'),
      command: 'mainAction',
      invoked: [],
      line: 'nothing to run for mainAction in proj',
    },
    {
      case: 'PreviewMainAction_RunsNothing',
      flow: flowIn('planReady'),
      previews: ['a'],
      command: 'mainAction',
      invoked: [],
      line: 'preview runs nothing for mainAction',
    },
  ])('runFor_$case', async ({ flow, previews, command, invoked, line }) => {
    const run = setUp(previews);
    run.put(flow);

    await run.view.runFor('a', command);

    expect(run.invoked).toEqual(invoked);
    expect(run.logged.at(-1)).toBe(line);
  });

  it('button_ChipOfUnselectedSession_RunsForItsOwnSession', async () => {
    const { view, put, invoked } = setUp();
    const withButton: Layout = {
      chip(parent, input, kit) {
        const chip = kit.el(parent, 'div', 'button-chip');
        if (input.mainAction !== null) {
          kit.actionButton(chip, input.mainAction, { anchor: false });
        }
        return { element: chip };
      },
    };
    view.setLayouts(withUser<Layout>(defaultLayout, withButton));
    const chips = { a: new FakeElement('div'), b: new FakeElement('div') };
    put(flowIn('planReady', {}, 'a'));
    put(flowIn('planReady', {}, 'b'));
    view.chipPart.build(asHtml(chips.a), 'a');
    view.chipPart.build(asHtml(chips.b), 'b');
    let isStopped = false;

    findAll(chips.b, 'ui-button')[0].fire('click', {
      stopPropagation() {
        isStopped = true;
      },
    });
    await settle();

    expect(invoked).toEqual([{ sessionId: 'b', command: 'clearAndMake' }]);
    expect(isStopped).toBe(true);
  });

  it.each(['chip', 'strip'] as const)('%s_IdleFlow_DrawsNothing', (part) => {
    const { view, put } = setUp();
    const wrapper = new FakeElement('div');
    put(flowIn('idle'));

    const built = part === 'chip' ? view.chipPart : view.stripPart;
    built.build(asHtml(wrapper), 'a');

    expect(wrapper.children).toHaveLength(0);
  });

  it('log_SameStageRedrawn_LogsOnce', () => {
    const { view, put, logged } = setUp();
    const wrapper = asHtml(new FakeElement('div'));
    const flow = flowIn('planReady');

    put(flow);
    put(flow);
    view.chipPart.build(wrapper, 'a').dispose?.();
    view.chipPart.build(wrapper, 'a');
    put(flowIn('planReady', { progress: progressOf(1, [3, 3, 1]) }));

    expect(logged).toEqual([
      'proj shows planReady',
      'proj progress 0/7 wave 1',
      'proj progress 1/7 wave 1',
    ]);
  });

  it('tick_CountdownShown_RedrawsAndStopsWhenGone', () => {
    const { view, put, advance, sets, clears } = setUp();
    const wrapper = new FakeElement('div');
    view.stripPart.build(asHtml(wrapper), 'a');
    put(flowIn('planReady', { countdownEndsAt: NOW + 10_000 }));
    const before = findAll(wrapper, 'workflow-countdown')[0].textContent;
    const firstButton = findAll(wrapper, 'ui-button')[0].textContent;

    advance(1000);
    sets[0].run();
    const afterTick = {
      countdown: findAll(wrapper, 'workflow-countdown')[0].textContent,
      sets: sets.length,
    };
    put(flowIn('planReady'));

    expect(before).toBe('10s');
    expect(firstButton).toBe('Cancel');
    expect(afterTick).toEqual({ countdown: '9s', sets: 2 });
    expect(clears).toEqual([sets[1].handle]);
    expect(sets).toHaveLength(2);
    expect(findAll(wrapper, 'workflow-countdown')).toEqual([]);
  });

  it.each([
    {
      stage: 'primer',
      busy: 'none',
      steps: [
        'Primer:paused',
        'Make:pending',
        'Review:pending',
        'Close:pending',
      ],
    },
    {
      stage: 'feature',
      busy: 'turn',
      steps: [
        'Feature:running',
        'Make:pending',
        'Review:pending',
        'Close:pending',
      ],
    },
    {
      stage: 'planReady',
      busy: 'none',
      steps: ['Feature:done', 'Make:ready', 'Review:pending', 'Close:pending'],
    },
    {
      stage: 'make',
      busy: 'subagent',
      steps: [
        'Feature:done',
        'Make:running',
        'Review:pending',
        'Close:pending',
      ],
    },
    {
      stage: 'make',
      busy: 'none',
      steps: ['Feature:done', 'Make:paused', 'Review:pending', 'Close:pending'],
    },
    {
      stage: 'review',
      busy: 'turn',
      steps: ['Feature:done', 'Make:done', 'Review:running', 'Close:pending'],
    },
    {
      stage: 'closed',
      busy: 'none',
      steps: ['Feature:done', 'Make:done', 'Review:done', 'Close:done'],
    },
  ])(
    'steps_FlowIn_$stage_$busy_CarryThePinnedStates',
    ({ stage, busy, steps }) => {
      const { view, put } = setUp();
      const recording = recordingLayout();
      view.setLayouts(withUser<Layout>(defaultLayout, recording.layout));
      view.stripPart.build(asHtml(new FakeElement('div')), 'a');

      put(flowIn(stage, BUSY[busy]));

      expect(stepTexts(recording.strips.at(-1)!)).toEqual(steps);
    },
  );

  it('steps_StageOutsideTheStepper_LeavesEveryStepPending', () => {
    const { view, stages, put } = setUp();
    const recording = recordingLayout();
    view.setLayouts(withUser<Layout>(defaultLayout, recording.layout));
    view.stripPart.build(asHtml(new FakeElement('div')), 'a');
    stages.add({
      id: 'aside',
      label: 'Aside',
      inStepper: false,
      order: 35,
      actions: [],
      detail: () => '',
      status: () => 'running',
    });

    put(flowIn('aside'));

    expect(stepTexts(recording.strips.at(-1)!)).toEqual([
      'Feature:pending',
      'Make:pending',
      'Review:pending',
      'Close:pending',
    ]);
  });

  it('stepper_NoPlan_DrawsAMarkLabelAndStatusPerStep', () => {
    const { view, put } = setUp();
    const wrapper = new FakeElement('div');
    view.stripPart.build(asHtml(wrapper), 'a');

    put(flowIn('planReady', { progress: null }));

    expect(
      findAll(wrapper, 'workflow-step').map((step) => [
        step.dataset.state,
        findAll(step, 'workflow-mark')[0].dataset.state,
        findAll(step, 'workflow-step-label')[0].textContent,
        findAll(step, 'workflow-step-status')[0].textContent,
      ]),
    ).toEqual([
      ['done', 'done', 'Feature', 'done'],
      ['ready', 'ready', 'Make', 'ready'],
      ['pending', 'pending', 'Review', 'pending'],
      ['pending', 'pending', 'Close', 'pending'],
    ]);
  });

  it.each<{ state: MarkState; icon: string }>([
    { state: 'pending', icon: 'codicon-circle-large' },
    { state: 'running', icon: 'codicon-loading' },
    { state: 'ready', icon: 'codicon-play-circle' },
    { state: 'paused', icon: 'codicon-debug-pause' },
    { state: 'done', icon: 'codicon-pass-filled' },
  ])('statusMark_$state_DrawsItsCodiconAtTheClock', ({ state, icon }) => {
    const { view, put, advance } = setUp();
    const wrapper = new FakeElement('div');
    const drawsMark: Layout = {
      strip(parent, _input, kit) {
        const strip = kit.el(parent, 'div');
        kit.statusMark(strip, state);
        return { element: strip };
      },
    };
    view.setLayouts(withUser<Layout>(defaultLayout, drawsMark));
    view.stripPart.build(asHtml(wrapper), 'a');
    advance(2500);

    put(flowIn('make'));

    const mark = findAll(wrapper, 'workflow-mark')[0];
    expect(mark.dataset.state).toBe(state);
    expect(findAll(mark, icon)).toHaveLength(1);
    expect(mark.style['--workflow-mark-clock']).toBe('1002500ms');
  });

  it.each([
    {
      name: 'waves 1 and 2 done, 3 open, 4 and 5 later, make busy',
      stage: 'make',
      busy: 'turn',
      plan: planOf([
        [1, true],
        [2, true],
        [3, true],
        [3, false],
        [4, false],
        [5, false],
      ]),
      finishedWaves: [
        { title: 'Wave 1', tasks: [{ text: 'w1.1', state: 'done' }] },
        { title: 'Wave 2', tasks: [{ text: 'w2.1', state: 'done' }] },
      ],
      currentWave: {
        title: 'Wave 3',
        tasks: [
          { text: 'w3.1', state: 'done' },
          { text: 'w3.2', state: 'running' },
        ],
      },
      laterWaves: [
        { title: 'Wave 4', tasks: [{ text: 'w4.1', state: 'pending' }] },
        { title: 'Wave 5', tasks: [{ text: 'w5.1', state: 'pending' }] },
      ],
    },
    {
      name: 'make not busy',
      stage: 'make',
      busy: 'none',
      plan: planOf([
        [3, false],
        [4, false],
      ]),
      finishedWaves: [],
      currentWave: {
        title: 'Wave 3',
        tasks: [{ text: 'w3.1', state: 'paused' }],
      },
      laterWaves: [
        { title: 'Wave 4', tasks: [{ text: 'w4.1', state: 'pending' }] },
      ],
    },
    {
      name: 'review busy runs no tasks',
      stage: 'review',
      busy: 'turn',
      plan: planOf([[3, false]]),
      finishedWaves: [],
      currentWave: {
        title: 'Wave 3',
        tasks: [{ text: 'w3.1', state: 'pending' }],
      },
      laterWaves: [],
    },
    {
      name: 'a done wave after an open wave is finished',
      stage: 'make',
      busy: 'none',
      plan: planOf([
        [1, false],
        [2, true],
        [3, false],
        [3, true],
      ]),
      finishedWaves: [
        { title: 'Wave 2', tasks: [{ text: 'w2.1', state: 'done' }] },
      ],
      currentWave: {
        title: 'Wave 1',
        tasks: [{ text: 'w1.1', state: 'paused' }],
      },
      laterWaves: [
        {
          title: 'Wave 3',
          tasks: [
            { text: 'w3.1', state: 'pending' },
            { text: 'w3.2', state: 'done' },
          ],
        },
      ],
    },
    {
      name: 'boxes under no wave heading are the current wave',
      stage: 'make',
      busy: 'turn',
      plan: planOf([
        [null, true],
        [null, false],
      ]),
      finishedWaves: [],
      currentWave: {
        title: 'Tasks',
        tasks: [
          { text: 't.1', state: 'done' },
          { text: 't.2', state: 'running' },
        ],
      },
      laterWaves: [],
    },
    {
      name: 'groups in the order they first appear, split boxes joined',
      stage: 'make',
      busy: 'none',
      plan: planOf([
        [null, false],
        [2, false],
        [1, false],
        [2, true],
      ]),
      finishedWaves: [],
      currentWave: {
        title: 'Tasks',
        tasks: [{ text: 't.1', state: 'paused' }],
      },
      laterWaves: [
        {
          title: 'Wave 2',
          tasks: [
            { text: 'w2.1', state: 'pending' },
            { text: 'w2.2', state: 'done' },
          ],
        },
        { title: 'Wave 1', tasks: [{ text: 'w1.1', state: 'pending' }] },
      ],
    },
    {
      name: 'every wave finished',
      stage: 'make',
      busy: 'none',
      plan: planOf([
        [1, true],
        [2, true],
      ]),
      finishedWaves: [
        { title: 'Wave 1', tasks: [{ text: 'w1.1', state: 'done' }] },
        { title: 'Wave 2', tasks: [{ text: 'w2.1', state: 'done' }] },
      ],
      currentWave: null,
      laterWaves: [],
    },
  ])(
    'side pane groups the plan and states its tasks: $name',
    ({ stage, busy, plan, finishedWaves, currentWave, laterWaves }) => {
      const { view, put } = setUp();
      const recording = recordingLayout();
      view.setLayouts(withUser<Layout>(defaultLayout, recording.layout));
      view.sidePart.build(asHtml(new FakeElement('div')), 'a', NO_SECTION);

      put(flowIn(stage, { ...BUSY[busy], progress: plan }));

      const input = recording.sidePanes.at(-1)!;
      expect({
        finishedWaves: input.finishedWaves,
        currentWave: input.currentWave,
        laterWaves: input.laterWaves,
      }).toEqual({ finishedWaves, currentWave, laterWaves });
    },
  );

  it.each([
    {
      name: 'a plan at 5 of 7',
      flow: flowIn('make', { progress: progressOf(5, [3, 3, 1]) }),
      hidden: false,
      panes: 1,
      summaries: ['5/7'],
    },
    {
      name: 'a plan with no box ticked',
      flow: flowIn('make', { progress: progressOf(0, [3, 3, 1]) }),
      hidden: false,
      panes: 1,
      summaries: ['0/7'],
    },
    {
      name: 'a plan with no boxes',
      flow: flowIn('make', { progress: progressOf(0, []) }),
      hidden: false,
      panes: 1,
      summaries: [null],
    },
    {
      name: 'idle',
      flow: flowIn('idle', { progress: progressOf(1, [3]) }),
      hidden: false,
      panes: 0,
      summaries: [null],
    },
    {
      name: 'no plan read',
      flow: flowIn('make', { progress: null }),
      hidden: false,
      panes: 0,
      summaries: [null],
    },
    {
      name: 'hidden',
      flow: flowIn('make'),
      hidden: true,
      panes: 0,
      summaries: [null],
    },
  ])(
    'side pane draws and sets its summary only with a plan and while shown: $name',
    ({ flow, hidden, panes, summaries }) => {
      const { view, put } = setUp();
      const wrapper = new FakeElement('div');
      const section = recordingSection();
      view.setSidePaneHidden(hidden);
      put(flow);

      view.sidePart.build(asHtml(wrapper), 'a', section);

      expect(wrapper.children).toHaveLength(panes);
      expect(section.summaries).toEqual(summaries);
    },
  );

  it('setSidePaneHidden_HiddenThenShown_RemovesAndDrawsThePane', () => {
    const { view, put } = setUp();
    const wrapper = new FakeElement('div');
    const section = recordingSection();
    put(flowIn('make', { progress: progressOf(5, [3, 3, 1]) }));
    view.sidePart.build(asHtml(wrapper), 'a', section);
    const paneCount = () => findAll(wrapper, 'workflow-side-pane').length;
    const first = paneCount();

    view.setSidePaneHidden(true);
    const whileHidden = wrapper.children.length;
    view.setSidePaneHidden(false);

    expect([first, whileHidden, paneCount()]).toEqual([1, 0, 1]);
    expect(section.summaries).toEqual(['5/7', null, '5/7']);
  });

  it.each<{
    name: string;
    act(scene: ScrollScene): void;
    scroll: number;
  }>([
    {
      name: 'a flow pushed while it has a box',
      act: ({ push }) => push(),
      scroll: 120,
    },
    {
      name: 'flows pushed with no box, then the box back',
      act: ({ push, loseBox, regainBox }) => {
        loseBox();
        push();
        push();
        regainBox();
      },
      scroll: 120,
    },
    {
      name: 'a flow pushed with the box back before the observer reports',
      act: ({ push, resize, loseBox, boxBackUnreported }) => {
        loseBox();
        push();
        boxBackUnreported();
        push();
        resize();
      },
      scroll: 120,
    },
    {
      name: 'a scroll event with no box',
      act: ({ scrollTo, push, loseBox, regainBox }) => {
        loseBox();
        scrollTo(50);
        push();
        regainBox();
      },
      scroll: 120,
    },
    {
      name: 'hidden then shown',
      act: ({ view }) => {
        view.setSidePaneHidden(true);
        view.setSidePaneHidden(false);
      },
      scroll: 120,
    },
    {
      name: 'hidden, a flow pushed with no box, shown, then the box back',
      act: ({ view, push, loseBox, regainBox }) => {
        view.setSidePaneHidden(true);
        loseBox();
        push();
        view.setSidePaneHidden(false);
        regainBox();
      },
      scroll: 120,
    },
    {
      name: 'a resize after a scroll',
      act: ({ scrollTo, resize }) => {
        scrollTo(300);
        resize();
      },
      scroll: 300,
    },
  ])('sidePane_ListKeepsItsScroll: $name', ({ act, scroll }) => {
    const { view, put } = setUp();
    const observers = stubResizeObservers();
    const wrapper = new FakeElement('div');
    put(flowIn('make'));
    view.sidePart.build(asHtml(wrapper), 'a', NO_SECTION);
    const sideList = () => findAll(wrapper, 'workflow-side-list')[0];
    const scrollTo = (value: number) => {
      sideList().scrollTop = value;
      sideList().fire('scroll');
    };
    scrollTo(120);
    const resize = () => {
      for (const observer of observers) {
        if (observer.observed.size > 0) {
          observer.callback();
        }
      }
    };
    let checked = 1;

    act({
      view,
      scrollTo,
      push: () => {
        checked += 1;
        put(flowIn('make', { progress: progressOf(checked, [3, 3, 1]) }));
      },
      resize,
      loseBox: () => {
        hasBox = false;
        resize();
      },
      regainBox: () => {
        hasBox = true;
        resize();
      },
      boxBackUnreported: () => {
        hasBox = true;
      },
    });

    expect(sideList().scrollTop).toBe(scroll);
  });

  it('sidePane_Disposed_StopsObservingItsWrapper', () => {
    const { view, put } = setUp();
    const observers = stubResizeObservers();
    const wrapper = new FakeElement('div');
    put(flowIn('make'));
    const built = view.sidePart.build(asHtml(wrapper), 'a', NO_SECTION);
    const whileHeld = observers.flatMap((each) => [...each.observed]);

    built.dispose?.();

    expect(whileHeld).toEqual([wrapper]);
    expect(observers.flatMap((each) => [...each.observed])).toEqual([]);
  });

  it.each<{
    name: string;
    previews?: string[];
    flow?: SessionFlow;
    hidden?: boolean;
    act(view: WorkflowView): void | Promise<void>;
    open: { a: boolean; b: boolean };
    line: string;
  }>([
    {
      name: 'a toggle opens only its session',
      act: (view) => view.toggleFinishedWaves('a'),
      open: { a: true, b: false },
      line: 'finished waves open in proj',
    },
    {
      name: 'a second toggle folds it',
      act: (view) => {
        view.toggleFinishedWaves('a');
        view.toggleFinishedWaves('a');
      },
      open: { a: false, b: false },
      line: 'finished waves folded in proj',
    },
    {
      name: 'forget drops it',
      act: (view) => {
        view.toggleFinishedWaves('a');
        view.forget('a');
        view.redraw();
      },
      open: { a: false, b: false },
      line: 'finished waves open in proj',
    },
    {
      name: 'a preview session flips it through runFor',
      previews: ['a'],
      act: (view) => view.runFor('a', 'toggleFinishedWaves'),
      open: { a: true, b: false },
      line: 'finished waves open in proj',
    },
    {
      name: 'no finished waves leaves it',
      flow: flowIn('make', { progress: progressOf(0, [1, 1]) }),
      act: (view) => view.toggleFinishedWaves('a'),
      open: { a: false, b: false },
      line: 'nothing to run for toggleFinishedWaves in proj',
    },
    {
      name: 'a hidden pane leaves it',
      hidden: true,
      act: (view) => view.toggleFinishedWaves('a'),
      open: { a: false, b: false },
      line: 'nothing to run for toggleFinishedWaves in proj',
    },
    {
      name: 'no plan read leaves it',
      flow: flowIn('make', { progress: null }),
      act: (view) => view.toggleFinishedWaves('a'),
      open: { a: false, b: false },
      line: 'nothing to run for toggleFinishedWaves in proj',
    },
    {
      name: 'idle leaves it',
      flow: flowIn('idle', { progress: progressOf(1, [1, 1]) }),
      act: (view) => view.toggleFinishedWaves('a'),
      open: { a: false, b: false },
      line: 'nothing to run for toggleFinishedWaves in proj',
    },
  ])('the fold is kept per session: $name', async (row) => {
    const { view, put, logged } = setUp(row.previews);
    const recording = recordingLayout();
    view.setLayouts(withUser<Layout>(defaultLayout, recording.layout));
    const planTitled = (title: string) => ({
      progress: { ...progressOf(1, [1, 1]), title },
    });
    put(row.flow ?? flowIn('make', planTitled('a'), 'a'));
    put(flowIn('make', planTitled('b'), 'b'));
    view.sidePart.build(asHtml(new FakeElement('div')), 'a', NO_SECTION);
    view.sidePart.build(asHtml(new FakeElement('div')), 'b', NO_SECTION);
    view.setSidePaneHidden(row.hidden ?? false);

    await row.act(view);
    const line = logged.at(-1);
    view.setSidePaneHidden(false);
    put(flowIn('make', planTitled('a'), 'a'));

    expect(line).toBe(row.line);
    const { open } = row;
    const lastOpen = (title: string) =>
      recording.sidePanes.filter((input) => input.planTitle === title).at(-1)!
        .finishedOpen;
    expect({ a: lastOpen('a'), b: lastOpen('b') }).toEqual(open);
  });

  it('finishedFold_Click_OpensItsSessionsWavesAndStatesIt', async () => {
    const { view, put } = setUp();
    const wrapper = new FakeElement('div');
    put(flowIn('make', { progress: progressOf(1, [1, 1]) }));
    view.sidePart.build(asHtml(wrapper), 'a', NO_SECTION);
    const fold = () => findAll(wrapper, 'workflow-finished-fold')[0];
    const closed = {
      text: fold().textContent,
      expanded: fold().attributes.get('aria-expanded'),
    };

    fold().click();
    await settle();

    expect(closed).toEqual({
      text: '▸ 1 wave · 1 done',
      expanded: 'false',
    });
    expect(fold().textContent).toBe('▾ 1 wave · 1 done');
    expect(fold().attributes.get('aria-expanded')).toBe('true');
  });

  it('registry_StageAddedOutOfOrder_SortsOnOrder', () => {
    const { view, stages, put } = setUp();
    const recording = recordingLayout();
    view.setLayouts(withUser<Layout>(defaultLayout, recording.layout));
    view.stripPart.build(asHtml(new FakeElement('div')), 'a');
    const checking: PageStage = {
      id: 'checking',
      label: 'Checking',
      inStepper: true,
      order: 35,
      actions: [],
      detail: () => '',
      status: () => null,
    };

    stages.add(checking);
    put(flowIn('make', { progress: progressOf(1, [3]) }));

    expect(recording.strips.at(-1)!.steps.map((step) => step.label)).toEqual([
      'Feature',
      'Checking',
      'Make',
      'Review',
      'Close',
    ]);
  });

  it('chip_UserLayoutThrows_DrawsWithDefault', () => {
    const { view, put } = setUp();
    const wrapper = new FakeElement('div');
    const throwing: Layout = {
      chip() {
        throw new Error('broken chip');
      },
    };
    view.setLayouts(withUser<Layout>(defaultLayout, throwing));
    put(flowIn('planReady'));

    view.chipPart.build(asHtml(wrapper), 'a');

    expect(
      findAll(wrapper, 'workflow-chip').map((chip) => chip.dataset.layout),
    ).toEqual(['default']);
    expect(wrapper.children).toHaveLength(1);
  });

  it('hold_FirstDrawThrows_LetsThePartGo', () => {
    const { view, put, breakFlowOf } = setUp();
    const body = new FakeElement('div');
    put(flowIn('planReady'));
    breakFlowOf(true);

    expect(() => view.sidePart.build(asHtml(body), 'a', NO_SECTION)).toThrow(
      'no flow',
    );
    breakFlowOf(false);
    put(flowIn('make', { progress: progressOf(1, [3]) }));

    expect(body.children).toEqual([]);
  });
});
