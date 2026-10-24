import path from 'node:path';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type {
  DriveHost,
  MainApi,
  MainServices,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import {
  argsObject,
  optionalString,
  requiredString,
} from '../../../shared/drive-args';
import { errorText } from '../../../shared/error-text';
import {
  type LayoutRegistry,
  startLayoutRegistry,
} from '../../../shared/layouts/layout-registry';
import type {
  SessionsMainEvents,
  SessionsMainExports,
  ToolResult,
} from '../../sessions/contract';
import type { ChatChannel } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { chatManifest } from '../manifest';
import { createAccounts } from './accounts';
import { createArchivedSessions } from './archived-sessions';
import { type ChatSessions, createChatSessions } from './chat-sessions';
import { askFixturePermission } from './fixtures';
import { createFolderChoices } from './folder-choices';
import { requireChatHarness } from './lookups';
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
    send: (set) => api.channel.send('layoutChanged', set),
    log,
    logSource: 'chat',
    layoutTypes,
  });
  layouts.catch((error: unknown) =>
    log('chat', `layouts not started: ${errorText(error)}`),
  );
  api.channel.handle('layout', async () => (await layouts).current());
  return layouts;
}

// The folder `chat.start` opens when the agent names none, under the run's
// home.
const DRIVE_PROJECT_FOLDER = path.join('dev', 'drive-project');

const DEFAULT_PERMISSION_TOOL = 'Bash';
const DEFAULT_PERMISSION_INPUT = { command: 'ls' };

// Where a permission `chat.askPermission` raised stands.
type DrivePermission =
  | { state: 'pending' }
  | { state: 'answered'; reply: ToolResult }
  | { state: 'failed'; error: unknown };

interface ChatDriveDeps {
  services: Pick<MainServices, 'homeDir' | 'randomUuid' | 'log'> & {
    files: Pick<Files, 'makeFolder'>;
  };
  // Chat's profiles' names, in settings order, read at each `chat.start`.
  profileNames: () => string[];
  chat: Pick<
    ChatSessions,
    'start' | 'closed' | 'sessions' | 'permissionToolSession'
  >;
  sessions: Pick<SessionsMainExports, 'activate'>;
}

// Offers a drive run chat's fixtures: `chat.start` opens a chat session and
// selects its row, `chat.askPermission` raises a permission card in one whose
// process still runs, and `chat.permissionAnswer` reads that card's reply.
export function addDriveActions(
  drive: DriveHost,
  deps: ChatDriveDeps,
): Disposable[] {
  const { services, profileNames, chat, sessions } = deps;
  const permissions = new Map<string, DrivePermission>();
  const start = drive.add('start', {
    description:
      'Starts a chat session in projectDir (default <home>/dev/drive-project, made if missing) under profile (default the first of chat\'s profiles) and selects its row. Under the fake harness a message of "fake: tool" runs a tool turn, "fake: hold" a turn that waits for an interrupt, "fake: end" one that ends the session, and anything else an echo.',
    args: '{ projectDir?: string; profile?: string }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const projectDir =
        optionalString(args, 'projectDir') ??
        path.join(services.homeDir, DRIVE_PROJECT_FOLDER);
      const profile = optionalString(args, 'profile') ?? profileNames()[0];
      if (profile === undefined) {
        throw new Error('chat has no profiles');
      }
      await services.files.makeFolder(projectDir);
      const sessionId = chat.start({ projectDir, profile });
      try {
        sessions.activate(sessionId);
      } catch (error) {
        chat.closed(sessionId);
        throw error;
      }
      return { sessionId };
    },
  });
  const askPermission = drive.add('askPermission', {
    description: `Raises a permission card in the chat session sessionId for a call of toolName (default ${DEFAULT_PERMISSION_TOOL}) with input (default ${JSON.stringify(DEFAULT_PERMISSION_INPUT)}). Returns the call's toolUseId at once, which chat.permissionAnswer reads the reply by; the main output logs the reply once the user answers. Fails when chat holds no session sessionId, or when that session has ended.`,
    args: '{ sessionId: string; toolName?: string; input?: unknown }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const sessionId = requiredString(args, 'sessionId');
      const state = chat
        .sessions()
        .find((held) => held.sessionId === sessionId);
      if (!state) {
        throw new Error(`chat holds no session ${sessionId}`);
      }
      if (state.ended) {
        throw new Error(`session ${sessionId} has ended`);
      }
      const toolUseId = services.randomUuid();
      permissions.set(toolUseId, { state: 'pending' });
      askFixturePermission(chat, sessionId, state.projectDir, {
        toolName: optionalString(args, 'toolName') ?? DEFAULT_PERMISSION_TOOL,
        input: args.input === undefined ? DEFAULT_PERMISSION_INPUT : args.input,
        toolUseId,
      }).then(
        (reply) => {
          permissions.set(toolUseId, { state: 'answered', reply });
          services.log(
            'chat',
            `drive permission ${toolUseId} answered: ${reply.content[0]?.text}`,
          );
        },
        (error: unknown) => {
          permissions.set(toolUseId, { state: 'failed', error });
          services.log(
            'chat',
            `drive permission ${toolUseId} failed: ${errorText(error)}`,
          );
        },
      );
      return { toolUseId };
    },
  });
  const permissionAnswer = drive.add('permissionAnswer', {
    description:
      "The permission_prompt tool's reply to the card chat.askPermission raised under toolUseId once the user answered it, else { pending: true }.",
    args: '{ toolUseId: string }',
    async run(rawArgs) {
      const toolUseId = requiredString(argsObject(rawArgs), 'toolUseId');
      const permission = permissions.get(toolUseId);
      if (permission === undefined) {
        throw new Error(`no permission ${toolUseId} from chat.askPermission`);
      }
      if (permission.state === 'failed') {
        throw permission.error;
      }
      return permission.state === 'answered'
        ? permission.reply
        : { pending: true };
    },
  });
  return [start, askPermission, permissionAnswer];
}

// Starts, resumes and runs the Claude Code sessions the page asks for, lists
// and archives the saved ones, answers their permission prompts through the
// `permission_prompt` tool, keeps the recent project folders and serves them
// merged with the harness's, signs profiles in and out (cancelling a running
// sign-in when the page loads again or the part is disposed), serves the page
// its chat layouts, and offers a drive run its fixtures.
export const chatMainPart: MainPart<typeof chatManifest> = {
  manifest: chatManifest,
  start(api: ChatApi) {
    const { services } = api;
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const recent = createRecentFolders({
      data: api.data,
      clock: services.clock,
      paths: services.paths,
      log: services.log,
    });
    const harness = () => requireChatHarness(services.agentHarnesses);
    const profiles = () => api.settings().profiles;
    const folderChoices = createFolderChoices({
      recent,
      harness,
      profiles,
      files: services.files,
      paths: services.paths,
      tempFolders: services.tempFolders,
      log: services.log,
    });
    const accounts = createAccounts({
      harness,
      profiles,
      send: (message, data) => api.channel.send(message, data),
      log: services.log,
    });
    const chat = createChatSessions({
      harnesses: services.agentHarnesses,
      sessions,
      profiles,
      randomUuid: services.randomUuid,
      recent,
      archived: createArchivedSessions(api.data),
      send: (message, data) => api.channel.send(message, data),
      alerts: services.alerts,
      window: services.window,
      log: services.log,
    });
    // The page announces each load: a sign-in running then was started by a
    // page that is gone, and would refuse every later one.
    api.channel.handle('loaded', () => accounts.cancelRunning());
    api.channel.handle('sessions', () => chat.sessions());
    api.channel.handle('start', (request) => chat.start(request));
    api.channel.handle('pastSessions', (projectDir, profile) =>
      chat.pastSessions(projectDir, profile),
    );
    api.channel.handle('setArchived', (hostSessionId, archived) =>
      chat.setArchived(hostSessionId, archived),
    );
    api.channel.handle('resume', (request) => chat.resume(request));
    api.channel.handle('send', (sessionId, message) =>
      chat.send(sessionId, message),
    );
    api.channel.handle('notice', (sessionId, text, tone) =>
      chat.notice(sessionId, text, tone),
    );
    api.channel.handle('accountStatus', (profile) => accounts.status(profile));
    api.channel.handle('logIn', (id, profile) => accounts.logIn(id, profile));
    api.channel.handle('logInCode', (id, code) => accounts.sendCode(id, code));
    api.channel.handle('cancelLogIn', (id) => accounts.cancel(id));
    api.channel.handle('logOut', (profile) => accounts.logOut(profile));
    api.channel.handle('interrupt', (sessionId) => chat.interrupt(sessionId));
    api.channel.handle('setControl', (sessionId, controlId, value) =>
      chat.setControl(sessionId, controlId, value),
    );
    api.channel.handle('answerPermission', (sessionId, entryId, answer) =>
      chat.answerPermission(sessionId, entryId, answer),
    );
    api.channel.handle('recentFolders', () => folderChoices.list());
    api.channel.handle('chooseFolder', () => services.window.chooseFolder());
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
        homeDir: services.homeDir,
        files: services.files,
        chat,
        sessions,
        harnesses: services.agentHarnesses,
      }),
    );
    const driveActions: Disposable[] = [];
    if (api.drive !== null) {
      driveActions.push(
        ...addDriveActions(api.drive, {
          services,
          profileNames: () =>
            api.settings().profiles.map((profile) => profile.name),
          chat,
          sessions,
        }),
      );
    }
    const layouts = serveLayouts(api);
    return {
      commands: {},
      dispose: () => {
        chat.killAll();
        accounts.cancelRunning();
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
