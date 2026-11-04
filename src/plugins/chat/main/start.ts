import path from 'node:path';
import type { AgentHarness } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type {
  DriveHost,
  MainApi,
  MainServices,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { HostedProcessInfo } from '../../../contracts/session-host';
import {
  argsObject,
  optionalString,
  requiredString,
} from '../../../shared/drive-args';
import { errorText } from '../../../shared/error-text';
import { isFakeAgentHarness } from '../../../shared/fake-agent-harness';
import type {
  SessionsMainEvents,
  SessionsMainExports,
  ToolResult,
} from '../../sessions/contract';
import type { ChatChannel, ChatMainEvents, ChatMainExports } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { chatManifest } from '../manifest';
import { createAccounts } from './accounts';
import { createArchivedSessions } from './archived-sessions';
import { type ChatSessions, createChatSessions } from './chat-sessions';
import { askFixturePermission } from './fixtures';
import { createFolderChoices } from './folder-choices';
import { requireChatHarness } from './lookups';
import { createOpenSessions } from './open-sessions';
import { PERMISSION_TOOLS } from './permission-tool';
import { createChatPreview } from './preview/chat-preview';
import { createRecentFolders } from './recent-folders';
import { chatSelfTestScript } from './selftest-script';

type ChatApi = MainApi<
  typeof chatManifest,
  ChatChannel,
  ChatMainEvents,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// The folder `chat.start` opens when the agent names none, under the run's
// home.
const DRIVE_PROJECT_FOLDER = path.join('dev', 'drive-project');

// Every session chat starts carries it, so the agent names the session's row.
const SESSION_TITLE_INSTRUCTION =
  'This session shows as a row in the Auri app\'s side bar. As the first thing you do in your first turn, before any other work, call the set_session_title tool with a title of 2 to 4 words, at most 30 characters, that names the topic of the user\'s prompt like a heading ("Agent Status Line", "Forms Crash on Resume"), not a sentence describing the request. Call it again only when the work\'s focus clearly changes.';

// Under the relay's hold on connects, so a relay hello never opens an unowned
// row while chat waits on the host.
const SESSION_HOST_LIST_WAIT_MS = 3_000;

// The host's processes, or null after logging when the list rejects or outlasts
// its wait.
function listHostedProcesses(
  services: Pick<MainServices, 'sessionHost' | 'timers' | 'log'>,
): Promise<HostedProcessInfo[] | null> {
  return new Promise((resolve) => {
    const timer = services.timers.set(() => {
      services.log(
        'chat',
        `session host not listed: timed out after ${SESSION_HOST_LIST_WAIT_MS} ms`,
      );
      resolve(null);
    }, SESSION_HOST_LIST_WAIT_MS);
    services.sessionHost.list().then(
      (hosted) => {
        services.timers.clear(timer);
        resolve(hosted);
      },
      (error: unknown) => {
        services.timers.clear(timer);
        services.log('chat', `session host not listed: ${errorText(error)}`);
        resolve(null);
      },
    );
  });
}

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
    | 'start'
    | 'hostSessionIdOf'
    | 'closed'
    | 'sessions'
    | 'permissionToolSession'
  >;
  sessions: Pick<SessionsMainExports, 'activate'>;
  harnesses: readonly AgentHarness[];
}

// Offers a drive run chat's fixtures: `chat.start` opens a chat session and
// selects its row, `chat.askPermission` raises a permission card in one whose
// process runs, `chat.permissionAnswer` reads that card's reply, and
// `chat.holdCompactions` and `chat.releaseCompactions` hold a fake harness's
// compactions open and end them.
export function addDriveActions(
  drive: DriveHost,
  deps: ChatDriveDeps,
): Disposable[] {
  const { services, profileNames, chat, sessions, harnesses } = deps;
  const permissions = new Map<string, DrivePermission>();
  const fakeHarness = () => {
    const fake = harnesses.find(isFakeAgentHarness);
    if (fake === undefined) {
      throw new Error('chat runs on no fake harness');
    }
    return fake;
  };
  const start = drive.add('start', {
    description:
      'Starts a chat session in projectDir (default <home>/dev/drive-project, made if missing) under profile (default the first of chat\'s profiles) and selects its row. Under the fake harness a message of "fake: tool" runs a tool turn, "fake: hold" a turn that waits for an interrupt, "fake: steps" six tools and a thought in a turn that waits for an interrupt, "fake: agents" two subagents that run until an interrupt, the next message or the session\'s end, "fake: end" one that ends the session, "fake: workflow feature" a wigley:feature turn that writes a three-task plan, "fake: workflow step" the next make step of that plan, after /wigley:make <its folder>, "fake: visual" a reply holding a UI mockup and a flowchart whose second html block stays open for 1.5 s, "fake: blocks" a reply of three paragraphs, a two-item list and a ts code block, "fake: cold" an echo whose usage reads 200k of context with the cache already cold, so with auto-compact on the next message is held for a compaction, "fake: compact" a turn that runs an autocompact, and anything else an echo. Returns { sessionId, hostSessionId }: hostSessionId is the id forms.openRound and primer.openPrimer take to open a form in this session.',
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
      const hostSessionId = chat.hostSessionIdOf(sessionId);
      if (hostSessionId === null) {
        throw new Error(
          `chat started ${sessionId} but holds no host id for it`,
        );
      }
      return { sessionId, hostSessionId };
    },
  });
  const askPermission = drive.add('askPermission', {
    description: `Raises a permission card in the chat session sessionId for a call of toolName (default ${DEFAULT_PERMISSION_TOOL}) with input (default ${JSON.stringify(DEFAULT_PERMISSION_INPUT)}). Returns the call's toolUseId at once, which chat.permissionAnswer reads the reply by; the main output logs the reply once the user answers. Fails when chat holds no session sessionId, or when that session has no running process.`,
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
      if (!state.running) {
        throw new Error(`session ${sessionId} has no running process`);
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
  const holdCompactions = drive.add('holdCompactions', {
    description:
      "Under the fake harness, holds every compaction that starts from now on until chat.releaseCompactions or an interrupt, so a held send's pending row and the dock's Compacting state stay up.",
    args: '{}',
    async run() {
      fakeHarness().holdCompactions();
      return {};
    },
  });
  const releaseCompactions = drive.add('releaseCompactions', {
    description:
      'Ends the compactions chat.holdCompactions held, and holds no later one.',
    args: '{}',
    async run() {
      fakeHarness().releaseCompactions();
      return {};
    },
  });
  return [
    start,
    askPermission,
    permissionAnswer,
    holdCompactions,
    releaseCompactions,
  ];
}

// Starts, resumes and runs the Claude Code sessions the page asks for, keeps
// the open ones saved with their titles and queued messages, and on start
// restores them, re-attaching each to its process the session host still runs,
// holding relay connects until the rows are open; stops every process on
// request, leaves them running on quit, tells the host how long to keep idle
// ones, asks every session it starts to name its row, lists and archives
// the saved ones, answers their permission prompts through the
// `permission_prompt` tool, keeps the recent project folders and serves them
// merged with the harness's, signs profiles in and out (cancelling a running
// sign-in when the page loads again or the part is disposed), registers its
// chat layouts, opens the layout preview's sample session (held apart from
// chat's sessions, with no process), offers a drive run its fixtures, and
// exports to other plugins a background launch, a send and clear on the
// sessions it holds, a close of every session in a folder, a registration of
// instructions every later session start carries, a registration of send gates,
// and one of the idle compaction threshold a start passes.
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
    const profileNames = () => profiles().map((profile) => profile.name);
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
    const saved = createOpenSessions(api.data);
    const chat = createChatSessions({
      harnesses: services.agentHarnesses,
      sessions,
      profiles,
      randomUuid: services.randomUuid,
      recent,
      archived: createArchivedSessions(api.data),
      saved,
      send: (message, data) => api.channel.send(message, data),
      emit: (event, data) => api.events.emit(event, data),
      alerts: services.alerts,
      window: services.window,
      git: services.git,
      log: services.log,
      clock: services.clock,
      sessionHost: services.sessionHost,
    });
    const preview = createChatPreview({
      sessions,
      send: (message, data) => api.channel.send(message, data),
      emit: (event, data) => api.events.emit(event, data),
      log: services.log,
      clock: services.clock,
    });
    // The preview holds no process or history: a call there does nothing and
    // raises no error, so the page shows no toast.
    const ignoredInPreview = (method: string, sessionId: string) => {
      const inPreview = preview.holds(sessionId);
      if (inPreview) {
        services.log('chat', `${method} in the chat preview ignored`);
      }
      return inPreview;
    };
    // The page announces each load: a sign-in running then was started by a
    // page that is gone, and would refuse every later one.
    api.channel.handle('loaded', () => accounts.cancelRunning());
    api.channel.handle('sessions', () => [
      ...chat.sessions(),
      ...preview.states(),
    ]);
    api.channel.handle('start', (request) => chat.start(request));
    api.channel.handle('pastSessions', (projectDir, profile) =>
      chat.pastSessions(projectDir, profile),
    );
    api.channel.handle('setArchived', (hostSessionId, archived) =>
      chat.setArchived(hostSessionId, archived),
    );
    api.channel.handle('resume', (request) => chat.resume(request));
    api.channel.handle('send', async (sessionId, message) => {
      if (!ignoredInPreview('send', sessionId)) {
        await chat.send(sessionId, message);
      }
    });
    api.channel.handle('loadHistory', async (sessionId) => {
      if (!ignoredInPreview('loadHistory', sessionId)) {
        await chat.loadHistory(sessionId);
      }
    });
    api.channel.handle('notice', (sessionId, text, tone) =>
      preview.holds(sessionId)
        ? preview.notice(text, tone)
        : chat.notice(sessionId, text, tone),
    );
    api.channel.handle('accountStatus', (profile) => accounts.status(profile));
    api.channel.handle('logIn', (id, profile) => accounts.logIn(id, profile));
    api.channel.handle('logInCode', (id, code) => accounts.sendCode(id, code));
    api.channel.handle('cancelLogIn', (id) => accounts.cancel(id));
    api.channel.handle('logOut', (profile) => accounts.logOut(profile));
    api.channel.handle('interrupt', (sessionId) => {
      if (!ignoredInPreview('interrupt', sessionId)) {
        chat.interrupt(sessionId);
      }
    });
    api.channel.handle('clear', (sessionId) => {
      if (!ignoredInPreview('clear', sessionId)) {
        chat.clear(sessionId);
      }
    });
    api.channel.handle('pullBack', (sessionId, queuedId) => {
      if (!ignoredInPreview('pullBack', sessionId)) {
        chat.pullBack(sessionId, queuedId);
      }
    });
    api.channel.handle('returnedPlaced', (sessionId, returnedIds) => {
      if (!ignoredInPreview('returnedPlaced', sessionId)) {
        chat.returnedPlaced(sessionId, returnedIds);
      }
    });
    api.channel.handle('sendNow', (sessionId, queuedId) => {
      if (!ignoredInPreview('sendNow', sessionId)) {
        chat.sendNow(sessionId, queuedId);
      }
    });
    api.channel.handle('sendAllNow', async (sessionId, message) => {
      if (!ignoredInPreview('sendAllNow', sessionId)) {
        await chat.sendAllNow(sessionId, message);
      }
    });
    api.channel.handle('setControl', (sessionId, controlId, value) => {
      if (!ignoredInPreview('setControl', sessionId)) {
        chat.setControl(sessionId, controlId, value);
      }
    });
    api.channel.handle('answerPermission', (sessionId, entryId, answer) => {
      if (!ignoredInPreview('answerPermission', sessionId)) {
        chat.answerPermission(sessionId, entryId, answer);
      }
    });
    api.channel.handle('stopAll', () => chat.stopAll());
    api.channel.handle('openPreview', () => preview.open());
    api.channel.handle('recentFolders', () => folderChoices.list());
    api.channel.handle('chooseFolder', () => services.window.chooseFolder());
    api.events.on('sessions.closed', ({ sessionId }) => {
      chat.closed(sessionId);
      preview.closed(sessionId);
    });
    api.events.on('sessions.connected', (session) =>
      chat.sessionConnected(session),
    );
    // closeSessionsIn's waits, by session id: each resolves when its session
    // ends.
    const endWaits = new Map<string, () => void>();
    api.events.on('sessions.ended', ({ sessionId }) => {
      chat.sessionEnded(sessionId);
      endWaits.get(sessionId)?.();
      endWaits.delete(sessionId);
    });
    api.events.on('sessions.selected', ({ sessionId }) =>
      chat.selected(sessionId),
    );
    api.events.on('sessions.titleChanged', ({ sessionId }) =>
      chat.titleChanged(sessionId),
    );
    // The registration lives and dies with the part.
    chat.addInstructions(SESSION_TITLE_INSTRUCTION);
    sessions.contributeTools(PERMISSION_TOOLS, (session) =>
      chat.permissionToolSession(session),
    );
    const restored = Promise.all([
      saved.load().catch((error: unknown) => {
        services.log('chat', `open sessions not read: ${errorText(error)}`);
        // Lets saving start; the store refuses every write to the unread file.
        return { sessions: [], selectedHostSessionId: null };
      }),
      listHostedProcesses(services),
    ])
      .then(([snapshot, hosted]) => chat.restore(snapshot, hosted))
      .catch((error: unknown) => {
        services.log('chat', `open sessions not restored: ${errorText(error)}`);
      });
    sessions.holdConnects(restored);
    const passKeepIdle = (keepIdleMinutes: number) =>
      services.sessionHost.setKeepIdleMinutes(Math.max(0, keepIdleMinutes));
    passKeepIdle(api.settings().keepIdleMinutes);
    const keepIdleListener = api.onSettingsChanged((settings) =>
      passKeepIdle(settings.keepIdleMinutes),
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
          profileNames,
          chat,
          sessions,
          harnesses: services.agentHarnesses,
        }),
      );
    }
    const layouts = api.layouts.register({ layoutTypes });
    const requireHeld = (sessionId: string) => {
      if (!chat.sessions().some((held) => held.sessionId === sessionId)) {
        throw new Error(`chat holds no session ${sessionId}`);
      }
    };
    const exports: ChatMainExports = {
      launch: async (request) => chat.launch(request),
      profileNames,
      profiles,
      profileOf: (sessionId) =>
        chat.sessions().find((held) => held.sessionId === sessionId)?.profile ??
        null,
      send: async (sessionId, message) => {
        requireHeld(sessionId);
        return chat.send(sessionId, message);
      },
      clear: async (sessionId) => {
        requireHeld(sessionId);
        chat.clear(sessionId);
      },
      closeSessionsIn: async (projectDir) => {
        const closing = chat
          .sessions()
          .filter((held) =>
            services.paths.samePath(held.projectDir, projectDir),
          )
          .map((held) => held.sessionId);
        const ended = closing.map(
          (sessionId) =>
            new Promise<void>((resolve) => endWaits.set(sessionId, resolve)),
        );
        for (const sessionId of closing) {
          chat.closed(sessionId);
        }
        await Promise.all(ended);
      },
      addInstructions: (text) => chat.addInstructions(text),
      addSendGate: (gate) => chat.addSendGate(gate),
      addIdleCompactThreshold: (read) => chat.addIdleCompactThreshold(read),
    };
    return {
      commands: {},
      exports,
      dispose: () => {
        const lastSave = chat.detachAll();
        keepIdleListener.dispose();
        accounts.cancelRunning();
        for (const action of driveActions) {
          action.dispose();
        }
        layouts.dispose();
        return lastSave;
      },
    };
  },
};
