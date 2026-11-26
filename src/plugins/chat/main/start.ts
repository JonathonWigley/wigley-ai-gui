import path from 'node:path';
import type {
  AgentHarnessInfo,
  PermissionDecision,
} from '../../../contracts/agent';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type { Disposable, Registrations } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type {
  DriveHost,
  MainApi,
  MainServices,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { HostedProcessInfo } from '../../../contracts/session-host';
import type { KeyedSlotReader } from '../../../contracts/state';
import { callEach } from '../../../shared/call-each';
import {
  argsObject,
  optionalString,
  requiredString,
} from '../../../shared/drive-args';
import { errorText } from '../../../shared/error-text';
import {
  createFakeAgentHarness,
  isFakeAgentHarness,
} from '../../../shared/fake-agent-harness';
import {
  listedHarnesses,
  registeredProfiles,
} from '../../../shared/harness-profiles';
import { isSameJson } from '../../../shared/json';
import {
  editableTitle,
  type SessionsMainEvents,
  type SessionsMainExports,
  sessionsMainKey,
  sessionsSelectionSlot,
} from '../../sessions/contract';
import { frameAgentMessage, frameSenderName } from '../agent-frame';
import {
  type ChatChannel,
  chatCommandsSlot,
  chatControlsSlot,
  chatEntriesSlot,
  type ChatMainEvents,
  type ChatMainExports,
  chatQueuedSlot,
  chatReturnedSlot,
  chatSessionSlot,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { chatManifest } from '../manifest';
import { createAccounts } from './accounts';
import { createArchivedSessions } from './archived-sessions';
import { type ChatSessions, createChatSessions } from './chat-sessions';
import { createChatSlots } from './chat-slots';
import { askFixturePermission } from './fixtures';
import { createFolderChoices } from './folder-choices';
import {
  type ChatHarnesses,
  chatHarnessesOf,
  requireHarnessOfProfile,
} from './lookups';
import { createOpenSessions } from './open-sessions';
import { registerDemoSteps } from './demo-steps';
import { createChatPreview } from './preview/chat-preview';
import { createPoolProviders, projectOf, readProjects } from './projects';
import { createRecentFolders } from './recent-folders';
import { chatSelfTestScript, RETURN_FIXTURE_IDENTITY } from './selftest-script';
import {
  SET_HEADLESS_OFFLINE,
  SET_HEADLESS_TOOL,
  setHeadlessToolSession,
} from './set-headless-tool';
import { callerGuard, createToolCallers } from './tool-callers';
import {
  START_SESSION_TOOL,
  startSessionToolSession,
} from './start-session-tool';

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
        services.log(`session host not listed: ${errorText(error)}`);
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
  | { state: 'answered'; decision: PermissionDecision }
  | { state: 'failed'; error: unknown };

interface ChatDriveDeps {
  services: Pick<MainServices, 'homeDir' | 'randomUuid' | 'log'> & {
    files: Pick<Files, 'makeFolder'>;
  };
  // The profile `chat.start` takes when the agent names none, read at each
  // call: the first profile of chat's `defaultHarness`, null when it has none.
  defaultProfile: () => string | null;
  chat: Pick<
    ChatSessions,
    'start' | 'hostSessionIdSettled' | 'closed' | 'sessions'
  >;
  sessions: Pick<SessionsMainExports, 'activate'>;
  harnesses: ChatHarnesses;
}

// Offers a drive run chat's fixtures: `chat.start` opens a chat session and
// selects its row, `chat.askPermission` raises a permission card in one whose
// fake process runs, `chat.permissionAnswer` reads that card's decision, and
// `chat.holdCompactions` and `chat.releaseCompactions` hold a fake harness's
// compactions open and end them.
export function addDriveActions(drive: DriveHost, deps: ChatDriveDeps): void {
  const { services, defaultProfile, chat, sessions, harnesses } = deps;
  const permissions = new Map<string, DrivePermission>();
  const fakeHarness = () => {
    const fake = harnesses.list().find(isFakeAgentHarness);
    if (fake === undefined) {
      throw new Error('chat runs on no fake harness');
    }
    return fake;
  };
  drive.add('start', {
    description:
      'Starts a chat session in projectDir (default <home>/dev/drive-project, made if missing) under profile (default the first profile of chat\'s defaultHarness), on the harness that declares that profile, and selects its row. Under the fake harness a message of "fake: tool" runs a tool turn, "fake: hold" a turn that waits for an interrupt, "fake: steps" six tools and a thought in a turn that waits for an interrupt, "fake: agents" two subagents that run until an interrupt, the next message or the session\'s end, "fake: end" one that ends the session, "fake: workflow feature" a turn that starts the sample Large workflow\'s feature skill and writes a three-task plan, "fake: workflow step" the next make step of that plan, after the sample\'s make command on its folder, "fake: visual" a reply holding a UI mockup and a flowchart whose second html block stays open for 1.5 s, "fake: blocks" a reply of three paragraphs, a two-item list and a ts code block, "fake: cold" an echo whose usage reads 200k of context with the cache already cold, so with auto-compact on the next message is held for a compaction, "fake: compact" a turn that runs an autocompact, and anything else an echo. Returns { sessionId, hostSessionId }: hostSessionId is the id forms.openRound and primer.openPrimer take to open a form in this session.',
    args: '{ projectDir?: string; profile?: string }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const projectDir =
        optionalString(args, 'projectDir') ??
        path.join(services.homeDir, DRIVE_PROJECT_FOLDER);
      const profile = optionalString(args, 'profile') ?? defaultProfile();
      if (profile === null) {
        throw new Error('chat has no profiles');
      }
      const harness = requireHarnessOfProfile(harnesses, profile).id;
      await services.files.makeFolder(projectDir);
      const sessionId = chat.start({ projectDir, harness, profile });
      try {
        sessions.activate(sessionId);
      } catch (error) {
        chat.closed(sessionId, 'start-failed');
        throw error;
      }
      const hostSessionId = await chat.hostSessionIdSettled(sessionId);
      return { sessionId, hostSessionId };
    },
  });
  drive.add('askPermission', {
    description: `Under the fake harness, raises a permission card in the chat session sessionId for a call of toolName (default ${DEFAULT_PERMISSION_TOOL}) with input (default ${JSON.stringify(DEFAULT_PERMISSION_INPUT)}), through the session's fake process. Returns the call's toolUseId at once, which chat.permissionAnswer reads the decision by; the main output logs the decision once the user answers. Fails when chat holds no session sessionId, when that session has no running process, or when chat runs on no fake harness.`,
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
      const fake = fakeHarness();
      const toolUseId = services.randomUuid();
      permissions.set(toolUseId, { state: 'pending' });
      askFixturePermission(fake, sessionId, {
        toolName: optionalString(args, 'toolName') ?? DEFAULT_PERMISSION_TOOL,
        input: args.input === undefined ? DEFAULT_PERMISSION_INPUT : args.input,
        toolUseId,
      }).then(
        (decision) => {
          permissions.set(toolUseId, { state: 'answered', decision });
          services.log(
            `drive permission ${toolUseId} answered: ${JSON.stringify(decision)}`,
          );
        },
        (error: unknown) => {
          permissions.set(toolUseId, { state: 'failed', error });
          services.log(
            `drive permission ${toolUseId} failed: ${errorText(error)}`,
          );
        },
      );
      return { toolUseId };
    },
  });
  drive.add('permissionAnswer', {
    description:
      'The decision { allowed, reason } on the card chat.askPermission raised under toolUseId once the user answered it, else { pending: true }.',
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
        ? permission.decision
        : { pending: true };
    },
  });
  drive.add('holdCompactions', {
    description:
      "Under the fake harness, holds every compaction that starts from now on until chat.releaseCompactions or an interrupt, so a held send's pending row and the dock's Compacting state stay up.",
    args: '{}',
    async run() {
      fakeHarness().holdCompactions();
      return {};
    },
  });
  drive.add('releaseCompactions', {
    description:
      'Ends the compactions chat.holdCompactions held, and holds no later one.',
    args: '{}',
    async run() {
      fakeHarness().releaseCompactions();
      return {};
    },
  });
}

// Chat's view of `core.agentHarnesses`: the ids present when it was made and
// the last label read for each id. `follow` tells `chat` of each later change:
// a present id's key deleted is a leave, a key set for an id not present (a
// first registration included) a return, and a present id's key set again a
// refresh, which may carry new profiles. `labelOf` is the last label read for
// an id, else the id.
export interface HarnessFollower {
  labelOf(harnessId: string): string;
  follow(
    chat: Pick<
      ChatSessions,
      'harnessLeft' | 'harnessReturned' | 'harnessRefreshed'
    >,
  ): Disposable;
}

export function createHarnessFollower(
  slot: KeyedSlotReader<AgentHarnessInfo>,
  log: (line: string) => void,
): HarnessFollower {
  const present = new Set(slot.all().keys());
  const labels = new Map(
    [...slot.all()].map(([harnessId, info]) => [harnessId, info.label]),
  );
  return {
    labelOf: (harnessId) => labels.get(harnessId) ?? harnessId,
    follow: (chat) =>
      slot.on((harnessId, info) => {
        if (info === undefined) {
          if (present.delete(harnessId)) {
            chat.harnessLeft(harnessId);
          }
          return;
        }
        labels.set(harnessId, info.label);
        if (present.has(harnessId)) {
          chat.harnessRefreshed(harnessId);
          return;
        }
        present.add(harnessId);
        chat.harnessReturned(harnessId).catch((error: unknown) => {
          log(`harness ${harnessId} not re-attached: ${errorText(error)}`);
        });
      }),
  };
}

// Starts, resumes and runs the agent sessions the page asks for, each on its
// harness (a new one on the `defaultHarness` setting's, or its profile's),
// reading profiles as the registry publishes them in `core.agentHarnesses`;
// keeps the open ones saved with their titles and queued messages, and on start
// restores them, re-attaching each to its process the session host still runs,
// holding relay connects until the rows are open, and on a restart keeps
// their rows for the restarted part's restore to adopt; lets a harness's
// sessions wait, detached, while it is gone from `core.agentHarnesses` (ending
// a process with no settled host id, which it cannot find again) and
// re-attaches them when it is back; stops every process on
// request, leaves them running on quit, tells the host how long to keep idle
// ones, asks every session it starts to name its row, lists and archives
// the saved ones, shows their processes' permission requests and hands the
// user's answers back, starts a session for any agent that calls the
// `start_session` tool, sets a session's headless flag for its main agent's
// `set_headless` call, keeps the recent project folders and serves them
// merged with the harness's, signs profiles in and out (cancelling a running
// sign-in when the page loads again or the part is disposed), registers its
// chat layouts, opens the layout preview's sample session (held apart from
// chat's sessions, with no process), offers a drive run its fixtures, runs
// `chat.sendTo`, which sends to a session it holds, framed when an agent asks,
// and exports to other plugins a background launch, a send, clear, active time,
// headless, unattended and sender-name reads on the sessions it holds, the agent
// that made a tool call in one of them, a close of every session in a folder or
// of one session, a registration of
// instructions every later session start carries, a registration of send gates,
// one of the idle compaction threshold a start passes, one of the resume
// sections the start prompt lists, and one of the pool provider a pool
// project's clones come from. It names each row's project from the `projects`
// setting for the side bar, and lists the projects and a project's saved
// sessions for the start prompt.
export const chatMainPart: MainPart<typeof chatManifest> = {
  manifest: chatManifest,
  start(api: ChatApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsMainKey);
    const selection = api.state.read(sessionsSelectionSlot);
    const recent = createRecentFolders({
      data: api.data,
      clock: services.clock,
      paths: services.paths,
      log: services.log,
    });
    const harnessSlot = api.state.read(coreAgentHarnessesSlot);
    const harnesses = chatHarnessesOf(services.agentHarnesses, harnessSlot);
    // Every listed harness's profile name the registry publishes, in registration order.
    const profileNames = () =>
      registeredProfiles(listedHarnesses(harnessSlot.all())).map(
        (profile) => profile.name,
      );
    // The first profile published for chat's `defaultHarness`; null when it is
    // not registered or has no profiles.
    const defaultHarnessProfile = () =>
      harnesses.profilesOf(api.settings().defaultHarness).at(0)?.name ?? null;
    const folderChoices = createFolderChoices({
      recent,
      harnesses,
      files: services.files,
      paths: services.paths,
      tempFolders: services.tempFolders,
      log: services.log,
    });
    const poolProviders = createPoolProviders();
    const poolProvider = () => poolProviders.current();
    // Checked once per settings change, so a bad entry logs once.
    let projectSettings = api.settings().projects;
    let projects = readProjects(projectSettings, services.log);
    // The page's list and the `projects` export's, read at each call.
    const projectList = () => [...projects];
    const accounts = createAccounts({
      harnesses,
      send: (message, data) => api.channel.send(message, data),
      log: services.log,
    });
    const saved = createOpenSessions(api.data);
    const slots = createChatSlots({
      session: api.state.publish(chatSessionSlot),
      entries: api.state.publish(chatEntriesSlot),
      controls: api.state.publish(chatControlsSlot),
      commands: api.state.publish(chatCommandsSlot),
      queued: api.state.publish(chatQueuedSlot),
      returned: api.state.publish(chatReturnedSlot),
    });
    const toolCallers = createToolCallers(services.timers);
    const harnessFollower = createHarnessFollower(harnessSlot, services.log);
    const chat = createChatSessions({
      harnesses,
      harnessLabelOf: (harnessId) => harnessFollower.labelOf(harnessId),
      sessions,
      selectedSessionId: () => selection.get() ?? null,
      recent,
      archived: createArchivedSessions(api.data),
      saved,
      slots,
      send: (message, data) => api.channel.send(message, data),
      emit: (event, data) => api.events.emit(event, data),
      window: services.window,
      git: services.git,
      files: services.files,
      toolCallers,
      log: services.log,
      clock: services.clock,
      timers: services.timers,
      randomUuid: services.randomUuid,
      sessionHost: services.sessionHost,
      projects: () => projects,
      poolProvider,
      homeDir: services.homeDir,
      paths: services.paths,
    });
    harnessFollower.follow(chat);
    registerDemoSteps(services, { chat });
    const namer = sessions.addProjectNamer(
      (projectDir) =>
        projectOf(
          projectDir,
          projects,
          (pool) => poolProvider()?.folders(pool) ?? [],
          services.homeDir,
          services.paths,
        )?.name ?? null,
    );
    namer.changed();
    // True for a row whose stream chat reads, which names its calls' agents.
    const readsStreamOf = (sessionId: string) =>
      chat.activeTimeOf(sessionId) !== null;
    sessions.addToolCallGuard(
      callerGuard({ callers: toolCallers, owns: readsStreamOf }),
    );
    const preview = createChatPreview({
      sessions,
      slots,
      emit: (event, data) => api.events.emit(event, data),
      log: services.log,
      clock: services.clock,
    });
    // The preview holds no process or history: a call there does nothing and
    // raises no error, so the page shows no toast.
    const ignoredInPreview = (method: string, sessionId: string) => {
      const inPreview = preview.holds(sessionId);
      if (inPreview) {
        services.log(`${method} in the chat preview ignored`);
      }
      return inPreview;
    };
    // The page announces each load: a sign-in running then was started by a
    // page that is gone, and would refuse every later one.
    api.channel.handle('loaded', () => accounts.cancelRunning());
    api.channel.handle('start', (request) => chat.start(request));
    api.channel.handle('projects', projectList);
    api.channel.handle('projectPastSessions', (project, profile) =>
      chat.projectPastSessions(project, profile),
    );
    api.channel.handle('pastSessions', (projectDir, profile) =>
      chat.pastSessions(projectDir, profile),
    );
    api.channel.handle('resumeSections', () => chat.resumeSections());
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
    api.channel.handle('setHeadless', (sessionId, headless) => {
      if (!ignoredInPreview('setHeadless', sessionId)) {
        chat.setHeadless(sessionId, headless);
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
    api.events.on('sessions.closed', ({ sessionId }) => {
      chat.closed(sessionId, 'user');
      preview.closed(sessionId);
    });
    api.events.on('sessions.connected', (session) =>
      chat.recordOpenHostId(session),
    );
    api.events.on('sessions.hostSessionChanged', (session) =>
      chat.recordOpenHostId(session),
    );
    // closeSessionsIn's and close's waits, by session id: each resolves when its
    // session ends or chat stops; once stopped, both calls are refused.
    const endWaits = new Map<string, () => void>();
    let isDisposed = false;
    api.events.on('sessions.ended', ({ sessionId }) => {
      chat.sessionEnded(sessionId);
      toolCallers.forget(sessionId);
      endWaits.get(sessionId)?.();
      endWaits.delete(sessionId);
    });
    selection.on((sessionId) => chat.selected(sessionId ?? null));
    api.events.on('sessions.titleChanged', ({ sessionId }) =>
      chat.titleChanged(sessionId),
    );
    // The registration lives and dies with the part.
    chat.addInstructions(SESSION_TITLE_INSTRUCTION);
    const holds = (sessionId: string) =>
      chat.sessions().some((held) => held.sessionId === sessionId);
    const profileOf = (sessionId: string) =>
      chat.sessions().find((held) => held.sessionId === sessionId)?.profile ??
      null;
    const defaultProfile = (sessionId: string | null) =>
      (sessionId === null ? null : profileOf(sessionId)) ??
      defaultHarnessProfile();
    sessions.contributeTools(
      [START_SESSION_TOOL],
      startSessionToolSession({
        launch: (request) => chat.launch(request),
        isHeadless: (sessionId) => chat.isHeadless(sessionId),
        defaultProfile,
        profileNames,
        projects: () => projects,
        isAbsolute: (folder) => services.paths.isAbsolute(folder),
        stat: (folder) => services.files.stat(folder),
        log: services.log,
      }),
    );
    sessions.contributeTools(
      [SET_HEADLESS_TOOL],
      setHeadlessToolSession({
        owns: holds,
        setHeadless: (sessionId, headless) =>
          chat.setHeadless(sessionId, headless),
        log: services.log,
      }),
      {
        mainAgentOnly: true,
        offline: { [SET_HEADLESS_TOOL.name]: SET_HEADLESS_OFFLINE },
      },
    );
    const restored = Promise.all([
      saved.load().catch((error: unknown) => {
        services.log(`open sessions not read: ${errorText(error)}`);
        // Lets saving start; the store refuses every write to the unread file.
        return { sessions: [], selectedHostSessionId: null };
      }),
      listHostedProcesses(services),
    ])
      .then(([snapshot, hosted]) => chat.restore(snapshot, hosted))
      .catch((error: unknown) => {
        services.log(`open sessions not restored: ${errorText(error)}`);
      });
    sessions.holdConnects(restored);
    // A page part's restore window waits for the rows chat reopens.
    api.channel.handle('restored', () => restored);
    const passKeepIdle = (keepIdleMinutes: number) =>
      services.sessionHost.setKeepIdleMinutes(Math.max(0, keepIdleMinutes));
    passKeepIdle(api.settings().keepIdleMinutes);
    api.onSettingsChanged((settings) => {
      passKeepIdle(settings.keepIdleMinutes);
      if (isSameJson(settings.projects, projectSettings)) {
        return;
      }
      projectSettings = settings.projects;
      projects = readProjects(projectSettings, services.log);
      namer.changed();
    });
    if (services.selfTest !== null) {
      services.selfTest.run(
        chatSelfTestScript({
          homeDir: services.homeDir,
          files: services.files,
          chat,
          sessions,
          harnesses: services.agentHarnesses,
          defaultHarness: () => api.settings().defaultHarness,
          returnFixture: createFakeAgentHarness(
            services.clock,
            services.files,
            services.timers,
            RETURN_FIXTURE_IDENTITY,
          ),
        }),
      );
    }
    if (api.drive !== null) {
      addDriveActions(api.drive, {
        services,
        defaultProfile: defaultHarnessProfile,
        chat,
        sessions,
        harnesses,
      });
    }
    api.layouts.register({ layoutTypes });
    const requireHeld = (sessionId: string) => {
      if (!holds(sessionId)) {
        throw new Error(`chat holds no session ${sessionId}`);
      }
    };
    const requireRunning = (call: string) => {
      if (isDisposed) {
        throw new Error(`chat is stopped; ${call} refused`);
      }
    };
    const senderName = (sessionId: string) => {
      const titles = sessions.titles(sessionId);
      return frameSenderName(
        titles === null ? null : editableTitle(titles),
        sessions.label(sessionId),
        sessionId,
      );
    };
    const exports = (consumer: Registrations): ChatMainExports => ({
      launch: async (request) => chat.launch(request),
      prepareLaunch: (request, env) => chat.prepareLaunch(request, env),
      projects: projectList,
      // After chat's own restore, so a restored row of the same host session
      // is found and saving has started; the hold makes the run's relay hello
      // join the adopted row.
      adopt: (run) => {
        const adopting = restored.then(() => chat.adopt(run));
        sessions.holdConnects(adopting);
        return adopting;
      },
      resume: (request) => chat.resume(request),
      profileOf,
      activeTime: (sessionId) => chat.activeTimeOf(sessionId),
      toolCaller: (sessionId, toolUseId) =>
        readsStreamOf(sessionId)
          ? toolCallers.agentOf(sessionId, toolUseId)
          : Promise.resolve(null),
      isHeadless: (sessionId) => chat.isHeadless(sessionId),
      isUnattended: (sessionId) => chat.isUnattended(sessionId),
      senderName,
      launchedHeadless: (sessionId) => chat.launchedHeadless(sessionId),
      defaultProfile,
      restored: () => restored,
      loadHistory: (sessionId) =>
        restored.then(() => chat.loadHistoryWhenReadable(sessionId)),
      send: async (sessionId, message) => {
        requireHeld(sessionId);
        return chat.send(sessionId, message);
      },
      sendIntoTurn: async (sessionId, message) => {
        requireHeld(sessionId);
        return chat.sendIntoTurn(sessionId, message);
      },
      clear: async (sessionId) => {
        requireHeld(sessionId);
        chat.clear(sessionId);
        await chat.hostSessionIdSettled(sessionId);
      },
      closeSessionsIn: async (projectDir) => {
        requireRunning('closeSessionsIn');
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
          chat.closed(sessionId, 'project-closed');
        }
        await Promise.all(ended);
      },
      close: async (sessionId, reason) => {
        requireRunning('close');
        requireHeld(sessionId);
        const ended = new Promise<void>((resolve) =>
          endWaits.set(sessionId, resolve),
        );
        chat.closed(sessionId, reason);
        await ended;
      },
      addInstructions: (text) => consumer.track(chat.addInstructions(text)),
      onInstructionsChanged: (listener) =>
        consumer.track(chat.onInstructionsChanged(listener)),
      addSendGate: (gate) => consumer.track(chat.addSendGate(gate)),
      addIdleCompactThreshold: (read) =>
        consumer.track(chat.addIdleCompactThreshold(read)),
      compact: (sessionId, reason) => chat.compact(sessionId, reason),
      addResumeSection: (section) =>
        consumer.track(chat.addResumeSection(section)),
      // Rows in a pool's clones regroup when a provider registers, says its
      // folders changed, or goes.
      addPoolProvider: (provider) => {
        const registration = poolProviders.add(provider);
        let isRegistered = true;
        namer.changed();
        return consumer.track({
          changed() {
            if (isRegistered) {
              namer.changed();
            }
          },
          dispose() {
            isRegistered = false;
            callEach<() => void>(
              [() => registration.dispose(), () => namer.changed()],
              (step) => step(),
            );
          },
        });
      },
    });
    return {
      commands: {
        // Sends as chat's own send does, so it queues behind a running turn;
        // an agent's run opens the text with the frame line naming its
        // session. It never runs an app slash command.
        sendTo: async ({ arg, callerSessionId }) => {
          const { sessionId, text } = arg;
          if (text.trim() === '') {
            throw new Error('chat.sendTo: no text');
          }
          if (sessionId === callerSessionId) {
            throw new Error('chat.sendTo: a session cannot send to itself');
          }
          if (!holds(sessionId)) {
            throw new Error(`chat.sendTo: no chat session ${sessionId}`);
          }
          const sent =
            callerSessionId === undefined
              ? text
              : frameAgentMessage(senderName(callerSessionId), text);
          await chat.send(sessionId, { text: sent, images: [] });
        },
      },
      exports,
      // A step that throws skips none of the rest; the end waits resolve
      // whatever throws, and the quit awaits the final save before a step's
      // error rejects it.
      dispose: (stop) => {
        isDisposed = true;
        let lastSave: Promise<void> = Promise.resolve();
        try {
          callEach<() => void>(
            [
              () => {
                if (stop === 'restart') {
                  chat.keepRows();
                }
              },
              () => {
                lastSave = chat.detachAll();
              },
              () => toolCallers.stop(),
              () => accounts.cancelRunning(),
            ],
            (step) => step(),
          );
        } catch (error) {
          return lastSave.then(() => {
            throw error;
          });
        } finally {
          for (const resolveWait of endWaits.values()) {
            resolveWait();
          }
          endWaits.clear();
        }
        return lastSave;
      },
    };
  },
};
