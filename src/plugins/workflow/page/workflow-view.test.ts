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
import type { FlowTabInput, Layout, StripInput } from '../layouts/layout';
import type { PlanProgress } from '../plan-reader';
import { createStageList } from '../stage-list';
import { BUILT_IN_PAGE_STAGES } from '../stages';
import { createWorkflowView } from './workflow-view';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

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
    hasLeftIdle: !isIdle,
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

// A view over the built-in page stages whose timers record each `set` (its
// handle the set's count) and each `clear`, whose channel records each
// `runAction`, and whose `nameOf` reads every session as `proj`.
function setUp() {
  let now = NOW;
  const sets: { run: () => void; handle: number }[] = [];
  const clears: number[] = [];
  const logged: string[] = [];
  const invoked: WorkflowActionRequest[] = [];
  const flows = new Map<string, SessionFlow>();
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
    toast: () => undefined,
    paths: { join: (folder, ...segments) => [folder, ...segments].join('/') },
    stages,
    flowOf: (sessionId) => flows.get(sessionId) ?? newFlow(sessionId, '/p'),
    nameOf: () => 'proj',
    isPreview: () => false,
    stripBuilt: () => undefined,
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
  return {
    view,
    stages,
    put,
    advance,
    sets,
    clears,
    logged,
    invoked,
  };
}

// A user layout whose strip and Flow tab record each input they draw.
function recordingLayout() {
  const strips: StripInput[] = [];
  const flowTabs: FlowTabInput[] = [];
  const layout: Layout = {
    strip(parent, input, kit) {
      strips.push(input);
      return { element: kit.el(parent, 'div') };
    },
    flowTab(parent, input, kit) {
      flowTabs.push(input);
      return { element: kit.el(parent, 'div') };
    },
  };
  return { layout, strips, flowTabs };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
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
      actions: ['clearAndMake:true', 'makeInNewSession:true', 'openPlan:true'],
    },
    {
      stage: 'planReady',
      busy: 'turn',
      countdownMs: null,
      fields: {},
      actions: ['clearAndMake:false', 'makeInNewSession:true', 'openPlan:true'],
    },
    {
      stage: 'planReady',
      busy: 'subagent',
      countdownMs: null,
      fields: {},
      actions: ['clearAndMake:false', 'makeInNewSession:true', 'openPlan:true'],
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
        'openPlan:true',
      ],
    },
    {
      stage: 'make',
      busy: 'subagent',
      countdownMs: null,
      fields: { progress: progressOf(1, [3]) },
      actions: ['resumeMake:false', 'openPlan:true'],
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
      line: '[workflow] ran clearAndMake in proj',
    },
    {
      case: 'PlanReadyBusyMainAction_RunsNothing',
      flow: flowIn('planReady', { turnRunning: true }),
      command: 'mainAction',
      invoked: [],
      line: '[workflow] nothing to run for mainAction in proj',
    },
    {
      case: 'PlanReadyBusyMakeInNewSession_RunsIt',
      flow: flowIn('planReady', { turnRunning: true }),
      command: 'makeInNewSession',
      invoked: [{ sessionId: 'a', command: 'makeInNewSession' }],
      line: '[workflow] ran makeInNewSession in proj',
    },
    {
      case: 'MakeAllTickedResumeMake_RunsNothing',
      flow: flowIn('make', { progress: progressOf(3, [3]) }),
      command: 'resumeMake',
      invoked: [],
      line: '[workflow] nothing to run for resumeMake in proj',
    },
    {
      case: 'IdleMainAction_RunsNothing',
      flow: flowIn('idle'),
      command: 'mainAction',
      invoked: [],
      line: '[workflow] nothing to run for mainAction in proj',
    },
  ])('runFor_$case', async ({ flow, command, invoked, line }) => {
    const run = setUp();
    run.put(flow);

    await run.view.runFor('a', command);

    expect(run.invoked).toEqual(invoked);
    expect(run.logged.at(-1)).toBe(line);
  });

  it('button_ChipOfUnselectedSession_RunsForItsOwnSession', async () => {
    const { view, put, invoked } = setUp();
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
      '[workflow] proj shows planReady',
      '[workflow] proj progress 0/7 wave 1',
      '[workflow] proj progress 1/7 wave 1',
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

  it('steps_FlowInMake_MarksDoneCurrentAhead', () => {
    const { view, put } = setUp();
    const wrapper = new FakeElement('div');
    view.stripPart.build(asHtml(wrapper), 'a');

    put(flowIn('make', { progress: progressOf(1, [3]) }));

    expect(
      findAll(wrapper, 'workflow-step').map(
        (step) => `${step.textContent}:${step.dataset.state}`,
      ),
    ).toEqual([
      'Primer:done',
      'Feature:done',
      'Plan ready:done',
      'Make:current',
      'Review:ahead',
      'Closed:ahead',
    ]);
  });

  it('waves_TasksAcrossWaves_GroupsInFileOrderAndMarksCurrent', () => {
    const { view, put } = setUp();
    const recording = recordingLayout();
    view.setLayouts(withUser<Layout>(defaultLayout, recording.layout));
    view.drawFlowTab(asHtml(new FakeElement('div')), 'a', () => undefined);
    const progress: PlanProgress = {
      checked: 2,
      total: 4,
      wave: 2,
      reviewRounds: 0,
      title: 'Plan x',
      tasks: [
        { wave: null, text: 'set up', done: true },
        { wave: 2, text: 'second wave', done: false },
        { wave: 1, text: 'first wave', done: true },
        { wave: 2, text: 'second wave again', done: false },
      ],
    };

    put(flowIn('make', { progress }));

    expect(recording.flowTabs.at(-1)!.waves).toEqual([
      {
        title: 'Tasks',
        tasks: [{ text: 'set up', done: true }],
        current: false,
      },
      {
        title: 'Wave 2',
        tasks: [
          { text: 'second wave', done: false },
          { text: 'second wave again', done: false },
        ],
        current: true,
      },
      {
        title: 'Wave 1',
        tasks: [{ text: 'first wave', done: true }],
        current: false,
      },
    ]);
  });

  it.each([
    { name: 'NoPlanRead', progress: null, planTitle: null },
    {
      name: 'ReadPlanWithNoTitle',
      progress: { ...progressOf(0, []), title: '' },
      planTitle: '',
    },
    {
      name: 'ReadPlanWithTitle',
      progress: progressOf(0, [2]),
      planTitle: 'Plan x',
    },
  ])(
    'planTitle_$name_IsNullOnlyBeforeAPlanIsRead',
    ({ progress, planTitle }) => {
      const { view, put } = setUp();
      const recording = recordingLayout();
      view.setLayouts(withUser<Layout>(defaultLayout, recording.layout));
      view.drawFlowTab(asHtml(new FakeElement('div')), 'a', () => undefined);

      put(flowIn('make', { progress }));

      expect(recording.flowTabs.at(-1)!.planTitle).toBe(planTitle);
    },
  );

  it('registry_StageAddedOutOfOrder_SortsOnOrder', () => {
    const { view, stages, put } = setUp();
    const wrapper = new FakeElement('div');
    view.stripPart.build(asHtml(wrapper), 'a');
    const checking: PageStage = {
      id: 'checking',
      label: 'Checking',
      inStepper: true,
      order: 35,
      actions: [],
      detail: () => '',
    };

    stages.add(checking);
    put(flowIn('make', { progress: progressOf(1, [3]) }));

    expect(
      findAll(wrapper, 'workflow-step').map((step) => step.textContent),
    ).toEqual([
      'Primer',
      'Feature',
      'Plan ready',
      'Checking',
      'Make',
      'Review',
      'Closed',
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
    const { view, put } = setUp();
    const body = new FakeElement('div');
    put(flowIn('planReady'));

    expect(() =>
      view.drawFlowTab(asHtml(body), 'a', () => {
        throw new Error('no status line');
      }),
    ).toThrow('no status line');
    put(flowIn('make', { progress: progressOf(1, [3]) }));

    expect(body.children).toEqual([]);
  });
});
