import type { FileStat } from '../../../contracts/files';
import { errorText } from '../../../shared/error-text';
import {
  type AgentSession,
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import type { LaunchRequest } from '../contract';

export const START_SESSION_TOOL: ToolDefinition = {
  name: 'start_session',
  description:
    "Start a new, independent chat session in the Auri app with `prompt` as its first message. It opens in the background as a new row in the side bar, without taking focus. It is a full agent session running the user's whole agent setup, not a lightweight subagent: even a one-word prompt spends tens of thousands of tokens of the user's plan, so start one only when the work needs its own session. It always runs on Claude, whichever agent calls this tool. It runs on its own: its output does not come back here, and this tool cannot message or end it. `folder` must be an absolute path to a folder that exists; it defaults to this session's folder when there is one. `profile` defaults to this session's when the app started this session, else to the app's first profile. Returns the new session's id.",
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: "The new session's first message.",
      },
      folder: {
        type: 'string',
        description:
          "The absolute path of an existing folder to start in. Defaults to this session's folder, when it has one.",
      },
      profile: {
        type: 'string',
        description:
          "The name of the chat profile to start under. Defaults to this session's when the app started this session, else to the app's first profile.",
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
};

export interface StartSessionToolDeps {
  launch(request: LaunchRequest): string;
  defaultProfile(sessionId: string | null): string | null;
  profileNames(): string[];
  isAbsolute(path: string): boolean;
  stat(path: string): Promise<FileStat | null>;
  log(line: string): void;
}

interface StartSessionArgs {
  prompt?: unknown;
  folder?: unknown;
  profile?: unknown;
}

// A value an argument settled on, or the problem that stops the call.
type Choice = { value: string } | { problem: string };

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function chooseProfile(
  deps: StartSessionToolDeps,
  sessionId: string,
  named: unknown,
): Choice {
  if (named === undefined || named === null) {
    const profile = deps.defaultProfile(sessionId);
    return profile === null
      ? { problem: 'Chat has no profiles.' }
      : { value: profile };
  }
  if (!isNonBlankString(named)) {
    return { problem: 'profile must be a non-empty string.' };
  }
  const names = deps.profileNames();
  if (!names.includes(named)) {
    const known = names.length === 0 ? 'none' : names.join(', ');
    return { problem: `Unknown profile "${named}". Profiles: ${known}.` };
  }
  return { value: named };
}

async function chooseFolder(
  deps: StartSessionToolDeps,
  session: AgentSession,
  named: unknown,
): Promise<Choice> {
  const isNamed = named !== undefined && named !== null;
  if (isNamed && !isNonBlankString(named)) {
    return { problem: 'folder must be a non-empty string.' };
  }
  const folder = isNamed ? (named as string) : session.info.projectDir;
  if (folder === null) {
    return { problem: 'This session has no folder; name one with `folder`.' };
  }
  if (!deps.isAbsolute(folder)) {
    return { problem: `folder must be an absolute path: ${folder}` };
  }
  let found: FileStat | null;
  try {
    found = await deps.stat(folder);
  } catch (error) {
    deps.log(`folder ${folder} not read: ${errorText(error)}`);
    return { problem: `Could not read ${folder}: ${errorText(error)}` };
  }
  if (found === null || !found.isFolder) {
    return { problem: `No folder at ${folder}.` };
  }
  return { value: folder };
}

// Starts a session from valid args; a bad argument or a failed launch is an
// error result, and a bad argument starts nothing. A failed launch or a rejected
// stat also writes a log line.
async function startSession(
  deps: StartSessionToolDeps,
  session: AgentSession,
  args: unknown,
): Promise<ToolResult> {
  const named = (args ?? {}) as StartSessionArgs;
  if (!isNonBlankString(named.prompt)) {
    return errorResult('prompt must be a non-empty string.');
  }
  const profile = chooseProfile(deps, session.id, named.profile);
  if ('problem' in profile) {
    return errorResult(profile.problem);
  }
  const folder = await chooseFolder(deps, session, named.folder);
  if ('problem' in folder) {
    return errorResult(folder.problem);
  }
  let id: string;
  try {
    id = deps.launch({
      projectDir: folder.value,
      profile: profile.value,
      message: { text: named.prompt, images: [] },
    });
  } catch (error) {
    deps.log(`session not started: ${errorText(error)}`);
    return errorResult(`Session not started: ${errorText(error)}`);
  }
  return textResult(
    `Launched session ${id} in ${folder.value} under profile ${profile.value}. A failure to start shows on its row.`,
  );
}

// The `start` chat hands sessions' `contributeTools` with START_SESSION_TOOL:
// each session's calls default to that session's folder, and to its profile
// when the app started it.
export function startSessionToolSession(
  deps: StartSessionToolDeps,
): (session: AgentSession) => ToolSession {
  return (session) => ({
    call(name, args) {
      if (name !== START_SESSION_TOOL.name) {
        return Promise.reject(new Error(`no chat tool "${name}"`));
      }
      return startSession(deps, session, args);
    },
    end: () => undefined,
  });
}
