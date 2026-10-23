// The MCP tool that answers a harness's permission prompts, served to every
// session by the app's MCP server. Claude Code names a plugin's MCP tool
// `mcp__plugin_<plugin>_<server>__<tool>`: the server is `wigley-forms` in the
// marketplace's `wigley` plugin.
export const PERMISSION_TOOL_NAME = 'permission_prompt';
export const CLAUDE_PERMISSION_TOOL = `mcp__plugin_wigley_wigley-forms__${PERMISSION_TOOL_NAME}`;

export interface ControlChoice {
  value: string;
  label: string;
}
// A setting of a running session the harness declares; `value` is null until the harness reports it.
export interface SessionControl {
  id: string;
  label: string;
  choices: ControlChoice[];
  value: string | null;
}

export type ProcessActivity = 'idle' | 'working' | 'waiting';

// An image in a user message: `mediaType` such as `image/png`, `data` the
// file's bytes in base64 with no `data:` prefix.
export interface ChatImage {
  mediaType: string;
  data: string;
}

// What the user sends: `images` go before `text`, in order; either may be
// empty.
export interface UserMessage {
  text: string;
  images: ChatImage[];
}

// `id` is unique within its session; an entry sent again with the same id replaces the earlier one.
// `raw` holds the harness events the entry was built from, oldest first; a harness adapter may leave out
// streaming events whose content the kept events already hold.
export type ChatEntry =
  | {
      kind: 'user';
      id: string;
      text: string;
      images: ChatImage[];
      raw: unknown[];
    }
  | {
      kind: 'assistant';
      id: string;
      text: string;
      streaming: boolean;
      raw: unknown[];
    }
  | {
      kind: 'thinking';
      id: string;
      text: string;
      streaming: boolean;
      raw: unknown[];
    }
  | {
      kind: 'tool';
      id: string;
      toolUseId: string;
      name: string;
      input: unknown;
      summary: string;
      result: { text: string; isError: boolean } | null;
      raw: unknown[];
    }
  | {
      kind: 'permission';
      id: string;
      toolName: string;
      input: unknown;
      answer: { allowed: boolean; reason: string | null } | null;
      raw: unknown[];
    }
  | {
      kind: 'result';
      id: string;
      stopReason: string;
      costUsd: number | null;
      durationMs: number | null;
      raw: unknown[];
    }
  | {
      kind: 'notice';
      id: string;
      text: string;
      tone: 'info' | 'error';
      raw: unknown[];
    }
  | { kind: 'raw'; id: string; raw: unknown[] };

export type ChatEntryKind = ChatEntry['kind'];

// `sessionId` is the host's session id: fresh for a new session, the old one when `resume` is true.
// `profileDir` is the harness's config folder (Claude's `CLAUDE_CONFIG_DIR`) as the profile writes it, which the
// adapter resolves (`~` against the home the adapter was built with); null for the harness default.
export interface AgentStart {
  sessionId: string;
  resume: boolean;
  projectDir: string;
  profileDir: string | null;
}

// An event caused by `start` or by a call on the process arrives in a later
// microtask, never inside that call.
export interface AgentProcessEvents {
  entry(entry: ChatEntry): void;
  controls(controls: SessionControl[]): void;
  activity(activity: ProcessActivity): void;
  // The slash commands and skills the session offers, as typed after `/`.
  // Chat main stores them and the Chat tab's message box offers them after `/`.
  commands(names: string[]): void;
  ended(end: { code: number | null; error: string | null }): void;
}

// `send`, `interrupt` and `setControl` throw after `end`. `setControl` also
// throws for a control or choice the harness did not declare, or when the
// harness cannot change that control now.
export interface AgentProcess {
  send(message: UserMessage): void;
  interrupt(): void;
  setControl(id: string, value: string): void;
  // Resolves once the process has exited, after `ended` has fired.
  end(): Promise<void>;
  // Stops the process at once, mid-turn included, for a caller that cannot
  // wait for `end`, such as an app quit; `ended` follows once it exits.
  kill(): void;
}

// A session the harness saved for a folder. `title` is its first user message, whitespace collapsed to
// single spaces, at most 80 characters (a longer one is its first 79 and `…`), or `Untitled session`;
// `modified` is the transcript's last change, epoch milliseconds.
export interface PastSession {
  sessionId: string;
  title: string;
  modified: number;
}

// A profile's sign-in: `account` is the adapter's one-line label for the
// signed-in account, null when signed out or when the harness names no
// account.
export interface AccountStatus {
  signedIn: boolean;
  account: string | null;
}

// Events of a `logIn`, each in a later microtask, never inside the call that
// caused it. `link` is the page the user opens to sign in when the harness
// cannot open it itself. `ended` fires once, after `cancel` too: `status` is
// the profile's status once the sign-in ends, null when it was cancelled or
// could not be read, and `error` is null only for a finished sign-in.
export interface LogInEvents {
  link(url: string): void;
  ended(end: { status: AccountStatus | null; error: string | null }): void;
}

// A running sign-in. `sendCode` passes the code the sign-in page showed the
// user; `cancel` stops the sign-in. Both do nothing after `ended`.
export interface LogInProcess {
  sendCode(code: string): void;
  cancel(): void;
}

// A folder the harness saved sessions in; `modified` is its newest session's
// last change, epoch milliseconds.
export interface ProjectFolder {
  projectDir: string;
  modified: number;
}

export interface AgentHarness {
  id: string;
  start(request: AgentStart, events: AgentProcessEvents): AgentProcess;
  // Every session the harness saved for `projectDir` under `profileDir` (as `AgentStart` holds it), newest first;
  // [] when none.
  listSessions(
    projectDir: string,
    profileDir: string | null,
  ): Promise<PastSession[]>;
  // The saved session's conversation as chat entries, oldest first. Rejects naming the path when the
  // transcript is missing.
  history(
    sessionId: string,
    projectDir: string,
    profileDir: string | null,
  ): Promise<ChatEntry[]>;
  // Whether `profileDir` (as `AgentStart` holds it) is signed in, and as whom.
  accountStatus(profileDir: string | null): Promise<AccountStatus>;
  // Starts a sign-in to `profileDir`.
  logIn(profileDir: string | null, events: LogInEvents): LogInProcess;
  // Signs `profileDir` out.
  logOut(profileDir: string | null): Promise<void>;
  // Every folder with saved sessions under `profileDir`, newest `modified`
  // first; [] when none.
  listProjects(profileDir: string | null): Promise<ProjectFolder[]>;
}
