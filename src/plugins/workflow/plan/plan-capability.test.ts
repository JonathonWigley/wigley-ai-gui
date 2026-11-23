import { describe, expect, it } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  AgentSession,
  ContributeToolsOptions,
  ToolCallContext,
  ToolDefinition,
  ToolSession,
} from '../../sessions/contract';
import {
  CHECKLIST_WORKFLOW,
  CHECKLIST_WORKFLOW_ID,
  type DeclaredWorkflow,
  type MainWorkflow,
  type PlanState,
  type SessionFlow,
  type SignalOrigin,
  type WorkflowObserver,
  type WorkflowSignal,
  WORKFLOW_OFFLINE_ANSWER,
} from '../contract';
import { buildMainWorkflow } from '../declared/build-main';
import { foldFlow, newFlow } from '../flow';
import { startPlanCapability } from './plan-capability';
import {
  PLAN_SKILL,
  PLAN_WORKFLOW_ID,
  planWorkflowFixture,
  USER_PLAN_FORMAT,
} from './plan-fixtures.test-support';
import { createPlanFold } from './plan-fold';
import { PLAN_RUNS_FOLDER } from './plan-reports';
import { SET_WORKFLOW_PLAN_TOOL } from './plan-tool';
import { readPlan } from './read-plan';

const PLAN_DIR = '/r/docs/features/x/plan-a';
const PLAN_FILE = `${PLAN_DIR}/plan.md`;
const PLAN =
  '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [ ] two\n- [ ] three\n';
const PLAN_TICKED =
  '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [x] two\n- [ ] three\n';
// The plan folder's copy in a worktree, outside the clone the test git finds.
const W_PLAN_DIR = '/w/docs/features/x/plan-a';
// s1's plan report file, in the endpoint folder of the home `/home` and the
// app instance `app`.
const S1_PLAN_RUN_FILE = `/home/.agents/app/${PLAN_RUNS_FOLDER}/s1.json`;

const NO_CALL_CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

const settled = () => new Promise((settle) => setImmediate(settle));

const progressOf = (text: string) =>
  readPlan(text, new Map(), USER_PLAN_FORMAT);

// A declared workflow keeping no plan, claimed by `test:other`.
const OTHER_WORKFLOW: DeclaredWorkflow = {
  id: 'test:other',
  pluginName: 'test',
  planFormat: USER_PLAN_FORMAT,
  decl: {
    ...CHECKLIST_WORKFLOW,
    id: 'other',
    order: 10,
    claims: ['test:other'],
  },
};

const CHECKLIST_DECLARED: DeclaredWorkflow = {
  id: CHECKLIST_WORKFLOW_ID,
  pluginName: '',
  decl: CHECKLIST_WORKFLOW,
  planFormat: null,
};

function skill(name: string, argsPath: string | null): WorkflowSignal {
  return { type: 'skillStarted', skill: name, args: argsPath ?? '', argsPath };
}

function planHeld(fields: Partial<PlanState>): PlanState {
  return {
    dir: null,
    reported: false,
    unreportedDir: null,
    progress: null,
    snapshots: {},
    ...fields,
  };
}

// The plan capability over an engine of its own: each signal folds through
// the real `foldFlow` and each enabled workflow's `buildMainWorkflow` with the
// real plan fold, and the observers hear every fold, as the engine's do.
// `project` holds the project files the capability reads, a fresh one unless
// given, and `projectReads` each path it read; while `silent` is set its
// watches hear nothing. `held` are the flows the engine holds when the
// capability starts.
function startCapability(
  options: {
    workflows?: readonly DeclaredWorkflow[];
    held?: readonly SessionFlow[];
    project?: MemoryFiles;
  } = {},
) {
  let enabled = options.workflows ?? [planWorkflowFixture(), OTHER_WORKFLOW];
  const workflowsListeners = new Set<
    (workflows: readonly DeclaredWorkflow[]) => void
  >();
  const planFold = createPlanFold();
  const engineWorkflows = (): MainWorkflow[] =>
    [...enabled, CHECKLIST_DECLARED]
      .map((workflow) => buildMainWorkflow(workflow, planFold))
      .sort((a, b) => a.order - b.order);
  const flows = new Map<string, SessionFlow>(
    (options.held ?? []).map((flow) => [flow.sessionId, flow]),
  );
  const observers: WorkflowObserver[] = [];
  const signals: [WorkflowSignal, SignalOrigin][] = [];
  const apply = (
    sessionId: string,
    signal: WorkflowSignal,
    origin: SignalOrigin = 'live',
  ) => {
    const before = flows.get(sessionId);
    if (before === undefined) {
      return;
    }
    signals.push([signal, origin]);
    const after = foldFlow(before, signal, engineWorkflows());
    flows.set(sessionId, after);
    for (const observer of [...observers]) {
      observer.folded({
        sessionId,
        before,
        after,
        signal,
        origin,
        whole: true,
      });
    }
  };

  const project = options.project ?? createMemoryFiles();
  const projectReads: string[] = [];
  let silent = false;
  const files: Files = {
    ...project,
    read: (path) => {
      projectReads.push(path);
      return project.read(path);
    },
    watch: (folder, onChange, watchOptions) =>
      project.watch(
        folder,
        (path) => {
          if (!silent) {
            onChange(path);
          }
        },
        watchOptions,
      ),
  };
  const contributions: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
    options: ContributeToolsOptions | undefined;
  }[] = [];
  const logs: string[] = [];

  const capability = startPlanCapability({
    git: {
      topLevel: async () => null,
      worktrees: async () => [],
      commonDir: async () => '/r/.git',
    },
    files,
    paths: posixPaths,
    log: (line) => logs.push(line),
    homeDir: '/home',
    appInstance: { id: 'app' },
    sessions: {
      contributeTools: (tools, start, contributeOptions) => {
        const contribution = { tools, start, options: contributeOptions };
        contributions.push(contribution);
        return {
          dispose: () => {
            contributions.splice(contributions.indexOf(contribution), 1);
          },
        };
      },
    },
    signal: (sessionId, signal, origin) => apply(sessionId, signal, origin),
    flowOf: (sessionId) => flows.get(sessionId) ?? null,
    flows: () => [...flows.values()],
    observe: (observer): Disposable => {
      observers.push(observer);
      return {
        dispose: () => {
          observers.splice(observers.indexOf(observer), 1);
        },
      };
    },
    ready: Promise.resolve(),
    enabledWorkflows: () => enabled,
    onWorkflowsChanged: (listener) => {
      workflowsListeners.add(listener);
      return { dispose: () => workflowsListeners.delete(listener) };
    },
    workflowOf: (flow) =>
      enabled.find((workflow) => workflow.id === flow.workflow) ?? null,
  });

  // A signal of s1, then whatever the capability reads after it.
  const signal = async (sent: WorkflowSignal) => {
    apply('s1', sent);
    await settled();
    await settled();
  };
  const contributionOf = (name: string) =>
    contributions.find(({ tools }) => tools.some((tool) => tool.name === name));
  return {
    project,
    projectReads,
    signals,
    logs,
    contributions,
    contributionOf,
    capability,
    signal,
    setSilent: (next: boolean) => {
      silent = next;
    },
    open: async () => {
      const flow = newFlow('s1', '/r');
      flows.set('s1', flow);
      for (const observer of [...observers]) {
        observer.opened(flow);
      }
      await settled();
    },
    lastFlow: () => flows.get('s1') ?? null,
    setWorkflows: (next: readonly DeclaredWorkflow[]) => {
      enabled = next;
      for (const listener of workflowsListeners) {
        listener(next);
      }
    },
    callPlanTool: async (folder: string) => {
      const contribution = contributionOf(SET_WORKFLOW_PLAN_TOOL);
      if (contribution === undefined) {
        throw new Error(`no contribution of ${SET_WORKFLOW_PLAN_TOOL}`);
      }
      const result = await contribution
        .start({ id: 's1' } as AgentSession)
        .call(SET_WORKFLOW_PLAN_TOOL, { folder }, NO_CALL_CONTEXT);
      await settled();
      return result;
    },
  };
}

// The capability started while the engine holds `held` as s1's flow, over a
// project whose `PLAN_FILE` holds `PLAN`, once its first reads settle.
async function startHolding(held: SessionFlow) {
  const project = createMemoryFiles();
  await project.write(PLAN_FILE, PLAN);
  const subject = startCapability({ held: [held], project });
  await settled();
  await settled();
  return subject;
}

// The capability with s1 open and in `make` on `PLAN_DIR`, its plan read.
async function startInMake(options: { silent?: boolean } = {}) {
  const subject = startCapability();
  subject.setSilent(options.silent ?? false);
  await subject.project.write(PLAN_FILE, PLAN);
  await subject.open();
  await subject.signal(skill(PLAN_SKILL, PLAN_DIR));
  return subject;
}

describe('startPlanCapability', () => {
  it('turnEndedChangingNoField_StillChecksThePlan', async () => {
    const subject = await startInMake({ silent: true });
    expect(subject.lastFlow()).toMatchObject({
      workflow: PLAN_WORKFLOW_ID,
      stage: 'make',
      turnRunning: false,
      plan: { dir: PLAN_DIR, progress: progressOf(PLAN) },
    });

    subject.project.remove(PLAN_DIR);
    await subject.signal({ type: 'turnEnded' });

    expect(subject.lastFlow()?.stage).toBe('closed');
  });

  it('planFileWrittenAfterPlanGone_ReadsThePlanAgain', async () => {
    const subject = await startInMake();
    subject.project.remove(PLAN_DIR);
    await settled();
    expect(subject.lastFlow()?.stage).toBe('closed');

    await subject.signal({ type: 'turnStarted' });
    await subject.project.write(PLAN_FILE, PLAN_TICKED);
    await subject.signal({ type: 'fileWritten', path: PLAN_FILE });

    expect(subject.lastFlow()?.plan?.progress).toEqual(progressOf(PLAN_TICKED));
    expect(subject.lastFlow()?.stage).toBe('make');
  });

  it('planFolderBackReadIdle_NextTurnStartReopens', async () => {
    const subject = await startInMake();
    subject.project.remove(PLAN_DIR);
    await settled();
    await subject.project.write(PLAN_FILE, PLAN_TICKED);
    await subject.signal({ type: 'turnEnded' });
    expect(subject.lastFlow()?.stage).toBe('closed');

    await subject.signal({ type: 'turnStarted' });

    expect(subject.lastFlow()?.stage).toBe('make');
  });

  it('PlanTool_ContributedForTheMainAgentOnly', () => {
    const subject = startCapability();

    expect(subject.contributionOf(SET_WORKFLOW_PLAN_TOOL)?.options).toEqual({
      mainAgentOnly: true,
      offline: { [SET_WORKFLOW_PLAN_TOOL]: WORKFLOW_OFFLINE_ANSWER },
    });
  });

  // Breaks if the report files are read with no plan workflow enabled: the
  // capability would open a watch on the endpoint folder, making it.
  it('PlanTool_NoEnabledPlanWorkflow_NotContributed', async () => {
    const subject = startCapability({ workflows: [OTHER_WORKFLOW] });
    await settled();

    expect(subject.contributions).toEqual([]);
    expect(await subject.project.stat('/home/.agents/app')).toBeNull();
  });

  it('PlanTool_PlanWorkflowSwitchedOn_Contributed', () => {
    const subject = startCapability({ workflows: [] });

    subject.setWorkflows([planWorkflowFixture()]);
    subject.setWorkflows([planWorkflowFixture(), OTHER_WORKFLOW]);
    const whileOn = subject.contributions.length;
    subject.setWorkflows([OTHER_WORKFLOW]);

    expect(whileOn).toBe(1);
    expect(subject.contributions).toEqual([]);
  });

  it.each([
    {
      name: 'set_workflow_plan of a worktree copy',
      source: 'tool',
      folder: W_PLAN_DIR,
      expected: {
        dir: W_PLAN_DIR,
        reported: true,
        unreportedDir: PLAN_DIR,
        plan: PLAN_TICKED,
      },
    },
    {
      name: 'a report file naming a worktree copy',
      source: 'file',
      folder: W_PLAN_DIR,
      expected: {
        dir: W_PLAN_DIR,
        reported: true,
        unreportedDir: PLAN_DIR,
        plan: PLAN_TICKED,
      },
    },
    {
      name: 'set_workflow_plan of the folder already held',
      source: 'tool',
      folder: PLAN_DIR,
      expected: {
        dir: PLAN_DIR,
        reported: true,
        unreportedDir: null,
        plan: PLAN,
      },
    },
  ])(
    'PlanReport_FoldsIntoTheFlow ($name)',
    async ({ source, folder, expected }) => {
      const subject = await startInMake();
      await subject.project.write(`${W_PLAN_DIR}/plan.md`, PLAN_TICKED);

      if (source === 'tool') {
        await subject.callPlanTool(folder);
      } else {
        await subject.project.write(
          S1_PLAN_RUN_FILE,
          `${JSON.stringify({ planDir: folder })}\n`,
        );
      }
      await settled();
      await settled();

      expect(subject.lastFlow()?.plan).toMatchObject({
        dir: expected.dir,
        reported: expected.reported,
        unreportedDir: expected.unreportedDir,
        progress: progressOf(expected.plan),
      });
    },
  );

  it('restartOverAReportedFolderGone_ReadsTheUnreportedMainCopy', async () => {
    const held: SessionFlow = {
      ...newFlow('s1', '/r'),
      workflow: PLAN_WORKFLOW_ID,
      stage: 'make',
      plan: planHeld({
        dir: W_PLAN_DIR,
        reported: true,
        unreportedDir: PLAN_DIR,
      }),
    };
    const subject = await startHolding(held);

    expect(subject.lastFlow()?.stage).toBe('make');
    expect(subject.lastFlow()?.plan).toMatchObject({
      dir: W_PLAN_DIR,
      progress: progressOf(PLAN),
    });
  });

  it('startWithFlowsHeld_FollowsTheirPlans', async () => {
    const held: SessionFlow = {
      ...newFlow('s1', '/r'),
      workflow: PLAN_WORKFLOW_ID,
      stage: 'make',
      plan: planHeld({ dir: PLAN_DIR }),
    };

    const subject = await startHolding(held);

    expect(subject.lastFlow()?.plan?.progress).toEqual(progressOf(PLAN));
  });

  it('subagentPlanWrite_NamesThePlanAndWatchesIt', async () => {
    const subject = startCapability();
    await subject.project.write('/r/docs/plan-a/plan.md', PLAN);
    await subject.open();
    await subject.signal(skill(PLAN_SKILL, null));

    await subject.signal({
      type: 'fileWritten',
      path: '/r/docs/plan-a/plan.md',
    });
    await subject.project.write('/r/docs/plan-a/plan.md', PLAN_TICKED);
    await settled();
    await settled();

    expect(subject.lastFlow()?.plan).toMatchObject({
      dir: '/r/docs/plan-a',
      progress: progressOf(PLAN_TICKED),
    });
  });

  it('checklistWorkflowFlow_IsNotWatched', async () => {
    const subject = startCapability();
    await subject.project.write(PLAN_FILE, PLAN);
    await subject.open();

    await subject.signal({ type: 'fileWritten', path: PLAN_FILE });

    expect(subject.lastFlow()).toMatchObject({
      workflow: CHECKLIST_WORKFLOW_ID,
      plan: null,
    });
    expect(subject.projectReads).toEqual([]);
  });

  it('FlowLeavingAPlanWorkflow_StopsItsWatch', async () => {
    const subject = await startInMake();

    await subject.signal(skill('test:other', null));
    expect(subject.lastFlow()?.workflow).toBe(OTHER_WORKFLOW.id);
    const signalsBefore = subject.signals.length;
    subject.project.remove(PLAN_DIR);
    await settled();
    await subject.signal({ type: 'turnEnded' });

    expect(
      subject.signals
        .slice(signalsBefore)
        .filter(([, origin]) => origin === 'observed'),
    ).toEqual([]);
  });

  it('dispose_StopsTheWatchAndTheTool', async () => {
    const subject = await startInMake();
    const signalsBefore = subject.signals.length;

    subject.capability.dispose();
    await subject.project.write(PLAN_FILE, PLAN_TICKED);
    await settled();

    expect(subject.contributions).toEqual([]);
    expect(subject.signals.slice(signalsBefore)).toEqual([]);
  });
});
