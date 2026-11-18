import { describe, expect, it, vi } from 'vitest';
import type {
  ScreenCapture,
  WindowList,
} from '../../../contracts/screen-capture';
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

const GRANTED = createFakeScreenCapture();
const BLOCKED = createFakeScreenCapture({ access: 'blocked' });

// A macrotask, so every pending promise chain settles first.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// `listWindows` answers through `capture.list`, which a test swaps; the editor
// file of PROJECT names the fake editor's pid.
async function startPart() {
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
    services: { screenCapture },
  });
  await harness.files.write(
    EDITOR_FILE,
    JSON.stringify({ process_id: FAKE_EDITOR_PROCESS_ID }),
  );
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
  return { harness, capture, contributions, call, pickOf };
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
      pick: {
        kind: 'stream',
        sourceId: 'sample:1440x900',
        summary: 'Game View · Game',
        windowSize: { width: 1440, height: 900 },
        crop: {
          x: 500 / 1440,
          y: 95 / 900,
          width: 360 / 1440,
          height: 640 / 900,
        },
      },
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

  it.each([
    {
      given: 'hide_live_view',
      end: (parts: Awaited<ReturnType<typeof startPart>>) =>
        parts.call('hide_live_view', {}),
    },
    {
      given: 'the session ending',
      end: (parts: Awaited<ReturnType<typeof startPart>>) =>
        parts.harness.emit('sessions.ended', { sessionId: SESSION }),
    },
  ])('streamPick_IsDeletedBy_given $given', async ({ end }) => {
    const parts = await startPart();
    await parts.call('show_live_view', {
      projectPath: PROJECT,
      gameRect: FAKE_GAME_RECT,
    });

    await end(parts);

    expect(parts.pickOf(SESSION)).toBeUndefined();
  });

  it.each<{
    given: string;
    stop: (
      parts: Awaited<ReturnType<typeof startPart>>,
      abort: AbortController,
    ) => unknown;
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
      pick: {
        kind: 'stream',
        sourceId: 'sample:1440x900',
        summary: 'Game View · sample',
        windowSize: { width: 1440, height: 900 },
        crop: {
          x: 500 / 1440,
          y: 95 / 900,
          width: 360 / 1440,
          height: 640 / 900,
        },
      },
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
