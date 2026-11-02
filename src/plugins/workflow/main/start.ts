import type { Disposable } from '../../../contracts/disposable';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { ChatMainEvents, ChatMainExports } from '../../chat/contract';
import type { SessionsMainEvents } from '../../sessions/contract';
import type {
  MainStage,
  SessionFlow,
  WorkflowChannel,
  WorkflowMainExports,
  WorkflowSignal,
} from '../contract';
import { foldFlow, isPlanFile } from '../flow';
import { workflowManifest } from '../manifest';
import { BUILT_IN_MAIN_STAGES } from '../stages';
import { createWorkflowActions } from './actions';
import { signalOf } from './agent-signals';
import { createCountdown } from './countdown';
import { createFlowStore } from './flow-store';
import { createPlanWatch } from './plan-watch';

type WorkflowApi = MainApi<
  typeof workflowManifest,
  WorkflowChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// What the self-test script drives main through. `resetFlows` makes every
// flow in the folder a new idle flow, stopping its countdown and plan watch;
// `onMainTurnEnded` hears each main-agent `turnEnded` once main applied it,
// whether or not the flow changed.
export interface WorkflowSelfTestHooks {
  resetFlows(projectDir: string): void;
  onMainTurnEnded(listener: (sessionId: string) => void): Disposable;
}

// Folds each owned Chat-tab session's agent events and session events into its
// flow through the registered stages, keeps the flows in `flows.json` keyed by
// host session id, watches each flow's plan folder, runs the main-side
// workflow commands for the page and the plan-ready auto-start countdown, and
// sends every flow to the page on each change. Exports `addStage`.
export const workflowMainPart: MainPart<typeof workflowManifest> = {
  manifest: workflowManifest,
  start(api: WorkflowApi) {
    const { services, channel, events } = api;
    const { log, clock } = services;
    const chat = api.dependency<ChatMainExports>('chat');
    const stages: MainStage[] = [];
    const store = createFlowStore({
      files: api.data,
      log,
      paths: services.paths,
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

    const sendFlows = () => channel.send('flows', store.all());
    const stageOf = (flow: SessionFlow) =>
      stages.find((stage) => stage.id === flow.stage);

    const planWatch = createPlanWatch({
      files: services.files,
      log,
      signal: (sessionId, signal) => apply(sessionId, signal),
    });
    const countdown = createCountdown({
      timers: services.timers,
      clock,
      fire: (sessionId) => fireCountdown(sessionId),
    });
    const actions = createWorkflowActions({
      chat,
      flowOf: (sessionId) => store.get(sessionId),
      signal: (sessionId, signal) => apply(sessionId, signal),
      cancelCountdown: (sessionId) => cancelCountdown(sessionId),
    });

    // The countdown a flow that just entered an auto-start stage begins.
    const withCountdown = (flow: SessionFlow, next: SessionFlow) => {
      const settings = api.settings();
      const startsCountdown =
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

    const putFlow = (next: SessionFlow) => {
      store.put(next);
      countdown.sync(next);
      sendFlows();
    };

    // The one change path every fold takes.
    function apply(sessionId: string, signal: WorkflowSignal): void {
      const flow = store.get(sessionId);
      if (flow === null) {
        return;
      }
      const folded = foldFlow(flow, signal, stages);
      if (signal.type === 'turnEnded') {
        planWatch.check(sessionId);
      }
      if (signal.type === 'fileWritten' && isPlanFile(signal.path)) {
        planWatch.follow(sessionId, folded.planDir);
      }
      if (folded === flow) {
        return;
      }
      const next = withCountdown(flow, folded);
      putFlow(next);
      if (next.planDir !== flow.planDir) {
        planWatch.follow(sessionId, next.planDir);
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
      actions.run(sessionId, command).catch((error: unknown) => {
        log('workflow', `auto-start failed: ${errorText(error)}`);
      });
    }

    const addStage = (stage: MainStage): Disposable => {
      if (stages.some((held) => held.id === stage.id)) {
        throw new Error(`Workflow stage ${stage.id} is already added`);
      }
      const at = stages.findIndex((held) => held.order > stage.order);
      stages.splice(at === -1 ? stages.length : at, 0, stage);
      return {
        dispose: () => {
          const index = stages.indexOf(stage);
          if (index !== -1) {
            stages.splice(index, 1);
          }
        },
      };
    };
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
        apply(id, { type: 'cleared' });
      });
    });
    events.on('sessions.ended', ({ sessionId }) => {
      void ready.then(() => {
        connected.delete(sessionId);
        countdown.stop(sessionId);
        planWatch.follow(sessionId, null);
        store.drop(sessionId);
        sendFlows();
      });
    });
    events.on('chat.agentEvent', ({ sessionId, hostSessionId, event }) => {
      void ready.then(() => {
        const flow = store.get(sessionId);
        if (flow === null) {
          return;
        }
        const fromCurrentHost = store.hostIdOf(sessionId) === hostSessionId;
        for (const signal of signalOf(event, flow, fromCurrentHost)) {
          apply(sessionId, signal);
          if (signal.type === 'turnEnded') {
            for (const listener of turnEndedListeners) {
              listener(sessionId);
            }
          }
        }
      });
    });

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
      ready.then(() => actions.run(sessionId, command)),
    );
    void ready.then(sendFlows);

    const selfTestHooks: WorkflowSelfTestHooks | null =
      services.selfTest === null
        ? null
        : {
            resetFlows(projectDir) {
              const reset = store
                .all()
                .filter((flow) =>
                  services.paths.samePath(flow.projectDir, projectDir),
                );
              store.resetFlows(projectDir);
              for (const { sessionId } of reset) {
                countdown.stop(sessionId);
                planWatch.follow(sessionId, null);
              }
              sendFlows();
            },
            onMainTurnEnded(listener) {
              const registered = (sessionId: string) => listener(sessionId);
              turnEndedListeners.add(registered);
              return { dispose: () => turnEndedListeners.delete(registered) };
            },
          };

    const exports: WorkflowMainExports = { addStage };
    return {
      commands: {},
      exports,
      dispose() {
        settingsListener.dispose();
        planWatch.dispose();
        countdown.dispose();
      },
    };
  },
};
