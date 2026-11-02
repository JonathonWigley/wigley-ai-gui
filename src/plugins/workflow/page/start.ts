import './workflow.css';
import type { Disposable } from '../../../contracts/disposable';
import type { ScrollStep } from '../../../contracts/editor';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { scrollContent, scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { textLineHeightPx } from '../../../shared/page/text-line';
import {
  CHAT_PREVIEW_HOST_ID,
  type ChatPageExports,
} from '../../chat/contract';
import type { DocsPageExports } from '../../docs/contract';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type {
  PageStage,
  SessionFlow,
  WorkflowChannel,
  WorkflowPageExports,
} from '../contract';
import { newFlow } from '../flow';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { workflowManifest } from '../manifest';
import { BUILT_IN_PAGE_STAGES } from '../stages';
import { createFlowTabs } from './flow-tab';
import { readWorkflowLayout } from './layout/read-workflow-layout';
import { PREVIEW_STAGES, previewFlow } from './preview';
import { createPageStageList, createWorkflowView } from './workflow-view';

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
  | 'startFeature'
  | 'dismiss';

// A session the page heard of: its name in the log, its project folder and
// its host session id.
interface HeardSession {
  name: string;
  projectDir: string | null;
  hostSessionId: string | null;
}

// Draws each session's flow as a chip under its row, a strip above its Chat
// composer and, once it leaves idle, a Flow tab, through the
// `workflow.layout` layout. Holds every flow main pushes, filled in by one
// `flows` read, and the page halves of the stages, which `addStage` extends.
// Each workflow command runs on the selected session; each button on the
// session it draws. `openPreview` steps chat's preview session through a
// sample of every stage.
export const workflowPagePart: PagePart<typeof workflowManifest> = {
  manifest: workflowManifest,
  start(api: WorkflowApi) {
    const { services } = api;
    const log = (line: string) => services.log('workflow', line);
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const chat = api.dependency<ChatPageExports>('chat');
    const docs = api.dependency<DocsPageExports>('docs');
    const keys = api.dependency<KeysPageExports>('keys');
    const heard = new Map<string, HeardSession>();
    const flows = new Map<string, SessionFlow>();
    const stages = createPageStageList();

    // The preview's session and the sample it shows, made once per step so its
    // countdown runs down; `awaitingPreview` while chat opens its preview
    // session.
    let preview: {
      sessionId: string;
      index: number;
      flow: SessionFlow;
    } | null = null;
    let awaitingPreview = false;

    const nameOf = (sessionId: string) =>
      heard.get(sessionId)?.name ?? sessionId;
    const isPreview = (sessionId: string) => preview?.sessionId === sessionId;
    const flowOf = (sessionId: string): SessionFlow => {
      if (preview !== null && preview.sessionId === sessionId) {
        return preview.flow;
      }
      return (
        flows.get(sessionId) ??
        newFlow(sessionId, heard.get(sessionId)?.projectDir ?? '')
      );
    };

    const view = createWorkflowView({
      kit: {
        markdown: services.markdown,
        keys: { anchor: keys.anchor, keysFor: keys.keysFor },
        commands: {
          exists: (id) => api.keys.command(id) !== undefined,
          run: (id) => api.commands.run(id),
        },
        platform: api.platform,
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
      stripBuilt: (sessionId) => flowTabs.chatTabBuilt(sessionId),
      fillComposer: (sessionId, text) => chat.fillComposer(sessionId, text),
      openDoc: (path) => docs.openDoc(path),
      runAction: (request) => api.channel.invoke('runAction', request),
    });
    const flowTabs = createFlowTabs({
      addTab: (sessionId, tab) => sessions.addTab(sessionId, tab),
      timers: services.timers,
      log: services.log,
      flowOf,
      nameOf,
      draw: view.drawFlowTab,
      shown() {
        api.keys.setScope('flow');
        api.panes.setResizeTarget(null);
        api.panes.setFocusTarget(null);
      },
    });

    const showFlow = (flow: SessionFlow) => {
      view.setFlow(flow);
      flowTabs.setFlow(flow);
    };

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

    const showPreviewStep = (sessionId: string, index: number) => {
      const flow = previewFlow(
        index,
        sessionId,
        services.clock.now(),
        api.settings().autoStartSeconds,
      );
      preview = { sessionId, index, flow };
      showFlow(flow);
      log(
        `workflow preview step ${index + 1} of ${PREVIEW_STAGES.length}: ${PREVIEW_STAGES[index]}`,
      );
    };
    const closePreview = (sessionId: string) => {
      preview = null;
      flowTabs.remove(sessionId);
      view.setFlow(flowOf(sessionId));
      log('workflow preview closed');
    };
    const previewSessionId = () =>
      [...heard].find(
        ([, session]) => session.hostSessionId === CHAT_PREVIEW_HOST_ID,
      )?.[0] ?? null;

    api.events.on(
      'sessions.sessionAdded',
      ({ sessionId, projectDir, hostSessionId }) => {
        heard.set(sessionId, {
          name:
            projectDir === null ? sessionId : services.paths.base(projectDir),
          projectDir,
          hostSessionId,
        });
        if (awaitingPreview && hostSessionId === CHAT_PREVIEW_HOST_ID) {
          awaitingPreview = false;
          showPreviewStep(sessionId, 0);
        }
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
      if (isPreview(sessionId)) {
        preview = null;
      }
      heard.delete(sessionId);
      flows.delete(sessionId);
      flowTabs.remove(sessionId);
      view.forget(sessionId);
    });

    // A flows read is stale for each session a `flows` push touched since the
    // read began; null once the read settles.
    let changedSinceRead: Set<string> | null = new Set<string>();
    const putFlow = (flow: SessionFlow) => {
      flows.set(flow.sessionId, flow);
      if (!isPreview(flow.sessionId)) {
        showFlow(flow);
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
    const scrollFlowTab = (step: ScrollStep, direction: 1 | -1) => {
      const body = flowTabs.visibleBody();
      if (body === null) {
        log('no Flow tab shows');
        return;
      }
      const scroll = scrollContent(
        body,
        step,
        direction,
        textLineHeightPx(body),
      );
      log(scrollText('the Flow tab', step, direction, scroll));
    };

    const exports: WorkflowPageExports = { addStage };
    return {
      commands: {
        mainAction: runOnSelected('mainAction'),
        clearAndMake: runOnSelected('clearAndMake'),
        cancelCountdown: runOnSelected('cancelCountdown'),
        makeInNewSession: runOnSelected('makeInNewSession'),
        resumeMake: runOnSelected('resumeMake'),
        openPlan: runOnSelected('openPlan'),
        retro: runOnSelected('retro'),
        startFeature: runOnSelected('startFeature'),
        dismiss: runOnSelected('dismiss'),
        lineDown: () => scrollFlowTab('line', 1),
        lineUp: () => scrollFlowTab('line', -1),
        halfPageDown: () => scrollFlowTab('halfPage', 1),
        halfPageUp: () => scrollFlowTab('halfPage', -1),
        openPreview() {
          if (preview !== null) {
            const { sessionId, index } = preview;
            if (index + 1 < PREVIEW_STAGES.length) {
              showPreviewStep(sessionId, index + 1);
            } else {
              closePreview(sessionId);
            }
            return;
          }
          if (awaitingPreview) {
            return;
          }
          api.commands.run('chat.openPreview');
          const sessionId = previewSessionId();
          if (sessionId === null) {
            awaitingPreview = true;
          } else {
            showPreviewStep(sessionId, 0);
          }
        },
      },
      exports,
    };
  },
};
