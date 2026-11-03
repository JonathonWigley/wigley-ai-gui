import type { Disposable } from '../../../contracts/disposable';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import layoutTypes from '../layouts/layout.d.ts?raw';
import type { ChatMainEvents, ChatMainExports } from '../../chat/contract';
import type {
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import type {
  MainStage,
  SessionFlow,
  WorkflowChannel,
  WorkflowMainExports,
  WorkflowSignal,
} from '../contract';
import { foldFlow, foldRunningState, isPlanFile } from '../flow';
import { workflowManifest } from '../manifest';
import { createStageList } from '../stage-list';
import { BUILT_IN_MAIN_STAGES } from '../stages';
import { createWorkflowActions } from './actions';
import { signalOf } from './agent-signals';
import { createCountdown } from './countdown';
import { createFlowStore } from './flow-store';
import { createPlanWatch } from './plan-watch';
import { workflowSelfTestScript } from './selftest-script';

// Where a fold's signal came from. Only 'live' stamps the flow's save time: the
// time a replayed event is compared against says how far the flow has heard the
// log, and neither a replay nor a read of the plan file adds to that.
type SignalOrigin = 'live' | 'replay' | 'planRead';

type WorkflowApi = MainApi<
  typeof workflowManifest,
  WorkflowChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// What the self-test script drives main through. `forgetFlows` drops every
// flow in the folder, saved ones included, stopping each open one's countdown
// and plan watch, for a run that closed the folder's sessions;
// `onMainTurnEnded` hears each main-agent `turnEnded` once main applied it,
// whether or not the flow changed.
export interface WorkflowSelfTestHooks {
  forgetFlows(projectDir: string): void;
  onMainTurnEnded(listener: (sessionId: string) => void): Disposable;
}

// Folds each owned Chat-tab session's agent events and session events into its
// flow through the registered stages, keeps the flows in `flows.json` keyed by
// host session id, folds a re-attach's replay only past the flow's last save,
// watches each flow's plan folder, runs the main-side
// workflow commands for the page and the plan-ready auto-start countdown, and
// sends every flow to the page on each change. Exports `addStage`.
export const workflowMainPart: MainPart<typeof workflowManifest> = {
  manifest: workflowManifest,
  start(api: WorkflowApi) {
    const layouts = api.layouts.register({ layoutTypes });
    const { services, channel, events } = api;
    const { log, clock } = services;
    const chat = api.dependency<ChatMainExports>('chat');
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const stages = createStageList<MainStage>();
    const store = createFlowStore({
      files: api.data,
      log,
      paths: services.paths,
      clock,
    });
    const ready = store.load().catch((error: unknown) => {
      log(
        'workflow',
        `flows.json not read: ${errorText(error)}; starting with no flows`,
      );
    });
    // Host session id and project folder of each connected session, until
    // chat opens it.
    const connected = new Map<
      string,
      { hostSessionId: string; projectDir: string }
    >();
    const turnEndedListeners = new Set<(sessionId: string) => void>();
    // Sessions whose last turn end was replayed, until a live turn starts: the
    // plan read such a turn causes settles after its replay, as a plain signal.
    const replayedTurnEnds = new Set<string>();

    const sendFlows = () => channel.send('flows', store.all());
    const stageOf = (flow: SessionFlow) =>
      stages.all().find((stage) => stage.id === flow.stage);

    const planWatch = createPlanWatch({
      files: services.files,
      log,
      signal: (sessionId, signal) => apply(sessionId, signal, 'planRead'),
    });
    const countdown = createCountdown({
      timers: services.timers,
      clock,
      fire: (sessionId) => fireCountdown(sessionId),
    });
    const actions = createWorkflowActions({
      chat,
      log,
      flowOf: (sessionId) => store.get(sessionId),
      signal: (sessionId, signal) => apply(sessionId, signal, 'live'),
      cancelCountdown: (sessionId) => cancelCountdown(sessionId),
    });

    // The countdown a flow that just entered an auto-start stage begins.
    const withCountdown = (flow: SessionFlow, next: SessionFlow) => {
      const settings = api.settings();
      const startsCountdown =
        !replayedTurnEnds.has(flow.sessionId) &&
        next.stage !== flow.stage &&
        stageOf(next)?.autoCommand !== undefined &&
        next.countdownEndsAt === null &&
        settings.autoClearAndMake;
      return startsCountdown
        ? {
            ...next,
            countdownEndsAt:
              clock.now() + Math.max(1, settings.autoStartSeconds) * 1000,
          }
        : next;
    };

    const putFlow = (next: SessionFlow, origin: SignalOrigin = 'live') => {
      if (origin === 'live') {
        store.put(next);
      } else {
        store.putKeepingSavedAt(next);
      }
      countdown.sync(next);
      sendFlows();
    };

    const noteTurnBoundary = (
      sessionId: string,
      signal: WorkflowSignal,
      replayed: boolean,
    ) => {
      if (signal.type === 'turnEnded' && replayed) {
        replayedTurnEnds.add(sessionId);
      }
      const isLiveBoundary =
        !replayed &&
        (signal.type === 'turnStarted' || signal.type === 'turnEnded');
      if (isLiveBoundary) {
        replayedTurnEnds.delete(sessionId);
      }
    };

    // The one change path every full fold takes. A replayed event's fold starts
    // no countdown.
    function apply(
      sessionId: string,
      signal: WorkflowSignal,
      origin: SignalOrigin,
    ): void {
      const flow = store.get(sessionId);
      if (flow === null) {
        return;
      }
      const folded = foldFlow(flow, signal, stages.all());
      if (signal.type === 'turnEnded') {
        planWatch.check(sessionId);
      }
      if (signal.type === 'fileWritten' && isPlanFile(signal.path)) {
        planWatch.follow(sessionId, folded.planDir);
      }
      if (folded === flow) {
        return;
      }
      const next = origin === 'replay' ? folded : withCountdown(flow, folded);
      putFlow(next, origin);
      if (next.planDir !== flow.planDir) {
        planWatch.follow(sessionId, next.planDir);
      }
    }

    // A replayed event at or before the flow's last save is already in the flow,
    // apart from the running state a loaded flow drops.
    function applyReplayed(
      sessionId: string,
      signal: WorkflowSignal,
      at: number,
    ): void {
      if (at > store.savedAtOf(sessionId)) {
        apply(sessionId, signal, 'replay');
        return;
      }
      const flow = store.get(sessionId);
      if (flow !== null) {
        const next = foldRunningState(flow, signal);
        if (next !== flow) {
          putFlow(next, 'replay');
        }
      }
    }

    function cancelCountdown(sessionId: string): void {
      const flow = store.get(sessionId);
      if (flow !== null && flow.countdownEndsAt !== null) {
        putFlow({ ...flow, countdownEndsAt: null });
      }
    }

    function fireCountdown(sessionId: string): void {
      const flow = store.get(sessionId);
      if (flow === null || flow.countdownEndsAt === null) {
        return;
      }
      putFlow({ ...flow, countdownEndsAt: null });
      const command = stageOf(flow)?.autoCommand;
      if (command === undefined) {
        return;
      }
      const name =
        sessions.label(sessionId) ?? services.paths.base(flow.projectDir);
      actions.run(sessionId, command).then(
        (ran) => {
          if (ran) {
            log('workflow', `ran ${command} in ${name}`);
          }
        },
        (error: unknown) => {
          log('workflow', `auto-start failed: ${errorText(error)}`);
        },
      );
    }

    const addStage = (stage: MainStage) => stages.add(stage);
    for (const stage of BUILT_IN_MAIN_STAGES) {
      addStage(stage);
    }

    events.on('sessions.connected', ({ id, info }) => {
      const { sessionId: hostSessionId, projectDir } = info;
      void ready.then(() => {
        if (hostSessionId !== null && projectDir !== null) {
          connected.set(id, { hostSessionId, projectDir });
        }
      });
    });
    events.on('chat.sessionOpened', ({ sessionId }) => {
      void ready.then(() => {
        const pair = connected.get(sessionId);
        if (pair === undefined) {
          log('workflow', `session ${sessionId} opened with no host session`);
          return;
        }
        connected.delete(sessionId);
        const flow = store.open(sessionId, pair.hostSessionId, pair.projectDir);
        planWatch.follow(sessionId, flow.planDir);
        sendFlows();
      });
    });
    events.on('sessions.hostSessionChanged', ({ id, info }) => {
      const hostSessionId = info.sessionId;
      void ready.then(() => {
        if (hostSessionId !== null) {
          store.rekey(id, hostSessionId);
        }
        apply(id, { type: 'cleared' }, 'live');
      });
    });
    events.on('sessions.ended', ({ sessionId }) => {
      void ready.then(() => {
        connected.delete(sessionId);
        countdown.stop(sessionId);
        planWatch.follow(sessionId, null);
        replayedTurnEnds.delete(sessionId);
        store.drop(sessionId);
        sendFlows();
      });
    });
    events.on(
      'chat.agentEvent',
      ({ sessionId, hostSessionId, event, replayed }) => {
        void ready.then(() => {
          const flow = store.get(sessionId);
          if (flow === null) {
            return;
          }
          // The open's plan read can arm a countdown before the replay says a
          // turn still runs.
          if (replayed && flow.countdownEndsAt !== null) {
            putFlow({ ...flow, countdownEndsAt: null }, 'replay');
          }
          const fromCurrentHost = store.hostIdOf(sessionId) === hostSessionId;
          for (const signal of signalOf(event, flow, fromCurrentHost)) {
            noteTurnBoundary(sessionId, signal, replayed);
            if (replayed) {
              applyReplayed(sessionId, signal, event.at);
            } else {
              apply(sessionId, signal, 'live');
            }
            if (signal.type === 'turnEnded') {
              for (const listener of turnEndedListeners) {
                listener(sessionId);
              }
            }
          }
        });
      },
    );

    const settingsListener = api.onSettingsChanged((settings) => {
      void ready.then(() => {
        const onOff = settings.autoClearAndMake ? 'on' : 'off';
        const seconds = Math.max(1, settings.autoStartSeconds);
        log(
          'workflow',
          `settings: autoClearAndMake ${onOff}, autoStartSeconds ${String(seconds)}`,
        );
        if (!settings.autoClearAndMake) {
          for (const flow of store.all()) {
            cancelCountdown(flow.sessionId);
          }
        }
      });
    });

    channel.handle('flows', () => ready.then(() => store.all()));
    channel.handle('runAction', ({ sessionId, command }) =>
      ready.then(async () => {
        await actions.run(sessionId, command);
      }),
    );
    void ready.then(sendFlows);

    if (services.selfTest !== null) {
      const selfTestHooks: WorkflowSelfTestHooks = {
        forgetFlows(projectDir) {
          for (const sessionId of store.forgetFlows(projectDir)) {
            countdown.stop(sessionId);
            planWatch.follow(sessionId, null);
            replayedTurnEnds.delete(sessionId);
          }
          sendFlows();
        },
        onMainTurnEnded(listener) {
          const registered = (sessionId: string) => listener(sessionId);
          turnEndedListeners.add(registered);
          return { dispose: () => turnEndedListeners.delete(registered) };
        },
      };
      services.selfTest.run(
        workflowSelfTestScript({
          homeDir: services.homeDir,
          files: services.files,
          chat,
          sessions,
          harnesses: services.agentHarnesses,
          hooks: selfTestHooks,
        }),
      );
    }

    const exports: WorkflowMainExports = { addStage };
    return {
      commands: {},
      exports,
      dispose() {
        layouts.dispose();
        settingsListener.dispose();
        planWatch.dispose();
        countdown.dispose();
      },
    };
  },
};
