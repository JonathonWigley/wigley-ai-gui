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
import type { ChatProject, LaunchRequest } from '../contract';

export const START_SESSION_TOOL: ToolDefinition = {
  name: 'start_session',
  description:
    "Start a new, independent chat session in the Auri app with `prompt` as its first message. It opens in the background as a new row in the side bar, without taking focus. It is a full agent session running the user's whole agent setup, not a lightweight subagent: even a one-word prompt spends tens of thousands of tokens of the user's plan, so start one only when the work needs its own session. It runs on the agent harness of the profile it starts under: this session's harness when the app started this session, else the app's default harness. It runs on its own: its output does not come back here, and this tool cannot message or end it. Name where it starts with `folder` or `project`, not both; with neither it starts in this session's folder when there is one. `folder` must be an absolute path to a folder that exists. `project` names one of the app's projects: a folder project starts in its folder, and a Unity pool project starts in the pool's lowest-numbered clone and claims no clone, so name the branch in `prompt` when the work needs one. `profile` defaults to the project's own profile when it has one, else to this session's when the app started this session, else to the first profile of the app's default harness; a project with its own profile refuses any other. Returns the new session's id.",
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
          "The absolute path of an existing folder to start in, in place of project. Defaults to this session's folder, when it has one.",
      },
      project: {
        type: 'string',
        description:
          "The name of one of the app's projects to start in, in place of folder.",
      },
      profile: {
        type: 'string',
        description:
          "The name of the chat profile to start under. Defaults to this session's when the app started this session, else to the first profile of the app's default harness.",
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
};

export interface StartSessionToolDeps {
  launch(request: LaunchRequest): string;
  // Whether the calling session is headless; its launch copies the flag.
  isHeadless(sessionId: string): boolean;
  // The profile of the calling session when chat owns it, else the first
  // profile of chat's default harness.
  defaultProfile(sessionId: string | null): string | null;
  // Every registered harness's profile names, in registration order.
  profileNames(): string[];
  // Chat's checked projects, read at each call for a project's own profile.
  projects(): readonly ChatProject[];
  isAbsolute(path: string): boolean;
  stat(path: string): Promise<FileStat | null>;
  log(line: string): void;
}

interface StartSessionArgs {
  prompt?: unknown;
  folder?: unknown;
  profile?: unknown;
  project?: unknown;
}

// The project the args name, null when absent.
type ProjectChoice = { project: string | null } | { problem: string };

// A value an argument settled on, or the problem that stops the call.
type Choice = { value: string } | { problem: string };

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isAbsent(value: unknown): value is undefined | null {
  return value === undefined || value === null;
}

// The named profile is passed on even when it differs from the project's own,
// so chat's launch refuses it in one place.
function chooseProfile(
  deps: StartSessionToolDeps,
  sessionId: string,
  named: unknown,
  project: string | null,
): Choice {
  if (isAbsent(named)) {
    const own = deps.projects().find((each) => each.name === project)?.profile;
    const profile = own ?? deps.defaultProfile(sessionId);
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

function chooseProject(named: StartSessionArgs): ProjectChoice {
  const isFolderNamed = !isAbsent(named.folder);
  const isProjectNamed = !isAbsent(named.project);
  if (isFolderNamed && isProjectNamed) {
    return { problem: 'Name folder or project, not both.' };
  }
  if (isProjectNamed && !isNonBlankString(named.project)) {
    return { problem: 'project must be a non-empty string.' };
  }
  return { project: isProjectNamed ? (named.project as string) : null };
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
// stat also writes a log line. A call naming a project stats no folder.
async function startSession(
  deps: StartSessionToolDeps,
  session: AgentSession,
  args: unknown,
): Promise<ToolResult> {
  const named = (args ?? {}) as StartSessionArgs;
  if (!isNonBlankString(named.prompt)) {
    return errorResult('prompt must be a non-empty string.');
  }
  const target = chooseProject(named);
  if ('problem' in target) {
    return errorResult(target.problem);
  }
  const { project } = target;
  const profile = chooseProfile(deps, session.id, named.profile, project);
  if ('problem' in profile) {
    return errorResult(profile.problem);
  }
  const fields = {
    profile: profile.value,
    message: { text: named.prompt, images: [] },
    headless: deps.isHeadless(session.id),
  };
  let request: LaunchRequest;
  let launchedText: (id: string) => string;
  if (project !== null) {
    request = { project, ...fields };
    launchedText = (id) =>
      `Launched session ${id} in project ${project} under profile ${profile.value}. A failure to start shows on its row.`;
  } else {
    const folder = await chooseFolder(deps, session, named.folder);
    if ('problem' in folder) {
      return errorResult(folder.problem);
    }
    request = { projectDir: folder.value, ...fields };
    launchedText = (id) =>
      `Launched session ${id} in ${folder.value} under profile ${profile.value}. A failure to start shows on its row.`;
  }
  let id: string;
  try {
    id = deps.launch(request);
  } catch (error) {
    deps.log(`session not started: ${errorText(error)}`);
    return errorResult(`Session not started: ${errorText(error)}`);
  }
  return textResult(launchedText(id));
}

// The `start` chat hands sessions' `contributeTools` with START_SESSION_TOOL:
// each session's calls default to that session's folder, and to its profile
// when the app started it. A call naming a project starts there, under the
// project's profile when it has one.
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
