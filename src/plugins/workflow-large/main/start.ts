import type { MainApi, MainPart } from '../../../contracts/plugin';
import { appEndpointDir } from '../../../shared/app-endpoint-dir';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import {
  type FoldEvent,
  type SessionFlow,
  WORKFLOW_OFFLINE_ANSWER,
  workflowMainKey,
} from '../../workflow/contract';
import {
  EMPTY_LARGE_STATE,
  LARGE_WORKFLOW_ID,
  type LargeState,
  largeStateOf,
  type WorkflowLargeChannel,
  withLargeState,
} from '../contract';
import { isPlanFile } from '../large-state';
import { largeMainWorkflow } from '../large-workflow';
import { workflowLargeManifest } from '../manifest';
import { LARGE_MAIN_STAGES } from '../stages';
import { createWorkflowActions } from './actions';
import { createCountdown } from './countdown';
import { createPlanReports, PLAN_RUNS_FOLDER } from './plan-reports';
import { largePlanReporter } from './plan-report';
import {
  planToolDefinition,
  SET_WORKFLOW_PLAN_TOOL,
  startPlanTool,
} from './plan-tool';
import { createPlanWatch } from './plan-watch';
import { workflowLargeSelfTestScript } from './selftest-script';

type WorkflowLargeApi = MainApi<
  typeof workflowLargeManifest,
  WorkflowLargeChannel
>;

const ACTIVITY_SIGNALS: ReadonlySet<string> = new Set([
  'turnStarted',
  'turnEnded',
  'subagentStarted',
  'subagentFinished',
]);

const autoCommandOf = (stageId: string): string | undefined =>
  LARGE_MAIN_STAGES.find((stage) => stage.id === stageId)?.autoCommand;

// Large, the plan-driven workflow: adds its stages and state to the engine, and as
// one engine observer runs the plan watch of each Large flow and the plan-ready
// auto-start countdown; `set_workflow_plan` and `plan.py`'s report files move a
// flow's watch to the copy its run writes; the page runs its main-side commands over `runAction`. Every
// write goes through `setState`, which keeps the flow's save time, on a fresh flow,
// since a plan read can signal while an observer call runs.
export const workflowLargeMainPart: MainPart<typeof workflowLargeManifest> = {
  manifest: workflowLargeManifest,
  start(api: WorkflowLargeApi) {
    const { services, channel } = api;
    const { clock, log } = services;
    const workflow = api.dependency(workflowMainKey);
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    api.layouts.register({ layoutTypes: workflow.layoutTypes });
    workflow.addWorkflow(largeMainWorkflow);

    // Sessions whose last turn end was replayed, until a live turn starts or
    // ends: the plan read such a turn causes settles after its replay, as a plain
    // signal.
    const replayedTurnEnds = new Set<string>();

    const planWatch = createPlanWatch({
      git: services.git,
      files: services.files,
      paths: services.paths,
      log,
      signal: (sessionId, signal) =>
        workflow.signal(sessionId, signal, 'observed'),
    });
    const reportPlan = largePlanReporter(workflow);
    sessions.contributeTools(
      [planToolDefinition()],
      startPlanTool({
        paths: services.paths,
        files: services.files,
        reportPlan,
      }),
      {
        mainAgentOnly: true,
        offline: { [SET_WORKFLOW_PLAN_TOOL]: WORKFLOW_OFFLINE_ANSWER },
      },
    );
    const planRunsFolder = services.paths.join(
      appEndpointDir(services.paths, services.homeDir, services.appInstance.id),
      PLAN_RUNS_FOLDER,
    );
    const planReports = createPlanReports({
      files: services.files,
      paths: services.paths,
      log,
      folder: planRunsFolder,
      reportPlan,
    });
    const countdown = createCountdown({
      timers: services.timers,
      clock,
      fire: (sessionId) => fireCountdown(sessionId),
    });
    let isStopped = false;
    const actions = createWorkflowActions({
      chat,
      log,
      flowOf: (sessionId) => workflow.flowOf(sessionId),
      signal: (sessionId, signal) => workflow.signal(sessionId, signal, 'live'),
      cancelCountdown: (sessionId) => cancelCountdown(sessionId),
      isStopped: () => isStopped,
    });

    const syncCountdown = (sessionId: string) => {
      const flow = workflow.flowOf(sessionId);
      if (flow !== null) {
        countdown.sync(flow);
      }
    };

    const patchState = (flow: SessionFlow, patch: Partial<LargeState>) => {
      workflow.setState(flow.sessionId, withLargeState(flow, patch).state);
      syncCountdown(flow.sessionId);
    };

    const countingDownFlow = (sessionId: string): SessionFlow | null => {
      const flow = workflow.flowOf(sessionId);
      const countsDown =
        flow?.workflow === LARGE_WORKFLOW_ID &&
        largeStateOf(flow).countdownEndsAt !== null;
      return countsDown ? flow : null;
    };

    function cancelCountdown(sessionId: string): void {
      const flow = countingDownFlow(sessionId);
      if (flow !== null) {
        patchState(flow, { countdownEndsAt: null });
      }
    }

    function fireCountdown(sessionId: string): void {
      const flow = countingDownFlow(sessionId);
      if (flow === null) {
        return;
      }
      patchState(flow, { countdownEndsAt: null });
      const command = autoCommandOf(flow.stage);
      if (command === undefined) {
        return;
      }
      const name =
        sessions.label(sessionId) ?? services.paths.base(flow.projectDir);
      actions.run(sessionId, command).then(
        (ran) => {
          if (ran && !isStopped) {
            log(`ran ${command} in ${name}`);
          }
        },
        (error: unknown) => {
          if (!isStopped) {
            log(`auto-start failed: ${errorText(error)}`);
          }
        },
      );
    }

    const noteTurnBoundary = ({ sessionId, signal, origin }: FoldEvent) => {
      if (signal.type === 'turnEnded' && origin === 'replay') {
        replayedTurnEnds.add(sessionId);
      }
      const isLiveBoundary =
        origin === 'live' &&
        (signal.type === 'turnStarted' || signal.type === 'turnEnded');
      if (isLiveBoundary) {
        replayedTurnEnds.delete(sessionId);
      }
    };

    // A closed run's watch closed with its `planGone`: each turn or subagent
    // start or end checks the plan again and follows it, which reopens a
    // closed watch, so a plan folder a branch switch brought back is read
    // while the run still works, however many boundaries passed idle.
    const followPlan = ({ sessionId, before, after, signal }: FoldEvent) => {
      const plan = largeStateOf(after);
      const was = largeStateOf(before);
      const closedRunMoved =
        after.stage === 'closed' &&
        plan.planDir !== null &&
        ACTIVITY_SIGNALS.has(signal.type);
      if (signal.type === 'turnEnded' || closedRunMoved) {
        planWatch.check(sessionId);
      }
      const wrotePlan =
        signal.type === 'fileWritten' && isPlanFile(signal.path);
      const followedPlanChanged =
        plan.planDir !== was.planDir ||
        plan.planReported !== was.planReported ||
        plan.unreportedPlanDir !== was.unreportedPlanDir;
      if (wrotePlan || followedPlanChanged || closedRunMoved) {
        planWatch.follow(sessionId, plan);
      }
    };

    // The countdown a flow that just entered an auto-start stage begins.
    const startCountdown = ({
      sessionId,
      before,
      after,
      origin,
    }: FoldEvent) => {
      const flow = workflow.flowOf(sessionId);
      if (flow?.workflow !== LARGE_WORKFLOW_ID) {
        return;
      }
      const settings = api.settings();
      const startsCountdown =
        origin !== 'replay' &&
        !replayedTurnEnds.has(sessionId) &&
        after.stage !== before.stage &&
        autoCommandOf(after.stage) !== undefined &&
        largeStateOf(flow).countdownEndsAt === null &&
        settings.autoClearAndMake;
      if (startsCountdown) {
        patchState(flow, {
          countdownEndsAt:
            clock.now() + Math.max(1, settings.autoStartSeconds) * 1000,
        });
      }
    };

    const stopSession = (sessionId: string) => {
      countdown.stop(sessionId);
      planWatch.follow(sessionId, EMPTY_LARGE_STATE);
      replayedTurnEnds.delete(sessionId);
    };

    const follow = (flow: SessionFlow) => {
      if (flow.workflow === LARGE_WORKFLOW_ID) {
        planWatch.follow(flow.sessionId, largeStateOf(flow));
        cancelCountdown(flow.sessionId);
      }
    };

    workflow.observe({
      folded(event) {
        const { sessionId, before, after, whole } = event;
        if (after.workflow !== LARGE_WORKFLOW_ID) {
          if (before.workflow === LARGE_WORKFLOW_ID) {
            stopSession(sessionId);
          }
          return;
        }
        noteTurnBoundary(event);
        if (whole) {
          followPlan(event);
          startCountdown(event);
        }
        syncCountdown(sessionId);
      },
      opened: follow,
      closed: stopSession,
      replaying: cancelCountdown,
    });
    // A restarted part never hears `opened` for a flow already open.
    for (const flow of workflow.flows()) {
      follow(flow);
    }

    api.onSettingsChanged((settings) => {
      void workflow.ready.then(() => {
        if (isStopped) {
          return;
        }
        const onOff = settings.autoClearAndMake ? 'on' : 'off';
        const seconds = Math.max(1, settings.autoStartSeconds);
        log(
          `settings: autoClearAndMake ${onOff}, autoStartSeconds ${String(seconds)}`,
        );
        if (!settings.autoClearAndMake) {
          for (const flow of workflow.flows()) {
            cancelCountdown(flow.sessionId);
          }
        }
      });
    });

    channel.handle('runAction', ({ sessionId, command }) =>
      workflow.ready.then(async () => {
        if (isStopped) {
          return;
        }
        await actions.run(sessionId, command);
      }),
    );

    if (services.selfTest !== null && workflow.selfTestHooks !== null) {
      services.selfTest.run(
        workflowLargeSelfTestScript({
          homeDir: services.homeDir,
          files: services.files,
          chat,
          sessions,
          harnesses: services.agentHarnesses,
          hooks: workflow.selfTestHooks,
          planRunsFolder,
        }),
      );
    }

    return {
      commands: {},
      dispose: () => {
        isStopped = true;
        callEach([planReports, planWatch], (each) => each.dispose());
      },
    };
  },
};
