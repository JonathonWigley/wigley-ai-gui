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

// `id` is unique among one process's entries (one `start`): a resumed session's new process numbers its
// entries afresh. An entry sent again with the same id replaces the earlier one.
// `at` is when the entry first appeared, epoch milliseconds; a later version of the entry (same id) keeps its first
// `at`.
// `raw` holds the harness events the entry was built from, oldest first; a harness adapter may leave out
// streaming events whose content the kept events already hold.
export type ChatEntry =
  | {
      kind: 'user';
      id: string;
      at: number;
      text: string;
      images: ChatImage[];
      raw: unknown[];
    }
  | {
      kind: 'assistant';
      id: string;
      at: number;
      text: string;
      streaming: boolean;
      raw: unknown[];
    }
  | {
      kind: 'thinking';
      id: string;
      at: number;
      text: string;
      streaming: boolean;
      raw: unknown[];
    }
  | {
      kind: 'tool';
      id: string;
      at: number;
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
      at: number;
      toolName: string;
      input: unknown;
      answer: { allowed: boolean; reason: string | null } | null;
      raw: unknown[];
    }
  | {
      kind: 'result';
      id: string;
      at: number;
      stopReason: string;
      costUsd: number | null;
      durationMs: number | null;
      raw: unknown[];
    }
  | {
      kind: 'notice';
      id: string;
      at: number;
      text: string;
      tone: 'info' | 'error';
      raw: unknown[];
    }
  | { kind: 'raw'; id: string; at: number; raw: unknown[] };

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

export type PlanSeverity = 'normal' | 'warning' | 'critical';

// One plan window as the server reports it. `percent` is 0–100; `resetsAt` is epoch ms, null when unknown;
// `label` is the server's model or surface name for a scoped row, else the adapter's name for the kind.
export interface PlanRow {
  kind: string;
  group: string;
  label: string;
  percent: number;
  resetsAt: number | null;
  severity: PlanSeverity;
  isActive: boolean;
}

// The plan's overage credits, amounts in minor units of `currency`, a three-letter ISO 4217 code; each null when the
// server sends none (or, for `currency`, sends another shape).
export interface ExtraUsage {
  enabled: boolean;
  usedMinor: number | null;
  limitMinor: number | null;
  currency: string | null;
}

// One profile's plan usage from one poll: `rows` in the server's order, `at` epoch ms when the poll started.
export interface PlanUsage {
  rows: readonly PlanRow[];
  extraUsage: ExtraUsage | null;
  at: number;
}

export type PlanRowPatch = Pick<
  PlanRow,
  'kind' | 'percent' | 'resetsAt' | 'severity'
>;

// The rows one session saw between polls; the caller folds them into the poll's rows by `kind`.
export interface PlanRowUpdate {
  rows: readonly PlanRowPatch[];
  at: number;
}

// `configured` is the profile's own autocompact limit, `reported` the harness's; tokens, each null when unknown.
export interface AutocompactLimits {
  configured: number | null;
  reported: number | null;
}

// One agent's context and spend. `agentId` is `main` for the session's own agent; `contextWindow` is null until the
// harness reports it and `spendUsd` until the first turn ends; `cacheExpiresAt` is epoch ms, null when unknown.
export interface UsageAgentEvent {
  type: 'usage';
  agentId: string;
  at: number;
  contextTokens: number;
  contextWindow: number | null;
  autocompact: AutocompactLimits;
  cacheExpiresAt: number | null;
  spendUsd: number | null;
}

export const MAIN_AGENT_ID = 'main';

// The harness-neutral record of what an agent did, `docs/features/agent-tower/design.md` § Agent events.
// `at` is epoch milliseconds from the adapter's clock. `agentId` is MAIN_AGENT_ID or a subagent's id (Claude: the
// Agent tool call's id).
export type AgentEvent =
  | UsageAgentEvent
  | { type: 'sessionStarted'; at: number }
  | { type: 'sessionEnded'; at: number }
  | {
      type: 'agentSpawned';
      at: number;
      agentId: string;
      parentAgentId: string;
      agentType: string;
      description: string;
    }
  | {
      type: 'agentFinished';
      at: number;
      agentId: string;
      outcome: 'done' | 'failed';
    }
  | {
      type: 'toolStarted';
      at: number;
      agentId: string;
      toolUseId: string;
      tool: string;
    }
  | {
      type: 'toolFinished';
      at: number;
      agentId: string;
      toolUseId: string;
      ok: boolean;
    }
  | {
      type: 'compacted';
      at: number;
      beforeTokens: number;
      afterTokens: number | null;
    }
  | { type: 'userMessage'; at: number };

export type AgentEventType = AgentEvent['type'];

// An event caused by `start` or by a call on the process arrives in a later
// microtask, never inside that call.
export interface AgentProcessEvents {
  entry(entry: ChatEntry): void;
  controls(controls: SessionControl[]): void;
  activity(activity: ProcessActivity): void;
  // The slash commands and skills the session offers, as typed after `/`.
  // Chat main stores them and the Chat tab's message box offers them after `/`.
  commands(names: string[]): void;
  // Plan rows the session saw between polls.
  planUsage(update: PlanRowUpdate): void;
  agentEvent(event: AgentEvent): void;
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
  // Runs one poll of `profileDir`'s plan usage, or rejects with the reason.
  planUsage(profileDir: string | null): Promise<PlanUsage>;
}
