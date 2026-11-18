import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Registrations } from '../../../contracts/disposable';
import type { PluginCommands } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import {
  fakeDependency,
  noCounts,
  probePart,
  startPagePart,
  type PartCounts,
} from '../../../shared/plugin-part-harness.test-support';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import {
  type ChatComposerPart,
  type ChatPageExports,
  type ChatSessionInfo,
  type ChatSidePart,
  chatPageKey,
  chatSessionSlot,
} from '../../chat/contract';
import {
  type SessionPart,
  type SessionRow,
  sessionsActiveSlot,
  type SessionsPageExports,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import {
  type PageStage,
  type PageWorkflow,
  type SessionFlow,
  type StageActionArg,
  type StripInput,
  type WorkflowDraw,
  workflowFlowsSlot,
  type WorkflowPageExports,
  workflowStageActionCommand,
} from '../contract';
import { newFlow } from '../flow';
import { workflowPagePart } from './start';
import type { createWorkflowView } from './workflow-view';

// Each session id the view's `setFlow` ran for, in order, and each flow it drew.
const drawn = vi.hoisted(() => ({
  setFlow: [] as string[],
  flows: [] as SessionFlow[],
}));

vi.mock('./workflow-view', async (importOriginal) => {
  const original = await importOriginal<typeof import('./workflow-view')>();
  return {
    ...original,
    createWorkflowView(deps: Parameters<typeof createWorkflowView>[0]) {
      const view = original.createWorkflowView(deps);
      return {
        ...view,
        setFlow(flow: SessionFlow) {
          drawn.setFlow.push(flow.sessionId);
          drawn.flows.push(flow);
          view.setFlow(flow);
        },
      };
    },
  };
});

const NONE_LIVE: PartCounts = noCounts;

const noHandle = (consumer: Registrations) => () =>
  consumer.track({ dispose: () => undefined });

// Files `part` in `parts` until its registration is disposed.
function holdsPart<T>(consumer: Registrations, parts: Set<T>, part: T) {
  parts.add(part);
  return consumer.track({ dispose: () => parts.delete(part) });
}

// Workflow's page part over fakes that file each part they take under it, as
// sessions' and chat's views do. `commands` is another plugin's, `runs` holds
// each run its process heard, and `activated` each session sessions activated.
// With `sidePartDisposeError`, a side part's dispose unfiles it and then throws
// that error.
function startWorkflow(sidePartDisposeError: Error | null = null) {
  installFakeDom((name, value) => vi.stubGlobal(name, value));
  const rowParts = new Set<SessionPart>();
  const composerParts = new Set<ChatComposerPart>();
  const sideParts = new Set<ChatSidePart>();
  const probe: { commands: PluginCommands | null } = { commands: null };
  const runs: [string, unknown][] = [];
  const activated: string[] = [];
  const harness = startPagePart(workflowPagePart, {
    parts: [probePart(runs, probe)],
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addRowPart: (part: SessionPart) =>
              holdsPart(consumer, rowParts, part),
            addTab: noHandle(consumer),
            setActivity: () => undefined,
            shownSessionId: () =>
              harness.state.read(sessionsActiveSlot, 'test').get() ?? null,
            activate: (sessionId: string) => activated.push(sessionId),
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
            addComposerPart: (part: ChatComposerPart) =>
              holdsPart(consumer, composerParts, part),
            addSidePart(part: ChatSidePart) {
              const held = holdsPart(consumer, sideParts, part);
              if (sidePartDisposeError === null) {
                return held;
              }
              return {
                dispose() {
                  held.dispose();
                  throw sidePartDisposeError;
                },
              };
            },
          }) as unknown as ChatPageExports,
      ),
    ],
  });
  const exportsFor = (consumer: Registrations) =>
    harness.started().exports?.(consumer) as WorkflowPageExports;
  const ids = () => [...sideParts].map((part) => part.id);
  const commands = () => probe.commands!;
  return {
    harness,
    exportsFor,
    rowParts,
    composerParts,
    sideParts,
    ids,
    commands,
    runs,
    activated,
  };
}

function stageOf(id: string, order: number): PageStage {
  return {
    id,
    label: id,
    inStepper: true,
    order,
    actions: [],
    detail: () => '',
    status: () => 'running',
  };
}

// A workflow `small` over a draw that records each strip and draws one `div` for
// each part.
function stubSmall(stages: readonly PageStage[] = [stageOf('build', 10)]) {
  const strips: StripInput[] = [];
  const part = (parent: HTMLElement) => {
    const element = asHtml(new FakeElement('div'));
    parent.append(element);
    return { element, dispose: () => element.remove() };
  };
  const draw: WorkflowDraw = {
    sideTitle: 'List',
    chip: part,
    strip(parent, input) {
      strips.push(input);
      return part(parent);
    },
    sidePane: part,
  };
  const workflow: PageWorkflow = {
    id: 'small',
    label: 'Small',
    badge: 'S',
    stages,
    draw,
    runAction: async () => undefined,
  };
  return { workflow, strips };
}

function flowOfSmall(stage: string): SessionFlow {
  return { ...newFlow('s1', '/p'), workflow: 'small', stage };
}

describe('workflow page part', () => {
  beforeEach(() => {
    drawn.setFlow = [];
    drawn.flows = [];
  });

  afterEach(() => vi.unstubAllGlobals());

  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness } = startWorkflow();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(NONE_LIVE);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startWorkflow();

    await harness.restart();

    expect(Object.keys(harness.started().commands)).toContain('mainAction');
    await harness.stop();
    expect(harness.counts()).toEqual(NONE_LIVE);
  });

  // Breaks if a side part whose dispose throws skips the redraw that removes
  // the workflow's chip.
  it.each([
    { row: 'its side part disposes', error: null },
    { row: 'its side part dispose throws', error: 'side part failed' },
  ])(
    'an added workflow draws, and its consumer dispose removes its chip and side part ($row)',
    ({ error }) => {
      const { harness, exportsFor, rowParts, ids } = startWorkflow(
        error === null ? null : new Error(error),
      );
      const consumer = createRegistrations();
      const { workflow } = stubSmall();
      const wrapper = new FakeElement('div');

      exportsFor(consumer).addWorkflow(workflow);
      harness.state.publish(workflowFlowsSlot).set('s1', flowOfSmall('build'));
      [...rowParts][0].build(asHtml(wrapper), 's1');
      const whileAdded = { chip: wrapper.children.length, ids: ids() };
      if (error === null) {
        consumer.dispose();
      } else {
        expect(() => consumer.dispose()).toThrow(error);
      }

      expect(whileAdded.chip).toBe(1);
      expect(whileAdded.ids).toContain('small.sidePane');
      expect(wrapper.children).toHaveLength(0);
      expect(ids()).not.toContain('small.sidePane');
      expect(() =>
        exportsFor(createRegistrations()).addWorkflow(workflow),
      ).not.toThrow();
    },
  );

  function row(sessionId: string): SessionRow {
    return sessionRow(sessionId, {
      label: sessionId,
      projectDir: '/r',
      hostSessionId: `h-${sessionId}`,
    });
  }

  // A harness past `ready` whose slots held rows and flows of s1, s2 and
  // s3 before it, and the flow of `gone`, which has no row.
  function startWithThreeFlows() {
    const harness = startWorkflow().harness;
    const rows = harness.state.publish(sessionsRowsSlot);
    const flows = harness.state.publish(workflowFlowsSlot);
    for (const sessionId of ['s1', 's2', 's3']) {
      rows.set(sessionId, row(sessionId));
      flows.set(sessionId, newFlow(sessionId, '/r'));
    }
    flows.set('gone', newFlow('gone', '/r'));
    harness.ready();
    return { harness, rows, flows };
  }

  it.each([
    { name: 'page load', restarts: false },
    { name: 'live restart', restarts: true },
  ])(
    'ready_DrawsEachFlowTheSlotHoldsAndOneFlowNoticeDrawsOne: $name',
    async ({ restarts }) => {
      const { harness, flows } = startWithThreeFlows();
      if (restarts) {
        drawn.setFlow = [];
        await harness.restart();
      }
      const drawnAtLoad = drawn.setFlow;
      drawn.setFlow = [];

      flows.set('s2', { ...newFlow('s2', '/r'), stage: 'make' });

      expect([drawnAtLoad, drawn.setFlow]).toEqual([
        ['s1', 's2', 's3'],
        ['s2'],
      ]);
    },
  );

  it('flowNotice_RowHasLeft_DrawsNothing', () => {
    const { rows, flows } = startWithThreeFlows();
    drawn.setFlow = [];

    rows.delete('s2');
    flows.set('s2', { ...newFlow('s2', '/r'), stage: 'make' });

    expect(drawn.setFlow).toEqual([]);
  });

  it('undefinedNotice_KeepsTheDrawnFlow', () => {
    const { flows } = startWithThreeFlows();
    drawn.setFlow = [];

    flows.delete('s2');

    expect(drawn.setFlow).toEqual([]);
  });

  it('exports_AddWorkflow_HeldId_Throws', () => {
    const { exportsFor } = startWorkflow();
    const consumer = createRegistrations();
    const { workflow } = stubSmall();
    exportsFor(consumer).addWorkflow(workflow);

    expect(() => exportsFor(consumer).addWorkflow(workflow)).toThrow(
      'small is already added',
    );
  });

  it('AddWorkflow_Sorts', () => {
    const { harness, exportsFor, composerParts } = startWorkflow();
    harness.state.publish(sessionsRowsSlot).set('s1', row('s1'));
    harness.ready();
    const { workflow, strips } = stubSmall([
      stageOf('later', 20),
      stageOf('first', 10),
    ]);
    exportsFor(createRegistrations()).addWorkflow(workflow);
    [...composerParts][0].build(asHtml(new FakeElement('div')), 's1');

    harness.state.publish(workflowFlowsSlot).set('s1', flowOfSmall('first'));

    expect(strips.at(-1)?.steps.map((step) => step.id)).toEqual([
      'first',
      'later',
    ]);
  });

  it('AddWorkflow_AfterItsFlowArrived_LogsItsLevelAndTrail', () => {
    const { harness, exportsFor } = startWorkflow();
    harness.state.publish(sessionsRowsSlot).set('s1', row('s1'));
    harness.state.publish(workflowFlowsSlot).set('s1', flowOfSmall('build'));
    const { workflow } = stubSmall();

    exportsFor(createRegistrations()).addWorkflow(workflow);

    expect(harness.logs).toEqual(
      expect.arrayContaining([
        { source: 'workflow', message: 's1 level S' },
        { source: 'workflow', message: 's1 trail build' },
      ]),
    );
  });

  // The engine past `ready` holding the workflow `small`, whose stage
  // `build` holds the action `go`, with rows `a` and `b`, `a` selected and `b`'s
  // flow in `build`. `ran` holds each `runAction` call.
  function startWithSmallAction() {
    const started = startWorkflow();
    const { harness, exportsFor } = started;
    const ran: [string, string, SessionFlow][] = [];
    const go = {
      command: 'go',
      label: 'Go',
      available: () => true,
      enabled: () => true,
    };
    const { workflow } = stubSmall([
      { ...stageOf('build', 10), actions: [go] },
    ]);
    exportsFor(createRegistrations()).addWorkflow({
      ...workflow,
      runAction: async (sessionId, command, flow) => {
        ran.push([sessionId, command, flow]);
      },
    });
    const rows = harness.state.publish(sessionsRowsSlot);
    rows.set('a', row('a'));
    rows.set('b', row('b'));
    harness.state.publish(sessionsActiveSlot).set('a');
    const flowOfB = {
      ...newFlow('b', '/r'),
      workflow: 'small',
      stage: 'build',
    };
    harness.state.publish(workflowFlowsSlot).set('b', flowOfB);
    harness.ready();
    return { ...started, ran, flowOfB };
  }

  it.each<{ case: string; arg: StageActionArg; ran: boolean; line?: string }>([
    { case: 'named session', arg: { sessionId: 'b', action: 'go' }, ran: true },
    {
      case: 'main action',
      arg: { sessionId: 'b', action: 'mainAction' },
      ran: true,
    },
    {
      case: 'unknown action',
      arg: { sessionId: 'b', action: 'nope' },
      ran: false,
      line: 'nothing to run for nope in b',
    },
  ])('stageAction_RunsTheGateForTheArgsSession $case', async (row) => {
    const { harness, commands, ran, flowOfB } = startWithSmallAction();

    await commands().run(workflowStageActionCommand, row.arg);

    expect(ran).toEqual(row.ran ? [['b', 'go', flowOfB]] : []);
    if (row.line !== undefined) {
      expect(harness.logs.at(-1)).toEqual({
        source: 'workflow',
        message: row.line,
      });
    }
  });

  // Breaks: a targeted run acting on the selected session instead.
  it.each([
    ['mainAction', undefined, 's1'],
    ['toggleFinishedWaves', undefined, 's1'],
    ['toggleHeadless', undefined, 's1'],
    ['mainAction', 's2', 's2'],
    ['toggleHeadless', 's2', 's2'],
  ] as const)(
    'engineKeys_RunStageActionOnTheSelectedSession %s, target %s',
    async (command, targetSessionId, sessionId) => {
      const { harness, runs } = startWorkflow();
      harness.state.publish(sessionsActiveSlot).set('s1');

      harness.started().commands[command]({ arg: undefined, targetSessionId });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        runs.filter(([id]) => id === workflowStageActionCommand.id),
      ).toEqual([
        [workflowStageActionCommand.id, { sessionId, action: command }],
      ]);
    },
  );

  // Breaks: a workflow key acting on a session the user cannot see, from
  // another mode.
  it.each([
    'mainAction',
    'toggleFinishedWaves',
    'toggleHeadless',
    'toggleSidePane',
  ] as const)('engineKeys_NoShownSession_DoNothing %s', async (command) => {
    const { harness, runs } = startWorkflow();

    harness.started().commands[command]({ arg: undefined });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runs).toEqual([]);
    expect(harness.logs.map((line) => line.message)).not.toContain(
      'side pane hidden',
    );
  });

  // Chat's `chat.session` value for s1, as chat writes it.
  function chatInfo(fields: Partial<ChatSessionInfo> = {}): ChatSessionInfo {
    return {
      sessionId: 's1',
      projectDir: '/p',
      harness: 'fake',
      profile: 'work',
      activity: 'idle',
      background: 0,
      activeTime: { totalMs: 0, since: null },
      running: true,
      pid: null,
      compaction: null,
      repo: 'p',
      branch: null,
      worktrees: [],
      headless: false,
      ...fields,
    };
  }

  it.each([
    {
      given: 'a notice that flips headless',
      before: chatInfo(),
      next: chatInfo({ headless: true }),
      draws: 1,
      headless: true,
    },
    {
      given: 'a notice that changes only activity',
      before: chatInfo(),
      next: chatInfo({ activity: 'working' }),
      draws: 0,
      headless: false,
    },
    {
      given: 'headless before ready, then a notice that turns it off',
      before: chatInfo({ headless: true }),
      next: chatInfo(),
      draws: 1,
      headless: false,
    },
  ])(
    'ready_ChatSessionNotice_PassesHeadlessToTheView $given',
    ({ before, next, draws, headless }) => {
      const { harness, exportsFor, composerParts } = startWorkflow();
      const { workflow, strips } = stubSmall();
      exportsFor(createRegistrations()).addWorkflow(workflow);
      harness.state.publish(sessionsRowsSlot).set('s1', row('s1'));
      harness.state.publish(workflowFlowsSlot).set('s1', flowOfSmall('build'));
      const sessions = harness.state.publish(chatSessionSlot);
      sessions.set('s1', before);
      harness.ready();
      [...composerParts][0].build(asHtml(new FakeElement('div')), 's1');
      const drawsBefore = strips.length;

      sessions.set('s1', next);

      expect(strips.length - drawsBefore).toBe(draws);
      expect(strips.at(-1)?.headless).toBe(headless);
    },
  );

  // The engine past `ready` holding `small`, s1's stored flow in `build`, and s1's
  // row when `hasRow`. `show` shows a sample of s1 in `stage`; `drawnStages` are
  // the stages drawn for s1 since the start was set up.
  function startWithStoredFlow(hasRow: boolean) {
    const started = startWorkflow();
    const { harness, exportsFor } = started;
    const { workflow } = stubSmall(
      ['build', 'check', 'review', 'land'].map((id, index) =>
        stageOf(id, index * 10),
      ),
    );
    exportsFor(createRegistrations()).addWorkflow(workflow);
    const rows = harness.state.publish(sessionsRowsSlot);
    if (hasRow) {
      rows.set('s1', row('s1'));
    }
    const flows = harness.state.publish(workflowFlowsSlot);
    flows.set('s1', flowOfSmall('build'));
    harness.ready();
    drawn.flows = [];
    const exported = exportsFor(createRegistrations());
    return {
      ...started,
      rows,
      flows,
      show: (stage: string) => exported.showSample(flowOfSmall(stage)),
      drawnStages: () =>
        drawn.flows
          .filter((flow) => flow.sessionId === 's1')
          .map((flow) => flow.stage),
    };
  }

  // Breaks: a sample a live signal overwrites, a dispose that strands the
  // sample, or one that clears another step's sample.
  it.each<{
    name: string;
    hasRow: boolean;
    act(started: ReturnType<typeof startWithStoredFlow>): void;
    stages: string[];
    activated: string[];
  }>([
    {
      name: 'draws over a stored flow',
      hasRow: true,
      act: ({ show }) => show('review'),
      stages: ['review'],
      activated: ['s1'],
    },
    {
      name: 'keeps the sample over a stored-flow change',
      hasRow: true,
      act({ show, flows }) {
        show('review');
        flows.set('s1', flowOfSmall('check'));
      },
      stages: ['review'],
      activated: ['s1'],
    },
    {
      name: 'redraws the stored flow at dispose',
      hasRow: true,
      act: ({ show }) => show('review').dispose(),
      stages: ['review', 'build'],
      activated: ['s1'],
    },
    {
      name: 'leaves a newer sample at an older dispose',
      hasRow: true,
      act({ show }) {
        const older = show('review');
        show('land');
        older.dispose();
      },
      stages: ['review', 'land'],
      activated: ['s1', 's1'],
    },
    {
      name: 'draws once its row is added',
      hasRow: false,
      act({ show, rows }) {
        show('review');
        rows.set('s1', row('s1'));
        rows.set('s1', { ...row('s1'), label: 'renamed' });
      },
      stages: ['review'],
      activated: ['s1'],
    },
  ])('showSample $name', ({ hasRow, act, stages, activated }) => {
    const started = startWithStoredFlow(hasRow);

    act(started);

    expect({
      stages: started.drawnStages(),
      activated: started.activated,
    }).toEqual({ stages, activated });
  });

  // Breaks: a click on a demo row that runs a real stage action.
  it('showSample makes the chip buttons inert', async () => {
    const { harness, commands, ran, flowOfB, exportsFor } =
      startWithSmallAction();
    exportsFor(createRegistrations()).showSample({ ...flowOfB });

    await commands().run(workflowStageActionCommand, {
      sessionId: 'b',
      action: 'go',
    });

    expect(ran).toEqual([]);
    expect(harness.logs.at(-1)).toEqual({
      source: 'workflow',
      message: 'preview runs nothing for go',
    });
  });
});
