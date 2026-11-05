import type { Disposable } from '../../../contracts/disposable';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { activeMsAt } from '../../../shared/active-time';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import type {
  ChecklistItem,
  FoldEvent,
  MainWorkflow,
  SessionFlow,
  SignalOrigin,
  WorkflowChannel,
  WorkflowMainExports,
  WorkflowObserver,
  WorkflowSelfTestHooks,
  WorkflowSignal,
} from '../contract';
import { foldFlow, foldRunningState, markMissedLevel } from '../flow';
import { workflowManifest } from '../manifest';
import { createStageList } from '../stage-list';
import { signalOf } from './agent-signals';
import { checklistToolDefinition, startChecklistTool } from './checklist-tool';
import { createFlowStore } from './flow-store';
import { createRunLog } from './run-log';
import { createRunMeter } from './run-meter';
import { SESSION_NOTE } from './session-note';
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
// which lists every workflow's stages' `reportedAs` and moves a flow only by its own
// workflow's, and `set_workflow_checklist`, hands chat the session note naming both,
// meters each session's active time and spend and appends a line to `runs.jsonl`
// when a fold enters a stage that finishes its workflow, and sends every flow to
// the page on each change. Exports `addWorkflow`, `signal`, `setState` and `observe`.
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
    const runLog = createRunLog({ files: api.data, log });
    const runMeter = createRunMeter({
      activeMsOf: (sessionId) => {
        const time = chat.activeTime(sessionId);
        return time === null ? 0 : activeMsAt(time, clock.now());
      },
    });
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

    // Writes the run's line when the fold entered a stage that finishes its
    // workflow, and starts the meter's next run.
    const logFinishedRun = (before: SessionFlow, after: SessionFlow) => {
      const workflow = workflows
        .all()
        .find((held) => held.id === after.workflow);
      const stage = workflow?.stages.find((held) => held.id === after.stage);
      const entered = after.stage !== before.stage;
      if (workflow === undefined || !entered || stage?.finishes !== true) {
        return;
      }
      const { sessionId, projectDir, movedUpFrom } = after;
      const { activeMs, costUsd } = runMeter.read(sessionId);
      runLog.append({
        at: clock.now(),
        sessionId,
        projectDir,
        workflow: workflow.id,
        movedUpFrom,
        activeMs,
        costUsd,
        fixCycles: workflow.fixCycles?.(after) ?? 0,
      });
      runMeter.finished(sessionId);
    };

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
        if (before.workflow === null && after.workflow !== null) {
          runMeter.claimed(sessionId);
        }
        logFinishedRun(before, after);
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

    // The registered workflow holding the session's flow; undefined with no flow,
    // a null workflow, or a workflow no plugin holds.
    const heldWorkflowOf = (sessionId: string) => {
      const flow = store.get(sessionId);
      return workflows.all().find((held) => held.id === flow?.workflow);
    };

    // Folds a reported step as a live event; resolves whether the flow is now in
    // the stage its own workflow reports as `step`. No such stage, or a stage rule
    // that ignores it, resolves false.
    const reportStep = (sessionId: string, step: string) =>
      ready.then(() => {
        const stage = heldWorkflowOf(sessionId)?.stages.find(
          (held) => held.reportedAs === step,
        );
        if (stage === undefined) {
          return false;
        }
        apply(sessionId, { type: 'stepReported', step: stage.id }, 'live');
        return store.get(sessionId)?.stage === stage.id;
      });
    const startStepToolSession = startStepTool({
      workflows: () => workflows.all(),
      reportStep,
    });

    // Folds a reported checklist as a live event; resolves whether a registered
    // workflow holds the flow.
    const reportChecklist = (
      sessionId: string,
      items: readonly ChecklistItem[],
    ) =>
      ready.then(() => {
        if (heldWorkflowOf(sessionId) === undefined) {
          return false;
        }
        apply(sessionId, { type: 'checklistReported', items }, 'live');
        return true;
      });
    const checklistTool = sessions.contributeTools(
      [checklistToolDefinition()],
      startChecklistTool({ reportChecklist }),
    );
    chat.addInstructions(SESSION_NOTE);

    // Contributes the tool again when the reportable stages change, so its
    // schema lists a stage a workflow added.
    let stepTool: Disposable | null = null;
    const contributeStepTool = () => {
      stepTool?.dispose();
      stepTool = sessions.contributeTools(
        [stepToolDefinition(workflows.all())],
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
        runMeter.cleared(id);
        apply(id, { type: 'cleared' }, 'live');
      });
    });
    events.on('sessions.ended', ({ sessionId }) => {
      void ready.then(() => {
        connected.delete(sessionId);
        turnWork.forget(sessionId);
        runMeter.forget(sessionId);
        tellObservers((observer) => observer.closed(sessionId));
        store.drop(sessionId);
        sendFlows();
      });
    });
    events.on(
      'chat.agentEvent',
      ({ sessionId, hostSessionId, event, replayed }) => {
        void ready.then(() => {
          runMeter.note(sessionId, event);
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

    channel.handle('flows', () => ready.then(() => store.all()));
    void ready.then(sendFlows);

    const selfTestHooks: WorkflowSelfTestHooks = {
      forgetFlows(projectDir) {
        for (const sessionId of store.forgetFlows(projectDir)) {
          turnWork.forget(sessionId);
          runMeter.forget(sessionId);
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
    return {
      commands: {},
      exports: (consumer): WorkflowMainExports => ({
        ...engine,
        addWorkflow: (workflow) => consumer.track(addWorkflow(workflow)),
        observe: (observer) => consumer.track(observe(observer)),
        layoutTypes,
        selfTestHooks: services.selfTest === null ? null : selfTestHooks,
      }),
      dispose: () => checklistTool.dispose(),
    };
  },
};
