import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import { DEMO_HARNESS_ID } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { activeMsAt } from '../../../shared/active-time';
import { appEndpointDir } from '../../../shared/app-endpoint-dir';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { registeredProfiles } from '../../../shared/harness-profiles';
import layoutTypes from '../layouts/layout.d.ts?raw';
import {
  type ChatMainEvents,
  chatMainKey,
  chatSessionSlot,
} from '../../chat/contract';
import { contributionsMainKey } from '../../contributions/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  CHECKLIST_HOOK,
  CHECKLIST_DECLARED,
  type ChecklistItem,
  type DeclaredWorkflow,
  type FoldEvent,
  isClaimed,
  type MainWorkflow,
  type SessionFlow,
  type SignalOrigin,
  type WorkflowChannel,
  workflowDeclaredSlot,
  workflowFlowsSlot,
  type WorkflowMainExports,
  type WorkflowObserver,
  type WorkflowSelfTestHooks,
  type WorkflowSignal,
  WORKFLOW_OFFLINE_ANSWER,
} from '../contract';
import { createDeclaredActions } from '../declared/actions';
import { buildMainWorkflow } from '../declared/build-main';
import { checklistHookHandler } from '../declared/checklist-hook';
import { autoStartSettingsLine, createAutoStart } from '../declared/countdown';
import {
  createDeclaredRegistry,
  mergeDeclared,
  publishDeclared,
} from '../declared/declared-set';
import { createEnabledWorkflows } from '../declared/enabled-workflows';
import { planFormatReader } from '../declared/plan-format-reader';
import {
  declaredWorkflows,
  workflowsReader,
} from '../declared/workflows-reader';
import { foldFlow, foldRunningState, markUnclaimedWork } from '../flow';
import { workflowManifest } from '../manifest';
import { startPlanCapability } from '../plan/plan-capability';
import { createPlanFold } from '../plan/plan-fold';
import { PLAN_RUNS_FOLDER } from '../plan/plan-reports';
import { createStageList } from '../stage-list';
import { signalOf } from './agent-signals';
import {
  checklistToolDefinition,
  SET_WORKFLOW_CHECKLIST_TOOL,
  startChecklistTool,
} from './checklist-tool';
import { registerDemoSteps } from './demo-steps';
import { addDriveActions } from './drive-actions';
import { createFlowStore } from './flow-store';
import { createHeadlessLines } from './headless-line';
import { createRunLog } from './run-log';
import { createRunMeter } from './run-meter';
import { sampleLargeSelfTestScript } from './sample-large-selftest-script';
import { sampleLevelSelfTestScripts } from './sample-selftest-scripts';
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
  WorkflowChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Folds each owned Chat-tab session's agent events and session events into
// its flow through the registered workflows, keeps the flows in `flows.json`
// keyed by host session id, opens at start each row chat already holds as its
// open events would have, folds a re-attach's replay only past the flow's last
// save, marks a live turn with agent work on the Checklist flow as unclaimed
// work while a registered workflow `flagsUnclaimedWork`, tells each observer
// every fold, open, close and replay, contributes `set_workflow_step` while a
// workflow has a reportable stage, which lists every workflow's stages'
// `reportedAs` and moves a flow only by its own workflow's, and
// `set_workflow_checklist`, hands chat the session note naming both, meters
// each session's active time and spend and appends a line to `runs.jsonl` when
// a fold enters a stage that finishes its workflow, writes each open session's
// flow to `workflow.flows`, and offers a drive run the two tools' reports as
// drive actions. A demo session (an ephemeral open, or a row on the demo
// harness) opens no flow, so nothing of it reaches `flows.json`; registers the
// main halves of the `workflow.engine` demo step and the four sample
// workflows' steps. Exports
// `addWorkflow`, `signal`, `observe`, and `stageFinishes` for whether a flow
// sits in a stage that finishes its run. Under the self-test, hands the four
// sample workflows' scripts, each adding its sample declaration.
// Registers the `workflows` and `planFormat` readers with contributions, runs
// the built-in Checklist flow and every declared workflow `workflow.off` leaves
// on (published in `workflow.declared`), answers the `workflow.checklist`
// hook, runs declared actions for the page and the auto-start countdown, and
// logs the `autoStart` setting on each settings change. Folds each declared
// workflow's plan through the plan capability, and once flows load runs its
// plan watch, `set_workflow_plan` and plan report files.
export const workflowMainPart: MainPart<typeof workflowManifest> = {
  manifest: workflowManifest,
  start(api: WorkflowApi) {
    const { services, events } = api;
    const { log, clock } = services;
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const rows = api.state.read(sessionsRowsSlot);
    const chatSessions = api.state.read(chatSessionSlot);
    const harnesses = api.state.read(coreAgentHarnessesSlot);
    const workflows = createStageList<MainWorkflow>();
    const store = createFlowStore({
      flows: api.state.publish(workflowFlowsSlot),
      files: api.data,
      log,
      paths: services.paths,
      clock,
    });
    const contributions = api.dependency(contributionsMainKey);
    contributions.registerFeature('workflows', workflowsReader);
    contributions.registerFeature('planFormat', planFormatReader);
    let isStopped = false;
    const enabled = createEnabledWorkflows();
    const planFold = createPlanFold();
    const declaredSlot = api.state.publish(workflowDeclaredSlot);
    // Every `addDeclared` entry, in call order.
    const addedDeclared: DeclaredWorkflow[] = [];
    const declaredRegistry = createDeclaredRegistry((entry) =>
      addWorkflow(buildMainWorkflow(entry, planFold)),
    );
    // The enabled set again: the contributed declarations `workflow.off`
    // leaves on, then each `addDeclared` one. Publishes it, hands it to
    // `enabled`, and registers each changed entry.
    const syncDeclared = () => {
      if (isStopped) {
        return;
      }
      const list = mergeDeclared(
        declaredWorkflows(
          contributions.strategies('workflows'),
          contributions.strategies('planFormat'),
          api.settings().off,
        ),
        addedDeclared,
      );
      publishDeclared(declaredSlot, list);
      enabled.set(list);
      declaredRegistry.syncList(list);
    };
    const flowsLoaded = store.load().catch((error: unknown) => {
      log(`flows.json not read: ${errorText(error)}; starting with no flows`);
    });
    const declaredRead = contributions.ready.then(
      () => syncDeclared(),
      (error: unknown) => {
        log(
          `contributions not read: ${errorText(error)}; no declared workflows`,
        );
      },
    );
    // The flows loaded and the first enabled set registered, so no signal folds
    // before the declared workflows can claim it.
    const ready = Promise.all([flowsLoaded, declaredRead]).then(
      () => undefined,
    );
    // Runs `work` once the flows load, unless the part stopped by then;
    // resolves to its result, else to `onceStopped`.
    const whenReady = <T>(work: () => T, onceStopped: T): Promise<T> =>
      ready.then(() => (isStopped ? onceStopped : work()));
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

    // The registered workflow holding `flow`; undefined with no flow or a
    // workflow no plugin holds.
    const workflowOf = (flow: SessionFlow | null) =>
      workflows.all().find((held) => held.id === flow?.workflow);

    const stageFinishes = (flow: SessionFlow) =>
      workflowOf(flow)?.stages.find((held) => held.id === flow.stage)
        ?.finishes === true;

    // Writes the run's line when the fold entered a stage that finishes its
    // workflow, and starts the meter's next run.
    const logFinishedRun = (before: SessionFlow, after: SessionFlow) => {
      const workflow = workflowOf(after);
      const entered = after.stage !== before.stage;
      if (workflow === undefined || !entered || !stageFinishes(after)) {
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
        if (!isClaimed(before) && isClaimed(after)) {
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

    const applyUnclaimedWork = (sessionId: string) => {
      const flow = store.get(sessionId);
      if (flow === null || !turnWork.worked(sessionId)) {
        return;
      }
      const isFlagged = workflows
        .all()
        .some((workflow) => workflow.flagsUnclaimedWork === true);
      const next = markUnclaimedWork(flow, isFlagged);
      if (next !== flow) {
        putFlow(next, 'live');
      }
    };

    // The registered workflow holding the session's flow, as `workflowOf` says.
    const heldWorkflowOf = (sessionId: string) =>
      workflowOf(store.get(sessionId));

    // Folds a reported step as a live event; resolves whether the flow is now in
    // the stage its own workflow reports as `step`. No such stage, a stage rule
    // that ignores it, or a stopped part resolves false.
    const reportStep = (sessionId: string, step: string) =>
      whenReady(() => {
        const stage = heldWorkflowOf(sessionId)?.stages.find(
          (held) => held.reportedAs === step,
        );
        if (stage === undefined) {
          return false;
        }
        apply(sessionId, { type: 'stepReported', step: stage.id }, 'live');
        return store.get(sessionId)?.stage === stage.id;
      }, false);
    // One headless-line state per session, shared by both workflow tools.
    const headlessLines = createHeadlessLines({
      isHeadless: (sessionId) => chat.isHeadless(sessionId),
      launchedHeadless: (sessionId) => chat.launchedHeadless(sessionId),
    });
    const startStepToolSession = startStepTool({
      workflows: () => workflows.all(),
      reportStep,
      lines: headlessLines,
    });

    // Folds a reported checklist as a live event, whatever workflow holds the
    // flow; resolves whether the session has a flow, false once the part
    // stopped.
    const reportChecklist = (
      sessionId: string,
      items: readonly ChecklistItem[],
    ) =>
      whenReady(() => {
        if (store.get(sessionId) === null) {
          return false;
        }
        apply(sessionId, { type: 'checklistReported', items }, 'live');
        return true;
      }, false);
    const startChecklistToolSession = startChecklistTool({
      reportChecklist,
      lines: headlessLines,
    });
    sessions.contributeTools(
      [checklistToolDefinition()],
      startChecklistToolSession,
      {
        mainAgentOnly: true,
        offline: { [SET_WORKFLOW_CHECKLIST_TOOL]: WORKFLOW_OFFLINE_ANSWER },
      },
    );
    if (api.drive !== null) {
      addDriveActions(api.drive, { reportStep, reportChecklist });
    }
    chat.addInstructions(SESSION_NOTE);
    registerDemoSteps(services);

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
              {
                mainAgentOnly: true,
                offline: { [SET_WORKFLOW_STEP_TOOL]: WORKFLOW_OFFLINE_ANSWER },
              },
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
          callEach<() => void>(
            [() => added.dispose(), contributeStepTool],
            (step) => step(),
          );
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

    addWorkflow(buildMainWorkflow(CHECKLIST_DECLARED, planFold));
    contributions.onChanged('workflows', syncDeclared);
    contributions.onChanged('planFormat', syncDeclared);

    // Replaces fields of the session's flow with no fold, keeping the save
    // time.
    const setFlowFields = (sessionId: string, patch: Partial<SessionFlow>) => {
      const flow = store.get(sessionId);
      if (flow !== null) {
        store.putKeepingSavedAt({ ...flow, ...patch });
      }
    };
    const autoStart = createAutoStart({
      clock,
      timers: services.timers,
      log,
      flowOf: (sessionId) => store.get(sessionId),
      flows: () => store.all(),
      workflowOf: (flow) => enabled.workflowOf(flow),
      autoStart: () => api.settings().autoStart,
      setCountdownEndsAt: (sessionId, countdownEndsAt) =>
        setFlowFields(sessionId, { countdownEndsAt }),
      runAction: (sessionId, action) => actions.run(sessionId, action),
      sessionName: (flow) =>
        sessions.label(flow.sessionId) ?? services.paths.base(flow.projectDir),
      isStopped: () => isStopped,
    });
    const actions = createDeclaredActions({
      chat,
      log,
      workflows: () => enabled.enabledWorkflows(),
      flowOf: (sessionId) => store.get(sessionId),
      signal: (sessionId, signal) => apply(sessionId, signal, 'live'),
      cancelCountdown: (sessionId) => autoStart.cancel(sessionId),
      isStopped: () => isStopped,
    });
    observe(autoStart);
    // Started once flows load, so its follow of every held flow sees them.
    let planCapability: Disposable | null = null;
    void ready.then(() => {
      if (isStopped) {
        return;
      }
      planCapability = startPlanCapability({
        git: services.git,
        files: services.files,
        paths: services.paths,
        log,
        homeDir: services.homeDir,
        appInstance: services.appInstance,
        sessions,
        signal: (sessionId, signal, origin) => apply(sessionId, signal, origin),
        flowOf: (sessionId) => store.get(sessionId),
        flows: () => store.all(),
        observe,
        ready,
        enabledWorkflows: () => enabled.enabledWorkflows(),
        onWorkflowsChanged: (listener) => enabled.onWorkflowsChanged(listener),
        workflowOf: (flow) => enabled.workflowOf(flow),
      });
    });
    api.channel.handle('runAction', ({ sessionId, action }) =>
      ready.then(async () => {
        if (isStopped) {
          return;
        }
        await actions.run(sessionId, action);
      }),
    );
    sessions.addHookHandler(
      CHECKLIST_HOOK,
      checklistHookHandler({
        ready,
        flowOf: (sessionId) => store.get(sessionId),
        workflowOf: (flow) => enabled.workflowOf(flow),
      }),
    );
    api.layouts.register({ layoutTypes });
    api.onSettingsChanged(() => {
      void ready.then(() => {
        if (isStopped) {
          return;
        }
        log(autoStartSettingsLine(api.settings().autoStart));
        syncDeclared();
        autoStart.settingsChanged();
      });
    });

    const openFlow = (
      sessionId: string,
      hostSessionId: string,
      projectDir: string,
    ) => {
      const flow = store.open(sessionId, hostSessionId, projectDir);
      tellObservers((observer) => observer.opened(flow));
    };

    // A start while chat runs hears no `sessionOpened` for the rows it already
    // holds, so each row chat holds under a registered harness's profile opens here
    // under its row's host id, as that event would have opened it. A row an
    // event opened first is left, and a demo row opens no flow.
    const openRowsAlreadyOpen = () => {
      const profileNames = new Set(
        registeredProfiles(harnesses.all()).map(({ name }) => name),
      );
      for (const [sessionId, info] of chatSessions.all()) {
        const row = rows.get(sessionId);
        const hostSessionId = row?.hostSessionId ?? null;
        const projectDir = row?.projectDir ?? null;
        if (hostSessionId === null || projectDir === null) {
          continue;
        }
        const isHeld = store.hostIdOf(sessionId) !== null;
        const isDemo = info.harness === DEMO_HARNESS_ID;
        if (isHeld || isDemo || !profileNames.has(info.profile)) {
          continue;
        }
        openFlow(sessionId, hostSessionId, projectDir);
      }
    };

    // Chat's open carries the host id and folder: a session chat adopts across
    // its own restart fires no `sessions.connected`. A row already held under
    // that host id is left, and an ephemeral (demo) session opens no flow.
    events.on(
      'chat.sessionOpened',
      ({ sessionId, hostSessionId, projectDir, ephemeral }) => {
        if (ephemeral === true) {
          return;
        }
        void whenReady(() => {
          if (store.hostIdOf(sessionId) === hostSessionId) {
            return;
          }
          openFlow(sessionId, hostSessionId, projectDir);
        }, undefined);
      },
    );
    events.on('sessions.hostSessionChanged', ({ id, info }) => {
      const hostSessionId = info.sessionId;
      void whenReady(() => {
        if (hostSessionId !== null) {
          store.rekey(id, hostSessionId);
        }
        turnWork.forget(id);
        runMeter.cleared(id);
        apply(id, { type: 'cleared' }, 'live');
      }, undefined);
    });
    events.on('sessions.ended', ({ sessionId }) => {
      void whenReady(() => {
        turnWork.forget(sessionId);
        runMeter.forget(sessionId);
        tellObservers((observer) => observer.closed(sessionId));
        store.drop(sessionId);
      }, undefined);
    });
    events.on(
      'chat.agentEvent',
      ({ sessionId, hostSessionId, event, replayed }) => {
        void whenReady(() => {
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
          for (const signal of signalOf(
            event,
            flow,
            fromCurrentHost,
            services.paths,
          )) {
            if (replayed) {
              applyReplayed(sessionId, signal, event.at);
            } else {
              apply(sessionId, signal, 'live');
            }
            if (signal.type === 'turnEnded') {
              if (!replayed) {
                applyUnclaimedWork(sessionId);
              }
              for (const listener of turnEndedListeners) {
                listener(sessionId);
              }
            }
          }
        }, undefined);
      },
    );

    // The tool session a self-test call stands for, under the flow's host id.
    const selfTestToolSession = (sessionId: string) => ({
      id: sessionId,
      info: {
        sessionId: store.hostIdOf(sessionId),
        projectDir: null,
        harness: null,
        rowId: null,
      },
    });
    const selfTestHooks: WorkflowSelfTestHooks = {
      forgetFlows(projectDir) {
        for (const sessionId of store.forgetFlows(projectDir)) {
          turnWork.forget(sessionId);
          runMeter.forget(sessionId);
          tellObservers((observer) => observer.closed(sessionId));
        }
      },
      callStepTool(sessionId, step) {
        void startStepToolSession(selfTestToolSession(sessionId)).call(
          SET_WORKFLOW_STEP_TOOL,
          { step },
          { toolUseId: null, signal: new AbortController().signal },
        );
      },
      callChecklistTool(sessionId, items) {
        void startChecklistToolSession(selfTestToolSession(sessionId)).call(
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
      addDeclared(workflow) {
        addedDeclared.push(workflow);
        syncDeclared();
        return {
          dispose() {
            const index = addedDeclared.indexOf(workflow);
            if (index !== -1) {
              addedDeclared.splice(index, 1);
              syncDeclared();
            }
          },
        };
      },
    };
    if (services.selfTest !== null) {
      const selfTest = services.selfTest;
      const deps = {
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        chat,
        sessions,
        harnesses: services.agentHarnesses,
        hooks: selfTestHooks,
      };
      selfTest.run(
        sampleLargeSelfTestScript({
          ...deps,
          planRunsFolder: services.paths.join(
            appEndpointDir(
              services.paths,
              services.homeDir,
              services.appInstance.id,
            ),
            PLAN_RUNS_FOLDER,
          ),
        }),
      );
      for (const script of sampleLevelSelfTestScripts(deps)) {
        selfTest.run(script);
      }
    }
    return {
      commands: {},
      ready() {
        void whenReady(openRowsAlreadyOpen, undefined);
      },
      dispose: () => {
        isStopped = true;
        autoStart.stop();
        planCapability?.dispose();
        return store.flushed();
      },
      exports: (consumer): WorkflowMainExports => ({
        signal: (sessionId, signal, origin) => apply(sessionId, signal, origin),
        flowOf: (sessionId) => store.get(sessionId),
        flows: () => store.all(),
        stageFinishes,
        ready,
        addWorkflow: (workflow) => consumer.track(addWorkflow(workflow)),
        observe: (observer) => consumer.track(observe(observer)),
        layoutTypes,
        selfTestHooks: services.selfTest === null ? null : selfTestHooks,
      }),
    };
  },
};
