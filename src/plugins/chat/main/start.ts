import path from 'node:path';
import type { Disposable } from '../../../contracts/disposable';
import type {
  DriveHost,
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
import { type ChatSessions, createChatSessions } from './chat-sessions';
import { askFixturePermission } from './fixtures';
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

// The folder `chat.start` opens when the agent names none, under the run's
// home.
const DRIVE_PROJECT_FOLDER = path.join('dev', 'drive-project');

const DEFAULT_PERMISSION_TOOL = 'Bash';
const DEFAULT_PERMISSION_INPUT = { command: 'ls' };

// The string `field` of a drive action's args; undefined when the args leave
// it out. Throws naming the field when it is there but not a string.
function optionalString(args: unknown, field: string): string | undefined {
  const value = (args as Record<string, unknown> | null | undefined)?.[field];
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function requiredString(args: unknown, field: string): string {
  const value = optionalString(args, field);
  if (value === undefined) {
    throw new Error(`${field} is missing`);
  }
  return value;
}

// Offers a drive run chat's fixtures: `chat.start` opens a chat session and
// selects its row, and `chat.askPermission` raises a permission card in one.
function addDriveActions(
  drive: DriveHost,
  api: ChatApi,
  chat: ChatSessions,
  sessions: SessionsMainExports,
): Disposable[] {
  const { services } = api;
  const start = drive.add('start', {
    description:
      'Starts a chat session in projectDir (default <home>/dev/drive-project, made if missing) under profile (default the first of chat\'s profiles) and selects its row. Under the fake harness a message of "fake: tool" runs a tool turn, "fake: hold" a turn that waits for an interrupt, and anything else an echo.',
    args: '{ projectDir?: string; profile?: string }',
    async run(args) {
      const projectDir =
        optionalString(args, 'projectDir') ??
        path.join(services.homeDir, DRIVE_PROJECT_FOLDER);
      const profile =
        optionalString(args, 'profile') ?? api.settings().profiles[0]?.name;
      if (profile === undefined) {
        throw new Error('chat has no profiles');
      }
      await services.files.makeFolder(projectDir);
      const sessionId = chat.start({ projectDir, profile });
      sessions.activate(sessionId);
      return { sessionId };
    },
  });
  const askPermission = drive.add('askPermission', {
    description: `Raises a permission card in the chat session sessionId for a call of toolName (default ${DEFAULT_PERMISSION_TOOL}) with input (default ${JSON.stringify(DEFAULT_PERMISSION_INPUT)}). Returns the call's toolUseId at once; the main output logs the reply once the user answers.`,
    args: '{ sessionId: string; toolName?: string; input?: unknown }',
    async run(args) {
      const sessionId = requiredString(args, 'sessionId');
      const state = chat
        .sessions()
        .find((held) => held.sessionId === sessionId);
      if (!state) {
        throw new Error(`chat holds no session ${sessionId}`);
      }
      const toolUseId = services.randomUuid();
      const input =
        (args as { input?: unknown }).input ?? DEFAULT_PERMISSION_INPUT;
      askFixturePermission(chat, sessionId, state.projectDir, {
        toolName: optionalString(args, 'toolName') ?? DEFAULT_PERMISSION_TOOL,
        input,
        toolUseId,
      }).then(
        (reply) =>
          services.log(
            'chat',
            `drive permission ${toolUseId} answered: ${reply.content[0]?.text}`,
          ),
        (error: unknown) =>
          services.log(
            'chat',
            `drive permission ${toolUseId} failed: ${errorText(error)}`,
          ),
      );
      return { toolUseId };
    },
  });
  return [start, askPermission];
}

// Starts, resumes and runs the Claude Code sessions the page asks for, lists
// and archives the saved ones, answers their permission prompts through the
// `permission_prompt` tool, keeps the recent project folders, serves the
// page its chat layouts, and offers a drive run its fixtures.
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
    const driveActions: Disposable[] = [];
    if (api.drive !== null) {
      driveActions.push(...addDriveActions(api.drive, api, chat, sessions));
    }
    const layouts = serveLayouts(api);
    return {
      commands: {},
      dispose: () => {
        for (const action of driveActions) {
          action.dispose();
        }
        return layouts.then(
          (registry) => registry.dispose(),
          () => undefined,
        );
      },
    };
  },
};
