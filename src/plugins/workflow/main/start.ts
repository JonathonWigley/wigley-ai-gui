import type { Disposable } from '../../../contracts/disposable';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import type {
  MainStage,
  SessionFlow,
  WorkflowChannel,
  WorkflowMainExports,
  WorkflowSignal,
} from '../contract';
import { foldFlow, isPlanFile } from '../flow';
import { workflowManifest } from '../manifest';
import { createStageList } from '../stage-list';
import { BUILT_IN_MAIN_STAGES } from '../stages';
import { createWorkflowActions } from './actions';
import { signalOf } from './agent-signals';
import { createCountdown } from './countdown';
import { createFlowStore } from './flow-store';
import { createPlanWatch } from './plan-watch';
import { workflowSelfTestScript } from './selftest-script';

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
// host session id, watches each flow's plan folder, runs the main-side
// workflow commands for the page and the plan-ready auto-start countdown, and
// sends every flow to the page on each change. Exports `addStage`.
export const workflowMainPart: MainPart<typeof workflowManifest> = {
  manifest: workflowManifest,
  start(api: WorkflowApi) {
    api.layouts.register({ layoutTypes });
    const { services, channel, events } = api;
    const { log, clock } = services;
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const stages = createStageList<MainStage>();
    const store = createFlowStore({
      files: api.data,
      log,
      paths: services.paths,
    });
    const ready = store.load().catch((error: unknown) => {
      log(`flows.json not read: ${errorText(error)}; starting with no flows`);
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
      stages.all().find((stage) => stage.id === flow.stage);

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
      log,
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

    for (const stage of BUILT_IN_MAIN_STAGES) {
      stages.add(stage);
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
          log(`session ${sessionId} opened with no host session`);
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

    api.onSettingsChanged((settings) => {
      void ready.then(() => {
        const onOff = settings.autoClearAndMake ? 'on' : 'off';
        const seconds = Math.max(1, settings.autoStartSeconds);
        log(
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

    return {
      commands: {},
      exports: (consumer): WorkflowMainExports => ({
        addStage: (stage) => consumer.track(stages.add(stage)),
      }),
    };
  },
};
