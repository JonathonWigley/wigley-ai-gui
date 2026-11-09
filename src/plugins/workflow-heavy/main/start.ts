import type { MainApi, MainPart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import {
  type FoldEvent,
  type SessionFlow,
  workflowMainKey,
} from '../../workflow/contract';
import {
  HEAVY_WORKFLOW_ID,
  type HeavyState,
  heavyStateOf,
  type WorkflowHeavyChannel,
  withHeavyState,
} from '../contract';
import { isPlanFile } from '../heavy-state';
import { heavyMainWorkflow } from '../heavy-workflow';
import { workflowHeavyManifest } from '../manifest';
import { HEAVY_MAIN_STAGES } from '../stages';
import { createWorkflowActions } from './actions';
import { createCountdown } from './countdown';
import { createPlanWatch } from './plan-watch';
import { workflowHeavySelfTestScript } from './selftest-script';

type WorkflowHeavyApi = MainApi<
  typeof workflowHeavyManifest,
  WorkflowHeavyChannel
>;

const autoCommandOf = (stageId: string): string | undefined =>
  HEAVY_MAIN_STAGES.find((stage) => stage.id === stageId)?.autoCommand;

// Heavy, the plan-driven workflow: adds its stages and state to the engine, and as
// one engine observer runs the plan watch of each Heavy flow and the plan-ready
// auto-start countdown; the page runs its main-side commands over `runAction`. Every
// write goes through `setState`, which keeps the flow's save time, on a fresh flow,
// since a plan read can signal while an observer call runs.
export const workflowHeavyMainPart: MainPart<typeof workflowHeavyManifest> = {
  manifest: workflowHeavyManifest,
  start(api: WorkflowHeavyApi) {
    const { services, channel } = api;
    const { clock, log } = services;
    const workflow = api.dependency(workflowMainKey);
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    api.layouts.register({ layoutTypes: workflow.layoutTypes });
    workflow.addWorkflow(heavyMainWorkflow);

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
    const countdown = createCountdown({
      timers: services.timers,
      clock,
      fire: (sessionId) => fireCountdown(sessionId),
    });
    const actions = createWorkflowActions({
      chat,
      log,
      flowOf: (sessionId) => workflow.flowOf(sessionId),
      signal: (sessionId, signal) => workflow.signal(sessionId, signal, 'live'),
      cancelCountdown: (sessionId) => cancelCountdown(sessionId),
    });

    const syncCountdown = (sessionId: string) => {
      const flow = workflow.flowOf(sessionId);
      if (flow !== null) {
        countdown.sync(flow);
      }
    };

    const patchState = (flow: SessionFlow, patch: Partial<HeavyState>) => {
      workflow.setState(flow.sessionId, withHeavyState(flow, patch).state);
      syncCountdown(flow.sessionId);
    };

    const countingDownFlow = (sessionId: string): SessionFlow | null => {
      const flow = workflow.flowOf(sessionId);
      const countsDown =
        flow?.workflow === HEAVY_WORKFLOW_ID &&
        heavyStateOf(flow).countdownEndsAt !== null;
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
          if (ran) {
            log(`ran ${command} in ${name}`);
          }
        },
        (error: unknown) => {
          log(`auto-start failed: ${errorText(error)}`);
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

    const followPlan = ({ sessionId, before, after, signal }: FoldEvent) => {
      const planDir = heavyStateOf(after).planDir;
      if (signal.type === 'turnEnded') {
        planWatch.check(sessionId);
      }
      if (signal.type === 'fileWritten' && isPlanFile(signal.path)) {
        planWatch.follow(sessionId, planDir);
      }
      if (planDir !== heavyStateOf(before).planDir) {
        planWatch.follow(sessionId, planDir);
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
      if (flow?.workflow !== HEAVY_WORKFLOW_ID) {
        return;
      }
      const settings = api.settings();
      const startsCountdown =
        origin !== 'replay' &&
        !replayedTurnEnds.has(sessionId) &&
        after.stage !== before.stage &&
        autoCommandOf(after.stage) !== undefined &&
        heavyStateOf(flow).countdownEndsAt === null &&
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
      planWatch.follow(sessionId, null);
      replayedTurnEnds.delete(sessionId);
    };

    const follow = (flow: SessionFlow) => {
      if (flow.workflow === HEAVY_WORKFLOW_ID) {
        planWatch.follow(flow.sessionId, heavyStateOf(flow).planDir);
        cancelCountdown(flow.sessionId);
      }
    };

    workflow.observe({
      folded(event) {
        const { sessionId, before, after, whole } = event;
        if (after.workflow !== HEAVY_WORKFLOW_ID) {
          if (before.workflow === HEAVY_WORKFLOW_ID) {
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
        await actions.run(sessionId, command);
      }),
    );

    if (services.selfTest !== null && workflow.selfTestHooks !== null) {
      services.selfTest.run(
        workflowHeavySelfTestScript({
          homeDir: services.homeDir,
          files: services.files,
          chat,
          sessions,
          harnesses: services.agentHarnesses,
          hooks: workflow.selfTestHooks,
        }),
      );
    }

    return {
      commands: {},
      dispose: () => planWatch.dispose(),
    };
  },
};
