import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { RowActivity } from '../../sessions/contract';
import type {
  ChecklistItem,
  ChipInput,
  MarkState,
  PageStage,
  PageWorkflow,
  SessionFlow,
  SidePaneInput,
  StageActionSpec,
  StageStatus,
  StripInput,
  WorkflowDraw,
  WorkflowKit,
} from '../contract';
import { newFlow } from '../flow';
import { createStageList } from '../stage-list';
import { testWorkflowKit } from './engine-parts.test-support';
import { createWorkflowView } from './workflow-view';

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

// A view holding the workflow `stub`, whose stages are live in `stages`: `build`
// with the main action `go`, `review`, and `idle` out of the stepper. Its timers
// record each `set` (its handle the set's count), and its `nameOf` reads every session
// as `proj`. `workflows` is what the view reads; `sidePart` is `stub`'s. Every session in
// `previews` shows the preview, and every session in `working` reads as working
// and in `headless` as headless. `setHeadless` records each call, and rejects
// with `headlessRefusal` while it is set. `active.session` is the session the
// user views.
function setUp(previews: readonly string[] = []) {
  const now = NOW;
  const sets: { run: () => void; handle: number }[] = [];
  const logged: string[] = [];
  const toasts: string[] = [];
  const flows = new Map<string, SessionFlow>();
  const rowActivities = new Map<string, RowActivity | null>();
  const working = new Set<string>();
  const headless = new Set<string>();
  const headlessSets: [string, boolean][] = [];
  const refusal: { headless: string | null } = { headless: null };
  const active: { session: string | null } = { session: null };
  let isFlowOfBroken = false;
  const stages = createStageList<PageStage>();
  stages.add(stageOf('idle', 'Idle', 0, { inStepper: false }));
  stages.add(stageOf('build', 'Build', 40, { actions: [actionOf('go')] }));
  stages.add(stageOf('review', 'Review', 50));
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
      clear: () => undefined,
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
    isWorking: (sessionId) => working.has(sessionId),
    isHeadless: (sessionId) => headless.has(sessionId),
    async setHeadless(sessionId, value) {
      headlessSets.push([sessionId, value]);
      if (refusal.headless !== null) {
        throw new Error(refusal.headless);
      }
    },
    activeSessionId: () => active.session,
  });
  const held = stubWorkflow('stub', undefined, { stages: stages.all() });
  workflows.push(held.workflow);
  const put = (flow: SessionFlow) => {
    flows.set(flow.sessionId, flow);
    view.setFlow(flow);
  };
  const breakFlowOf = (broken: boolean) => {
    isFlowOfBroken = broken;
  };
  return {
    view,
    held,
    sidePart: view.sidePartFor(held.workflow),
    workflows,
    stages,
    toasts,
    put,
    breakFlowOf,
    sets,
    logged,
    rowActivities,
    working,
    headless,
    headlessSets,
    refusal,
    active,
  };
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('workflow view', () => {
  it.each<{
    case: string;
    flow: SessionFlow;
    previews?: string[];
    command: string;
    line: string;
  }>([
    {
      case: 'IdleMainAction_RunsNothing',
      flow: flowOf('stub', {}, 'idle'),
      command: 'mainAction',
      line: 'nothing to run for mainAction in proj',
    },
    {
      case: 'NoWorkflowMainAction_RunsNothing',
      flow: newFlow('a', '/p'),
      command: 'mainAction',
      line: 'nothing to run for mainAction in proj',
    },
    {
      case: 'NoPageStage_RunsNothing',
      flow: flowOf('stub', {}, 'gone'),
      command: 'go',
      line: 'nothing to run for go in proj',
    },
    {
      case: 'PreviewMainAction_RunsNothing',
      flow: flowOf('stub'),
      previews: ['a'],
      command: 'mainAction',
      line: 'preview runs nothing for mainAction',
    },
  ])('runFor_$case', async ({ flow, previews, command, line }) => {
    const run = setUp(previews);
    run.put(flow);

    await run.view.runFor('a', command);

    expect(run.held.runAction).not.toHaveBeenCalled();
    expect(run.logged.at(-1)).toBe(line);
  });

  it.each(['chip', 'strip'] as const)('%s_IdleFlow_DrawsNothing', (part) => {
    const { view, put } = setUp();
    const wrapper = new FakeElement('div');
    put(flowOf('stub', {}, 'idle'));

    const built = part === 'chip' ? view.chipPart : view.stripPart;
    built.build(asHtml(wrapper), 'a');

    expect(wrapper.children).toHaveLength(0);
  });

  it('steps_StageOutsideTheStepper_LeavesEveryStepPending', () => {
    const { view, stages, held, put } = setUp();
    view.stripPart.build(asHtml(new FakeElement('div')), 'a');
    stages.add(stageOf('aside', 'Aside', 35, { inStepper: false }));

    put(flowOf('stub', {}, 'aside'));

    expect(
      held.strips.at(-1)?.steps.map((step) => `${step.label}:${step.state}`),
    ).toEqual(['Build:pending', 'Review:pending']);
  });

  it('registry_StageAddedOutOfOrder_SortsOnOrder', () => {
    const { view, stages, held, put } = setUp();
    view.stripPart.build(asHtml(new FakeElement('div')), 'a');

    stages.add(stageOf('checking', 'Checking', 35));
    put(flowOf('stub'));

    expect(held.strips.at(-1)?.steps.map((step) => step.label)).toEqual([
      'Checking',
      'Build',
      'Review',
    ]);
  });

  it('the fold is kept per session: a preview session flips it through runFor', async () => {
    const { view, workflows, put, logged } = setUp(['a']);
    const items = (done: boolean) => [{ text: 'x', done }];
    const small = stubWorkflow('small', undefined, {
      checklist: () => ({
        title: 'List',
        checked: 1,
        total: 2,
        groups: [
          { title: 'One', items: items(true) },
          { title: 'Two', items: items(false) },
        ],
      }),
    });
    workflows.push(small.workflow);
    put(flowOf('small'));
    view
      .sidePartFor(small.workflow)
      .build(asHtml(new FakeElement('div')), 'a', NO_SECTION);

    await view.runFor('a', 'toggleFinishedWaves');
    await settle();

    expect(logged.at(-1)).toBe('finished waves folded in proj');
    expect(small.sidePanes.at(-1)?.finishedOpen).toBe(false);
  });

  it('the side part keeps its height in the hub', () => {
    const { view, workflows } = setUp(['a']);
    const small = stubWorkflow('small');
    workflows.push(small.workflow);

    expect(view.sidePartFor(small.workflow).keepsHeight).toBe(true);
  });

  it('hold_FirstDrawThrows_LetsThePartGo', () => {
    const { put, breakFlowOf, sidePart } = setUp();
    const body = new FakeElement('div');
    put(flowOf('stub'));
    breakFlowOf(true);

    expect(() => sidePart.build(asHtml(body), 'a', NO_SECTION)).toThrow(
      'no flow',
    );
    breakFlowOf(false);
    put(flowOf('stub'));

    expect(body.children).toEqual([]);
  });
});

describe('workflow view over several workflows', () => {
  it.each([
    { missedLevel: false, isWorking: false, chip: [] },
    { missedLevel: true, isWorking: false, chip: ['No workflow'] },
    { missedLevel: false, isWorking: true, chip: ['Working'] },
    { missedLevel: true, isWorking: true, chip: ['No workflow', 'Working'] },
  ])(
    'Draw_NullWorkflow missedLevel $missedLevel isWorking $isWorking',
    ({ missedLevel, isWorking, chip: chipTexts }) => {
      const { view, put, sidePart, rowActivities, working } = setUp();
      if (isWorking) {
        working.add('a');
      }
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
      expect(findAll(chip, 'ui-tag--error')).toHaveLength(missedLevel ? 1 : 0);
      expect(findAll(chip, 'ui-tag--running')).toHaveLength(isWorking ? 1 : 0);
      expect(strip.children).toHaveLength(0);
      expect(pane.children).toHaveLength(0);
      expect(section.summaries.at(-1)).toBeNull();
      expect(rowActivities.get('a')).toBeNull();
    },
  );

  it.each<{ status: StageStatus; isWorking: boolean; working: number }>([
    { status: 'running', isWorking: true, working: 0 },
    { status: 'done', isWorking: true, working: 1 },
    { status: 'ready', isWorking: true, working: 1 },
    { status: 'done', isWorking: false, working: 0 },
  ])(
    'Draw_StageChip status $status isWorking $isWorking',
    ({ status, isWorking, working: workingTags }) => {
      const { view, workflows, put, working } = setUp();
      const shown = stubWorkflow(
        'w',
        stageOf('build', 'Build', 10, { status: () => status }),
      );
      workflows.push(shown.workflow);
      if (isWorking) {
        working.add('a');
      }
      const chip = new FakeElement('div');
      view.chipPart.build(asHtml(chip), 'a');

      put(flowOf('w'));

      expect(
        chip.children.filter((child) => child.textContent === 'Working'),
      ).toHaveLength(workingTags);
    },
  );

  it('ActivityChanged_DrawsTheChipAgain', () => {
    const { view, put, working } = setUp();
    const chip = new FakeElement('div');
    view.chipPart.build(asHtml(chip), 'a');
    put(newFlow('a', '/p'));

    working.add('a');
    view.activityChanged('a');

    expect(chip.children.map((child) => child.textContent)).toEqual([
      'Working',
    ]);
  });

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
      flow: flowOf('stub', {}, 'gone'),
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

  it('logFlow_LevelAndTrail_LogOncePerChange', () => {
    const { view, workflows, put, logged } = setUp();
    const small = stubWorkflow('small', stageOf('a', 'A', 10), {
      badge: 'S',
      stages: [stageOf('a', 'A', 10), stageOf('b', 'B', 20)],
      progressText: () => '1/2',
    });
    const medium = stubWorkflow('medium', stageOf('c', 'C', 10), {
      badge: 'M',
    });
    workflows.push(small.workflow, medium.workflow);
    const flow = flowOf('small', {}, 'a');

    put(flow);
    put(flow);
    const firstWorkflow = [...logged];
    logged.length = 0;
    put(flowOf('medium', {}, 'c'));
    const movedOn = [...logged];
    logged.length = 0;
    view.forget('a');
    put(flow);

    expect(firstWorkflow).toEqual([
      'proj level S',
      'proj trail A › B',
      'proj shows a',
      'proj progress 1/2',
    ]);
    expect(movedOn).toEqual(['proj level M', 'proj trail C', 'proj shows c']);
    expect(logged).toEqual(firstWorkflow);
  });

  it('logFlow_SharedStepSlot_TrailCountsItOnce', () => {
    const { workflows, put, logged } = setUp();
    workflows.push(
      stubWorkflow('small', undefined, {
        stages: [
          stageOf('a', 'A', 10),
          stageOf('land', 'Land', 20, { stepSlot: 'land' }),
          stageOf('done', 'Land', 30, { stepSlot: 'land' }),
        ],
      }).workflow,
    );

    put(flowOf('small', {}, 'a'));
    put(flowOf('small', {}, 'done'));

    expect(logged.filter((line) => line.includes(' trail '))).toEqual([
      'proj trail A › Land',
    ]);
  });

  it.each([
    { name: 'false', pushes: [false], lines: 0 },
    { name: 'true', pushes: [true, true], lines: 1 },
    { name: 'true again', pushes: [true, false, true], lines: 2 },
  ])('logFlow_MissedLevel_LogsNoWorkflow $name', ({ pushes, lines }) => {
    const { put, logged } = setUp();

    for (const missedLevel of pushes) {
      put({ ...newFlow('a', '/p'), missedLevel });
    }

    expect(logged.filter((line) => line === 'proj no workflow')).toHaveLength(
      lines,
    );
  });

  it('Chip_Input_CarriesBadge', () => {
    const { view, workflows, put } = setUp();
    const small = stubWorkflow('small', undefined, {
      badge: 'S',
      label: 'Small',
    });
    workflows.push(small.workflow);
    view.chipPart.build(asHtml(new FakeElement('div')), 'a');

    put(flowOf('small'));

    expect(small.chips.at(-1)).toMatchObject({
      badge: 'S',
      workflowLabel: 'Small',
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
      const small = stubWorkflow('small');
      workflows.push(small.workflow);
      const section = recordingSection();
      view.stripPart.build(asHtml(new FakeElement('div')), 'a');
      view
        .sidePartFor(small.workflow)
        .build(asHtml(new FakeElement('div')), 'a', section);

      put(flowOf('small', { checklist }));

      expect(small.strips.at(-1)?.hasChecklist).toBe(hasChecklist);
      expect(small.sidePanes.length > 0).toBe(pane !== null);
      if (pane !== null) {
        expect(small.sidePanes.at(-1)).toMatchObject(pane);
      }
      expect(section.summaries.at(-1)).toBe(summary);
    },
  );

  const RUNNING_STAGE: Partial<PageStage> = {
    runsTasks: true,
    status: () => 'running',
  };

  it.each<{
    name: string;
    item: ChecklistItem;
    stage: Partial<PageStage>;
    state: MarkState;
  }>([
    {
      name: 'a running item runs while the stage runs',
      item: { text: 'a', done: false, running: true },
      stage: RUNNING_STAGE,
      state: 'running',
    },
    {
      name: 'a running item pauses while the stage pauses',
      item: { text: 'a', done: false, running: true },
      stage: { runsTasks: true, status: () => 'paused' },
      state: 'paused',
    },
    {
      name: 'a running item waits in a stage that runs no tasks',
      item: { text: 'a', done: false, running: true },
      stage: { runsTasks: false, status: () => 'running' },
      state: 'pending',
    },
    {
      name: 'an item not running waits',
      item: { text: 'a', done: false, running: false },
      stage: RUNNING_STAGE,
      state: 'pending',
    },
    {
      name: 'an item with no flag shows the stage',
      item: { text: 'a', done: false },
      stage: RUNNING_STAGE,
      state: 'running',
    },
    {
      name: 'a done item is done though running',
      item: { text: 'a', done: true, running: true },
      stage: RUNNING_STAGE,
      state: 'done',
    },
  ])('SidePane_ItemRunning_PicksTheMark ($name)', ({ item, stage, state }) => {
    const { view, workflows, put } = setUp();
    const large = stubWorkflow('large', stageOf('build', 'Build', 10, stage), {
      checklist: () => ({
        title: 'Plan',
        checked: 0,
        total: 2,
        groups: [
          {
            title: 'Wave 1',
            items: [item, { text: 'b', done: false, running: false }],
          },
        ],
      }),
    });
    workflows.push(large.workflow);
    view
      .sidePartFor(large.workflow)
      .build(asHtml(new FakeElement('div')), 'a', NO_SECTION);

    put(flowOf('large'));

    expect(large.sidePanes.at(-1)?.currentGroup?.items).toEqual([
      { number: 1, text: 'a', state },
      { number: 2, text: 'b', state: 'pending' },
    ]);
  });

  it('HasChecklist_ReadsHasPlan', () => {
    const { view, workflows, put } = setUp();
    const small = stubWorkflow('small', undefined, { hasPlan: () => false });
    workflows.push(small.workflow);
    view.stripPart.build(asHtml(new FakeElement('div')), 'a');

    put(flowOf('small', { checklist: [{ text: 'a', done: false }] }));

    expect(small.strips.at(-1)?.hasChecklist).toBe(false);
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
    const small = stubWorkflow('small', undefined, {
      countdownText: () => text,
    });
    workflows.push(small.workflow);
    view.chipPart.build(asHtml(new FakeElement('div')), 'a');

    put(flowOf('small'));
    const shown = logged.at(-1);
    const chipsBeforeTick = small.chips.length;
    sets[0].run();
    const chipsAfterTick = small.chips.length;
    text = null;
    put(flowOf('small'));

    expect(shown).toBe('countdown shown in proj');
    expect(chipsAfterTick).toBe(chipsBeforeTick + 1);
    expect(small.chips.at(-2)?.countdown).toBe('5s');
    expect(small.chips.at(-1)?.countdown).toBeNull();
    expect(logged.at(-1)).toBe('countdown stopped in proj');
  });

  it.each([
    { name: 'text', texts: ['1/2', '1/2', '2/2'], lines: ['1/2', '2/2'] },
    { name: 'null', texts: [null], lines: [] },
  ])('ProgressText_Generic $name', ({ texts, lines }) => {
    const { workflows, put, logged } = setUp();
    let text: string | null = null;
    workflows.push(
      stubWorkflow('small', undefined, { progressText: () => text }).workflow,
    );

    for (const each of texts) {
      text = each;
      put(flowOf('small'));
    }

    expect(logged.filter((line) => line.includes(' progress '))).toEqual(
      lines.map((line) => `proj progress ${line}`),
    );
  });
});

describe('workflow kit', () => {
  const SMALL = { id: 'workflow-small', commands: {} };

  // The kit under the manifest `workflow-small` for session `b`, the anchors it
  // names and the commands its clicks run.
  const smallKit = () => testWorkflowKit(SMALL, NOW, 'b');

  it.each<{
    case: string;
    draw: (kit: WorkflowKit, parent: HTMLElement) => HTMLElement;
    action: string;
  }>([
    {
      case: 'main action',
      draw: (kit, parent) =>
        kit.actionButton(parent, {
          command: 'go',
          label: 'Go',
          enabled: true,
          main: true,
        }),
      action: 'mainAction',
    },
    {
      case: 'other action',
      draw: (kit, parent) =>
        kit.actionButton(parent, {
          command: 'go',
          label: 'Go',
          enabled: true,
          main: false,
        }),
      action: 'go',
    },
    {
      case: 'fold',
      draw: (kit, parent) => kit.finishedFold(parent, 'x', false),
      action: 'toggleFinishedWaves',
    },
  ])(
    'button_Click_RunsStageActionForTheKitsSession $case',
    ({ draw, action }) => {
      const { kit, runs } = smallKit();

      asFake(draw(kit, asHtml(new FakeElement('div')))).fire('click', {
        stopPropagation: () => undefined,
      });

      expect(runs).toEqual([
        { id: 'workflow.stageAction', arg: { sessionId: 'b', action } },
      ]);
    },
  );

  it.each<{ state: MarkState; icon: string }>([
    { state: 'pending', icon: 'codicon-circle-large' },
    { state: 'running', icon: 'codicon-circle-filled' },
    { state: 'ready', icon: 'codicon-play-circle' },
    { state: 'paused', icon: 'codicon-debug-pause' },
    { state: 'done', icon: 'codicon-pass-filled' },
  ])('statusMark_$state_DrawsItsCodiconAtTheClock', ({ state, icon }) => {
    const { kit } = smallKit();
    const parent = new FakeElement('div');

    kit.statusMark(asHtml(parent), state);

    const mark = findAll(parent, 'workflow-mark')[0];
    expect(mark.dataset.state).toBe(state);
    expect(findAll(mark, icon)).toHaveLength(1);
    expect(mark.style['--workflow-mark-clock']).toBe(`${NOW}ms`);
  });

  it('badge_TakesTheColourOfTheDrawingPluginsToken', () => {
    const { kit } = smallKit();
    const parent = new FakeElement('div');

    kit.badge(asHtml(parent), 'S', 'Small');

    const [badge] = findAll(parent, 'workflow-badge');
    expect(badge.textContent).toBe('S');
    expect(badge.title).toBe('Small');
    expect(badge.style['--workflow-badge-color']).toBe(
      'var(--wg-workflow-small-badge)',
    );
  });

  it.each([
    { main: false, command: 'workflow-small.go' },
    { main: true, command: 'workflow.mainAction' },
  ])('actionButton_main$main_Anchors $command', ({ main, command }) => {
    const { kit, anchors } = smallKit();

    kit.actionButton(asHtml(new FakeElement('div')), {
      command: 'go',
      label: 'Go',
      enabled: true,
      main,
    });

    expect(anchors.map((anchor) => anchor.command)).toEqual([command]);
  });

  it('finishedFold_AnchorsTheEnginesCommand', () => {
    const { kit, anchors } = smallKit();

    kit.finishedFold(asHtml(new FakeElement('div')), 'x', false);

    expect(anchors.map((anchor) => anchor.command)).toEqual([
      'workflow.toggleFinishedWaves',
    ]);
  });
});

describe('workflow view headless', () => {
  it.each([{ headless: true }, { headless: false }])(
    'StripInput_CarriesHeadless $headless',
    ({ headless }) => {
      const run = setUp();
      if (headless) {
        run.headless.add('a');
      }
      run.view.stripPart.build(asHtml(new FakeElement('div')), 'a');

      run.put(flowOf('stub'));

      expect(run.held.strips.at(-1)?.headless).toBe(headless);
    },
  );

  it.each<{ given: string; flow: SessionFlow; status?: StageStatus }>([
    {
      given: 'no workflow',
      flow: { ...newFlow('a', '/p'), missedLevel: true },
    },
    { given: 'idle', flow: flowOf('w', {}, 'idle') },
    { given: 'running', flow: flowOf('w'), status: 'running' },
    { given: 'done', flow: flowOf('w'), status: 'done' },
  ])('Chip_Headless_EndsOnTheHeadlessTag $given', ({ flow, status }) => {
    const run = setUp();
    const shown = stubWorkflow(
      'w',
      stageOf('build', 'Build', 10, { status: () => status ?? 'running' }),
      {
        stages: [
          stageOf('idle', 'Idle', 0, { inStepper: false }),
          stageOf('build', 'Build', 10, { status: () => status ?? 'running' }),
        ],
      },
    );
    run.workflows.push(shown.workflow);
    run.working.add('a');
    const chip = new FakeElement('div');
    run.view.chipPart.build(asHtml(chip), 'a');
    run.put(flow);
    const plainTags = findAll(chip, 'workflow-row-headless');

    run.headless.add('a');
    run.view.redraw();

    expect(plainTags).toHaveLength(0);
    expect(
      chip.children.at(-1)?.classList.contains('workflow-row-headless'),
    ).toBe(true);
    expect(chip.children.at(-1)?.textContent).toBe('Headless');
  });

  it.each<{
    given: string;
    previews?: string[];
    flow: SessionFlow;
    isHeadless: boolean;
    refusal?: string;
    sets: [string, boolean][];
    line: string;
    toasts: string[];
  }>([
    {
      given: 'off',
      flow: flowOf('stub'),
      isHeadless: false,
      sets: [['a', true]],
      line: 'proj headless on',
      toasts: [],
    },
    {
      given: 'on',
      flow: flowOf('stub'),
      isHeadless: true,
      sets: [['a', false]],
      line: 'proj headless off',
      toasts: [],
    },
    {
      given: 'the preview session',
      previews: ['a'],
      flow: flowOf('stub'),
      isHeadless: false,
      sets: [],
      line: 'preview runs nothing for toggleHeadless',
      toasts: [],
    },
    {
      given: 'a session with no workflow',
      flow: newFlow('a', '/p'),
      isHeadless: false,
      sets: [['a', true]],
      line: 'proj headless on',
      toasts: [],
    },
    {
      given: 'a refused set',
      flow: flowOf('stub'),
      isHeadless: false,
      refusal: 'chat is gone',
      sets: [['a', true]],
      line: 'toggleHeadless not run in proj: chat is gone',
      toasts: ['Workflow: chat is gone'],
    },
  ])(
    'RunFor_ToggleHeadless_SetsTheOppositeAndLogs $given',
    async ({ previews, flow, isHeadless, refusal, sets, line, toasts }) => {
      const run = setUp(previews);
      run.put(flow);
      if (isHeadless) {
        run.headless.add('a');
      }
      run.refusal.headless = refusal ?? null;

      await run.view.runFor('a', 'toggleHeadless');

      expect(run.headlessSets).toEqual(sets);
      expect(run.logged.at(-1)).toBe(line);
      expect(run.toasts).toEqual(toasts);
    },
  );

  it.each<{ given: string; calls: (boolean | undefined)[]; draws: number }>([
    { given: 'true while drawn false', calls: [true], draws: 1 },
    { given: 'the same value again', calls: [true, true], draws: 1 },
    { given: 'false after true', calls: [true, false], draws: 2 },
    { given: 'false while drawn false', calls: [false], draws: 0 },
    { given: 'undefined', calls: [undefined], draws: 0 },
    { given: 'true after undefined', calls: [true, undefined, true], draws: 2 },
  ])(
    'HeadlessChanged_OnlyAChangedValueDrawsAgain $given',
    ({ calls, draws }) => {
      const run = setUp();
      for (const sessionId of ['a', 'b']) {
        run.view.chipPart.build(asHtml(new FakeElement('div')), sessionId);
        run.view.stripPart.build(asHtml(new FakeElement('div')), sessionId);
        run.put({ ...flowOf('stub'), sessionId });
      }
      const drawsBefore = run.held.chips.length + run.held.strips.length;

      for (const headless of calls) {
        if (headless === true) {
          run.headless.add('a');
        } else {
          run.headless.delete('a');
        }
        run.view.headlessChanged('a', headless);
      }

      expect(run.held.chips.length + run.held.strips.length - drawsBefore).toBe(
        draws * 2,
      );
    },
  );
});

describe('workflow view unseen word', () => {
  const ANSWERED_WORD: RowActivity = {
    word: 'answered',
    tone: 'success',
    rank: 15,
  };
  const BUSY: Partial<SessionFlow> = { turnRunning: true };
  const IDLE: Partial<SessionFlow> = {};

  it.each<{
    name: string;
    stage: string;
    flows: Partial<SessionFlow>[];
    activeAtEnd: string | null;
    viewed: (string | null)[];
    word: string | null;
  }>([
    {
      name: 'turn ends while another session is viewed',
      stage: 'answered',
      flows: [BUSY, IDLE],
      activeAtEnd: 'b',
      viewed: [],
      word: 'answered',
    },
    {
      name: 'turn ends while the session is viewed',
      stage: 'answered',
      flows: [BUSY, IDLE],
      activeAtEnd: 'a',
      viewed: [],
      word: null,
    },
    {
      name: 'the user then views the session',
      stage: 'answered',
      flows: [BUSY, IDLE],
      activeAtEnd: null,
      viewed: ['a'],
      word: null,
    },
    {
      name: 'the user then views another session',
      stage: 'answered',
      flows: [BUSY, IDLE],
      activeAtEnd: null,
      viewed: ['b'],
      word: 'answered',
    },
    {
      name: 'a new turn starts',
      stage: 'answered',
      flows: [BUSY, IDLE, BUSY],
      activeAtEnd: null,
      viewed: [],
      word: null,
    },
    {
      name: 'first drawn already idle',
      stage: 'answered',
      flows: [IDLE],
      activeAtEnd: null,
      viewed: [],
      word: null,
    },
    {
      name: 'turn ends in a stage with no unseen word',
      stage: 'build',
      flows: [BUSY, IDLE],
      activeAtEnd: null,
      viewed: [],
      word: null,
    },
  ])(
    'setFlow_$name_RowReads$word',
    ({ stage, flows, activeAtEnd, viewed, word }) => {
      const { view, put, stages, rowActivities, active } = setUp();
      stages.add(
        stageOf('answered', 'Answered', 60, {
          inStepper: false,
          status: () => null,
          unseenActivity: ANSWERED_WORD,
        }),
      );

      active.session = activeAtEnd;
      for (const fields of flows) {
        put(flowOf('stub', fields, stage));
      }
      for (const sessionId of viewed) {
        view.activeChanged(sessionId);
      }

      expect(rowActivities.get('a')?.word ?? null).toBe(word);
    },
  );
});
