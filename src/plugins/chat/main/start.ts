import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  type LayoutRegistry,
  startLayoutRegistry,
} from '../../../shared/layouts/layout-registry';
import type {
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import type { ChatChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js?raw';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { chatManifest } from '../manifest';
import { createArchivedSessions } from './archived-sessions';
import { createChatSessions } from './chat-sessions';
import { PERMISSION_TOOLS } from './permission-tool';
import { createRecentFolders } from './recent-folders';
import { chatSelfTestScript } from './selftest-script';

type ChatApi = MainApi<
  typeof chatManifest,
  ChatChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Starts the layout registry and serves it to the page; a handler called
// before the registry is ready answers once it is, and every handler rejects
// with the start's error when it failed.
function serveLayouts(api: ChatApi): Promise<LayoutRegistry> {
  const { log } = api.services;
  const layouts = startLayoutRegistry({
    data: api.data,
    send: (choice) => api.channel.send('layoutChanged', choice),
    log,
    logSource: 'chat',
    layoutTypes,
    defaultLayout,
  });
  layouts.catch((error: unknown) =>
    log('chat', `layouts not started: ${errorText(error)}`),
  );
  api.channel.handle('layout', async () => (await layouts).current());
  api.channel.handle('cycleLayout', async (step) =>
    (await layouts).cycle(step),
  );
  api.channel.handle('copyLayout', async () => (await layouts).copy());
  return layouts;
}

// Starts, resumes and runs the Claude Code sessions the page asks for, lists
// and archives the saved ones, answers their permission prompts through the
// `permission_prompt` tool, keeps the recent project folders, and serves the
// page its chat layouts.
export const chatMainPart: MainPart<typeof chatManifest> = {
  manifest: chatManifest,
  start(api: ChatApi) {
    const { services } = api;
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const recent = createRecentFolders({
      data: api.data,
      clock: services.clock,
      log: services.log,
    });
    const chat = createChatSessions({
      harnesses: services.agentHarnesses,
      sessions,
      profiles: () => api.settings().profiles,
      randomUuid: services.randomUuid,
      recent,
      archived: createArchivedSessions(api.data),
      send: (message, data) => api.channel.send(message, data),
      alerts: services.alerts,
      window: services.window,
      log: services.log,
    });
    api.channel.handle('sessions', () => chat.sessions());
    api.channel.handle('start', (request) => chat.start(request));
    api.channel.handle('pastSessions', (projectDir, profile) =>
      chat.pastSessions(projectDir, profile),
    );
    api.channel.handle('setArchived', (hostSessionId, archived) =>
      chat.setArchived(hostSessionId, archived),
    );
    api.channel.handle('resume', (request) => chat.resume(request));
    api.channel.handle('send', (sessionId, text) => chat.send(sessionId, text));
    api.channel.handle('interrupt', (sessionId) => chat.interrupt(sessionId));
    api.channel.handle('setControl', (sessionId, controlId, value) =>
      chat.setControl(sessionId, controlId, value),
    );
    api.channel.handle('answerPermission', (sessionId, entryId, answer) =>
      chat.answerPermission(sessionId, entryId, answer),
    );
    api.channel.handle('recentFolders', () => recent.list());
    api.channel.handle('chooseFolder', () => services.window.chooseFolder());
    api.channel.handle('homeDir', () => services.homeDir);
    api.events.on('sessions.closed', ({ sessionId }) => chat.closed(sessionId));
    api.events.on('sessions.connected', (session) =>
      chat.sessionConnected(session),
    );
    api.events.on('sessions.ended', ({ sessionId }) =>
      chat.sessionEnded(sessionId),
    );
    sessions.contributeTools(PERMISSION_TOOLS, (session) =>
      chat.permissionToolSession(session),
    );
    services.selfTest?.run(
      chatSelfTestScript({
        chat,
        sessions,
        harnesses: services.agentHarnesses,
      }),
    );
    const layouts = serveLayouts(api);
    return {
      commands: {},
      dispose: () =>
        layouts.then(
          (registry) => registry.dispose(),
          () => undefined,
        ),
    };
  },
};
