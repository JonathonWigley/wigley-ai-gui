// The plan capability's main half: the plan watch of each flow whose workflow
// keeps a plan, and `set_workflow_plan` and the plan report files while an
// enabled workflow keeps one.

import type { AppInstance } from '../../../contracts/app-instance';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { Git } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { appEndpointDir } from '../../../shared/app-endpoint-dir';
import { callEach } from '../../../shared/call-each';
import type { SessionsMainExports } from '../../sessions/contract';
import {
  type DeclaredWorkflow,
  type FoldEvent,
  type SessionFlow,
  WORKFLOW_OFFLINE_ANSWER,
  type WorkflowMainExports,
} from '../contract';
import { usesPlan } from '../declared/uses-plan';
import {
  planReporter,
  planWorkflowOf,
  type PlanReporterDeps,
} from './plan-report';
import { createPlanReports, PLAN_RUNS_FOLDER } from './plan-reports';
import {
  planToolDefinition,
  SET_WORKFLOW_PLAN_TOOL,
  startPlanTool,
} from './plan-tool';
import { createPlanWatch, type FollowedPlan } from './plan-watch';
import { isPlanFilePath } from './read-plan';

export interface PlanCapabilityDeps {
  git: Pick<Git, 'topLevel' | 'worktrees' | 'commonDir'>;
  files: Pick<
    Files,
    'read' | 'modified' | 'list' | 'realPath' | 'stat' | 'watch'
  >;
  paths: Paths;
  log: PluginLog;
  homeDir: string;
  appInstance: Pick<AppInstance, 'id'>;
  sessions: Pick<SessionsMainExports, 'contributeTools'>;
  // The engine's.
  signal: WorkflowMainExports['signal'];
  flowOf: WorkflowMainExports['flowOf'];
  flows: WorkflowMainExports['flows'];
  observe: WorkflowMainExports['observe'];
  ready: Promise<void>;
  // The enabled declared workflows.
  enabledWorkflows(): readonly DeclaredWorkflow[];
  onWorkflowsChanged(
    listener: (workflows: readonly DeclaredWorkflow[]) => void,
  ): Disposable;
  workflowOf(flow: SessionFlow): DeclaredWorkflow | null;
}

const ACTIVITY_SIGNALS: ReadonlySet<string> = new Set([
  'turnStarted',
  'turnEnded',
  'subagentStarted',
  'subagentFinished',
]);

const NO_FOLLOWED_PLAN: FollowedPlan = {
  dir: null,
  reported: false,
  unreportedDir: null,
  format: null,
};

// As one engine observer, runs the plan watch of each flow whose workflow keeps
// a plan, signalling what it reads as `observed`; `set_workflow_plan` and the
// plan report files under `<endpoint dir>/plan-runs` move a flow's watch to the
// copy its run writes, and run while an enabled workflow keeps a plan. Start
// it once flows load: every flow held then follows its plan, since a restarted
// part hears no `opened`.
export function startPlanCapability(deps: PlanCapabilityDeps): Disposable {
  const { paths, log } = deps;
  const planWatch = createPlanWatch({
    git: deps.git,
    files: deps.files,
    paths,
    log,
    signal: (sessionId, signal) => deps.signal(sessionId, signal, 'observed'),
  });

  // The flow's declared workflow when it keeps a plan, else null.
  const planWorkflowHolding = (flow: SessionFlow): DeclaredWorkflow | null => {
    const workflow = deps.workflowOf(flow);
    return workflow !== null && usesPlan(workflow.decl) ? workflow : null;
  };

  const followedOf = (
    flow: SessionFlow,
    workflow: DeclaredWorkflow,
  ): FollowedPlan => ({
    dir: flow.plan?.dir ?? null,
    reported: flow.plan?.reported ?? false,
    unreportedDir: flow.plan?.unreportedDir ?? null,
    format: workflow.planFormat,
  });

  // Whether the flow sits in a stage that finishes and reopens its workflow.
  const sitsInReopeningStage = (
    flow: SessionFlow,
    workflow: DeclaredWorkflow,
  ) => {
    const stage = workflow.decl.stages.find((held) => held.id === flow.stage);
    return stage?.finishes === true && stage.reopens === true;
  };

  // A finished run's watch closed with its `planGone`: each turn or subagent
  // start or end checks the plan again and follows it, which reopens a closed
  // watch, so a plan folder a branch switch brought back is read while the
  // run still works, however many boundaries passed idle.
  const followPlan = (
    { sessionId, before, after, signal }: FoldEvent,
    workflow: DeclaredWorkflow,
  ) => {
    const finishedRunMoved =
      sitsInReopeningStage(after, workflow) &&
      (after.plan?.dir ?? null) !== null &&
      ACTIVITY_SIGNALS.has(signal.type);
    if (signal.type === 'turnEnded' || finishedRunMoved) {
      planWatch.check(sessionId);
    }
    const wrotePlan =
      signal.type === 'fileWritten' &&
      isPlanFilePath(signal.path, workflow.planFormat);
    const followedPlanChanged =
      (after.plan?.dir ?? null) !== (before.plan?.dir ?? null) ||
      (after.plan?.reported ?? false) !== (before.plan?.reported ?? false) ||
      (after.plan?.unreportedDir ?? null) !==
        (before.plan?.unreportedDir ?? null);
    if (wrotePlan || followedPlanChanged || finishedRunMoved) {
      planWatch.follow(sessionId, followedOf(after, workflow));
    }
  };

  const stopSession = (sessionId: string) => {
    planWatch.follow(sessionId, NO_FOLLOWED_PLAN);
  };

  const follow = (flow: SessionFlow) => {
    const workflow = planWorkflowHolding(flow);
    if (workflow !== null) {
      planWatch.follow(flow.sessionId, followedOf(flow, workflow));
    }
  };

  const observer = deps.observe({
    folded(event) {
      const workflow = planWorkflowHolding(event.after);
      if (workflow === null) {
        if (planWorkflowHolding(event.before) !== null) {
          stopSession(event.sessionId);
        }
        return;
      }
      if (event.whole) {
        followPlan(event, workflow);
      }
    },
    opened: follow,
    closed: stopSession,
    replaying: () => undefined,
  });
  for (const flow of deps.flows()) {
    follow(flow);
  }

  const reporterDeps: PlanReporterDeps = {
    workflow: { ready: deps.ready, flowOf: deps.flowOf, signal: deps.signal },
    workflowOf: deps.workflowOf,
  };
  const reportPlan = planReporter(reporterDeps);
  // The tool and the report files, while an enabled workflow keeps a plan.
  let planInputs: Disposable[] | null = null;
  const syncPlanInputs = (workflows: readonly DeclaredWorkflow[]) => {
    const keepsPlan = workflows.some((workflow) => usesPlan(workflow.decl));
    if (keepsPlan && planInputs === null) {
      planInputs = [
        deps.sessions.contributeTools(
          [planToolDefinition()],
          startPlanTool({
            paths,
            files: deps.files,
            reportPlan,
            planWorkflowOf: (sessionId) =>
              planWorkflowOf(reporterDeps, sessionId),
          }),
          {
            mainAgentOnly: true,
            offline: { [SET_WORKFLOW_PLAN_TOOL]: WORKFLOW_OFFLINE_ANSWER },
          },
        ),
        createPlanReports({
          files: deps.files,
          paths,
          log,
          folder: paths.join(
            appEndpointDir(paths, deps.homeDir, deps.appInstance.id),
            PLAN_RUNS_FOLDER,
          ),
          reportPlan,
        }),
      ];
    } else if (!keepsPlan && planInputs !== null) {
      callEach(planInputs, (each) => each.dispose());
      planInputs = null;
    }
  };
  syncPlanInputs(deps.enabledWorkflows());
  const workflowsListener = deps.onWorkflowsChanged(syncPlanInputs);

  return {
    dispose() {
      callEach<Disposable>(
        [
          workflowsListener,
          observer,
          { dispose: () => syncPlanInputs([]) },
          planWatch,
        ],
        (each) => each.dispose(),
      );
    },
  };
}
