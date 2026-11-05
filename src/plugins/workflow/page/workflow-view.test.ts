import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { RowActivity } from '../../sessions/contract';
import type {
  ChipInput,
  MarkState,
  PageStage,
  PageWorkflow,
  SessionFlow,
  SidePaneInput,
  StageActionSpec,
  StripInput,
  WorkflowDraw,
} from '../contract';
import { newFlow } from '../flow';
import { createStageList } from '../stage-list';
import { createWorkflowKit } from './layout/workflow-kit';
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
// `previews` shows the preview.
function setUp(previews: readonly string[] = []) {
  const now = NOW;
  const sets: { run: () => void; handle: number }[] = [];
  const logged: string[] = [];
  const toasts: string[] = [];
  const flows = new Map<string, SessionFlow>();
  const rowActivities = new Map<string, RowActivity | null>();
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
    const light = stubWorkflow('light', undefined, {
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
    workflows.push(light.workflow);
    put(flowOf('light'));
    view
      .sidePartFor(light.workflow)
      .build(asHtml(new FakeElement('div')), 'a', NO_SECTION);

    await view.runFor('a', 'toggleFinishedWaves');
    await settle();

    expect(logged.at(-1)).toBe('finished waves open in proj');
    expect(light.sidePanes.at(-1)?.finishedOpen).toBe(true);
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

  it.each<{ state: MarkState; icon: string }>([
    { state: 'pending', icon: 'codicon-circle-large' },
    { state: 'running', icon: 'codicon-circle-filled' },
    { state: 'ready', icon: 'codicon-play-circle' },
    { state: 'paused', icon: 'codicon-debug-pause' },
    { state: 'done', icon: 'codicon-pass-filled' },
  ])('statusMark_$state_DrawsItsCodiconAtTheClock', ({ state, icon }) => {
    const { kit } = lightKit();
    const parent = new FakeElement('div');

    kit.statusMark(asHtml(parent), state);

    const mark = findAll(parent, 'workflow-mark')[0];
    expect(mark.dataset.state).toBe(state);
    expect(findAll(mark, icon)).toHaveLength(1);
    expect(mark.style['--workflow-mark-clock']).toBe(`${NOW}ms`);
  });

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
