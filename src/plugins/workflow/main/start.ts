import type { Disposable } from '../../../contracts/disposable';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import type {
  FoldEvent,
  MainWorkflow,
  SessionFlow,
  SignalOrigin,
  StageId,
  WorkflowChannel,
  WorkflowMainExports,
  WorkflowObserver,
  WorkflowSelfTestHooks,
  WorkflowSignal,
} from '../contract';
import { foldFlow, foldRunningState, markMissedLevel } from '../flow';
import { workflowManifest } from '../manifest';
import { createStageList } from '../stage-list';
import { heavyMainWorkflow } from '../stages/heavy-workflow';
import { signalOf } from './agent-signals';
import { createFlowStore } from './flow-store';
import { startHeavyRuntime } from './heavy-runtime';
import { workflowSelfTestScript } from './selftest-script';
import {
  SET_WORKFLOW_STEP_TOOL,
  startStepTool,
  stepToolDefinition,
} from './step-tool';
import { createTurnWork } from './turn-work';

type WorkflowApi = MainApi<
  typeof workflowManifest,
  WorkflowChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Folds each owned Chat-tab session's agent events and session events into its
// flow through the registered workflows, keeps the flows in `flows.json` keyed by
// host session id, folds a re-attach's replay only past the flow's last save,
// marks a live turn with agent work and no workflow as a missed level, tells each
// observer every fold, open, close and replay, contributes `set_workflow_step`,
// whose steps are the workflows' stages' `reportedAs`, and sends every flow to the
// page on each change. Exports `addWorkflow`, `signal`, `setState` and `observe`.
export const workflowMainPart: MainPart<typeof workflowManifest> = {
  manifest: workflowManifest,
  start(api: WorkflowApi) {
    api.layouts.register({ layoutTypes });
    const { services, channel, events } = api;
    const { log, clock } = services;
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const workflows = createStageList<MainWorkflow>();
    const store = createFlowStore({
      files: api.data,
      log,
      paths: services.paths,
      clock,
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
    const turnWork = createTurnWork();
    const observers: WorkflowObserver[] = [];

    const sendFlows = () => channel.send('flows', store.all());

    const putFlow = (next: SessionFlow, origin: SignalOrigin) => {
      if (origin === 'live') {
        store.put(next);
      } else {
        store.putKeepingSavedAt(next);
      }
      sendFlows();
    };

    const tellObservers = (call: (observer: WorkflowObserver) => void) =>
      callEach([...observers], call);

    const tellFolded = (event: FoldEvent) =>
      tellObservers((observer) => observer.folded(event));

    // The one change path every full fold takes.
    function apply(
      sessionId: string,
      signal: WorkflowSignal,
      origin: SignalOrigin,
    ): void {
      const before = store.get(sessionId);
      if (before === null) {
        return;
      }
      const after = foldFlow(before, signal, workflows.all());
      if (after !== before) {
        putFlow(after, origin);
      }
      tellFolded({ sessionId, before, after, signal, origin, whole: true });
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
      const before = store.get(sessionId);
      if (before === null) {
        return;
      }
      const after = foldRunningState(before, signal);
      if (after !== before) {
        putFlow(after, 'replay');
      }
      tellFolded({
        sessionId,
        before,
        after,
        signal,
        origin: 'replay',
        whole: false,
      });
    }

    const applyMissedLevel = (sessionId: string) => {
      const flow = store.get(sessionId);
      if (flow === null || !turnWork.worked(sessionId)) {
        return;
      }
      const next = markMissedLevel(flow);
      if (next !== flow) {
        putFlow(next, 'live');
      }
    };

    // Folds a reported step as a live event; resolves whether the flow is now in
    // that stage. No flow, or a stage rule that ignores it, resolves false.
    const reportStep = (sessionId: string, stage: StageId) =>
      ready.then(() => {
        apply(sessionId, { type: 'stepReported', step: stage }, 'live');
        return store.get(sessionId)?.stage === stage;
      });
    const reportableStages = () =>
      workflows.all().flatMap((workflow) => workflow.stages);
    const startStepToolSession = startStepTool({
      stages: reportableStages,
      reportStep,
    });

    // Contributes the tool again when the reportable stages change, so its
    // schema lists a stage a workflow added.
    let stepTool: Disposable | null = null;
    const contributeStepTool = () => {
      stepTool?.dispose();
      stepTool = sessions.contributeTools(
        [stepToolDefinition(reportableStages())],
        startStepToolSession,
      );
    };
    const addWorkflow = (workflow: MainWorkflow): Disposable => {
      const stages = [...workflow.stages].sort((a, b) => a.order - b.order);
      const added = workflows.add({ ...workflow, stages });
      if (!stages.some((stage) => stage.reportedAs !== undefined)) {
        return added;
      }
      contributeStepTool();
      return {
        dispose() {
          added.dispose();
          contributeStepTool();
        },
      };
    };

    const observe = (observer: WorkflowObserver): Disposable => {
      observers.push(observer);
      return {
        dispose() {
          const index = observers.indexOf(observer);
          if (index !== -1) {
            observers.splice(index, 1);
          }
        },
      };
    };

    const engine = {
      signal: (
        sessionId: string,
        signal: WorkflowSignal,
        origin: 'live' | 'observed',
      ) => apply(sessionId, signal, origin),
      flowOf: (sessionId: string) => store.get(sessionId),
      flows: () => store.all(),
      setState(sessionId: string, state: unknown) {
        const flow = store.get(sessionId);
        if (flow === null) {
          return;
        }
        store.putKeepingSavedAt({ ...flow, state: state ?? null });
        sendFlows();
      },
      observe,
      ready,
    };

    addWorkflow(heavyMainWorkflow);
    const heavyRuntime = startHeavyRuntime({
      workflow: engine,
      chat,
      label: (sessionId) => sessions.label(sessionId),
      files: services.files,
      timers: services.timers,
      clock,
      log,
      paths: services.paths,
      settings: () => api.settings(),
    });

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
        tellObservers((observer) => observer.opened(flow));
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
        turnWork.forget(sessionId);
        tellObservers((observer) => observer.closed(sessionId));
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
          if (replayed) {
            tellObservers((observer) => observer.replaying(sessionId));
          } else {
            turnWork.note(sessionId, event);
          }
          const fromCurrentHost = store.hostIdOf(sessionId) === hostSessionId;
          for (const signal of signalOf(event, flow, fromCurrentHost)) {
            if (replayed) {
              applyReplayed(sessionId, signal, event.at);
            } else {
              apply(sessionId, signal, 'live');
            }
            if (signal.type === 'turnEnded') {
              if (!replayed) {
                applyMissedLevel(sessionId);
              }
              for (const listener of turnEndedListeners) {
                listener(sessionId);
              }
            }
          }
        });
      },
    );

    api.onSettingsChanged((settings) => {
      void ready.then(() => {
        const onOff = settings.autoClearAndMake ? 'on' : 'off';
        const seconds = Math.max(1, settings.autoStartSeconds);
        log(
          `settings: autoClearAndMake ${onOff}, autoStartSeconds ${String(seconds)}`,
        );
        if (!settings.autoClearAndMake) {
          for (const flow of engine.flows()) {
            heavyRuntime.cancelCountdown(flow.sessionId);
          }
        }
      });
    });

    channel.handle('flows', () => ready.then(() => store.all()));
    channel.handle('runAction', ({ sessionId, command }) =>
      ready.then(async () => {
        await heavyRuntime.run(sessionId, command);
      }),
    );
    void ready.then(sendFlows);

    const selfTestHooks: WorkflowSelfTestHooks = {
      forgetFlows(projectDir) {
        for (const sessionId of store.forgetFlows(projectDir)) {
          turnWork.forget(sessionId);
          tellObservers((observer) => observer.closed(sessionId));
        }
        sendFlows();
      },
      callStepTool(sessionId, step) {
        void startStepToolSession({ id: sessionId }).call(
          SET_WORKFLOW_STEP_TOOL,
          { step },
          { toolUseId: null, signal: new AbortController().signal },
        );
      },
      onMainTurnEnded(listener) {
        const registered = (sessionId: string) => listener(sessionId);
        turnEndedListeners.add(registered);
        return { dispose: () => turnEndedListeners.delete(registered) };
      },
    };
    if (services.selfTest !== null) {
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
        ...engine,
        addWorkflow: (workflow) => consumer.track(addWorkflow(workflow)),
        observe: (observer) => consumer.track(observe(observer)),
        layoutTypes,
        selfTestHooks: services.selfTest === null ? null : selfTestHooks,
      }),
      dispose: () => heavyRuntime.dispose(),
    };
  },
};
