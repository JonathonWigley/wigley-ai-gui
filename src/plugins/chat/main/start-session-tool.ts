import type { FileStat } from '../../../contracts/files';
import { errorText } from '../../../shared/error-text';
import type {
  AgentSession,
  ToolDefinition,
  ToolResult,
  ToolSession,
} from '../../sessions/contract';
import type { LaunchRequest } from '../contract';

export const START_SESSION_TOOL: ToolDefinition = {
  name: 'start_session',
  description:
    "Start a new chat session in the Auri app with `prompt` as its first message. It opens in the background as a new row in the side bar, without taking focus, and it spends plan usage like any session. `folder` must be an absolute path to a folder that exists. `folder` and `profile` default to this session's. Returns the new session's id.",
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
          "The absolute path of an existing folder to start in. Defaults to this session's folder.",
      },
      profile: {
        type: 'string',
        description:
          "The name of the chat profile to start under. Defaults to this session's profile.",
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
};

export interface StartSessionToolDeps {
  launch(request: LaunchRequest): string;
  profileOf(sessionId: string): string | null;
  profileNames(): string[];
  isAbsolute(path: string): boolean;
  stat(path: string): Promise<FileStat | null>;
}

interface StartSessionArgs {
  prompt?: unknown;
  folder?: unknown;
  profile?: unknown;
}

// A value an argument settled on, or the problem that stops the call.
type Choice = { value: string } | { problem: string };

function textResult(text: string, isError: boolean): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function chooseProfile(
  deps: StartSessionToolDeps,
  sessionId: string,
  named: unknown,
): Choice {
  if (named === undefined || named === null) {
    const profile = deps.profileOf(sessionId) ?? deps.profileNames().at(0);
    return profile === undefined
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
    return { problem: `Could not read ${folder}: ${errorText(error)}` };
  }
  if (found === null || !found.isFolder) {
    return { problem: `No folder at ${folder}.` };
  }
  return { value: folder };
}

// Starts a session from valid args; a bad argument or a failed launch is an
// error result, and a bad argument starts nothing.
async function startSession(
  deps: StartSessionToolDeps,
  session: AgentSession,
  args: unknown,
): Promise<ToolResult> {
  const named = (args ?? {}) as StartSessionArgs;
  if (!isNonBlankString(named.prompt)) {
    return textResult('prompt must be a non-empty string.', true);
  }
  const profile = chooseProfile(deps, session.id, named.profile);
  if ('problem' in profile) {
    return textResult(profile.problem, true);
  }
  const folder = await chooseFolder(deps, session, named.folder);
  if ('problem' in folder) {
    return textResult(folder.problem, true);
  }
  let id: string;
  try {
    id = deps.launch({
      projectDir: folder.value,
      profile: profile.value,
      message: { text: named.prompt, images: [] },
    });
  } catch (error) {
    return textResult(`Session not started: ${errorText(error)}`, true);
  }
  return textResult(
    `Started session ${id} in ${folder.value} under profile ${profile.value}.`,
    false,
  );
}

// The `start` chat hands sessions' `contributeTools` with START_SESSION_TOOL:
// each session's calls default to that session's folder and profile.
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
