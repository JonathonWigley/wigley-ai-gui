// The auto-start countdown of a declared workflow's `auto` stage: started when
// a live or observed fold enters the stage (a replayed one starts none) and
// `workflow.autoStart` lists the workflow, held in the flow's `countdownEndsAt`,
// and run through the stage's `auto` action when it fires.

import type { Clock, Timers } from '../../../contracts/ambient';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import {
  actionCommandShortId,
  type AutoStartSetting,
  type DeclaredWorkflow,
  type FoldEvent,
  type SessionFlow,
  type WorkflowObserver,
} from '../contract';

// One timer per session, armed while its flow's `countdownEndsAt` is set.
// `sync` arms the timer for a flow counting down that has none and clears it
// for a flow that stopped; `stop` clears the session's timer. A timer that
// fires is forgotten before `fire` runs, so the next countdown arms anew.
export interface Countdown {
  sync(flow: SessionFlow): void;
  stop(sessionId: string): void;
}

export function createCountdown(deps: {
  timers: Timers;
  clock: Clock;
  fire(sessionId: string): void;
}): Countdown {
  const handles = new Map<string, number>();

  const stop = (sessionId: string) => {
    const handle = handles.get(sessionId);
    if (handle !== undefined) {
      deps.timers.clear(handle);
      handles.delete(sessionId);
    }
  };

  return {
    sync(flow) {
      const { sessionId, countdownEndsAt } = flow;
      if (countdownEndsAt === null) {
        stop(sessionId);
        return;
      }
      if (handles.has(sessionId)) {
        return;
      }
      const handle = deps.timers.set(
        () => {
          handles.delete(sessionId);
          deps.fire(sessionId);
        },
        Math.max(0, countdownEndsAt - deps.clock.now()),
      );
      handles.set(sessionId, handle);
    },
    stop,
  };
}

// The log line of the `workflow.autoStart` setting:
// `settings: autoStart my-plugin:large 30s, …`, or `settings: autoStart none`.
export function autoStartSettingsLine(
  autoStart: readonly AutoStartSetting[],
): string {
  const entries = autoStart.map(
    ({ workflow, seconds }) =>
      `${workflow} ${String(autoStartSeconds(seconds))}s`,
  );
  return `settings: autoStart ${entries.length === 0 ? 'none' : entries.join(', ')}`;
}

export interface AutoStartDeps {
  clock: Clock;
  timers: Timers;
  log: PluginLog;
  flowOf(sessionId: string): SessionFlow | null;
  flows(): readonly SessionFlow[];
  // The declared workflow holding the flow; null for none.
  workflowOf(flow: SessionFlow): DeclaredWorkflow | null;
  autoStart(): readonly AutoStartSetting[];
  // Writes the flow's `countdownEndsAt` with no fold.
  setCountdownEndsAt(sessionId: string, endsAt: number | null): void;
  // Runs a declared action by its short id; resolves whether it ran.
  runAction(sessionId: string, action: string): Promise<boolean>;
  // The session's name for the log line.
  sessionName(flow: SessionFlow): string;
  isStopped(): boolean;
}

// The engine observer that runs every flow's countdown. `cancel` stops the
// session's countdown; `settingsChanged` stops each one whose workflow
// `autoStart` no longer lists; `stop` clears every timer.
export interface AutoStart extends WorkflowObserver {
  cancel(sessionId: string): void;
  settingsChanged(): void;
  stop(): void;
}

export function createAutoStart(deps: AutoStartDeps): AutoStart {
  // Sessions whose last turn end was replayed, until a live turn starts or
  // ends: a fold such a turn causes settles after its replay, as a plain
  // signal.
  const replayedTurnEnds = new Set<string>();
  const sessionIds = new Set<string>();

  const countdown = createCountdown({
    timers: deps.timers,
    clock: deps.clock,
    fire: (sessionId) => fire(sessionId),
  });

  const sync = (sessionId: string) => {
    const flow = deps.flowOf(sessionId);
    if (flow === null) {
      countdown.stop(sessionId);
      return;
    }
    sessionIds.add(sessionId);
    countdown.sync(flow);
  };

  const cancel = (sessionId: string) => {
    const flow = deps.flowOf(sessionId);
    if (flow !== null && flow.countdownEndsAt !== null) {
      deps.setCountdownEndsAt(sessionId, null);
    }
    sync(sessionId);
  };

  const secondsOf = (workflowId: string): number | null => {
    const entry = deps.autoStart().find((each) => each.workflow === workflowId);
    return entry === undefined ? null : autoStartSeconds(entry.seconds);
  };

  // The short id of the action the flow's stage runs on its own; null for a
  // stage with no `auto`.
  const autoActionOf = (flow: SessionFlow): string | null => {
    const workflow = deps.workflowOf(flow);
    const auto = workflow?.decl.stages.find(
      (stage) => stage.id === flow.stage,
    )?.auto;
    return workflow === null || auto === undefined
      ? null
      : actionCommandShortId(workflow.id, auto);
  };

  function fire(sessionId: string): void {
    const flow = deps.flowOf(sessionId);
    if (flow === null || flow.countdownEndsAt === null) {
      return;
    }
    deps.setCountdownEndsAt(sessionId, null);
    sync(sessionId);
    const action = autoActionOf(flow);
    if (action === null) {
      return;
    }
    const name = deps.sessionName(flow);
    deps.runAction(sessionId, action).then(
      (ran) => {
        if (ran && !deps.isStopped()) {
          deps.log(`ran ${action} in ${name}`);
        }
      },
      (error: unknown) => {
        if (!deps.isStopped()) {
          deps.log(`auto-start failed: ${errorText(error)}`);
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

  // The countdown a flow that just entered an `auto` stage begins.
  const startCountdown = ({ sessionId, before, after, origin }: FoldEvent) => {
    const flow = deps.flowOf(sessionId);
    if (flow === null) {
      return;
    }
    const seconds = secondsOf(flow.workflow);
    const startsCountdown =
      origin !== 'replay' &&
      !replayedTurnEnds.has(sessionId) &&
      after.stage !== before.stage &&
      autoActionOf(flow) !== null &&
      flow.countdownEndsAt === null &&
      seconds !== null;
    if (startsCountdown) {
      deps.setCountdownEndsAt(sessionId, deps.clock.now() + seconds * 1000);
    }
  };

  const forget = (sessionId: string) => {
    countdown.stop(sessionId);
    replayedTurnEnds.delete(sessionId);
    sessionIds.delete(sessionId);
  };

  return {
    folded(event) {
      const { sessionId, before, after, whole } = event;
      noteTurnBoundary(event);
      if (after.workflow !== before.workflow) {
        countdown.stop(sessionId);
      }
      if (whole) {
        startCountdown(event);
      }
      sync(sessionId);
    },
    // A flow opened with a saved countdown starts none.
    opened: (flow) => cancel(flow.sessionId),
    closed: forget,
    replaying: cancel,
    cancel,
    settingsChanged() {
      for (const flow of deps.flows()) {
        const isListed = secondsOf(flow.workflow) !== null;
        if (flow.countdownEndsAt !== null && !isListed) {
          cancel(flow.sessionId);
        }
      }
    },
    stop() {
      for (const sessionId of sessionIds) {
        forget(sessionId);
      }
    },
  };
}

// A countdown runs at least one second.
function autoStartSeconds(seconds: number): number {
  return Math.max(1, seconds);
}
