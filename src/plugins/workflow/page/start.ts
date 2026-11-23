import './workflow.css';
import type { Disposable } from '../../../contracts/disposable';
import type {
  PageApi,
  PageCommandContext,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { docsPageKey } from '../../docs/contract';
import {
  CHAT_PREVIEW_HOST_ID,
  chatPageKey,
  chatSessionSlot,
} from '../../chat/contract';
import {
  followRows,
  sessionsActiveSlot,
  sessionsPageKey,
  sessionsActivitySlot,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  actionCommandShortId,
  CHECKLIST_WORKFLOW,
  CHECKLIST_WORKFLOW_ID,
  type DeclaredWorkflow,
  type PageWorkflow,
  type SessionFlow,
  type WorkflowChannel,
  workflowDeclaredSlot,
  type WorkflowDrawOptions,
  workflowFlowsSlot,
  type WorkflowId,
  type WorkflowPageExports,
  workflowStageActionCommand,
} from '../contract';
import { CANCEL_COUNTDOWN_ACTION } from '../declared/actions';
import { buildPageWorkflow, type PageBuildDeps } from '../declared/build-page';
import { NO_PLAN_PANE } from '../declared/plan-pane';
import { newFlow } from '../flow';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import { workflowManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import {
  createWorkflowDraw,
  createWorkflowDrawShow,
  type WorkflowDrawDeps,
} from './layout/workflow-draw';
import { createPreview } from './preview-steps';
import { createWorkflowView } from './workflow-view';
import {
  keyRunner,
  kitCommandsOf,
} from '../../../shared/page/layout-host/base-kit';

type WorkflowApi = PageApi<typeof workflowManifest, WorkflowChannel>;

// The badge color of a declaration that names none.
const DEFAULT_BADGE_COLOR = 'var(--wg-accent)';

// The engine's commands a key runs on the session Sessions mode shows.
type SessionCommand = 'mainAction' | 'toggleFinishedWaves' | 'toggleHeadless';

const SIDE_PANE_HIDDEN_KEY = 'sidePaneHidden';

// Draws each session's flow as a chip under its row, a strip above its Chat
// composer and a side pane beside its transcript, through the `draw` of the
// flow's workflow, each workflow plugin's over its own layouts. Reads
// `workflow.flows`, drawing the one flow each notice names, leaving a deleted
// flow drawn until its row leaves and drawing no flow whose row has left, and
// holds the page half of each workflow, which `addWorkflow` extends; each
// workflow takes one side part. `stageAction` runs the view's gate for the
// session and action its arg names; each engine key runs it on the run's
// target when it names one, else on the session Sessions mode shows, and each
// button on the session it draws. A `chat.session` change that flips a
// session's headless flag draws its parts again. `toggleSidePane` shows or
// hides the pane in every session, kept in `uiState`, and does nothing while
// Sessions mode shows no session. `openPreview` steps chat's preview session
// through every workflow's samples (`createPreview`). `showSample` draws a demo
// step's sample flow on its session in place of the stored flow, and like the
// preview runs no action; registers the `workflow.engine` demo step. Holds the
// built-in Checklist flow's page half, and one page half per entry of
// `workflow.declared`, built again when its entry changes and disposed when it
// leaves: each declared action is a runtime command `workflow.<short id>`,
// bound to its key, and runs in main through the channel, `openPlan` aside,
// which opens the plan file in Docs mode. `cancelCountdown` stops the
// countdown of the session it targets.
export const workflowPagePart: PagePart<typeof workflowManifest> = {
  manifest: workflowManifest,
  start(api: WorkflowApi) {
    const { services } = api;
    const { log } = services;
    const sessions = api.dependency(sessionsPageKey);
    const chat = api.dependency(chatPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const activities = api.state.read(sessionsActivitySlot);
    const flows = api.state.read(workflowFlowsSlot);
    const chatSessions = api.state.read(chatSessionSlot);
    const active = api.state.read(sessionsActiveSlot);
    const workflows = new Map<WorkflowId, PageWorkflow>();
    // The demo sample each session shows (`showSample`), over its stored flow.
    const samples = new Map<string, SessionFlow>();

    const nameOf = (sessionId: string) =>
      rows.get(sessionId)?.label ?? sessionId;
    const isPreview = (sessionId: string) =>
      preview.flowOf(sessionId) !== null || samples.has(sessionId);
    const flowOf = (sessionId: string): SessionFlow =>
      preview.flowOf(sessionId) ??
      samples.get(sessionId) ??
      flows.get(sessionId) ??
      newFlow(sessionId, rows.get(sessionId)?.projectDir ?? '');

    const view = createWorkflowView({
      log: services.log,
      clock: services.clock,
      timers: services.timers,
      toast: (text, tone) => services.toast(text, tone),
      workflows: { all: () => [...workflows.values()] },
      flowOf,
      nameOf,
      isPreview,
      setRowActivity: (sessionId, activity) =>
        sessions.setActivity(sessionId, workflowManifest.id, activity),
      isWorking: (sessionId) =>
        (activities.get(sessionId) ?? []).some(
          ({ activity }) => activity.tone === 'running',
        ),
      isHeadless: (sessionId) => chatSessions.get(sessionId)?.headless === true,
      setHeadless: (sessionId, headless) =>
        chat.setHeadless(sessionId, headless),
      activeSessionId: () => active.get() ?? null,
    });
    view.setSidePaneHidden(services.uiState.get(SIDE_PANE_HIDDEN_KEY) === true);

    const preview = createPreview({
      openChatPreview: () => api.commands.run('chat.openPreview'),
      previewSessionId: () =>
        [...rows.all().values()].find(
          (row) => row.hostSessionId === CHAT_PREVIEW_HOST_ID,
        )?.sessionId ?? null,
      showFlow: view.setFlow,
      closed: (sessionId) => view.setFlow(flowOf(sessionId)),
      clock: services.clock,
      samples: (sessionId, now) =>
        [...workflows.values()].flatMap(
          (workflow) => workflow.previewFlows?.(sessionId, now) ?? [],
        ),
      log: services.log,
    });

    const drawDeps: WorkflowDrawDeps = {
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      log: services.log,
      clock: services.clock,
      redraw: () => view.redraw(),
    };

    // Holds a copy whose stages are in stage order, and draws again each flow of it,
    // which arrived before its page half; its dispose does nothing once the copy is
    // gone.
    const addWorkflow = (workflow: PageWorkflow): Disposable => {
      if (workflows.has(workflow.id)) {
        throw new Error(`${workflow.id} is already added`);
      }
      const added: PageWorkflow = {
        ...workflow,
        stages: [...workflow.stages].sort((a, b) => a.order - b.order),
      };
      workflows.set(added.id, added);
      const sidePart = chat.addSidePart(view.sidePartFor(added));
      view.redraw();
      for (const flow of flows.all().values()) {
        if (flow.workflow === added.id) {
          drawFlow(flow);
        }
      }
      return {
        dispose() {
          if (workflows.get(added.id) !== added) {
            return;
          }
          workflows.delete(added.id);
          try {
            sidePart.dispose();
          } finally {
            view.redraw();
          }
        },
      };
    };

    sessions.addRowPart(view.chipPart);
    chat.addComposerPart(view.stripPart);

    const drawOptions = (entry: DeclaredWorkflow): WorkflowDrawOptions => ({
      manifest: workflowManifest,
      defaultLayout,
      defaultStylesheet,
      userLayout: () => api.settings().layout,
      sideTitle: entry.decl.sidePane.title,
      badgeColor: entry.decl.badgeColor ?? DEFAULT_BADGE_COLOR,
    });
    const buildDeps = (
      draw: PageBuildDeps['draw'],
    ): PageBuildDeps => ({
      draw,
      planPane: NO_PLAN_PANE,
      runAction: (sessionId, action) =>
        api.channel.invoke('runAction', { sessionId, action }),
      // Docs is read at the call: a part started with no Docs page still draws.
      openDoc: (path) => api.dependency(docsPageKey).openDoc(path),
      paths: services.paths,
    });
    // Registers each action of `entry` as `workflow.<short id>` and binds its
    // key. A command that does not register costs that action's command and
    // key, and a key that does not bind costs that key alone.
    const registerActions = (entry: DeclaredWorkflow): Disposable[] => {
      const handles: Disposable[] = [];
      for (const [actionId, action] of Object.entries(
        entry.decl.actions ?? {},
      )) {
        const short = actionCommandShortId(entry.id, actionId);
        try {
          handles.push(
            api.commands.register(
              short,
              {
                label: action.label,
                group: 'workflow',
                runsIn: 'page',
                targets: true,
                ...(action.risky === true ? { risky: true } : {}),
              },
              ({ targetSessionId }) =>
                runOnTarget(short, targetSessionId ?? null),
            ),
          );
        } catch (error) {
          log(
            `workflow ${entry.id}: command ${short} not registered: ${errorText(error)}`,
          );
          continue;
        }
        if (action.key === undefined) {
          continue;
        }
        try {
          handles.push(
            api.keys.bind({
              keys: action.key,
              scope: 'any',
              command: `${workflowManifest.id}.${short}`,
            }),
          );
        } catch (error) {
          log(
            `workflow ${entry.id}: key ${action.key} not bound: ${errorText(error)}`,
          );
        }
      }
      return handles;
    };

    // A declared workflow's page half: its draw, its commands and keys, and its
    // `addWorkflow` entry, disposed together.
    const addDeclaredHalf = (entry: DeclaredWorkflow): Disposable => {
      const draw = createWorkflowDrawShow(drawDeps, api, drawOptions(entry));
      const handles: Disposable[] = [draw];
      try {
        handles.push(...registerActions(entry));
        handles.push(addWorkflow(buildPageWorkflow(entry, buildDeps(draw))));
      } catch (error) {
        log(`workflow ${entry.id} not drawn: ${errorText(error)}`);
      }
      return {
        dispose: () =>
          callEach([...handles].reverse(), (handle) => handle.dispose()),
      };
    };

    const declared = api.state.read(workflowDeclaredSlot);
    const declaredHalves = new Map<string, { json: string; half: Disposable }>();
    const syncDeclaredHalf = (id: string, entry: DeclaredWorkflow | undefined) => {
      const held = declaredHalves.get(id);
      const json = entry === undefined ? null : JSON.stringify(entry);
      if (held?.json === json) {
        return;
      }
      held?.half.dispose();
      declaredHalves.delete(id);
      if (entry !== undefined && json !== null) {
        declaredHalves.set(id, { json, half: addDeclaredHalf(entry) });
      }
    };

    // A flow whose draw throws is logged, so the rest of the catch-up still draws.
    const drawFlow = (flow: SessionFlow) => {
      const rowHasLeft = rows.get(flow.sessionId) === undefined;
      if (isPreview(flow.sessionId) || rowHasLeft) {
        return;
      }
      try {
        view.setFlow(flow);
      } catch (error) {
        log(`flow of ${flow.sessionId} not drawn: ${errorText(error)}`);
      }
    };

    // The built-in Checklist flow's page half, before any declared one.
    const checklistEntry: DeclaredWorkflow = {
      id: CHECKLIST_WORKFLOW_ID,
      pluginName: '',
      decl: CHECKLIST_WORKFLOW,
      planFormat: null,
    };
    addWorkflow(
      buildPageWorkflow(
        checklistEntry,
        buildDeps(createWorkflowDraw(drawDeps, api, drawOptions(checklistEntry))),
      ),
    );

    // Draws the sample now when its row is there, else once the row arrives.
    const showSample = (flow: SessionFlow): Disposable => {
      const { sessionId } = flow;
      samples.set(sessionId, flow);
      let rowWait: Disposable | null = null;
      if (rows.get(sessionId) === undefined) {
        rowWait = rows.on((changedId, row) => {
          if (changedId !== sessionId || row === undefined) {
            return;
          }
          rowWait?.dispose();
          rowWait = null;
          if (samples.get(sessionId) === flow) {
            view.setFlow(flow);
          }
        });
      } else {
        view.setFlow(flow);
      }
      sessions.activate(sessionId);
      return {
        dispose() {
          rowWait?.dispose();
          rowWait = null;
          if (samples.get(sessionId) !== flow) {
            return;
          }
          samples.delete(sessionId);
          if (rows.get(sessionId) !== undefined) {
            view.setFlow(flowOf(sessionId));
          }
        },
      };
    };
    registerDemoSteps(services, { showSample });

    const runKey = keyRunner(api.commands, log);
    // Acts on the run's target when it names one; else on the session
    // Sessions mode shows: in any other mode the key belongs to that mode, so
    // it does nothing.
    const runOnSelected =
      (command: SessionCommand) =>
      ({ targetSessionId }: PageCommandContext) => {
        const sessionId = targetSessionId ?? sessions.shownSessionId();
        if (sessionId === null) {
          log(`no shown session for ${command}`);
          return;
        }
        runKey(workflowStageActionCommand, { sessionId, action: command });
      };
    // Runs a stage action through the view's gate on the run's target, else
    // on the session Sessions mode shows.
    function runOnTarget(action: string, targetSessionId: string | null) {
      const sessionId = targetSessionId ?? sessions.shownSessionId();
      if (sessionId === null) {
        log(`no shown session for ${action}`);
        return;
      }
      runKey(workflowStageActionCommand, { sessionId, action });
    }
    const toggleSidePane = () => {
      if (sessions.shownSessionId() === null) {
        log('side pane key ignored: no shown session');
        return;
      }
      const isHidden = services.uiState.get(SIDE_PANE_HIDDEN_KEY) !== true;
      services.uiState.set(SIDE_PANE_HIDDEN_KEY, isHidden);
      view.setSidePaneHidden(isHidden);
      log(`side pane ${isHidden ? 'hidden' : 'shown'}`);
    };

    return {
      commands: {
        mainAction: runOnSelected('mainAction'),
        toggleSidePane,
        toggleFinishedWaves: runOnSelected('toggleFinishedWaves'),
        toggleHeadless: runOnSelected('toggleHeadless'),
        stageAction: ({ arg }) => view.runFor(arg.sessionId, arg.action),
        openPreview: () => preview.press(),
        cancelCountdown: ({ targetSessionId }) =>
          runOnTarget(CANCEL_COUNTDOWN_ACTION, targetSessionId ?? null),
      },
      exports: (consumer): WorkflowPageExports => ({
        addWorkflow: (workflow) => consumer.track(addWorkflow(workflow)),
        createWorkflowDraw: (pluginApi, options) =>
          createWorkflowDraw(drawDeps, pluginApi, options),
        showSample: (flow) => consumer.track(showSample(flow)),
      }),
      ready() {
        followRows(rows, {
          added: ({ sessionId, hostSessionId }) =>
            preview.sessionAdded(sessionId, hostSessionId),
          removed(sessionId) {
            preview.sessionRemoved(sessionId);
            view.forget(sessionId);
          },
        });
        flows.on((_sessionId, flow) => {
          if (flow !== undefined) {
            drawFlow(flow);
          }
        });
        activities.on((sessionId) => view.activityChanged(sessionId));
        active.on((sessionId) => view.activeChanged(sessionId ?? null));
        chatSessions.on((sessionId, info) =>
          view.headlessChanged(sessionId, info?.headless),
        );
        declared.on((id, entry) => syncDeclaredHalf(id, entry));
        for (const [id, entry] of declared.all()) {
          syncDeclaredHalf(id, entry);
        }
        for (const flow of flows.all().values()) {
          drawFlow(flow);
        }
      },
    };
  },
};
