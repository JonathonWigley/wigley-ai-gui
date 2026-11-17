import './workflow.css';
import type { Disposable } from '../../../contracts/disposable';
import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
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
  type PageWorkflow,
  type SessionFlow,
  workflowFlowsSlot,
  type WorkflowId,
  type WorkflowPageExports,
  workflowStageActionCommand,
} from '../contract';
import { newFlow } from '../flow';
import { workflowManifest } from '../manifest';
import {
  createWorkflowDraw,
  type WorkflowDrawDeps,
} from './layout/workflow-draw';
import { createPreview } from './preview-steps';
import { createWorkflowView } from './workflow-view';
import {
  keyRunner,
  kitCommandsOf,
} from '../../../shared/page/layout-host/base-kit';

type WorkflowApi = PageApi<typeof workflowManifest, ChannelShape>;

// The engine's commands a key runs on the selected session.
type SessionCommand = 'mainAction' | 'toggleFinishedWaves' | 'toggleHeadless';

const SIDE_PANE_HIDDEN_KEY = 'sidePaneHidden';

// Draws each session's flow as a chip under its row, a strip above its Chat
// composer and a side pane beside its transcript, through the `draw` of the
// flow's workflow, each workflow plugin's over its own layouts. Reads
// `workflow.flows`, drawing the one flow each notice names, leaving a deleted flow
// drawn until its row leaves and drawing no flow whose row has left, and holds the
// page half of each workflow, which `addWorkflow` extends; each workflow takes one
// side part. `stageAction` runs the view's gate for the session and action its arg
// names; each engine key runs it on the selected session, each button on the
// session it draws. A `chat.session` change that flips a session's headless
// flag draws its parts again. `toggleSidePane` shows or hides the pane in
// every session, kept in `uiState`. `openPreview` steps chat's preview session
// through every workflow's samples (`createPreview`).
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

    const nameOf = (sessionId: string) =>
      rows.get(sessionId)?.label ?? sessionId;
    const isPreview = (sessionId: string) => preview.flowOf(sessionId) !== null;
    const flowOf = (sessionId: string): SessionFlow =>
      preview.flowOf(sessionId) ??
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
          sidePart.dispose();
          view.redraw();
        },
      };
    };

    sessions.addRowPart(view.chipPart);
    chat.addComposerPart(view.stripPart);

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

    const runKey = keyRunner(api.commands, log);
    // Acts on the session Sessions mode shows: in any other mode the key
    // belongs to that mode, so it does nothing.
    const runOnSelected = (command: SessionCommand) => () => {
      const sessionId = sessions.shownSessionId();
      if (sessionId === null) {
        log(`no shown session for ${command}`);
        return;
      }
      runKey(workflowStageActionCommand, { sessionId, action: command });
    };
    const toggleSidePane = () => {
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
      },
      exports: (consumer): WorkflowPageExports => ({
        addWorkflow: (workflow) => consumer.track(addWorkflow(workflow)),
        createWorkflowDraw: (pluginApi, options) =>
          createWorkflowDraw(drawDeps, pluginApi, options),
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
        for (const flow of flows.all().values()) {
          drawFlow(flow);
        }
      },
    };
  },
};
