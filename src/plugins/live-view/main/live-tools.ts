import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { ScreenCapture } from '../../../contracts/screen-capture';
import type { KeyedSlotWriter } from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import {
  type AgentSession,
  errorResult,
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
    "Streams a Unity editor's Game View live in this session's Live section in the app, beside the chat, so the user watches the game while the agent plays it. Call it after each `capture.py start` of the unity-playtest skill, `--append` included. `projectPath` is the Unity project folder the editor has open; `gameRect` is the Game View's render area in global screen points, top-left origin, `[x, y, width, height]`: the `game_view` field of `capture.py start`'s reply. Without `gameRect` the whole editor window streams. Call it again after the Game View moves or resizes.",
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
    "Stops the stream in this session's Live section and hides it. Call it after the last `capture.py stop` of a playtest.",
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

const LIVE_TOOLS: readonly ToolDefinition[] = [SHOW_TOOL, HIDE_TOOL];

const PROJECT_PATH_REQUIRED = 'projectPath is required.';
const GAME_RECT_INVALID =
  'gameRect must be four numbers: [x, y, width, height].';
const PROJECT_PATH_NOT_ABSOLUTE =
  'projectPath must be the absolute path of a Unity project folder.';
const BLOCKED_REPLY =
  'Screen Recording is off for Auri. The Live section shows a button that opens System Settings; the user turns it on there and restarts Auri. Carry on without the stream.';
const HIDDEN_REPLY = 'The Live section stopped streaming.';
const ABORTED_REPLY =
  'show_live_view was interrupted; the Live section was left as it was.';

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
}

export interface LiveTools {
  readonly definitions: readonly ToolDefinition[];
  // The tool session sessions' `contributeTools` starts in each session.
  startSession(session: AgentSession): ToolSession;
  // `show_live_view` for the session, with its args already checked: writes
  // the session's pick and replies, or replies with the error and leaves the
  // pick as it was. A session that hides or ends while it waits, or a call
  // whose `signal` aborts, gets no pick.
  show(
    sessionId: string,
    args: ShowArgs,
    signal?: AbortSignal,
  ): Promise<ToolResult>;
  // Deletes the session's pick, and keeps a `show` still waiting from writing one.
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
  const hasArea =
    isFourFiniteNumbers(gameRect) && gameRect[2] > 0 && gameRect[3] > 0;
  if (!hasArea) {
    return { error: GAME_RECT_INVALID };
  }
  return { args: { projectPath, gameRect } };
}

function isFourFiniteNumbers(value: unknown): value is GameRectTuple {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
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

// `show_live_view` and `hide_live_view`: each session's agent picks the
// window its Live section streams, in the picks slot under the session's id.
export function createLiveTools(deps: LiveToolsDeps): LiveTools {
  const { files, paths, screenCapture, picks, log } = deps;
  // Bumped per session id by each hide and end, so a `show` that was waiting
  // through either writes no pick; a row id can come back after a restart, so
  // the id alone does not bar it.
  const generations = new Map<string, number>();
  const generationOf = (sessionId: string) => generations.get(sessionId) ?? 0;
  const bumpGeneration = (sessionId: string) =>
    generations.set(sessionId, generationOf(sessionId) + 1);

  const show = async (
    sessionId: string,
    { projectPath, gameRect }: ShowArgs,
    signal?: AbortSignal,
  ): Promise<ToolResult> => {
    const folder = paths.base(projectPath);
    if (!paths.isAbsolute(projectPath) || folder === '') {
      return errorResult(PROJECT_PATH_NOT_ABSOLUTE);
    }
    const generationBefore = generationOf(sessionId);
    try {
      // Read before the window list, so with no editor the no-editor error
      // wins and no blocked pick is written.
      const editorFile = paths.join(
        projectPath,
        'Library',
        'EditorInstance.json',
      );
      const processId = editorProcessId(await readIfPresent(files, editorFile));
      if (processId === null) {
        return errorResult(
          `No Unity editor has ${folder} open: ${editorFile} is missing or has no process_id.`,
        );
      }
      const result = pickOf(
        await screenCapture.listWindows(),
        processId,
        gameRect === null ? null : rectOfTuple(gameRect),
        folder,
      );
      if ('error' in result) {
        return errorResult(result.error);
      }
      if (signal?.aborted === true) {
        return errorResult(ABORTED_REPLY);
      }
      const { pick } = result;
      if (generationOf(sessionId) === generationBefore) {
        picks.set(sessionId, pick);
        log(
          `${sessionId} shows ${pick.kind === 'stream' ? pick.summary : 'Screen Recording off'}`,
        );
      }
      if (pick.kind === 'blocked') {
        return errorResult(BLOCKED_REPLY);
      }
      return textResult(
        gameRect === null
          ? `Streaming ${folder}'s whole editor window in the Live section. It streams while the user has the section on screen.`
          : `Streaming the Game View of ${folder} in the Live section. It streams while the user has the section on screen.`,
      );
    } catch (error) {
      return errorResult(errorText(error));
    }
  };

  const hide = (sessionId: string): ToolResult => {
    bumpGeneration(sessionId);
    picks.delete(sessionId);
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
    sessionEnded(sessionId) {
      bumpGeneration(sessionId);
      picks.delete(sessionId);
    },
  };
}
