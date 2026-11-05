import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Registrations } from '../contracts/disposable';
import type { ShownLayouts } from '../contracts/plugin';
import {
  recordingAnchors,
  withUser,
} from '../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../shared/page/test-dom';
import {
  fakeDependency,
  startPagePart,
} from '../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../shared/registrations';
import {
  type ChatComposerPart,
  type ChatPageExports,
  type ChatSidePart,
  chatPageKey,
} from './chat/contract';
import { type DocsPageExports, docsPageKey } from './docs/contract';
import { type KeysPageExports, keysPageKey } from './keys/contract';
import {
  type RowActivity,
  type SessionPart,
  type SessionsPageExports,
  sessionsPageKey,
} from './sessions/contract';
import {
  type SessionFlow,
  type WorkflowPageExports,
  workflowPageKey,
} from './workflow/contract';
import { newFlow } from './workflow/flow';
import type {
  Layout,
  SidePaneInput,
  StripInput,
} from './workflow/layouts/layout';
import { workflowPagePart } from './workflow/page/start';
import {
  HEAVY_WORKFLOW_ID,
  type HeavyActionRequest,
  type HeavyState,
  withHeavyState,
} from './workflow-heavy/contract';
import defaultLayout from './workflow-heavy/layouts/default/layout.js';
import { workflowHeavyPagePart } from './workflow-heavy/page/start';
import type { PlanProgress } from './workflow-heavy/plan-reader';

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

// The real engine page part and the real Heavy page part on its exports, each in
// its own harness, over fakes of sessions, chat, keys and docs. `view` drives the
// engine as its parts' hosts, commands and events do: `put` pushes a flow, `timers`
// counts the engine's live timers and `advance` moves its clock, `setLayouts` shows
// Heavy's layouts. `invoked` records Heavy's `runAction` calls; `logged` reads the
// engine's lines; `heavyLogged` Heavy's; every session named `a`, `b` or `s1` reads
// as `proj`. `selected` sets the session the commands run on.
function setUp() {
  const invoked: HeavyActionRequest[] = [];
  const openedDocs: string[] = [];
  const rowActivities = new Map<string, RowActivity | null>();
  const rowParts: SessionPart[] = [];
  const composerParts: ChatComposerPart[] = [];
  const sideParts: ChatSidePart[] = [];
  let selectedSession: string | null = null;
  const untracked = () => ({ dispose: () => undefined });
  const engine = startPagePart(workflowPagePart, {
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        () =>
          ({
            addRowPart: (part: SessionPart) => {
              rowParts.push(part);
              return untracked();
            },
            addTab: untracked,
            selectedSessionId: () => selectedSession,
            setActivity: (
              sessionId: string,
              _owner: string,
              activity: RowActivity | null,
            ) => rowActivities.set(sessionId, activity),
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(
        chatPageKey,
        () =>
          ({
            addComposerPart: (part: ChatComposerPart) => {
              composerParts.push(part);
              return untracked();
            },
            addSidePart: (part: ChatSidePart) => {
              sideParts.push(part);
              return untracked();
            },
          }) as unknown as ChatPageExports,
      ),
      fakeDependency(
        keysPageKey,
        () => KIT_SERVICES.keys as unknown as KeysPageExports,
      ),
    ],
    services: { markdown: KIT_SERVICES.markdown },
    invoke: () => Promise.resolve([]),
  });
  const engineExports = (consumer: Registrations = createRegistrations()) =>
    engine.started().exports?.(consumer) as WorkflowPageExports;
  const runCommand = vi.fn((sessionId: string, command: string) =>
    engineExports().runCommand(sessionId, command),
  );
  const heavy = startPagePart(workflowHeavyPagePart, {
    dependencies: [
      fakeDependency(workflowPageKey, (consumer) => ({
        ...engineExports(consumer),
        runCommand,
      })),
      fakeDependency(
        sessionsPageKey,
        () =>
          ({
            selectedSessionId: () => selectedSession,
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(
        docsPageKey,
        () =>
          ({
            openDoc: (path: string) => openedDocs.push(path),
          }) as unknown as DocsPageExports,
      ),
    ],
    invoke: async (_method, ...args) => {
      invoked.push(args[0] as HeavyActionRequest);
    },
  });
  for (const sessionId of ['a', 'b', 's1']) {
    engine.emit('sessions.sessionAdded', {
      sessionId,
      label: 'proj',
      projectDir: '/p/proj',
      hostSessionId: null,
    });
  }
  engine.advance(NOW);
  const put = (flow: SessionFlow) => engine.send('flows', [flow]);
  const engineCommands = () => engine.started().commands;
  let isPaneHidden = false;
  const view = {
    get chipPart() {
      return rowParts[0];
    },
    get stripPart() {
      return composerParts[0];
    },
    runFor: (sessionId: string, command: string) =>
      engineExports().runCommand(sessionId, command),
    toggleFinishedWaves: (sessionId: string) =>
      engineExports().runCommand(sessionId, 'toggleFinishedWaves'),
    setSidePaneHidden(hidden: boolean) {
      if (hidden !== isPaneHidden) {
        isPaneHidden = hidden;
        engineCommands().toggleSidePane({});
      }
    },
    // A session leaving and coming back: the engine forgets what it kept for it.
    forget(sessionId: string) {
      engine.emit('sessions.sessionRemoved', { sessionId });
      engine.emit('sessions.sessionAdded', {
        sessionId,
        label: 'proj',
        projectDir: '/p/proj',
        hostSessionId: null,
      });
    },
    redraw: () => undefined,
  };
  const linesOf = (harness: typeof engine | typeof heavy, source: string) =>
    harness.logs
      .filter((entry) => entry.source === source)
      .map((entry) => entry.message);
  return {
    engine,
    heavy,
    view,
    sidePart: sideParts[0],
    sideParts,
    setLayouts: (shown: ShownLayouts<Layout>) =>
      heavy.showLayouts(shown as ShownLayouts<unknown>),
    put,
    advance: engine.advance,
    timers: () => engine.counts().timers,
    logged: () => linesOf(engine, 'workflow'),
    heavyLogged: () => linesOf(heavy, 'workflow-heavy'),
    invoked,
    openedDocs,
    runCommand,
    rowActivities,
    selected: (sessionId: string | null) => {
      selectedSession = sessionId;
    },
  };
}

type HeavyView = ReturnType<typeof setUp>['view'];

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
  view: HeavyView;
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

describe('Heavy over the engine page part', () => {
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
  ])('runFor_$case', async ({ flow, command, invoked, line }) => {
    const run = setUp();
    run.put(flow);

    await run.view.runFor('a', command);

    expect(run.invoked).toEqual(invoked);
    expect(run.logged().at(-1)).toBe(line);
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

    expect(logged().filter((line) => !/ (level|trail) /.test(line))).toEqual([
      'proj shows planReady',
      'proj progress 0/7 wave 1',
      'proj progress 1/7 wave 1',
    ]);
  });

  it('tick_CountdownShown_RedrawsAndStopsWhenGone', () => {
    const { view, put, advance, timers } = setUp();
    const wrapper = new FakeElement('div');
    view.stripPart.build(asHtml(wrapper), 'a');
    put(flowIn('planReady', { countdownEndsAt: NOW + 10_000 }));
    const before = findAll(wrapper, 'workflow-countdown')[0].textContent;
    const firstButton = findAll(wrapper, 'ui-button')[0].textContent;

    advance(1000);
    const afterTick = {
      countdown: findAll(wrapper, 'workflow-countdown')[0].textContent,
      timers: timers(),
    };
    put(flowIn('planReady'));

    expect(before).toBe('10s');
    expect(firstButton).toBe('Cancel');
    expect(afterTick).toEqual({ countdown: '9s', timers: 1 });
    expect(timers()).toBe(0);
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
    flow?: SessionFlow;
    hidden?: boolean;
    act(view: HeavyView): void | Promise<void>;
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
    const { view, put, logged, sidePart, setLayouts } = setUp();
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
    const line = logged().at(-1);
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

  it('sideSection_ReadsPlan', () => {
    const { sideParts } = setUp();

    expect(sideParts.map(({ id, title, order }) => [id, title, order])).toEqual(
      [['workflow-heavy.sidePane', 'Plan', 20]],
    );
  });

  it('commandWithNoSelectedSession_LogsAndRunsNothing', async () => {
    const { heavy, heavyLogged, invoked, runCommand } = setUp();

    heavy.started().commands.dismiss({});
    await settle();

    expect(heavyLogged()).toEqual(['no selected session for dismiss']);
    expect(runCommand).not.toHaveBeenCalled();
    expect(invoked).toEqual([]);
  });

  it.each([
    'clearAndMake',
    'cancelCountdown',
    'makeInNewSession',
    'resumeMake',
    'openPlan',
    'retro',
    'dismiss',
  ] as const)(
    'commands_WithASelectedSession_RunThroughTheEngine %s',
    (command) => {
      const { heavy, runCommand, selected } = setUp();
      selected('s1');

      heavy.started().commands[command]({});

      expect(runCommand.mock.calls).toEqual([['s1', command]]);
    },
  );

  it('commands_WithASelectedSession_RunThroughTheEngine openPlan reaches the doc', async () => {
    const { heavy, put, openedDocs, invoked, selected } = setUp();
    selected('s1');
    put(flowIn('make', {}, 's1'));

    heavy.started().commands.openPlan({});
    await settle();

    expect(openedDocs).toEqual([`${PLAN_DIR}/plan.md`]);
    expect(invoked).toEqual([]);
  });
});
