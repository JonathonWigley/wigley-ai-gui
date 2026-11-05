import './workflow.css';
import type { CoreEvents } from '../../../contracts/core-state';
import type { Disposable } from '../../../contracts/disposable';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { CHAT_PREVIEW_HOST_ID, chatPageKey } from '../../chat/contract';
import { docsPageKey } from '../../docs/contract';
import {
  followRows,
  sessionsActiveSlot,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type PageStage,
  type SessionFlow,
  type WorkflowChannel,
  workflowFlowsSlot,
  type WorkflowPageExports,
} from '../contract';
import { newFlow } from '../flow';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { workflowManifest } from '../manifest';
import { createStageList } from '../stage-list';
import { BUILT_IN_PAGE_STAGES } from '../stages';
import { readWorkflowLayout } from './layout/read-workflow-layout';
import { createPreview } from './preview';
import { createWorkflowView } from './workflow-view';

type WorkflowApi = PageApi<
  typeof workflowManifest,
  WorkflowChannel,
  Record<never, never>,
  QualifiedEvents<'core', CoreEvents>
>;

// The workflow commands a key runs on the selected session.
type SessionCommand =
  | 'mainAction'
  | 'clearAndMake'
  | 'cancelCountdown'
  | 'makeInNewSession'
  | 'resumeMake'
  | 'openPlan'
  | 'retro'
  | 'dismiss'
  | 'toggleFinishedWaves';

const SIDE_PANE_HIDDEN_KEY = 'sidePaneHidden';

// Draws each session's flow as a chip under its row, a strip above its Chat
// composer and a side pane beside its transcript, through the
// `workflow.layout` layout. Reads `workflow.flows`, drawing the one flow each
// notice names and leaving a deleted flow drawn until its row leaves, and holds
// the page halves of the stages, which `addStage` extends.
// Each workflow command runs on the selected session; each button on the
// session it draws. `toggleSidePane` shows or hides the pane in every session,
// kept in `uiState`. `openPreview` steps chat's preview session through a
// sample of every stage (`createPreview`).
export const workflowPagePart: PagePart<typeof workflowManifest> = {
  manifest: workflowManifest,
  start(api: WorkflowApi) {
    const { services } = api;
    const { log } = services;
    const sessions = api.dependency(sessionsPageKey);
    const chat = api.dependency(chatPageKey);
    const docs = api.dependency(docsPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const flows = api.state.read(workflowFlowsSlot);
    const stages = createStageList<PageStage>();

    const nameOf = (sessionId: string) =>
      rows.get(sessionId)?.label ?? sessionId;
    const isPreview = (sessionId: string) => preview.flowOf(sessionId) !== null;
    const flowOf = (sessionId: string): SessionFlow =>
      preview.flowOf(sessionId) ??
      flows.get(sessionId) ??
      newFlow(sessionId, rows.get(sessionId)?.projectDir ?? '');

    const view = createWorkflowView({
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: {
          exists: (id) => api.keys.command(id) !== undefined,
          run: (id) => api.commands.run(id),
        },
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      log: services.log,
      clock: services.clock,
      timers: services.timers,
      toast: (text, tone) => services.toast(text, tone),
      paths: services.paths,
      stages,
      flowOf,
      nameOf,
      isPreview,
      setRowActivity: (sessionId, activity) =>
        sessions.setActivity(sessionId, workflowManifest.id, activity),
      openDoc: (path) => docs.openDoc(path),
      runAction: (request) => api.channel.invoke('runAction', request),
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
      autoStartSeconds: () => api.settings().autoStartSeconds,
      log: services.log,
    });

    const addStage = (stage: PageStage): Disposable => {
      const added = stages.add(stage);
      view.redraw();
      return {
        dispose() {
          added.dispose();
          view.redraw();
        },
      };
    };
    for (const stage of BUILT_IN_PAGE_STAGES) {
      addStage(stage);
    }

    sessions.addRowPart(view.chipPart);
    chat.addComposerPart(view.stripPart);
    chat.addSidePart(view.sidePart);

    // A flow whose draw throws is logged, so the rest of the catch-up still draws.
    const drawFlow = (flow: SessionFlow) => {
      if (isPreview(flow.sessionId)) {
        return;
      }
      try {
        view.setFlow(flow);
      } catch (error) {
        log(`flow of ${flow.sessionId} not drawn: ${errorText(error)}`);
      }
    };

    api.events.on('core.pageReady', () => {
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
      for (const flow of flows.all().values()) {
        drawFlow(flow);
      }
    });

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readWorkflowLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });

    const runOnSelected = (command: SessionCommand) => () => {
      const sessionId = api.state.read(sessionsActiveSlot).get() ?? null;
      if (sessionId === null) {
        log(`no selected session for ${command}`);
        return;
      }
      void view.runFor(sessionId, command);
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
        clearAndMake: runOnSelected('clearAndMake'),
        cancelCountdown: runOnSelected('cancelCountdown'),
        makeInNewSession: runOnSelected('makeInNewSession'),
        resumeMake: runOnSelected('resumeMake'),
        openPlan: runOnSelected('openPlan'),
        retro: runOnSelected('retro'),
        dismiss: runOnSelected('dismiss'),
        toggleSidePane,
        toggleFinishedWaves: runOnSelected('toggleFinishedWaves'),
        openPreview: () => preview.press(),
      },
      exports: (consumer): WorkflowPageExports => ({
        addStage: (stage) => consumer.track(addStage(stage)),
      }),
    };
  },
};
