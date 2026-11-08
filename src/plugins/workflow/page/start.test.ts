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
  type ChatSidePart,
  chatPageKey,
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

// Each session id the view's `setFlow` ran for, in order.
const drawn = vi.hoisted(() => ({ setFlow: [] as string[] }));

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
// sessions' and chat's views do. `commands` is another plugin's, and `runs` holds
// each run its process heard.
function startWorkflow() {
  installFakeDom((name, value) => vi.stubGlobal(name, value));
  const rowParts = new Set<SessionPart>();
  const composerParts = new Set<ChatComposerPart>();
  const sideParts = new Set<ChatSidePart>();
  const probe: { commands: PluginCommands | null } = { commands: null };
  const runs: [string, unknown][] = [];
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
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
            addComposerPart: (part: ChatComposerPart) =>
              holdsPart(consumer, composerParts, part),
            addSidePart: (part: ChatSidePart) =>
              holdsPart(consumer, sideParts, part),
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

// A workflow `light` over a draw that records each strip and draws one `div` for
// each part.
function stubLight(stages: readonly PageStage[] = [stageOf('build', 10)]) {
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
    id: 'light',
    label: 'Light',
    badge: 'L',
    stages,
    draw,
    runAction: async () => undefined,
  };
  return { workflow, strips };
}

function flowOfLight(stage: string): SessionFlow {
  return { ...newFlow('s1', '/p'), workflow: 'light', stage };
}

describe('workflow page part', () => {
  beforeEach(() => {
    drawn.setFlow = [];
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

  it('exports_AddWorkflow_DrawsAndConsumerDisposeRemovesBoth', () => {
    const { harness, exportsFor, rowParts, ids } = startWorkflow();
    const consumer = createRegistrations();
    const { workflow } = stubLight();
    const wrapper = new FakeElement('div');

    exportsFor(consumer).addWorkflow(workflow);
    harness.state.publish(workflowFlowsSlot).set('s1', flowOfLight('build'));
    [...rowParts][0].build(asHtml(wrapper), 's1');
    const whileAdded = { chip: wrapper.children.length, ids: ids() };
    consumer.dispose();

    expect(whileAdded.chip).toBe(1);
    expect(whileAdded.ids).toContain('light.sidePane');
    expect(wrapper.children).toHaveLength(0);
    expect(ids()).not.toContain('light.sidePane');
    expect(() =>
      exportsFor(createRegistrations()).addWorkflow(workflow),
    ).not.toThrow();
  });

  function row(sessionId: string): SessionRow {
    return sessionRow(sessionId, {
      label: sessionId,
      projectDir: '/r',
      hostSessionId: `h-${sessionId}`,
    });
  }

  // A harness past `core.pageReady` whose slots held rows and flows of s1, s2 and
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
    harness.emit('core.pageReady', null);
    return { harness, rows, flows };
  }

  it('pageReady_DrawsEachFlowTheSlotHolds', () => {
    startWithThreeFlows();

    expect(drawn.setFlow).toEqual(['s1', 's2', 's3']);
  });

  it('oneFlowNotice_DrawsOneFlow', () => {
    const { flows } = startWithThreeFlows();
    drawn.setFlow = [];

    flows.set('s2', { ...newFlow('s2', '/r'), stage: 'make' });

    expect(drawn.setFlow).toEqual(['s2']);
  });

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
    const { workflow } = stubLight();
    exportsFor(consumer).addWorkflow(workflow);

    expect(() => exportsFor(consumer).addWorkflow(workflow)).toThrow(
      'light is already added',
    );
  });

  it('AddWorkflow_Sorts', () => {
    const { harness, exportsFor, composerParts } = startWorkflow();
    harness.state.publish(sessionsRowsSlot).set('s1', row('s1'));
    harness.emit('core.pageReady', null);
    const { workflow, strips } = stubLight([
      stageOf('later', 20),
      stageOf('first', 10),
    ]);
    exportsFor(createRegistrations()).addWorkflow(workflow);
    [...composerParts][0].build(asHtml(new FakeElement('div')), 's1');

    harness.state.publish(workflowFlowsSlot).set('s1', flowOfLight('first'));

    expect(strips.at(-1)?.steps.map((step) => step.id)).toEqual([
      'first',
      'later',
    ]);
  });

  it('AddWorkflow_AfterItsFlowArrived_LogsItsLevelAndTrail', () => {
    const { harness, exportsFor } = startWorkflow();
    harness.state.publish(sessionsRowsSlot).set('s1', row('s1'));
    harness.state.publish(workflowFlowsSlot).set('s1', flowOfLight('build'));
    const { workflow } = stubLight();

    exportsFor(createRegistrations()).addWorkflow(workflow);

    expect(harness.logs).toEqual(
      expect.arrayContaining([
        { source: 'workflow', message: 's1 level L' },
        { source: 'workflow', message: 's1 trail build' },
      ]),
    );
  });

  // The engine past `core.pageReady` holding the workflow `light`, whose stage
  // `build` holds the action `go`, with rows `a` and `b`, `a` selected and `b`'s
  // flow in `build`. `ran` holds each `runAction` call.
  function startWithLightAction() {
    const started = startWorkflow();
    const { harness, exportsFor } = started;
    const ran: [string, string, SessionFlow][] = [];
    const go = {
      command: 'go',
      label: 'Go',
      available: () => true,
      enabled: () => true,
    };
    const { workflow } = stubLight([
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
      workflow: 'light',
      stage: 'build',
    };
    harness.state.publish(workflowFlowsSlot).set('b', flowOfB);
    harness.emit('core.pageReady', null);
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
    const { harness, commands, ran, flowOfB } = startWithLightAction();

    await commands().run(workflowStageActionCommand, row.arg);

    expect(ran).toEqual(row.ran ? [['b', 'go', flowOfB]] : []);
    if (row.line !== undefined) {
      expect(harness.logs.at(-1)).toEqual({
        source: 'workflow',
        message: row.line,
      });
    }
  });

  it.each(['mainAction', 'toggleFinishedWaves'] as const)(
    'engineKeys_RunStageActionOnTheSelectedSession %s',
    async (command) => {
      const { harness, runs } = startWorkflow();
      harness.state.publish(sessionsActiveSlot).set('s1');

      harness.started().commands[command]({ arg: undefined });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        runs.filter(([id]) => id === workflowStageActionCommand.id),
      ).toEqual([
        [workflowStageActionCommand.id, { sessionId: 's1', action: command }],
      ]);
    },
  );
});
