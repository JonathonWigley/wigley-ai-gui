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

// What started a compaction: `app`, the app called `AgentProcess.compact()`; `manual`, the user sent `/compact`;
// `harness`, the harness compacted on its own.
export type CompactionTrigger = 'app' | 'manual' | 'harness';

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
      // The agent that made the call: MAIN_AGENT_ID for the session's own agent, else the subagent's id the agent
      // events use (Claude: the Agent call's id, the line's `parent_tool_use_id`).
      agentId: string;
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
  // One per finished compaction (outcome `done`). `afterTokens` is null until the next main reply after the compaction;
  // the adapter then sends the entry again with the same id and `afterTokens` set. A saved transcript's compaction reads
  // back with trigger `manual` or `harness`, never `app`.
  | {
      kind: 'compaction';
      id: string;
      at: number;
      trigger: CompactionTrigger;
      beforeTokens: number | null;
      afterTokens: number | null;
      durationMs: number | null;
      raw: unknown[];
    }
  | { kind: 'raw'; id: string; at: number; raw: unknown[] };

export type ChatEntryKind = ChatEntry['kind'];

// `sessionId` is the host's session id: fresh for a new session, the old one when `resume` is true.
// `profileDir` is the harness's config folder (Claude's `CLAUDE_CONFIG_DIR`) as the profile writes it, which the
// adapter resolves (`~` against the home the adapter was built with); null for the harness default.
// `controls` maps a control id to the value the row holds, for the row's mode and for each model or effort the user
// picked in the row once the process confirmed the pick, leaving out a null `value`; the adapter starts with each value
// it knows and ignores an id it does not declare.
// `instructions` is text the session's agent is told before its first message, in the order its registrations were
// made; [] when none. Each adapter hands it to its harness in that harness's own way.
// `processId` is the hosted process id chat chooses for this start.
// `idleCompactMinTokens` is the context size above which the harness may compact an idle session on its own; null
// leaves the harness's default.
// `rowId` is the app's id for the session's row, which `/clear` keeps while `sessionId` changes; each adapter hands it
// to its harness's environment for tools that track the row, such as `unity-pool`.
export interface AgentStart {
  processId: string;
  sessionId: string;
  resume: boolean;
  projectDir: string;
  profileDir: string | null;
  controls: Readonly<Record<string, string>>;
  instructions: readonly string[];
  idleCompactMinTokens: number | null;
  rowId: string;
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
  // `name` is the label the agent was given, its type when none; `model` and `effort` are null when unknown.
  | {
      type: 'agentSpawned';
      at: number;
      agentId: string;
      parentAgentId: string;
      agentType: string;
      description: string;
      name: string;
      model: string | null;
      effort: string | null;
    }
  | {
      type: 'agentFinished';
      at: number;
      agentId: string;
      outcome: 'done' | 'failed';
    }
  // A subagent's model, spend and context, on each of its replies, on an Agent call's receipt that names its resolved
  // model, and when a turn's end changes its model's context window. `model` is the model id Claude used (the reply's, or the receipt's resolved model);
  // `spendUsd` is the agent's estimated spend so far (cumulative, not the reply's share), null before its first reply or
  // when any reply's model has no list price; `contextTokens` is the input side of its latest reply, null before its
  // first reply; `contextWindow` is its model's context window, null until the harness reports it.
  | {
      type: 'agentReplied';
      at: number;
      agentId: string;
      model: string;
      spendUsd: number | null;
      contextTokens: number | null;
      contextWindow: number | null;
    }
  // A subagent now runs in the background: its Agent call returned at launch, and it runs on until its `agentFinished`.
  | { type: 'agentLaunched'; at: number; agentId: string }
  // A process an agent started that runs apart from its turn (a background command). `agentId` is the agent that
  // started it, MAIN_AGENT_ID or a subagent's id. A task outlives its turn and its agent: it ends only on its own
  // `taskFinished` or `sessionEnded`. `command` is the shell command the task runs, the whole text; null when the
  // harness links the task to none.
  | {
      type: 'taskStarted';
      at: number;
      taskId: string;
      agentId: string;
      description: string;
      command: string | null;
    }
  // A task's end; nothing else ends a task but `sessionEnded`.
  | {
      type: 'taskFinished';
      at: number;
      taskId: string;
      outcome: 'done' | 'failed';
    }
  // `summary` is the tool call's one-line description, the tool ChatEntry's `summary`.
  | {
      type: 'toolStarted';
      at: number;
      agentId: string;
      toolUseId: string;
      tool: string;
      summary: string;
    }
  | {
      type: 'toolFinished';
      at: number;
      agentId: string;
      toolUseId: string;
      ok: boolean;
    }
  // A compaction started. Exactly one `compactionEnded` with the same trigger follows: on the harness's end line, on a
  // failed compaction, on an interrupt (within the interrupt grace), and before `sessionEnded` when the process ends
  // during it.
  | { type: 'compactionStarted'; at: number; trigger: CompactionTrigger }
  // `beforeTokens` is the context size when the compaction ran, null when the harness does not report it or the outcome
  // is not `done`. `durationMs` is how long it ran, null when unknown. After a compaction's boundary no main `usage`
  // goes out until the next main reply: that reply's `usage` is the first to carry the after-size, and spend or window
  // news from the gap waits for it.
  | {
      type: 'compactionEnded';
      at: number;
      trigger: CompactionTrigger;
      outcome: 'done' | 'failed' | 'interrupted';
      beforeTokens: number | null;
      durationMs: number | null;
    }
  | { type: 'userMessage'; at: number }
  // A skill or slash command started: the agent called its Skill tool, or the user's sent message began with `/`.
  // `skill` has no leading `/` (`wigley:make`); `args` is trimmed, `''` when none.
  | {
      type: 'skillStarted';
      at: number;
      agentId: string;
      skill: string;
      args: string;
    }
  // A write tool (Write, Edit and the others the adapter names) finished without an error. `path` is the full path as
  // the tool got it.
  | { type: 'fileWritten'; at: number; agentId: string; path: string }
  // A turn of the main conversation started. Every turn emits it, a turn the harness runs with no user message
  // included (Claude: each turn's `system/init`, the turn after a background subagent ends included).
  | { type: 'turnStarted'; at: number }
  // The main conversation's turn ended, done, failed or interrupted.
  | { type: 'turnEnded'; at: number };

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
  // The agent let `message`, which `send` returned `entryId` for, go without
  // taking it in; no entry with that id follows. An attach's replay fires it for
  // every such message in the process's log, including one the caller heard
  // before the attach.
  messageDropped(entryId: string, message: UserMessage): void;
  ended(end: { code: number | null; error: string | null }): void;
}

// `send`, `interrupt`, `setControl` and `compact` throw after `end`. `setControl` also
// throws for a control or choice the harness did not declare, or when the
// harness cannot change that control now. `interrupt` always ends the running
// turn: the adapter ends it within a grace period whatever the agent answers,
// and a second `interrupt` while that grace is pending ends the process.
export interface AgentProcess {
  // Returns the id of the user entry the harness emits for `message`. That
  // entry arrives through `entry` once the agent takes the message in, which
  // may be later than the call and is never before `send` returns. A send
  // during a running turn hands the message to the agent at once, and the
  // agent decides when its turn takes it in. `messageDropped` names an id
  // whose entry will never come, and also arrives only after `send` returns.
  // A message whose entry has not come when `ended` fires gets neither: the
  // process's end lets it go. One written before an `attach`, which the caller
  // never passed to this process's `send`, gets `messageDropped` before `ended`.
  send(message: UserMessage): string;
  interrupt(): void;
  setControl(id: string, value: string): void;
  // Starts a compaction with trigger `app`. It makes no user entry. It throws while the process is not idle. A
  // `compact()` that returns is always followed by a `compactionStarted` and `compactionEnded` pair, even when none ran.
  compact(): void;
  // Resolves once the process has exited, after `ended` has fired.
  end(): Promise<void>;
  // Stops the process at once, mid-turn included, for a caller that cannot
  // wait for `end`; `ended` follows once it exits.
  kill(): void;
  // Stops this process object's events and timers and leaves the hosted process
  // running; a pending `end` settles, with no `ended`. Chat calls it on quit and on
  // a chat plugin stop, in place of `kill`.
  detach(): void;
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
  // Attaches to the hosted process `request.processId`. Every event it fires before its promise resolves is replayed,
  // except what a process that exited during the attach fires for that exit, its `sessionEnded` and `ended` included.
  // Null when the host holds no running process with that id.
  attach(
    request: AgentStart,
    events: AgentProcessEvents,
  ): Promise<AgentProcess | null>;
  // Every session the harness saved for `projectDir` under `profileDir` (as `AgentStart` holds it), newest first;
  // [] when none.
  listSessions(
    projectDir: string,
    profileDir: string | null,
  ): Promise<PastSession[]>;
  // The saved session's conversation as chat entries, oldest first. Rejects naming the path when the
  // transcript is missing. `before`: only entries the transcript recorded before that epoch ms; null reads them all.
  history(
    sessionId: string,
    projectDir: string,
    profileDir: string | null,
    before: number | null,
  ): Promise<ChatEntry[]>;
  // The main agent's `usage` event as the saved session's main replies since the last compaction left it: `at` is the
  // last main reply's time; the window, both limits and spend are null. Null when the session has no main reply since
  // the last compaction. Rejects naming the path when the transcript is missing.
  lastUsage(
    sessionId: string,
    projectDir: string,
    profileDir: string | null,
  ): Promise<UsageAgentEvent | null>;
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
