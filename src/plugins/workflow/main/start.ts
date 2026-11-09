import type { Disposable } from '../../../contracts/disposable';
import type {
  ChannelShape,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { activeMsAt } from '../../../shared/active-time';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import layoutTypes from '../layouts/layout.d.ts?raw';
import {
  type ChatMainEvents,
  chatMainKey,
  chatSessionSlot,
} from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type ChecklistItem,
  type FoldEvent,
  type MainWorkflow,
  type SessionFlow,
  type SignalOrigin,
  workflowFlowsSlot,
  type WorkflowMainExports,
  type WorkflowObserver,
  type WorkflowSelfTestHooks,
  type WorkflowSignal,
} from '../contract';
import { foldFlow, foldRunningState, markMissedLevel } from '../flow';
import { workflowManifest } from '../manifest';
import { createStageList } from '../stage-list';
import { signalOf } from './agent-signals';
import {
  checklistToolDefinition,
  SET_WORKFLOW_CHECKLIST_TOOL,
  startChecklistTool,
} from './checklist-tool';
import { addDriveActions } from './drive-actions';
import { createFlowStore } from './flow-store';
import { createRunLog } from './run-log';
import { createRunMeter } from './run-meter';
import { SESSION_NOTE } from './session-note';
import {
  reportedSteps,
  SET_WORKFLOW_STEP_TOOL,
  startStepTool,
  stepToolDefinition,
} from './step-tool';
import { createTurnWork } from './turn-work';

type WorkflowApi = MainApi<
  typeof workflowManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Folds each owned Chat-tab session's agent events and session events into its
// flow through the registered workflows, keeps the flows in `flows.json` keyed by
// host session id, opens at start each row chat already holds as its open events
// would have, folds a re-attach's replay only past the flow's last save,
// marks a live turn with agent work and no workflow as a missed level, tells each
// observer every fold, open, close and replay, contributes `set_workflow_step`
// while a workflow has a reportable stage, which lists every workflow's stages'
// `reportedAs` and moves a flow only by its own workflow's, and
// `set_workflow_checklist`, hands chat the session note naming both,
// meters each session's active time and spend and appends a line to `runs.jsonl`
// when a fold enters a stage that finishes its workflow, writes each open session's
// flow to `workflow.flows`, and offers a drive run the two tools' reports as drive
// actions. Exports `addWorkflow`, `signal`, `setState` and `observe`.
export const workflowMainPart: MainPart<typeof workflowManifest> = {
  manifest: workflowManifest,
  start(api: WorkflowApi) {
    const { services, events } = api;
    const { log, clock } = services;
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const rows = api.state.read(sessionsRowsSlot);
    const chatSessions = api.state.read(chatSessionSlot);
    const workflows = createStageList<MainWorkflow>();
    const store = createFlowStore({
      flows: api.state.publish(workflowFlowsSlot),
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

    const putFlow = (next: SessionFlow, origin: SignalOrigin) => {
      if (origin === 'live') {
        store.put(next);
      } else {
        store.putKeepingSavedAt(next);
      }
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
    const startChecklistToolSession = startChecklistTool({ reportChecklist });
    sessions.contributeTools(
      [checklistToolDefinition()],
      startChecklistToolSession,
      { mainAgentOnly: true },
    );
    if (api.drive !== null) {
      addDriveActions(api.drive, { reportStep, reportChecklist });
    }
    chat.addInstructions(SESSION_NOTE);

    // Contributes the tool again when the reportable stages change, so its
    // schema lists a stage a workflow added; with none left, no tool.
    let stepTool: Disposable | null = null;
    const contributeStepTool = () => {
      stepTool?.dispose();
      stepTool =
        reportedSteps(workflows.all()).length === 0
          ? null
          : sessions.contributeTools(
              [stepToolDefinition(workflows.all())],
              startStepToolSession,
              { mainAgentOnly: true },
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

    const openFlow = (
      sessionId: string,
      hostSessionId: string,
      projectDir: string,
    ) => {
      const flow = store.open(sessionId, hostSessionId, projectDir);
      tellObservers((observer) => observer.opened(flow));
    };

    // A start while chat and sessions run hears no `connected` or
    // `sessionOpened` for the rows they already hold, so each row chat holds
    // under a profile in its settings opens here under its row's host id, as
    // those events would have opened it. A row an event opened first is left.
    const openRowsAlreadyOpen = () => {
      const profileNames = new Set(chat.profiles().map(({ name }) => name));
      for (const [sessionId, info] of chatSessions.all()) {
        const row = rows.get(sessionId);
        const hostSessionId = row?.hostSessionId ?? null;
        const projectDir = row?.projectDir ?? null;
        if (hostSessionId === null || projectDir === null) {
          continue;
        }
        const isHeld = store.hostIdOf(sessionId) !== null;
        if (isHeld || !profileNames.has(info.profile)) {
          continue;
        }
        openFlow(sessionId, hostSessionId, projectDir);
      }
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
        if (store.hostIdOf(sessionId) === pair.hostSessionId) {
          return;
        }
        openFlow(sessionId, pair.hostSessionId, pair.projectDir);
      });
    });
    events.on('sessions.hostSessionChanged', ({ id, info }) => {
      const hostSessionId = info.sessionId;
      void ready.then(() => {
        if (hostSessionId !== null) {
          store.rekey(id, hostSessionId);
        }
        turnWork.forget(id);
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
          runMeter.note(sessionId, event);
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

    const selfTestHooks: WorkflowSelfTestHooks = {
      forgetFlows(projectDir) {
        for (const sessionId of store.forgetFlows(projectDir)) {
          turnWork.forget(sessionId);
          runMeter.forget(sessionId);
          tellObservers((observer) => observer.closed(sessionId));
        }
      },
      callStepTool(sessionId, step) {
        void startStepToolSession({ id: sessionId }).call(
          SET_WORKFLOW_STEP_TOOL,
          { step },
          { toolUseId: null, signal: new AbortController().signal },
        );
      },
      callChecklistTool(sessionId, items) {
        void startChecklistToolSession({ id: sessionId }).call(
          SET_WORKFLOW_CHECKLIST_TOOL,
          { items },
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
      ready() {
        void ready.then(openRowsAlreadyOpen);
      },
      dispose: () => store.flushed(),
      exports: (consumer): WorkflowMainExports => ({
        signal: (sessionId, signal, origin) => apply(sessionId, signal, origin),
        flowOf: (sessionId) => store.get(sessionId),
        flows: () => store.all(),
        setState(sessionId, state) {
          const flow = store.get(sessionId);
          if (flow === null) {
            return;
          }
          store.putKeepingSavedAt({ ...flow, state: state ?? null });
        },
        ready,
        addWorkflow: (workflow) => consumer.track(addWorkflow(workflow)),
        observe: (observer) => consumer.track(observe(observer)),
        layoutTypes,
        selfTestHooks: services.selfTest === null ? null : selfTestHooks,
      }),
    };
  },
};
