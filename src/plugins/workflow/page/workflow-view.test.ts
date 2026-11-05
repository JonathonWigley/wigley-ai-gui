import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShownLayouts } from '../../../contracts/plugin';
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
import type { RowActivity } from '../../sessions/contract';
import type {
  ChipInput,
  PagePluginApi,
  PageStage,
  PageWorkflow,
  SessionFlow,
  StageActionSpec,
  WorkflowActionRequest,
  WorkflowDraw,
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
import { workflowManifest } from '../manifest';
import { BUILT_IN_PAGE_STAGES } from '../stages';
import {
  HEAVY_WORKFLOW_ID,
  type HeavyState,
  withHeavyState,
} from '../stages/heavy-contract';
import { heavyPageWorkflow } from '../stages/heavy-page-workflow';
import { createWorkflowDraw } from './layout/workflow-draw';
import { createWorkflowKit } from './layout/workflow-kit';
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

type FlowFields = Partial<SessionFlow & HeavyState>;

function flowIn(
  stage: string,
  fields: FlowFields = {},
  sessionId = 'a',
): SessionFlow {
  const isIdle = stage === 'idle';
  const { planDir, progress, reviewRoundsAtMake, countdownEndsAt, ...flow } =
    fields;
  return withHeavyState(
    {
      ...newFlow(sessionId, '/p/proj'),
      workflow: HEAVY_WORKFLOW_ID,
      stage,
      ...flow,
    },
    {
      planDir: planDir === undefined ? (isIdle ? null : PLAN_DIR) : planDir,
      progress:
        progress === undefined
          ? isIdle
            ? null
            : progressOf(0, [3, 3, 1])
          : progress,
      reviewRoundsAtMake: reviewRoundsAtMake ?? null,
      countdownEndsAt: countdownEndsAt ?? null,
    },
  );
}

const BUSY: Record<string, FlowFields> = {
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

const KIT_SERVICES = {
  markdown: {
    block: (text: string) => text,
    inline: (text: string) => text,
    document: async (text: string) => text,
    ...NO_FENCES,
  },
  keys: recordingAnchors().keys,
  commands: { exists: () => true, run: () => undefined },
  platform: 'macos' as const,
};

// A view holding Heavy over the built-in page stages, whose timers record each
// `set` (its handle the set's count) and each `clear`, whose Heavy records each
// main action, and whose `nameOf` reads every session as `proj`. `workflows` is
// what the view reads; `sidePart` is Heavy's. `setLayouts` is Heavy's draw's. Every
// session in `previews` shows the preview.
function setUp(previews: readonly string[] = []) {
  let now = NOW;
  const sets: { run: () => void; handle: number }[] = [];
  const clears: number[] = [];
  const logged: string[] = [];
  const invoked: WorkflowActionRequest[] = [];
  const toasts: string[] = [];
  const flows = new Map<string, SessionFlow>();
  const rowActivities = new Map<string, RowActivity | null>();
  let isFlowOfBroken = false;
  const stages = createStageList<PageStage>();
  for (const stage of BUILT_IN_PAGE_STAGES) {
    stages.add(stage);
  }
  const workflows: PageWorkflow[] = [];
  const view = createWorkflowView({
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
    toast: (text) => toasts.push(text),
    workflows: { all: () => workflows },
    flowOf(sessionId) {
      if (isFlowOfBroken) {
        throw new Error('no flow');
      }
      return flows.get(sessionId) ?? newFlow(sessionId, '/p');
    },
    nameOf: () => 'proj',
    isPreview: (sessionId) => previews.includes(sessionId),
    setRowActivity: (sessionId, activity) =>
      rowActivities.set(sessionId, activity),
  });
  let setLayouts: (shown: ShownLayouts<Layout>) => void = () => undefined;
  const fakeApi: PagePluginApi = {
    layouts: {
      show(options) {
        setLayouts = options.setLayouts as unknown as typeof setLayouts;
        return { refresh: () => undefined, dispose: () => undefined };
      },
    },
  };
  const heavy: PageWorkflow = {
    ...heavyPageWorkflow({
      draw: createWorkflowDraw(
        {
          kit: KIT_SERVICES,
          log: (line: string) => logged.push(line),
          clock: { now: () => now },
          redraw: () => view.redraw(),
        },
        fakeApi,
        {
          manifest: workflowManifest,
          defaultLayout,
          defaultStylesheet: '',
          userLayout: () => 'default',
          sideTitle: 'Plan',
        },
      ),
      runMainAction: async (sessionId, command) => {
        invoked.push({ sessionId, command });
      },
      openDoc: () => undefined,
      join: (a, b) => `${a}/${b}`,
      autoStartSeconds: () => 10,
    }),
    stages: stages.all(),
  };
  workflows.push(heavy);
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
    sidePart: view.sidePartFor(heavy),
    setLayouts: (shown: ShownLayouts<Layout>) => setLayouts(shown),
    workflows,
    stages,
    toasts,
    put,
    breakFlowOf,
    advance,
    sets,
    clears,
    logged,
    invoked,
    rowActivities,
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

// The trail's words, in order, the first holding the primer and explore slot.
const TRAIL = [
  'Explore',
  'Interview',
  'Plan',
  'Cold read',
  'Make',
  'Review',
  'Fix',
  'Close',
];

// The trail's `label:state` texts with the step at `current` reading `label` in
// `state`, the steps before it done and those after it pending.
function trail(current: number, label: string, state: string): string[] {
  return TRAIL.map((step, index) => {
    if (index === current) {
      return `${label}:${state}`;
    }
    return `${step}:${index < current ? 'done' : 'pending'}`;
  });
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
      stage: 'explore',
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
      const { view, put, setLayouts } = setUp();
      const recording = recordingLayout();
      setLayouts(withUser<Layout>(defaultLayout, recording.layout));
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
      case: 'NoWorkflowMainAction_RunsNothing',
      flow: newFlow('a', '/p'),
      command: 'mainAction',
      invoked: [],
      line: 'nothing to run for mainAction in proj',
    },
    {
      case: 'NoPageStage_RunsNothing',
      flow: flowIn('gone'),
      command: 'clearAndMake',
      invoked: [],
      line: 'nothing to run for clearAndMake in proj',
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
    const { view, put, invoked, setLayouts } = setUp();
    const withButton: Layout = {
      chip(parent, input, kit) {
        const chip = kit.el(parent, 'div', 'button-chip');
        if (input.mainAction !== null) {
          kit.actionButton(chip, input.mainAction, { anchor: false });
        }
        return { element: chip };
      },
    };
    setLayouts(withUser<Layout>(defaultLayout, withButton));
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

  it.each([
    { stage: 'planReady', fields: {}, word: 'ready to make', tag: false },
    { stage: 'closed', fields: {}, word: 'closed', tag: false },
    { stage: 'planReady', fields: BUSY.turn, word: null, tag: true },
    { stage: 'closed', fields: BUSY.subagent, word: null, tag: true },
    { stage: 'make', fields: {}, word: null, tag: true },
  ])('setFlow_$stage_RowLabelReads$word', ({ stage, fields, word, tag }) => {
    const { view, put, rowActivities } = setUp();
    const wrapper = new FakeElement('div');

    put(flowIn(stage, fields));
    view.chipPart.build(asHtml(wrapper), 'a');

    expect(rowActivities.get('a')?.word ?? null).toBe(word);
    expect(findAll(wrapper, 'ui-tag').length > 0).toBe(tag);
  });

  it('setFlow_LeavesWaitingStage_ClearsTheRowLabel', () => {
    const { put, rowActivities } = setUp();

    put(flowIn('closed'));
    put(flowIn('idle'));

    expect(rowActivities.get('a')).toBeNull();
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
      steps: trail(0, 'Primer', 'paused'),
    },
    {
      stage: 'explore',
      busy: 'turn',
      steps: trail(0, 'Explore', 'running'),
    },
    {
      stage: 'interview',
      busy: 'turn',
      steps: trail(1, 'Interview', 'running'),
    },
    {
      stage: 'coldRead',
      busy: 'none',
      steps: trail(3, 'Cold read', 'paused'),
    },
    {
      stage: 'planReady',
      busy: 'none',
      steps: trail(4, 'Make', 'ready'),
    },
    {
      stage: 'make',
      busy: 'subagent',
      steps: trail(4, 'Make', 'running'),
    },
    {
      stage: 'make',
      busy: 'none',
      steps: trail(4, 'Make', 'paused'),
    },
    {
      stage: 'review',
      busy: 'turn',
      steps: trail(5, 'Review', 'running'),
    },
    {
      stage: 'fix',
      busy: 'turn',
      steps: trail(6, 'Fix', 'running'),
    },
    {
      stage: 'closed',
      busy: 'none',
      steps: trail(7, 'Close', 'done'),
    },
  ])(
    'steps_FlowIn_$stage_$busy_CarryThePinnedStates',
    ({ stage, busy, steps }) => {
      const { view, put, setLayouts } = setUp();
      const recording = recordingLayout();
      setLayouts(withUser<Layout>(defaultLayout, recording.layout));
      view.stripPart.build(asHtml(new FakeElement('div')), 'a');

      put(flowIn(stage, BUSY[busy]));

      expect(stepTexts(recording.strips.at(-1)!)).toEqual(steps);
    },
  );

  it('steps_StageOutsideTheStepper_LeavesEveryStepPending', () => {
    const { view, stages, put, setLayouts } = setUp();
    const recording = recordingLayout();
    setLayouts(withUser<Layout>(defaultLayout, recording.layout));
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

    expect(stepTexts(recording.strips.at(-1)!)).toEqual(
      TRAIL.map((label) => `${label}:pending`),
    );
  });

  it.each([
    {
      name: 'make with progress',
      stage: 'make',
      fields: { progress: progressOf(1, [3]) },
      labels: {
        Make: 'Make 1/3',
      },
    },
    {
      name: 'plan ready with no progress',
      stage: 'planReady',
      fields: { progress: null },
      labels: {},
    },
  ])(
    'stepper_DrawsEachLabelTheCurrentOneWithProgressAndNoMark ($name)',
    ({ stage, fields, labels }) => {
      const { view, put } = setUp();
      const wrapper = new FakeElement('div');
      view.stripPart.build(asHtml(wrapper), 'a');

      put(flowIn(stage, fields));

      expect(findAll(wrapper, 'workflow-mark')).toEqual([]);
      expect(
        findAll(wrapper, 'workflow-step-label').map(
          (label) => label.textContent,
        ),
      ).toEqual(
        TRAIL.map(
          (label) => (labels as Record<string, string>)[label] ?? label,
        ),
      );
    },
  );

  it.each<{ state: MarkState; icon: string }>([
    { state: 'pending', icon: 'codicon-circle-large' },
    { state: 'running', icon: 'codicon-circle-filled' },
    { state: 'ready', icon: 'codicon-play-circle' },
    { state: 'paused', icon: 'codicon-debug-pause' },
    { state: 'done', icon: 'codicon-pass-filled' },
  ])('statusMark_$state_DrawsItsCodiconAtTheClock', ({ state, icon }) => {
    const { view, put, advance, setLayouts } = setUp();
    const wrapper = new FakeElement('div');
    const drawsMark: Layout = {
      strip(parent, _input, kit) {
        const strip = kit.el(parent, 'div');
        kit.statusMark(strip, state);
        return { element: strip };
      },
    };
    setLayouts(withUser<Layout>(defaultLayout, drawsMark));
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
      finishedGroups: [
        { title: 'Wave 1', items: [{ text: 'w1.1', state: 'done' }] },
        { title: 'Wave 2', items: [{ text: 'w2.1', state: 'done' }] },
      ],
      currentGroup: {
        title: 'Wave 3',
        items: [
          { text: 'w3.1', state: 'done' },
          { text: 'w3.2', state: 'running' },
        ],
      },
      laterGroups: [
        { title: 'Wave 4', items: [{ text: 'w4.1', state: 'pending' }] },
        { title: 'Wave 5', items: [{ text: 'w5.1', state: 'pending' }] },
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
      finishedGroups: [],
      currentGroup: {
        title: 'Wave 3',
        items: [{ text: 'w3.1', state: 'paused' }],
      },
      laterGroups: [
        { title: 'Wave 4', items: [{ text: 'w4.1', state: 'pending' }] },
      ],
    },
    {
      name: 'review busy runs no tasks',
      stage: 'review',
      busy: 'turn',
      plan: planOf([[3, false]]),
      finishedGroups: [],
      currentGroup: {
        title: 'Wave 3',
        items: [{ text: 'w3.1', state: 'pending' }],
      },
      laterGroups: [],
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
      finishedGroups: [
        { title: 'Wave 2', items: [{ text: 'w2.1', state: 'done' }] },
      ],
      currentGroup: {
        title: 'Wave 1',
        items: [{ text: 'w1.1', state: 'paused' }],
      },
      laterGroups: [
        {
          title: 'Wave 3',
          items: [
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
      finishedGroups: [],
      currentGroup: {
        title: 'Tasks',
        items: [
          { text: 't.1', state: 'done' },
          { text: 't.2', state: 'running' },
        ],
      },
      laterGroups: [],
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
      finishedGroups: [],
      currentGroup: {
        title: 'Tasks',
        items: [{ text: 't.1', state: 'paused' }],
      },
      laterGroups: [
        {
          title: 'Wave 2',
          items: [
            { text: 'w2.1', state: 'pending' },
            { text: 'w2.2', state: 'done' },
          ],
        },
        { title: 'Wave 1', items: [{ text: 'w1.1', state: 'pending' }] },
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
      finishedGroups: [
        { title: 'Wave 1', items: [{ text: 'w1.1', state: 'done' }] },
        { title: 'Wave 2', items: [{ text: 'w2.1', state: 'done' }] },
      ],
      currentGroup: null,
      laterGroups: [],
    },
  ])(
    'side pane groups the plan and states its tasks: $name',
    ({ stage, busy, plan, finishedGroups, currentGroup, laterGroups }) => {
      const { put, sidePart, setLayouts } = setUp();
      const recording = recordingLayout();
      setLayouts(withUser<Layout>(defaultLayout, recording.layout));
      sidePart.build(asHtml(new FakeElement('div')), 'a', NO_SECTION);

      put(flowIn(stage, { ...BUSY[busy], progress: plan }));

      const input = recording.sidePanes.at(-1)!;
      expect({
        finishedGroups: input.finishedGroups,
        currentGroup: input.currentGroup,
        laterGroups: input.laterGroups,
      }).toEqual({ finishedGroups, currentGroup, laterGroups });
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
      const { view, put, sidePart } = setUp();
      const wrapper = new FakeElement('div');
      const section = recordingSection();
      view.setSidePaneHidden(hidden);
      put(flow);

      sidePart.build(asHtml(wrapper), 'a', section);

      expect(wrapper.children).toHaveLength(panes);
      expect(section.summaries).toEqual(summaries);
    },
  );

  it('setSidePaneHidden_HiddenThenShown_RemovesAndDrawsThePane', () => {
    const { view, put, sidePart } = setUp();
    const wrapper = new FakeElement('div');
    const section = recordingSection();
    put(flowIn('make', { progress: progressOf(5, [3, 3, 1]) }));
    sidePart.build(asHtml(wrapper), 'a', section);
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
    const { view, put, sidePart } = setUp();
    const observers = stubResizeObservers();
    const wrapper = new FakeElement('div');
    put(flowIn('make'));
    sidePart.build(asHtml(wrapper), 'a', NO_SECTION);
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
    const { put, sidePart } = setUp();
    const observers = stubResizeObservers();
    const wrapper = new FakeElement('div');
    put(flowIn('make'));
    const built = sidePart.build(asHtml(wrapper), 'a', NO_SECTION);
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
    const { view, put, logged, sidePart, setLayouts } = setUp(row.previews);
    const recording = recordingLayout();
    setLayouts(withUser<Layout>(defaultLayout, recording.layout));
    const planTitled = (title: string) => ({
      progress: { ...progressOf(1, [1, 1]), title },
    });
    put(row.flow ?? flowIn('make', planTitled('a'), 'a'));
    put(flowIn('make', planTitled('b'), 'b'));
    sidePart.build(asHtml(new FakeElement('div')), 'a', NO_SECTION);
    sidePart.build(asHtml(new FakeElement('div')), 'b', NO_SECTION);
    view.setSidePaneHidden(row.hidden ?? false);

    await row.act(view);
    const line = logged.at(-1);
    view.setSidePaneHidden(false);
    put(flowIn('make', planTitled('a'), 'a'));

    expect(line).toBe(row.line);
    const { open } = row;
    const lastOpen = (title: string) =>
      recording.sidePanes
        .filter((input) => input.checklistTitle === title)
        .at(-1)!.finishedOpen;
    expect({ a: lastOpen('a'), b: lastOpen('b') }).toEqual(open);
  });

  it('finishedFold_Click_OpensItsSessionsWavesAndStatesIt', async () => {
    const { put, sidePart } = setUp();
    const wrapper = new FakeElement('div');
    put(flowIn('make', { progress: progressOf(1, [1, 1]) }));
    sidePart.build(asHtml(wrapper), 'a', NO_SECTION);
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
    const { view, stages, put, setLayouts } = setUp();
    const recording = recordingLayout();
    setLayouts(withUser<Layout>(defaultLayout, recording.layout));
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
      'Explore',
      'Interview',
      'Plan',
      'Cold read',
      'Checking',
      'Make',
      'Review',
      'Fix',
      'Close',
    ]);
  });

  it('chip_UserLayoutThrows_DrawsWithDefault', () => {
    const { view, put, setLayouts } = setUp();
    const wrapper = new FakeElement('div');
    const throwing: Layout = {
      chip() {
        throw new Error('broken chip');
      },
    };
    setLayouts(withUser<Layout>(defaultLayout, throwing));
    put(flowIn('planReady'));

    view.chipPart.build(asHtml(wrapper), 'a');

    expect(
      findAll(wrapper, 'workflow-chip').map((chip) => chip.dataset.layout),
    ).toEqual(['default']);
    expect(wrapper.children).toHaveLength(1);
  });

  it('hold_FirstDrawThrows_LetsThePartGo', () => {
    const { put, breakFlowOf, sidePart } = setUp();
    const body = new FakeElement('div');
    put(flowIn('planReady'));
    breakFlowOf(true);

    expect(() => sidePart.build(asHtml(body), 'a', NO_SECTION)).toThrow(
      'no flow',
    );
    breakFlowOf(false);
    put(flowIn('make', { progress: progressOf(1, [3]) }));

    expect(body.children).toEqual([]);
  });
});

// A stage of `label`, in the stepper unless a field says otherwise.
function stageOf(
  id: string,
  label: string,
  order: number,
  fields: Partial<PageStage> = {},
): PageStage {
  return {
    id,
    label,
    inStepper: true,
    order,
    actions: [],
    detail: () => '',
    status: () => 'running',
    ...fields,
  };
}

function actionOf(command: string): StageActionSpec {
  return {
    command,
    label: command,
    available: () => true,
    enabled: () => true,
  };
}

// A draw whose parts each record their input and draw one `div`.
function stubDraw(sideTitle = 'Plan') {
  const chips: ChipInput[] = [];
  const strips: StripInput[] = [];
  const sidePanes: SidePaneInput[] = [];
  const part = (parent: HTMLElement) => {
    const element = asHtml(new FakeElement('div'));
    parent.append(element);
    return { element, dispose: () => element.remove() };
  };
  const draw: WorkflowDraw = {
    sideTitle,
    chip(parent, input) {
      chips.push(input);
      return part(parent);
    },
    strip(parent, input) {
      strips.push(input);
      return part(parent);
    },
    sidePane(parent, input) {
      sidePanes.push(input);
      return part(parent);
    },
  };
  return { draw, chips, strips, sidePanes };
}

// A workflow `id` over a stub draw, holding one stage `build`.
function stubWorkflow(
  id: string,
  stage: PageStage = stageOf('build', 'Build', 10),
  fields: Partial<PageWorkflow> = {},
) {
  const drawn = stubDraw();
  const runAction = vi.fn(async () => undefined);
  const workflow: PageWorkflow = {
    id,
    label: id,
    badge: id.charAt(0).toUpperCase(),
    stages: [stage],
    draw: drawn.draw,
    runAction,
    ...fields,
  };
  return { workflow, runAction, ...drawn };
}

function flowOf(
  workflow: string,
  fields: Partial<SessionFlow> = {},
  stage = 'build',
): SessionFlow {
  return { ...newFlow('a', '/p'), workflow, stage, ...fields };
}

describe('workflow view over several workflows', () => {
  it.each([
    { missedLevel: false, chip: [] },
    { missedLevel: true, chip: ['No workflow'] },
  ])(
    'Draw_NullWorkflow missedLevel $missedLevel',
    ({ missedLevel, chip: chipTexts }) => {
      const { view, put, sidePart, rowActivities } = setUp();
      const chip = new FakeElement('div');
      const strip = new FakeElement('div');
      const pane = new FakeElement('div');
      const section = recordingSection();
      view.chipPart.build(asHtml(chip), 'a');
      view.stripPart.build(asHtml(strip), 'a');
      sidePart.build(asHtml(pane), 'a', section);

      put({ ...newFlow('a', '/p'), missedLevel });

      expect(chip.children.map((child) => child.textContent)).toEqual(
        chipTexts,
      );
      expect(findAll(chip, 'ui-tag--error')).toHaveLength(chipTexts.length);
      expect(strip.children).toHaveLength(0);
      expect(pane.children).toHaveLength(0);
      expect(section.summaries.at(-1)).toBeNull();
      expect(rowActivities.get('a')).toBeNull();
    },
  );

  it('Steps_PerWorkflow', () => {
    const { view, workflows, put } = setUp();
    const a = stubWorkflow('a', stageOf('build', 'Build A', 10));
    const b = stubWorkflow('b', stageOf('build', 'Build B', 10));
    workflows.push(a.workflow, b.workflow);
    view.stripPart.build(asHtml(new FakeElement('div')), 'a');

    put(flowOf('b'));

    expect(b.strips.at(-1)?.steps.map((step) => step.label)).toEqual([
      'Build B',
    ]);
    expect(a.strips).toHaveLength(0);
  });

  it('Actions_PerWorkflow', () => {
    const { view, workflows } = setUp();
    workflows.push(
      stubWorkflow(
        'a',
        stageOf('build', 'Build', 10, { actions: [actionOf('a')] }),
      ).workflow,
      stubWorkflow(
        'b',
        stageOf('build', 'Build', 10, { actions: [actionOf('b')] }),
      ).workflow,
    );

    expect(view.mainAction(flowOf('b'))?.command).toBe('b');
  });

  it('RunFor_CallsTheFlowsRunAction', async () => {
    const { view, workflows, put, logged, toasts } = setUp();
    const withAction = stageOf('build', 'Build', 10, {
      actions: [actionOf('b')],
    });
    const a = stubWorkflow('a', withAction);
    const b = stubWorkflow('b', withAction);
    workflows.push(a.workflow, b.workflow);
    const flow = { ...flowOf('b'), sessionId: 's1' };
    put(flow);

    await view.runFor('s1', 'b');
    const calls = { a: a.runAction.mock.calls, b: [...b.runAction.mock.calls] };
    b.runAction.mockRejectedValueOnce(new Error('boom'));
    await view.runFor('s1', 'b');

    expect(calls).toEqual({ a: [], b: [['s1', 'b', flow]] });
    expect(logged.at(-1)).toBe('b not run in proj: boom');
    expect(toasts).toEqual(['Workflow: boom']);
  });

  it('Draw_UsesTheFlowsDraw', () => {
    const { view, workflows, put } = setUp();
    const a = stubWorkflow('a');
    const b = stubWorkflow('b');
    workflows.push(a.workflow, b.workflow);
    view.chipPart.build(asHtml(new FakeElement('div')), 'a');

    put(flowOf('a'));

    expect([a.chips.length, b.chips.length]).toEqual([1, 0]);
  });

  it.each([
    { name: 'workflow', flow: flowOf('gone'), line: 'no page workflow gone' },
    {
      name: 'stage',
      flow: flowOf(HEAVY_WORKFLOW_ID, {}, 'gone'),
      line: 'no page stage gone',
    },
  ])('Draw_Unknown $name', ({ flow, line }) => {
    const { view, put, logged, rowActivities } = setUp();
    const chip = new FakeElement('div');
    const strip = new FakeElement('div');
    view.chipPart.build(asHtml(chip), 'a');
    view.stripPart.build(asHtml(strip), 'a');

    put(flow);
    put(flow);

    expect(chip.children).toHaveLength(0);
    expect(strip.children).toHaveLength(0);
    expect(rowActivities.get('a')).toBeNull();
    expect(logged.filter((each) => each === line)).toHaveLength(1);
  });

  it('Chip_Input_CarriesBadge', () => {
    const { view, workflows, put } = setUp();
    const light = stubWorkflow('light', undefined, {
      badge: 'L',
      label: 'Light',
    });
    workflows.push(light.workflow);
    view.chipPart.build(asHtml(new FakeElement('div')), 'a');

    put(flowOf('light'));

    expect(light.chips.at(-1)).toMatchObject({
      badge: 'L',
      workflowLabel: 'Light',
    });
  });

  it.each([
    {
      name: 'a list',
      checklist: [
        { text: 'a', done: true },
        { text: 'b', done: false },
      ],
      hasChecklist: true,
      pane: {
        checked: 1,
        total: 2,
        currentGroup: {
          title: 'Tasks',
          items: [
            { text: 'a', state: 'done' },
            { text: 'b', state: 'pending' },
          ],
        },
      },
      summary: '1/2',
    },
    {
      name: 'an empty list',
      checklist: [],
      hasChecklist: true,
      pane: { checked: 0, total: 0, currentGroup: null },
      summary: null,
    },
    {
      name: 'no list',
      checklist: null,
      hasChecklist: false,
      pane: null,
      summary: null,
    },
  ])(
    'SidePane_DefaultChecklist $name',
    ({ checklist, hasChecklist, pane, summary }) => {
      const { view, workflows, put } = setUp();
      const light = stubWorkflow('light');
      workflows.push(light.workflow);
      const section = recordingSection();
      view.stripPart.build(asHtml(new FakeElement('div')), 'a');
      view
        .sidePartFor(light.workflow)
        .build(asHtml(new FakeElement('div')), 'a', section);

      put(flowOf('light', { checklist }));

      expect(light.strips.at(-1)?.hasChecklist).toBe(hasChecklist);
      expect(light.sidePanes.length > 0).toBe(pane !== null);
      if (pane !== null) {
        expect(light.sidePanes.at(-1)).toMatchObject(pane);
      }
      expect(section.summaries.at(-1)).toBe(summary);
    },
  );

  it('HasChecklist_ReadsHasPlan', () => {
    const { view, workflows, put } = setUp();
    const light = stubWorkflow('light', undefined, { hasPlan: () => false });
    workflows.push(light.workflow);
    view.stripPart.build(asHtml(new FakeElement('div')), 'a');

    put(flowOf('light', { checklist: [{ text: 'a', done: false }] }));

    expect(light.strips.at(-1)?.hasChecklist).toBe(false);
  });

  it('SidePart_PerWorkflow', () => {
    const { view, workflows, put } = setUp();
    const a = stubWorkflow('a', undefined, { draw: stubDraw('Plan').draw });
    const b = stubWorkflow('b', undefined, { draw: stubDraw('List').draw });
    workflows.push(a.workflow, b.workflow);
    const parts = [a.workflow, b.workflow].map(view.sidePartFor);
    const wrappers = parts.map(() => new FakeElement('div'));
    const sections = parts.map(() => recordingSection());
    parts.forEach((part, index) =>
      part.build(asHtml(wrappers[index]), 'a', sections[index]),
    );

    put(flowOf('a', { checklist: [{ text: 'x', done: true }] }));

    expect(parts.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'a.sidePane', title: 'Plan' },
      { id: 'b.sidePane', title: 'List' },
    ]);
    expect(wrappers.map((wrapper) => wrapper.children.length)).toEqual([1, 0]);
    expect(sections.map((section) => section.summaries.at(-1))).toEqual([
      '1/1',
      null,
    ]);
  });

  it('Countdown_Generic', () => {
    const { view, workflows, put, logged, sets } = setUp();
    let text: string | null = '5s';
    const light = stubWorkflow('light', undefined, {
      countdownText: () => text,
    });
    workflows.push(light.workflow);
    view.chipPart.build(asHtml(new FakeElement('div')), 'a');

    put(flowOf('light'));
    const shown = logged.at(-1);
    const chipsBeforeTick = light.chips.length;
    sets[0].run();
    const chipsAfterTick = light.chips.length;
    text = null;
    put(flowOf('light'));

    expect(shown).toBe('countdown shown in proj');
    expect(chipsAfterTick).toBe(chipsBeforeTick + 1);
    expect(light.chips.at(-2)?.countdown).toBe('5s');
    expect(light.chips.at(-1)?.countdown).toBeNull();
    expect(logged.at(-1)).toBe('countdown stopped in proj');
  });

  it.each([
    { name: 'text', texts: ['1/2', '1/2', '2/2'], lines: ['1/2', '2/2'] },
    { name: 'null', texts: [null], lines: [] },
  ])('ProgressText_Generic $name', ({ texts, lines }) => {
    const { workflows, put, logged } = setUp();
    let text: string | null = null;
    workflows.push(
      stubWorkflow('light', undefined, { progressText: () => text }).workflow,
    );

    for (const each of texts) {
      text = each;
      put(flowOf('light'));
    }

    expect(logged.filter((line) => line.includes(' progress '))).toEqual(
      lines.map((line) => `proj progress ${line}`),
    );
  });
});

describe('workflow kit', () => {
  const LIGHT = { id: 'workflow-light', commands: {} };

  // The kit under the manifest `workflow-light`, and the anchors it names.
  function lightKit() {
    const { anchors, keys } = recordingAnchors();
    const kit = createWorkflowKit(
      { ...KIT_SERVICES, keys },
      { recordBox: () => undefined, recordAnchor: () => undefined },
      () => undefined,
      { now: () => NOW },
      LIGHT,
    );
    return { kit, anchors };
  }

  it('badge_TakesTheColourOfTheDrawingPluginsToken', () => {
    const { kit } = lightKit();
    const parent = new FakeElement('div');

    kit.badge(asHtml(parent), 'L', 'Light');

    const [badge] = findAll(parent, 'workflow-badge');
    expect(badge.textContent).toBe('L');
    expect(badge.title).toBe('Light');
    expect(badge.style['--workflow-badge-color']).toBe(
      'var(--wg-workflow-light-badge)',
    );
  });

  it.each([
    { main: false, command: 'workflow-light.go' },
    { main: true, command: 'workflow.mainAction' },
  ])('actionButton_main$main_Anchors $command', ({ main, command }) => {
    const { kit, anchors } = lightKit();

    kit.actionButton(asHtml(new FakeElement('div')), {
      command: 'go',
      label: 'Go',
      enabled: true,
      main,
    });

    expect(anchors.map((anchor) => anchor.command)).toEqual([command]);
  });

  it('finishedFold_AnchorsTheEnginesCommand', () => {
    const { kit, anchors } = lightKit();

    kit.finishedFold(asHtml(new FakeElement('div')), 'x', false);

    expect(anchors.map((anchor) => anchor.command)).toEqual([
      'workflow.toggleFinishedWaves',
    ]);
  });
});
