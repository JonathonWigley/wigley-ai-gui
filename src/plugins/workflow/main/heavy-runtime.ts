import type { Clock, Timers } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { ChatMainExports } from '../../chat/contract';
import type { FoldEvent, SessionFlow, WorkflowMainExports } from '../contract';
import {
  HEAVY_WORKFLOW_ID,
  type HeavyState,
  heavyStateOf,
} from '../stages/heavy-contract';
import { isPlanFile } from '../stages/heavy-state';
import { BUILT_IN_MAIN_STAGES } from '../stages';
import { createWorkflowActions } from './actions';
import { createCountdown } from './countdown';
import { createPlanWatch } from './plan-watch';

export interface HeavyRuntimeDeps {
  workflow: Pick<
    WorkflowMainExports,
    'signal' | 'flowOf' | 'flows' | 'setState' | 'observe' | 'ready'
  >;
  chat: Pick<ChatMainExports, 'send' | 'clear' | 'launch' | 'profileOf'>;
  label(sessionId: string): string | null;
  files: Files;
  timers: Timers;
  clock: Clock;
  log: PluginLog;
  paths: Paths;
  settings(): { autoClearAndMake: boolean; autoStartSeconds: number };
}

const autoCommandOf = (stageId: string): string | undefined =>
  BUILT_IN_MAIN_STAGES.find((stage) => stage.id === stageId)?.autoCommand;

// Heavy's running parts as one engine observer: the plan watch of each Heavy
// flow, the plan-ready auto-start countdown and the main-side commands. Every write
// goes through `setState`, which keeps the flow's save time, on a fresh flow,
// since a plan read can signal while an observer call runs.
export function startHeavyRuntime(deps: HeavyRuntimeDeps): {
  run(sessionId: string, command: string): Promise<boolean>;
  cancelCountdown(sessionId: string): void;
  dispose(): void;
} {
  const { workflow, clock, log } = deps;
  // Sessions whose last turn end was replayed, until a live turn starts or
  // ends: the plan read such a turn causes settles after its replay, as a plain
  // signal.
  const replayedTurnEnds = new Set<string>();

  const planWatch = createPlanWatch({
    files: deps.files,
    log,
    signal: (sessionId, signal) =>
      workflow.signal(sessionId, signal, 'observed'),
  });
  const countdown = createCountdown({
    timers: deps.timers,
    clock,
    fire: (sessionId) => fireCountdown(sessionId),
  });
  const actions = createWorkflowActions({
    chat: deps.chat,
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
    workflow.setState(flow.sessionId, { ...heavyStateOf(flow), ...patch });
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
    const name = deps.label(sessionId) ?? deps.paths.base(flow.projectDir);
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
  const startCountdown = ({ sessionId, before, after, origin }: FoldEvent) => {
    const flow = workflow.flowOf(sessionId);
    if (flow?.workflow !== HEAVY_WORKFLOW_ID) {
      return;
    }
    const settings = deps.settings();
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

  const observer = workflow.observe({
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
    opened(flow) {
      if (flow.workflow === HEAVY_WORKFLOW_ID) {
        planWatch.follow(flow.sessionId, heavyStateOf(flow).planDir);
        cancelCountdown(flow.sessionId);
      }
    },
    closed: stopSession,
    replaying: cancelCountdown,
  });

  return {
    run: (sessionId, command) => actions.run(sessionId, command),
    cancelCountdown,
    dispose() {
      observer.dispose();
      planWatch.dispose();
    },
  };
}
