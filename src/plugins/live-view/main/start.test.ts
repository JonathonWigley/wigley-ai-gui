import { describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../../../contracts/agent';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type {
  ScreenCapture,
  WindowList,
} from '../../../contracts/screen-capture';
import {
  harnessInfo,
  harnessRegistryOf,
} from '../../../shared/agent-harness-registry.test-support';
import {
  createFakeAgentHarness,
  FAKE_HARNESS_ID,
  FAKE_MICROTASK_TIMERS,
} from '../../../shared/fake-agent-harness';
import { FakeProcesses } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import { WIGLEY_PLUGIN_KEY } from '../../../shared/wigley-install';
import {
  createFakeScreenCapture,
  FAKE_EDITOR_PROCESS_ID,
  FAKE_GAME_RECT,
} from '../../../shared/fake-screen-capture';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  CHAT_PREVIEW_HOST_ID,
  type ChatMainExports,
  chatEntriesSlot,
  chatMainKey,
} from '../../chat/contract';
import {
  type AgentSession,
  type ContributeToolsOptions,
  type SessionsMainExports,
  sessionsMainKey,
  textResult,
  type ToolDefinition,
  type ToolSession,
} from '../../sessions/contract';
import { type LivePick, livePicksSlot } from '../contract';
import { PROBE_ATTEMPTS } from './game-view-probe';
import { liveViewMainPart } from './start';

const SESSION = 'row-1';
const PROJECT = '/home/Game';
const EDITOR_FILE = '/home/Game/Library/EditorInstance.json';
const CONTEXT = { toolUseId: null, signal: new AbortController().signal };
const INTERRUPTED_REPLY =
  'show_live_view was interrupted by a hide, the session ending or the call aborting; the Live section was left as it was.';

const EDITOR_PICK: LivePick = {
  kind: 'stream',
  sourceId: 'sample:1440x900',
  summary: 'Editor · Game',
  windowSize: { width: 1440, height: 900 },
  crop: null,
};
const FAKE_GAME_CROP = {
  x: 500 / 1440,
  y: 95 / 900,
  width: 360 / 1440,
  height: 640 / 900,
};
const GAME_VIEW_PICK: LivePick = {
  kind: 'stream',
  sourceId: 'sample:1440x900',
  summary: 'Game View · Game',
  windowSize: { width: 1440, height: 900 },
  crop: FAKE_GAME_CROP,
};
const SAMPLE_PICK: LivePick = {
  ...GAME_VIEW_PICK,
  summary: 'Game View · sample',
};

// The playtest's whole-editor line where no wigley install holds the probe.
const NO_INSTALL_PLAYTEST_LINE =
  'row-1 shows Editor · Game for a playtest (no Game View: no wigley install holds WigleyCapture.cs)';
const WIGLEY_INSTALL = '/home/.claude/plugins/cache/wigley/1.0.0';
const CAPTURE_SCRIPT = `${WIGLEY_INSTALL}/skills/unity-playtest/unity/WigleyCapture.cs`;

// The `--project-path` of PROJECT, as a playtest command names it.
const G = `--project-path ${PROJECT}`;
const PLAY = `unity command editor_play ${G}`;
const PLAY_RESULT_ONLY = `unity command editor_play --result-only ${G}`;
const STOP = `unity command editor_stop ${G}`;

const GRANTED = createFakeScreenCapture();
const BLOCKED = createFakeScreenCapture({ access: 'blocked' });

// A macrotask, so every pending promise chain settles first.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface CallOptions {
  agentId?: string;
  hostSessionId?: string;
  replayed?: boolean;
  isError?: boolean;
}

// Bash call n's entry in `chat.entries`, still running when `result` is null.
function bashEntry(
  n: number,
  command: string,
  result: { text: string; isError: boolean } | null,
  { agentId = 'main' }: CallOptions = {},
): ChatEntry {
  return {
    kind: 'tool',
    id: `tool-${n}`,
    at: 0,
    agentId,
    toolUseId: `use-${n}`,
    name: 'Bash',
    input: { command },
    summary: '',
    result,
    raw: [],
  };
}

// Chat's `toolStarted` agent event of Bash call n.
function toolStarted(
  n: number,
  {
    agentId = 'main',
    hostSessionId = 'host-1',
    replayed = false,
  }: CallOptions = {},
) {
  return {
    sessionId: SESSION,
    profileDir: null,
    hostSessionId,
    event: {
      type: 'toolStarted',
      at: 0,
      agentId,
      toolUseId: `use-${n}`,
      tool: 'Bash',
      summary: '',
    },
    replayed,
  };
}

// `listWindows` answers through `capture.list`, which a test swaps; the editor
// file of PROJECT names the fake editor's pid. With `probeReply`, a profile's
// wigley install holds WigleyCapture.cs and every `unity` run prints that
// script reply; without, no install holds it. `entries` is chat's entries
// slot; `runCall` runs Bash call n as chat writes a live one: its entry, its
// `toolStarted`, its completion.
async function startPart({ probeReply }: { probeReply?: object } = {}) {
  const contributions: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
    options: ContributeToolsOptions | undefined;
  }[] = [];
  const capture = {
    list: (): Promise<WindowList> => GRANTED.listWindows(),
    openAccessSettings: vi.fn((): Promise<void> => Promise.resolve()),
  };
  const screenCapture: ScreenCapture = {
    access: () => 'granted',
    listWindows: () => capture.list(),
    openAccessSettings: () => capture.openAccessSettings(),
  };
  const harness = startMainPart(liveViewMainPart, {
    dependencies: [
      fakeDependency(chatMainKey, () => ({}) as ChatMainExports),
      fakeDependency(
        sessionsMainKey,
        (consumer) =>
          ({
            contributeTools: (
              tools: ToolDefinition[],
              start: (session: AgentSession) => ToolSession,
              options?: ContributeToolsOptions,
            ) => {
              contributions.push({ tools, start, options });
              return consumer.track({ dispose() {} });
            },
          }) as unknown as SessionsMainExports,
      ),
    ],
    services: { screenCapture, ...probeServices(probeReply) },
  });
  await harness.files.write(
    EDITOR_FILE,
    JSON.stringify({ process_id: FAKE_EDITOR_PROCESS_ID }),
  );
  if (probeReply !== undefined) {
    await harness.files.write(CAPTURE_SCRIPT, '// WigleyCapture');
    harness.state
      .publish(coreAgentHarnessesSlot)
      .set(FAKE_HARNESS_ID, harnessInfo({ profiles: [WIGLEY_PROFILE] }));
  }
  const toolSession = contributions[0]!.start({
    id: SESSION,
    info: {
      sessionId: 'host-1',
      projectDir: PROJECT,
      harness: 'claude',
      rowId: null,
    },
  });
  const call = (name: string, args: unknown, context = CONTEXT) =>
    toolSession.call(name, args, context);
  const pickOf = (sessionId: string) =>
    harness.state.read(livePicksSlot, 'test').get(sessionId);
  const entries = harness.state.publish(chatEntriesSlot);
  const emitStarted = (n: number, options: CallOptions = {}) =>
    harness.emit('chat.agentEvent', toolStarted(n, options));
  const putEntry = (
    n: number,
    command: string,
    finished: boolean,
    options: CallOptions = {},
  ) =>
    entries.put(
      SESSION,
      bashEntry(
        n,
        command,
        finished ? { text: 'ok', isError: options.isError ?? false } : null,
        options,
      ),
    );
  const runCall = (n: number, command: string, options: CallOptions = {}) => {
    putEntry(n, command, false, options);
    emitStarted(n, options);
    putEntry(n, command, true, options);
  };
  const liveViewLogs = () =>
    harness.logs
      .filter(({ source }) => source === 'live-view')
      .map(({ message }) => message);
  return {
    harness,
    capture,
    contributions,
    call,
    pickOf,
    entries,
    emitStarted,
    putEntry,
    runCall,
    liveViewLogs,
  };
}

const WIGLEY_PROFILE = { name: 'work', configDir: '/home/.claude' };

// A fake harness whose profile lists the wigley install, and processes whose
// every run prints `probeReply` as `script run` does; none without a reply.
function probeServices(probeReply: object | undefined) {
  if (probeReply === undefined) {
    return {};
  }
  const agentHarness = createFakeAgentHarness(
    { now: () => 0 },
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  agentHarness.setInstalledPlugins(WIGLEY_PROFILE.configDir, [
    {
      key: WIGLEY_PLUGIN_KEY,
      installDir: WIGLEY_INSTALL,
      version: '1.0.0',
      listedAt: null,
    },
  ]);
  const processes = new FakeProcesses();
  processes.run = () =>
    Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ result: JSON.stringify(probeReply) }),
      stderr: '',
      timedOut: false,
    });
  return { agentHarnesses: harnessRegistryOf([agentHarness]), processes };
}

type Parts = Awaited<ReturnType<typeof startPart>>;

// Holds every `listWindows` call open until the test answers it, in call order.
function holdWindowLists(parts: Parts): ((list: WindowList) => void)[] {
  const answers: ((list: WindowList) => void)[] = [];
  parts.capture.list = () =>
    new Promise((resolve) => {
      answers.push(resolve);
    });
  return answers;
}

describe('liveViewMainPart', () => {
  it('start_ContributesBothTools', async () => {
    const { contributions } = await startPart();

    expect(
      contributions.map(({ tools }) => tools.map(({ name }) => name)),
    ).toEqual([['show_live_view', 'hide_live_view']]);
  });

  it('contributes the live-view tools with their offline answers', async () => {
    const { contributions } = await startPart();

    expect(contributions.map(({ options }) => options)).toEqual([
      {
        offline: {
          show_live_view: {
            result: textResult(
              'The app is closed, so no Live section streams. Carry on without the stream.',
            ),
            replay: false,
          },
          hide_live_view: {
            result: textResult(
              'The app is closed: no Live section was streaming.',
            ),
            replay: false,
          },
        },
      },
    ]);
  });

  it.each<{
    given: string;
    args: unknown;
    editorFile?: string;
    list?: () => Promise<WindowList>;
    pick: LivePick | undefined;
    error: boolean;
    text: string;
  }>([
    {
      given: 'the Game View rect',
      args: { projectPath: PROJECT, gameRect: FAKE_GAME_RECT },
      pick: GAME_VIEW_PICK,
      error: false,
      text: 'Streaming the Game View of Game in the Live section. It streams while the user has the section on screen.',
    },
    {
      given: 'a null gameRect',
      args: { projectPath: PROJECT, gameRect: null },
      pick: EDITOR_PICK,
      error: false,
      text: "Streaming Game's whole editor window in the Live section. It streams while the user has the section on screen.",
    },
    {
      given: 'Screen Recording blocked',
      args: { projectPath: PROJECT, gameRect: FAKE_GAME_RECT },
      list: () => BLOCKED.listWindows(),
      pick: { kind: 'blocked' },
      error: true,
      text: 'Screen Recording is off for Auri. The Live section shows a button that opens System Settings; the user turns it on there and restarts Auri. Carry on without the stream.',
    },
    {
      given: 'a project with no EditorInstance.json, while blocked',
      args: { projectPath: '/home/Other', gameRect: FAKE_GAME_RECT },
      list: () => BLOCKED.listWindows(),
      pick: EDITOR_PICK,
      error: true,
      text: 'No Unity editor has Other open: /home/Other/Library/EditorInstance.json is missing or has no process_id.',
    },
    {
      given: 'an EditorInstance.json that does not parse',
      args: { projectPath: PROJECT, gameRect: FAKE_GAME_RECT },
      editorFile: 'not json',
      pick: EDITOR_PICK,
      error: true,
      text: 'No Unity editor has Game open: /home/Game/Library/EditorInstance.json is missing or has no process_id.',
    },
    {
      given: 'an EditorInstance.json with no process_id',
      args: { projectPath: PROJECT, gameRect: FAKE_GAME_RECT },
      editorFile: '{}',
      pick: EDITOR_PICK,
      error: true,
      text: 'No Unity editor has Game open: /home/Game/Library/EditorInstance.json is missing or has no process_id.',
    },
    {
      given: 'a window list that rejects',
      args: { projectPath: PROJECT },
      list: () => Promise.reject(new Error('no window list')),
      pick: EDITOR_PICK,
      error: true,
      text: 'no window list',
    },
    {
      given: 'no projectPath',
      args: { gameRect: FAKE_GAME_RECT },
      pick: EDITOR_PICK,
      error: true,
      text: 'projectPath is required.',
    },
    {
      given: 'a gameRect of three numbers',
      args: { projectPath: PROJECT, gameRect: [500, 120, 360] },
      pick: EDITOR_PICK,
      error: true,
      text: 'gameRect must be four numbers: [x, y, width, height].',
    },
    {
      given: 'a gameRect of zero width',
      args: { projectPath: PROJECT, gameRect: [500, 120, 0, 640] },
      pick: EDITOR_PICK,
      error: true,
      text: 'gameRect must be four numbers: [x, y, width, height].',
    },
    {
      given: 'a relative projectPath',
      args: { projectPath: 'Game' },
      pick: EDITOR_PICK,
      error: true,
      text: 'projectPath must be the absolute path of a Unity project folder.',
    },
    {
      given: 'a root projectPath',
      args: { projectPath: '/' },
      pick: EDITOR_PICK,
      error: true,
      text: 'projectPath must be the absolute path of a Unity project folder.',
    },
  ])(
    'showLiveView_AfterAWholeEditorPick_WritesThePickOrLeavesIt_given $given',
    async ({ args, editorFile, list, pick, error, text }) => {
      const { harness, capture, call, pickOf } = await startPart();
      await call('show_live_view', { projectPath: PROJECT });
      if (editorFile !== undefined) {
        await harness.files.write(EDITOR_FILE, editorFile);
      }
      if (list !== undefined) {
        capture.list = list;
      }

      const result = await call('show_live_view', args);

      expect(pickOf(SESSION)).toEqual(pick);
      expect(result.isError ?? false).toBe(error);
      expect(result.content[0]?.text).toBe(text);
    },
  );

  const showByAgent = async (parts: Parts) => {
    await parts.call('show_live_view', {
      projectPath: PROJECT,
      gameRect: FAKE_GAME_RECT,
    });
  };
  const showByPlaytest = async (parts: Parts) => {
    parts.runCall(1, PLAY);
    await settle();
  };
  const hideByAgent = (parts: Parts) => parts.call('hide_live_view', {});
  const endSession = (parts: Parts) =>
    parts.harness.emit('sessions.ended', { sessionId: SESSION });

  it.each([
    {
      given: 'hide_live_view, the agent showed',
      show: showByAgent,
      end: hideByAgent,
    },
    {
      given: 'the session ending, the agent showed',
      show: showByAgent,
      end: endSession,
    },
    {
      given: 'hide_live_view, the playtest watch showed',
      show: showByPlaytest,
      end: hideByAgent,
    },
    {
      given: 'the session ending, the playtest watch showed',
      show: showByPlaytest,
      end: endSession,
    },
  ])('streamPick_IsDeletedBy_given $given', async ({ show, end }) => {
    const parts = await startPart();
    await show(parts);
    expect(parts.pickOf(SESSION)).toBeDefined();

    await end(parts);

    expect(parts.pickOf(SESSION)).toBeUndefined();
  });

  it.each<{
    given: string;
    run: (parts: Parts) => void;
    list?: () => Promise<WindowList>;
    pick: LivePick;
  }>([
    {
      given: 'entry first',
      run: (parts) => parts.runCall(1, PLAY_RESULT_ONLY),
      pick: EDITOR_PICK,
    },
    {
      given: 'event first',
      run: (parts) => {
        parts.emitStarted(1);
        parts.putEntry(1, PLAY_RESULT_ONLY, false);
        parts.putEntry(1, PLAY_RESULT_ONLY, true);
      },
      pick: EDITOR_PICK,
    },
    {
      given: 'result before the event',
      run: (parts) => {
        parts.putEntry(1, PLAY_RESULT_ONLY, false);
        parts.putEntry(1, PLAY_RESULT_ONLY, true);
        parts.emitStarted(1);
      },
      pick: EDITOR_PICK,
    },
    {
      given: "a subagent's call",
      run: (parts) =>
        parts.runCall(1, PLAY_RESULT_ONLY, { agentId: 'agent-1' }),
      pick: EDITOR_PICK,
    },
    {
      given: 'capture.py start',
      run: (parts) => parts.runCall(1, `python3 /s/capture.py start ${G}`),
      pick: EDITOR_PICK,
    },
    {
      given: 'Screen Recording off',
      run: (parts) => parts.runCall(1, PLAY),
      list: () => BLOCKED.listWindows(),
      pick: { kind: 'blocked' },
    },
  ])(
    'playtestStart_OpensTheWholeEditor_given $given',
    async ({ run, list, pick }) => {
      const parts = await startPart();
      if (list !== undefined) {
        parts.capture.list = list;
      }

      run(parts);
      await settle();

      expect(parts.pickOf(SESSION)).toEqual(pick);
    },
  );

  it.each<{
    given: string;
    run: (parts: Parts) => unknown;
    list?: () => Promise<WindowList>;
    pick?: LivePick;
    logs: string[];
  }>([
    {
      given: 'a replayed call',
      run: (parts) => {
        parts.putEntry(1, PLAY, false);
        parts.emitStarted(1, { replayed: true });
        parts.putEntry(1, PLAY, true);
      },
      logs: [],
    },
    {
      given: 'a restored entry',
      run: (parts) =>
        parts.entries.replace(SESSION, [
          bashEntry(1, PLAY, { text: 'ok', isError: false }),
        ]),
      logs: [],
    },
    {
      given: 'a restore then a replayed start',
      run: (parts) => {
        parts.entries.replace(SESSION, [
          bashEntry(1, PLAY, { text: 'ok', isError: false }),
        ]);
        parts.emitStarted(1, { replayed: true });
      },
      logs: [],
    },
    {
      given: 'a live start with no entry',
      run: (parts) => parts.emitStarted(1),
      logs: [],
    },
    {
      given: 'started, no result yet',
      run: (parts) => {
        parts.putEntry(1, PLAY, false);
        parts.emitStarted(1);
      },
      logs: [],
    },
    {
      given: 'a second live start of a settled call',
      run: async (parts) => {
        parts.runCall(1, PLAY);
        await settle();
        await parts.call('hide_live_view', {});
        parts.emitStarted(1);
      },
      logs: [NO_INSTALL_PLAYTEST_LINE, 'row-1 hid its Live section'],
    },
    {
      given: 'a denied or failed call',
      run: (parts) => parts.runCall(1, PLAY, { isError: true }),
      logs: [],
    },
    {
      given: 'an unrelated unity command',
      run: (parts) => parts.runCall(1, `unity command editor_status ${G}`),
      logs: [],
    },
    {
      // With no --project-path, a watch that heard the preview would log at
      // once; the preview's own sample pick still lands.
      given: "chat's preview row",
      run: (parts) =>
        parts.runCall(1, 'unity command editor_play --result-only', {
          hostSessionId: CHAT_PREVIEW_HOST_ID,
        }),
      pick: SAMPLE_PICK,
      logs: [],
    },
    {
      given: 'no --project-path',
      run: (parts) =>
        parts.runCall(1, 'unity command editor_play --result-only'),
      logs: [
        'row-1 opened no Live view for a playtest: the command names no --project-path',
      ],
    },
    {
      given: 'no editor in the folder',
      run: (parts) =>
        parts.runCall(
          1,
          'unity command editor_play --project-path /home/Other',
        ),
      logs: [
        'row-1 opened no Live view for a playtest: No Unity editor has Other open: /home/Other/Library/EditorInstance.json is missing or has no process_id.',
      ],
    },
    {
      given: 'a relative path',
      run: (parts) =>
        parts.runCall(1, 'unity command editor_play --project-path Game'),
      logs: [
        'row-1 opened no Live view for a playtest: projectPath must be the absolute path of a Unity project folder.',
      ],
    },
    {
      given: 'no editor window',
      run: (parts) => parts.runCall(1, PLAY),
      list: () => Promise.resolve({ access: 'granted', windows: [] }),
      logs: [
        `row-1 opened no Live view for a playtest: Game's editor (process ${FAKE_EDITOR_PROCESS_ID}) has no window the app can stream; a minimized window cannot stream.`,
      ],
    },
    {
      given: 'a window list that rejects',
      run: (parts) => parts.runCall(1, PLAY),
      list: () => Promise.reject(new Error('no window list')),
      logs: ['row-1 opened no Live view for a playtest: no window list'],
    },
  ])(
    'playtestCommand_WritesNoPick_given $given',
    async ({ run, list, pick, logs }) => {
      const parts = await startPart();
      if (list !== undefined) {
        parts.capture.list = list;
      }

      await run(parts);
      await settle();

      expect(parts.pickOf(SESSION)).toEqual(pick);
      expect(parts.liveViewLogs()).toEqual(logs);
    },
  );

  it.each<{ given: string; window: unknown; pick: LivePick; log: string }>([
    {
      given: 'a Game View inside the editor window',
      window: FAKE_GAME_RECT,
      pick: GAME_VIEW_PICK,
      log: 'row-1 shows Game View · Game for a playtest',
    },
    {
      given: 'a Game View outside every editor window',
      window: [5000, 5000, 100, 100],
      pick: EDITOR_PICK,
      log: 'row-1 shows Editor · Game for a playtest (no Game View: The Game View rect [5000, 5000, 100, 100] is not inside any window of Game',
    },
    {
      given: 'no Game View',
      window: null,
      pick: EDITOR_PICK,
      log: 'row-1 shows Editor · Game for a playtest (no Game View: the editor has no Game View open)',
    },
  ])(
    'playtestStart_CropsToTheProbedGameView_given $given',
    async ({ window, pick, log }) => {
      const parts = await startPart({
        probeReply: { ok: true, playing: true, window },
      });

      parts.runCall(1, PLAY);
      for (let attempt = 1; attempt < PROBE_ATTEMPTS; attempt += 1) {
        await settle();
        parts.harness.advance(1000);
      }
      await settle();

      expect(parts.pickOf(SESSION)).toEqual(pick);
      expect(
        parts.liveViewLogs().map((line) => line.slice(0, log.length)),
      ).toEqual([log]);
    },
  );

  it('playtestStart_LeavesTheAgentsPick', async () => {
    const parts = await startPart();
    await showByAgent(parts);

    parts.runCall(1, PLAY);
    await settle();

    expect(parts.pickOf(SESSION)).toEqual(GAME_VIEW_PICK);
    expect(
      parts.liveViewLogs().filter((line) => line.includes('for a playtest')),
    ).toEqual([]);
  });

  it.each<{
    given: string;
    before: (parts: Parts) => Promise<void>;
    stop: string;
    stopFails?: boolean;
    after?: (parts: Parts) => void;
    pick: LivePick | undefined;
    closed: string[];
  }>([
    {
      given: 'the app opened it',
      before: showByPlaytest,
      stop: STOP,
      pick: undefined,
      closed: ['row-1 closed the Live view its playtest opened'],
    },
    {
      given: 'trailing slash',
      before: showByPlaytest,
      stop: 'unity command editor_stop --project-path /home/Game/',
      pick: undefined,
      closed: ['row-1 closed the Live view its playtest opened'],
    },
    {
      given: 'the app opened the blocked pick',
      before: async (parts) => {
        parts.capture.list = () => BLOCKED.listWindows();
        await showByPlaytest(parts);
      },
      stop: STOP,
      pick: undefined,
      closed: ['row-1 closed the Live view its playtest opened'],
    },
    {
      given: 'a stop with no path',
      before: showByPlaytest,
      stop: 'unity command editor_stop',
      pick: EDITOR_PICK,
      closed: [],
    },
    {
      given: 'a stop for another project',
      before: showByPlaytest,
      stop: 'unity command editor_stop --project-path /home/Other',
      pick: EDITOR_PICK,
      closed: [],
    },
    {
      given: 'a failed stop',
      before: showByPlaytest,
      stop: STOP,
      stopFails: true,
      pick: EDITOR_PICK,
      closed: [],
    },
    {
      given: 'the agent showed after the app',
      before: async (parts) => {
        await showByPlaytest(parts);
        await showByAgent(parts);
      },
      stop: STOP,
      pick: GAME_VIEW_PICK,
      closed: [],
    },
    {
      given: "the agent's failed show after its own",
      before: async (parts) => {
        await showByPlaytest(parts);
        await showByAgent(parts);
        await parts.call('show_live_view', { gameRect: FAKE_GAME_RECT });
      },
      stop: STOP,
      pick: GAME_VIEW_PICK,
      closed: [],
    },
    {
      given: 'the agent showed only',
      before: showByAgent,
      stop: STOP,
      pick: GAME_VIEW_PICK,
      closed: [],
    },
    {
      given: "call 1's completion put again after the stop",
      before: showByPlaytest,
      stop: STOP,
      after: (parts) => parts.putEntry(1, PLAY, true),
      pick: undefined,
      closed: ['row-1 closed the Live view its playtest opened'],
    },
  ])(
    'editorStop_ClosesOnlyTheAppsPickForItsProject_given $given',
    async ({ before, stop, stopFails, after, pick, closed }) => {
      const parts = await startPart();
      await before(parts);
      await settle();

      parts.runCall(2, stop, { isError: stopFails ?? false });
      after?.(parts);
      await settle();

      expect(parts.pickOf(SESSION)).toEqual(pick);
      expect(
        parts.liveViewLogs().filter((line) => line.includes(' closed ')),
      ).toEqual(closed);
    },
  );

  it.each<{
    given: string;
    event: (
      parts: Parts,
      answers: ((list: WindowList) => void)[],
      list: WindowList,
    ) => Promise<unknown>;
    pick: LivePick | undefined;
    logs: string[];
  }>([
    {
      given: 'editor_stop',
      event: async (parts) => parts.runCall(2, STOP),
      pick: undefined,
      logs: [],
    },
    {
      given: "the agent's show landing first",
      event: async (parts, answers, list) => {
        const shown = showByAgent(parts);
        await settle();
        answers[1]?.(list);
        await shown;
      },
      pick: GAME_VIEW_PICK,
      logs: ['row-1 shows Game View · Game'],
    },
    {
      given: 'hide_live_view',
      event: hideByAgent,
      pick: undefined,
      logs: ['row-1 hid its Live section'],
    },
    {
      given: 'the session ending',
      event: async (parts) => endSession(parts),
      pick: undefined,
      logs: [],
    },
    {
      given: 'a second live start',
      event: async (parts) => parts.runCall(2, PLAY),
      pick: EDITOR_PICK,
      logs: [NO_INSTALL_PLAYTEST_LINE],
    },
  ])(
    'playtestShow_InterruptedWhileTheWindowsList_given $given',
    async ({ event, pick, logs }) => {
      const parts = await startPart();
      const list = await GRANTED.listWindows();
      const answers = holdWindowLists(parts);
      parts.runCall(1, PLAY);
      await settle();
      const logsBefore = parts.liveViewLogs().length;

      await event(parts, answers, list);
      await settle();
      for (const answer of answers) {
        answer(list);
      }
      await settle();

      expect(parts.pickOf(SESSION)).toEqual(pick);
      expect(parts.liveViewLogs().slice(logsBefore)).toEqual(logs);
    },
  );

  it.each<{
    given: string;
    stop: (parts: Parts, abort: AbortController) => unknown;
    text: string;
  }>([
    {
      given: 'the session ending',
      stop: (parts) =>
        parts.harness.emit('sessions.ended', { sessionId: SESSION }),
      text: INTERRUPTED_REPLY,
    },
    {
      given: 'hide_live_view',
      stop: (parts) => parts.call('hide_live_view', {}),
      text: INTERRUPTED_REPLY,
    },
    {
      given: 'the call aborting',
      stop: (_parts, abort) => abort.abort(),
      text: INTERRUPTED_REPLY,
    },
  ])(
    'showLiveView_StoppedWhileTheWindowsList_WritesNoPickAndRepliesInterrupted_given $given',
    async ({ stop, text }) => {
      const parts = await startPart();
      const abort = new AbortController();
      let answer: (list: WindowList) => void = () => undefined;
      parts.capture.list = () => new Promise((resolve) => (answer = resolve));
      const shown = parts.call(
        'show_live_view',
        { projectPath: PROJECT },
        { toolUseId: null, signal: abort.signal },
      );
      await settle();

      await stop(parts, abort);
      answer(await GRANTED.listWindows());
      const result = await shown;

      expect({
        pick: parts.pickOf(SESSION),
        isError: result.isError ?? false,
        text: result.content[0]?.text,
      }).toEqual({ pick: undefined, isError: true, text });
    },
  );

  it.each([
    { given: 'the settings open', fails: false, logged: [] },
    {
      given: 'the settings fail to open',
      fails: true,
      logged: ['Screen Recording settings not opened: no settings'],
    },
  ])(
    'openScreenSettings_CallsTheServiceAndLogsAFailure_given $given',
    async ({ fails, logged }) => {
      const { harness, capture } = await startPart();
      if (fails) {
        capture.openAccessSettings.mockRejectedValueOnce(
          new Error('no settings'),
        );
      }

      harness.started().commands.openScreenSettings({ arg: undefined });
      await settle();

      expect(capture.openAccessSettings).toHaveBeenCalledOnce();
      expect(
        harness.logs
          .filter(({ source }) => source === 'live-view')
          .map(({ message }) => message),
      ).toEqual(logged);
    },
  );

  it.each([
    {
      given: "chat's preview row",
      hostSessionId: CHAT_PREVIEW_HOST_ID,
      writes: 1,
      pick: SAMPLE_PICK,
    },
    {
      given: 'a live row',
      hostSessionId: 'host-2',
      writes: 0,
      pick: undefined,
    },
  ])(
    'agentEvents_WriteTheSamplePickOnceForThePreview_given $given',
    async ({ hostSessionId, writes, pick }) => {
      const { harness, pickOf } = await startPart();
      const written = vi.fn();
      harness.state.read(livePicksSlot, 'test').on(written);
      const agentEvent = {
        sessionId: 'row-2',
        profileDir: null,
        hostSessionId,
        event: { type: 'turnStarted', at: 0 },
        replayed: false,
      };

      harness.emit('chat.agentEvent', agentEvent);
      harness.emit('chat.agentEvent', agentEvent);
      await settle();

      expect(written).toHaveBeenCalledTimes(writes);
      expect(pickOf('row-2')).toEqual(pick);
    },
  );
});
