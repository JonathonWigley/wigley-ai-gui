import './workflow.css';
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
  type SessionsPageEvents,
  sessionsPageKey,
} from '../../sessions/contract';
import type {
  PageStage,
  SessionFlow,
  WorkflowChannel,
  WorkflowPageExports,
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
  QualifiedEvents<'sessions', SessionsPageEvents>
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

// A session the page heard of: its name in the log (its side bar label), its
// project folder and its host session id.
interface HeardSession {
  name: string;
  projectDir: string | null;
  hostSessionId: string | null;
}

// Draws each session's flow as a chip under its row, a strip above its Chat
// composer and a side pane beside its transcript, through the
// `workflow.layout` layout. Holds every flow main pushes, filled in by one
// `flows` read, and the page halves of the stages, which `addStage` extends.
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
    const heard = new Map<string, HeardSession>();
    const flows = new Map<string, SessionFlow>();
    const stages = createStageList<PageStage>();

    const nameOf = (sessionId: string) =>
      heard.get(sessionId)?.name ?? sessionId;
    const isPreview = (sessionId: string) => preview.flowOf(sessionId) !== null;
    const flowOf = (sessionId: string): SessionFlow =>
      preview.flowOf(sessionId) ??
      flows.get(sessionId) ??
      newFlow(sessionId, heard.get(sessionId)?.projectDir ?? '');

    const view = createWorkflowView({
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: {
          exists: (id) => api.keys.command(id) !== undefined,
          run: (id) => api.commands.run(id),
        },
        platform: api.platform.os,
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
        [...heard].find(
          ([, session]) => session.hostSessionId === CHAT_PREVIEW_HOST_ID,
        )?.[0] ?? null,
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

    api.events.on(
      'sessions.sessionAdded',
      ({ sessionId, label, projectDir, hostSessionId }) => {
        heard.set(sessionId, {
          name: label,
          projectDir,
          hostSessionId,
        });
        preview.sessionAdded(sessionId, hostSessionId);
      },
    );
    api.events.on(
      'sessions.sessionHostChanged',
      ({ sessionId, hostSessionId }) => {
        const session = heard.get(sessionId);
        if (session !== undefined) {
          session.hostSessionId = hostSessionId;
        }
      },
    );
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      preview.sessionRemoved(sessionId);
      heard.delete(sessionId);
      flows.delete(sessionId);
      view.forget(sessionId);
    });

    // A flows read is stale for each session a `flows` push touched since the
    // read began; null once the read settles.
    let changedSinceRead: Set<string> | null = new Set<string>();
    // A flow whose draw throws is logged, so the rest of its push or read
    // still draws.
    const putFlow = (flow: SessionFlow) => {
      flows.set(flow.sessionId, flow);
      if (isPreview(flow.sessionId)) {
        return;
      }
      try {
        view.setFlow(flow);
      } catch (error) {
        log(`flow of ${flow.sessionId} not drawn: ${errorText(error)}`);
      }
    };
    api.channel.on('flows', (pushed) => {
      for (const flow of pushed) {
        changedSinceRead?.add(flow.sessionId);
        putFlow(flow);
      }
    });
    api.channel
      .invoke('flows')
      .then(
        (read) => {
          for (const flow of read) {
            if (!changedSinceRead?.has(flow.sessionId)) {
              putFlow(flow);
            }
          }
        },
        (error: unknown) => log(`flows not read: ${errorText(error)}`),
      )
      .finally(() => {
        changedSinceRead = null;
      });

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readWorkflowLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });

    const runOnSelected = (command: SessionCommand) => () => {
      const sessionId = sessions.selectedSessionId();
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
