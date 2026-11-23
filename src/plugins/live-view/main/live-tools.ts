import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { ScreenCapture } from '../../../contracts/screen-capture';
import type { KeyedSlotWriter } from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import {
  type AgentSession,
  errorResult,
  type OfflineAnswer,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import type { LivePick } from '../contract';
import { pickOf, rectOfTuple } from '../window-pick';

const SHOW_TOOL: ToolDefinition = {
  name: 'show_live_view',
  description:
    "Streams a Unity editor's Game View live in this session's Live section in the app, beside the chat, so the user watches the game while the agent plays it. Call it after each playtest capture starts, `--append` included. `projectPath` is the Unity project folder the editor has open; `gameRect` is the Game View's render area in global screen points, top-left origin, `[x, y, width, height]`, as the capture tool reports it. Without `gameRect` the whole editor window streams. Call it again after the Game View moves or resizes.",
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: { type: 'string' },
      gameRect: {
        type: 'array',
        items: { type: 'number' },
        minItems: 4,
        maxItems: 4,
      },
    },
    required: ['projectPath'],
    additionalProperties: false,
  },
};

const HIDE_TOOL: ToolDefinition = {
  name: 'hide_live_view',
  description:
    "Stops the stream in this session's Live section and hides it. Call it after the playtest's last capture stops.",
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

const LIVE_TOOLS: readonly ToolDefinition[] = [SHOW_TOOL, HIDE_TOOL];

// Each live tool's answer while the app is closed: a non-error "carry on", so
// a playtest does not retry the stream. Neither call replays.
export const LIVE_VIEW_OFFLINE: Readonly<Record<string, OfflineAnswer>> = {
  [SHOW_TOOL.name]: {
    result: textResult(
      'The app is closed, so no Live section streams. Carry on without the stream.',
    ),
    replay: false,
  },
  [HIDE_TOOL.name]: {
    result: textResult('The app is closed: no Live section was streaming.'),
    replay: false,
  },
};

const PROJECT_PATH_REQUIRED = 'projectPath is required.';
const GAME_RECT_INVALID =
  'gameRect must be four numbers: [x, y, width, height].';
const PROJECT_PATH_NOT_ABSOLUTE =
  'projectPath must be the absolute path of a Unity project folder.';
const BLOCKED_REPLY =
  'Screen Recording is off for Auri. The Live section shows a button that opens System Settings; the user turns it on there and restarts Auri. Carry on without the stream.';
const HIDDEN_REPLY = 'The Live section stopped streaming.';
const ABORTED_REPLY =
  'show_live_view was interrupted by a hide, the session ending or the call aborting; the Live section was left as it was.';

// `[x, y, width, height]` in global screen points, top-left origin.
export type GameRectTuple = readonly [number, number, number, number];

export interface ShowArgs {
  projectPath: string;
  gameRect: GameRectTuple | null;
}

export interface LiveToolsDeps {
  files: Pick<Files, 'read'>;
  paths: Pick<Paths, 'base' | 'isAbsolute' | 'join'>;
  screenCapture: ScreenCapture;
  picks: KeyedSlotWriter<LivePick>;
  log: PluginLog;
  // The Game View rect of the editor that has `projectPath` open, or why there
  // is none; it stops trying once `isCancelled` reads true. Never rejects.
  probeGameRect(
    projectPath: string,
    isCancelled: () => boolean,
  ): Promise<{ rect: GameRectTuple } | { error: string }>;
}

export interface LiveTools {
  readonly definitions: readonly ToolDefinition[];
  // The tool session sessions' `contributeTools` starts in each session.
  startSession(session: AgentSession): ToolSession;
  // `show_live_view` for the session, with its args already checked: writes
  // the session's pick and replies, or replies with the error and leaves the
  // pick as it was. A pick it writes is the agent's, an app-opened one
  // included. A session that hides or ends while it waits, or a call whose
  // `signal` aborts, gets no pick and the interrupted error reply.
  show(
    sessionId: string,
    args: ShowArgs,
    signal?: AbortSignal,
  ): Promise<ToolResult>;
  // The app's show for a session's playtest, only while the session has no
  // pick, marked as opened for `projectPath`: the Game View `probeGameRect`
  // finds in the editor of `projectPath`, else that editor's whole window,
  // whose log line names why. A failed lookup logs a line and writes no pick.
  // Writes nothing when a pick, a hide, a stop, the session's end or a later
  // `playtestStarted` came while it waited. Never rejects.
  playtestStarted(sessionId: string, projectPath: string): Promise<void>;
  // Deletes the pick the app opened for `projectPath` (one trailing `/`
  // ignored), and keeps a `playtestStarted` still waiting from writing one; a
  // null path, another project, or an agent's pick stays.
  playtestStopped(sessionId: string, projectPath: string | null): void;
  // Deletes the session's pick, and keeps a `show` or `playtestStarted` still
  // waiting from writing one.
  sessionEnded(sessionId: string): void;
}

// The args of a `show_live_view` call, or the error text its agent reads.
function parseShowArgs(args: unknown): { args: ShowArgs } | { error: string } {
  const { projectPath, gameRect } = (args ?? {}) as {
    projectPath?: unknown;
    gameRect?: unknown;
  };
  if (typeof projectPath !== 'string' || projectPath === '') {
    return { error: PROJECT_PATH_REQUIRED };
  }
  if (gameRect === undefined || gameRect === null) {
    return { args: { projectPath, gameRect: null } };
  }
  if (!isGameRectWithArea(gameRect)) {
    return { error: GAME_RECT_INVALID };
  }
  return { args: { projectPath, gameRect } };
}

// Whether `value` is four finite numbers whose width and height are positive.
export function isGameRectWithArea(value: unknown): value is GameRectTuple {
  const isFourFiniteNumbers =
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item));
  return isFourFiniteNumbers && value[2] > 0 && value[3] > 0;
}

// The `process_id` of a Unity editor's `EditorInstance.json`, or null when the
// file is missing, does not parse, or holds no process id.
function editorProcessId(text: string | null): number | null {
  if (text === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const processId = (parsed as { process_id?: unknown } | null)?.process_id;
  const isProcessId = Number.isInteger(processId) && (processId as number) > 0;
  return isProcessId ? (processId as number) : null;
}

interface EditorFound {
  processId: number;
  folder: string;
}

// The editor that has `projectPath` open, by its `EditorInstance.json`, or the
// error text a `show_live_view` reply carries. Never rejects.
async function findEditor(
  { files, paths }: Pick<LiveToolsDeps, 'files' | 'paths'>,
  projectPath: string,
): Promise<EditorFound | { error: string }> {
  const folder = paths.base(projectPath);
  if (!paths.isAbsolute(projectPath) || folder === '') {
    return { error: PROJECT_PATH_NOT_ABSOLUTE };
  }
  try {
    const editorFile = paths.join(
      projectPath,
      'Library',
      'EditorInstance.json',
    );
    const processId = editorProcessId(await readIfPresent(files, editorFile));
    if (processId === null) {
      return {
        error: `No Unity editor has ${folder} open: ${editorFile} is missing or has no process_id.`,
      };
    }
    return { processId, folder };
  } catch (error) {
    return { error: errorText(error) };
  }
}

// The pick for `editor`'s window, cut to `gameRect` when given. Never rejects.
async function pickEditorWindow(
  { screenCapture }: Pick<LiveToolsDeps, 'screenCapture'>,
  editor: EditorFound,
  gameRect: GameRectTuple | null,
): Promise<{ pick: LivePick } | { error: string }> {
  try {
    return pickOf(
      await screenCapture.listWindows(),
      editor.processId,
      gameRect === null ? null : rectOfTuple(gameRect),
      editor.folder,
    );
  } catch (error) {
    return { error: errorText(error) };
  }
}

// The pick for the editor that has `projectPath` open, or the error text a
// `show_live_view` reply carries. The editor file is read before the window
// list, so with no editor the no-editor error wins and no blocked pick is
// written. Never rejects.
async function lookUpPick(
  deps: Pick<LiveToolsDeps, 'files' | 'paths' | 'screenCapture'>,
  projectPath: string,
  gameRect: GameRectTuple | null,
): Promise<{ pick: LivePick } | { error: string }> {
  const editor = await findEditor(deps, projectPath);
  if ('error' in editor) {
    return editor;
  }
  return pickEditorWindow(deps, editor, gameRect);
}

// The playtest's pick of `editor`: the probed Game View's, else the whole
// editor's, with why the Game View was not picked (null when it was).
async function lookUpPlaytestPick(
  deps: Pick<LiveToolsDeps, 'screenCapture'>,
  editor: EditorFound,
  probed: { rect: GameRectTuple } | { error: string },
): Promise<{
  result: { pick: LivePick } | { error: string };
  noCropReason: string | null;
}> {
  if ('error' in probed) {
    return {
      result: await pickEditorWindow(deps, editor, null),
      noCropReason: probed.error,
    };
  }
  const cropped = await pickEditorWindow(deps, editor, probed.rect);
  if ('pick' in cropped) {
    return { result: cropped, noCropReason: null };
  }
  return {
    result: await pickEditorWindow(deps, editor, null),
    noCropReason: cropped.error,
  };
}

// What a pick's log line names.
export function pickText(pick: LivePick): string {
  return pick.kind === 'stream' ? pick.summary : 'Screen Recording off';
}

function withoutTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

// `show_live_view` and `hide_live_view`, and the app's playtest show and stop:
// each session's agent, or the app on a playtest while the session has no
// pick, picks the window its Live section streams, in the picks slot under
// the session's id. The agent's pick wins; a playtest stop closes only a pick
// the app opened.
export function createLiveTools(deps: LiveToolsDeps): LiveTools {
  const { paths, picks, log } = deps;
  // Bumped per session id by each hide and end, so a `show` that was waiting
  // through either writes no pick; a row id can come back after a restart, so
  // the id alone does not bar it.
  const generations = new Map<string, number>();
  const generationOf = (sessionId: string) => generations.get(sessionId) ?? 0;
  const bumpGeneration = (sessionId: string) =>
    generations.set(sessionId, generationOf(sessionId) + 1);
  // Bumped per session id by each app show at its start, app stop, hide, end,
  // and agent show that writes, so an app show that was waiting through any of
  // them writes no pick.
  const appCounters = new Map<string, number>();
  const appCounterOf = (sessionId: string) => appCounters.get(sessionId) ?? 0;
  const bumpAppCounter = (sessionId: string) =>
    appCounters.set(sessionId, appCounterOf(sessionId) + 1);
  // The project path the app opened each session's current pick for, for the
  // sessions whose current pick the app's playtest show wrote.
  const appOpened = new Map<string, string>();

  const forget = (sessionId: string) => {
    bumpGeneration(sessionId);
    bumpAppCounter(sessionId);
    appOpened.delete(sessionId);
    picks.delete(sessionId);
  };

  const show = async (
    sessionId: string,
    { projectPath, gameRect }: ShowArgs,
    signal?: AbortSignal,
  ): Promise<ToolResult> => {
    const generationBefore = generationOf(sessionId);
    const result = await lookUpPick(deps, projectPath, gameRect);
    if ('error' in result) {
      return errorResult(result.error);
    }
    if (
      signal?.aborted === true ||
      generationOf(sessionId) !== generationBefore
    ) {
      return errorResult(ABORTED_REPLY);
    }
    const { pick } = result;
    picks.set(sessionId, pick);
    appOpened.delete(sessionId);
    bumpAppCounter(sessionId);
    log(`${sessionId} shows ${pickText(pick)}`);
    if (pick.kind === 'blocked') {
      return errorResult(BLOCKED_REPLY);
    }
    const folder = paths.base(projectPath);
    return textResult(
      gameRect === null
        ? `Streaming ${folder}'s whole editor window in the Live section. It streams while the user has the section on screen.`
        : `Streaming the Game View of ${folder} in the Live section. It streams while the user has the section on screen.`,
    );
  };

  const playtestStarted = async (
    sessionId: string,
    projectPath: string,
  ): Promise<void> => {
    if (picks.get(sessionId) !== undefined) {
      return;
    }
    bumpAppCounter(sessionId);
    const generationBefore = generationOf(sessionId);
    const appCounterBefore = appCounterOf(sessionId);
    const isInterrupted = () =>
      generationOf(sessionId) !== generationBefore ||
      appCounterOf(sessionId) !== appCounterBefore ||
      picks.get(sessionId) !== undefined;
    // The editor checks run first, so a trigger that cannot pick runs no
    // probe.
    const editor = await findEditor(deps, projectPath);
    if (isInterrupted()) {
      return;
    }
    if ('error' in editor) {
      log(`${sessionId} opened no Live view for a playtest: ${editor.error}`);
      return;
    }
    const probed = await deps.probeGameRect(projectPath, isInterrupted);
    const { result, noCropReason } = await lookUpPlaytestPick(
      deps,
      editor,
      probed,
    );
    if (isInterrupted()) {
      return;
    }
    if ('error' in result) {
      log(`${sessionId} opened no Live view for a playtest: ${result.error}`);
      return;
    }
    picks.set(sessionId, result.pick);
    appOpened.set(sessionId, projectPath);
    const why = noCropReason === null ? '' : ` (no Game View: ${noCropReason})`;
    log(`${sessionId} shows ${pickText(result.pick)} for a playtest${why}`);
  };

  const playtestStopped = (
    sessionId: string,
    projectPath: string | null,
  ): void => {
    bumpAppCounter(sessionId);
    const openedFor = appOpened.get(sessionId);
    const isTheOpenedProject =
      openedFor !== undefined &&
      projectPath !== null &&
      withoutTrailingSlash(openedFor) === withoutTrailingSlash(projectPath);
    if (!isTheOpenedProject) {
      return;
    }
    appOpened.delete(sessionId);
    picks.delete(sessionId);
    log(`${sessionId} closed the Live view its playtest opened`);
  };

  const hide = (sessionId: string): ToolResult => {
    forget(sessionId);
    log(`${sessionId} hid its Live section`);
    return textResult(HIDDEN_REPLY);
  };

  return {
    definitions: LIVE_TOOLS,
    startSession: (session) => ({
      call(name, args, { signal }) {
        if (name === HIDE_TOOL.name) {
          return Promise.resolve(hide(session.id));
        }
        if (name !== SHOW_TOOL.name) {
          return Promise.reject(new Error(`no live-view tool "${name}"`));
        }
        const parsed = parseShowArgs(args);
        return 'error' in parsed
          ? Promise.resolve(errorResult(parsed.error))
          : show(session.id, parsed.args, signal);
      },
      end: () => undefined,
    }),
    show,
    playtestStarted,
    playtestStopped,
    sessionEnded: forget,
  };
}
