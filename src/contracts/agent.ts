import type { Disposable } from './disposable';
import type { HostedSpawn } from './session-host';

export interface ControlChoice {
  value: string;
  label: string;
}
// A setting of a running session the harness declares; `value` is null until the harness reports it, and while the harness reports none.
// `role` names what the control is, so chat can bind a key to it whatever its id: one of `CONTROL_ROLES`, or any
// other string a harness picks; absent for a control no key binds.
export interface SessionControl {
  id: string;
  label: string;
  choices: ControlChoice[];
  value: string | null;
  role?: string;
}

// The control roles chat binds keys to.
export const CONTROL_ROLES = {
  model: 'model',
  permissionMode: 'permissionMode',
  effort: 'effort',
} as const;

export type ProcessActivity = 'idle' | 'working' | 'waiting';

// A slash command or skill a session offers: `name` and `aliases` as typed
// after `/`, and `description` and `argumentHint` `''` when it has none.
export interface AgentCommand {
  name: string;
  description: string;
  argumentHint: string;
  aliases: string[];
}

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

// How far a user message got toward the model.
// `sent`: a turn took it in, and no response to a request naming it has started.
// `received`: a response to a request naming it has started.
// `notReceived`: it ended, or its process closed, before such a response.
export type UserDelivery = 'sent' | 'received' | 'notReceived';

// `id` is unique among one process's entries (one `start`): a resumed session's new process numbers its
// entries afresh. An entry sent again with the same id replaces the earlier one, which is how a user entry's
// `delivery` changes.
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
      // Null when nothing tracks it: saved history, a harness with no message lifecycle, a slash command that ended
      // with no request naming it.
      delivery: UserDelivery | null;
      raw: unknown[];
    }
  | {
      kind: 'assistant';
      id: string;
      at: number;
      // The agent that wrote the text: MAIN_AGENT_ID for the session's own agent, else the subagent's id the agent
      // events use (Claude: the Agent call's id, the line's `parent_tool_use_id`).
      agentId: string;
      text: string;
      streaming: boolean;
      raw: unknown[];
    }
  | {
      kind: 'thinking';
      id: string;
      at: number;
      // The agent that wrote the text: MAIN_AGENT_ID for the session's own agent, else the subagent's id the agent
      // events use (Claude: the Agent call's id, the line's `parent_tool_use_id`).
      agentId: string;
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
      answer: PermissionDecision | null;
      raw: unknown[];
    }
  | {
      kind: 'result';
      id: string;
      at: number;
      stopReason: string;
      // This turn's cost in USD, null when the harness reports none; an adapter whose harness reports a running total
      // subtracts the previous turn's.
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
  // One per finished compaction (outcome `done`). `afterTokens` is null until the adapter knows the size the compaction
  // left; it then sends the entry again with the same id and `afterTokens` set. A saved transcript's compaction reads
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
  | { kind: 'raw'; id: string; at: number; raw: unknown[] }
  // A kind a harness adds, named `<harness id>:<kind>`. It carries only `raw`, which a renderer the harness's plugin
  // adds decodes; `default` draws it with its `raw` builder.
  | { kind: HarnessEntryKind; id: string; at: number; raw: unknown[] };

// A harness's own entry kind, `<harness id>:<kind>`; no known kind holds a `:`, so the two never meet.
export type HarnessEntryKind = `${string}:${string}`;

export type ChatEntryKind = ChatEntry['kind'];

// The user's answer to a tool call's permission request; `reason` is what a deny tells the agent, null for the
// harness's own default.
export interface PermissionDecision {
  allowed: boolean;
  reason: string | null;
}

// A tool call waiting on the user. `entry` is the permission entry the adapter minted for it, `answer`
// null; `entry.id` is the id `answerPermission` takes, unique among the process's entries.
export interface PermissionRequest {
  entry: Extract<ChatEntry, { kind: 'permission' }>;
}

// `sessionId` null asks the harness for a new conversation, whose id the adapter mints or learns and reports through
// `AgentProcessEvents.sessionId`; a string with `resume` false starts a conversation under that id (a row whose earlier
// start never got a message); a string with `resume` true resumes it. `attach` always gets a string.
// `profileDir` is the config folder of the profile the session runs under, as that harness's profiles setting writes
// it (`HarnessProfile.configDir`), which the adapter resolves (`~` against the home the adapter was built with); null
// for the harness default.
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
// `permissions` is the role-based launch mode chat asks for: `'default'` for the harness's normal launch, `'auto'` for
// its most permissive one. Each adapter maps it to its harness's own launch, and a harness with no permissive mode
// treats `'auto'` as `'default'`.
export interface AgentStart {
  processId: string;
  sessionId: string | null;
  resume: boolean;
  projectDir: string;
  profileDir: string | null;
  controls: Readonly<Record<string, string>>;
  instructions: readonly string[];
  idleCompactMinTokens: number | null;
  rowId: string;
  permissions: 'default' | 'auto';
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
// `spendUsd` is the process's spend so far in USD, cumulative across its turns.
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

// One part of a context source: a file, a skill, a tool, an MCP server. `isPath` is true when `label` is a full path.
export interface ContextSourceItem {
  label: string;
  isPath: boolean;
  tokens: number;
}

// One source of what is in an agent's context, its `items` largest first (empty when the harness names none). `id`
// stays the same for the same source across replies, so a view can keep a source open.
export interface ContextSource {
  id: string;
  label: string;
  tokens: number;
  items: readonly ContextSourceItem[];
}

// Where the main agent's context comes from, as the harness reports it. `sources` hold only what is in context now,
// largest first, and sum to `totalTokens`; `deferredTokens` counts what the harness can load on demand and has not
// (Claude's deferred tools). `autocompactAt` is the limit compaction runs at, the profile's own when it sets one;
// `contextWindow` and `autocompactAt` are null when the harness reports none.
export interface ContextBreakdownAgentEvent {
  type: 'contextBreakdown';
  agentId: string;
  at: number;
  totalTokens: number;
  contextWindow: number | null;
  autocompactAt: number | null;
  deferredTokens: number;
  sources: readonly ContextSource[];
}

// The harness-neutral record of what an agent did, `docs/features/agent-tower/design.md` § Agent events.
// `at` is epoch milliseconds from the adapter's clock. `agentId` is MAIN_AGENT_ID or a subagent's id (Claude: the
// Agent tool call's id).
export type AgentEvent =
  | UsageAgentEvent
  | ContextBreakdownAgentEvent
  | { type: 'sessionStarted'; at: number }
  | { type: 'sessionEnded'; at: number }
  // `name` is the label the agent was given, its type when none; `model` and `effort` are null when unknown. An agent
  // that finished may be spawned again under the same id: it runs again until its next `agentFinished`.
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
      // The profile's autocompact limit for this window, in tokens; null when it sets none or the window is unknown.
      autocompactLimit: number | null;
    }
  // A subagent now runs in the background: its Agent call returned at launch, and it runs on until its `agentFinished`.
  // Its `agentFinished` comes only after every task it owns has its `taskFinished`.
  | { type: 'agentLaunched'; at: number; agentId: string }
  // A process an agent started that runs apart from its turn (a background command). `agentId` is the agent that
  // started it, MAIN_AGENT_ID or a subagent's id. A task outlives its turn and its agent, and a background subagent's
  // end waits for it: it ends only on its own `taskFinished` or `sessionEnded`. `command` is the shell command the task
  // runs, the whole text; null when the harness links the task to none.
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
  // goes out until the adapter knows the after-size: the first `usage` carries it, with `cacheExpiresAt` null unless a
  // main reply set it, and spend or window news from the gap waits for it.
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
  // The id the process's conversation runs under. Each `start` calls it once, before every other event of that
  // process, in a later microtask like every event; each `attach` calls it once, first, before its promise resolves.
  sessionId(id: string): void;
  entry(entry: ChatEntry): void;
  controls(controls: SessionControl[]): void;
  activity(activity: ProcessActivity): void;
  // The OS pid of the session's agent process, once the harness knows it: after
  // `start` once the process runs, and during an `attach` before its promise
  // resolves. At most once per process object; a harness with no OS process of
  // its own never calls it. The process's pid ends with `ended`.
  pid(pid: number): void;
  // The slash commands and skills the session offers, the whole list each time.
  // Chat main stores them and the Chat tab's message box offers them after `/`.
  commands(commands: AgentCommand[]): void;
  // Plan rows the session saw between polls.
  planUsage(update: PlanRowUpdate): void;
  agentEvent(event: AgentEvent): void;
  // The agent queued `message`, which `send` returned `entryId` for, to take in
  // at its running turn's next step (Claude: the message's `queued` lifecycle
  // line). A harness that reports no such step never calls it; the message's
  // entry or `messageDropped` still settles it.
  messageQueued(entryId: string): void;
  // The agent let `message`, which `send` returned `entryId` for, go without
  // taking it in; no entry with that id follows. An attach's replay fires it for
  // every such message in the process's log, including one the caller heard
  // before the attach.
  messageDropped(entryId: string, message: UserMessage): void;
  // A tool call waits on the user's answer. A request still waiting when the process closes is cancelled, and its
  // answered entry comes before `ended`. After `detach` nothing comes. No `entry` comes for a waiting request: its
  // answered entry (same id, `answer` set) comes through `entry` once it is answered or cancelled.
  permission(request: PermissionRequest): void;
  ended(end: { code: number | null; error: string | null }): void;
}

// Chat passes `now` only to a harness whose `capabilities.midTurnSend` is true; to any other it writes the message
// plainly.
export interface SendOptions {
  now?: boolean;
}

// `send`, `interrupt`, `setControl` and `compact` throw after `end`. `setControl` also
// throws for a control or choice the harness did not declare, or when the
// harness cannot change that control now. `interrupt` always ends the running
// turn: the adapter ends it within a grace period whatever the agent answers,
// and a second `interrupt` while that grace is pending ends the process. It also
// stops every running subagent and background task, with a turn running or none.
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
  // `now` asks the agent to take the message in at once, ending its running
  // turn's tool or reply rather than waiting for the turn's next step; messages
  // sent now back to back run as one turn. Chat passes `now` only to a harness whose `capabilities.midTurnSend` is
  // true; to any other it writes the message plainly.
  send(message: UserMessage, options?: SendOptions): string;
  interrupt(): void;
  setControl(id: string, value: string): void;
  // Starts a compaction with trigger `app`. It makes no user entry. It throws while the process is not idle. A
  // `compact()` that returns is always followed by a `compactionStarted` and `compactionEnded` pair, even when none ran.
  // The pair arrives asynchronously, after `compact()` returns.
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
  // Answers the request `requestId` that `permission` raised. Does nothing for an id that is not waiting (answered,
  // cancelled or unknown), logging it; it does not throw after `end`, since an answer may race the process's end.
  answerPermission(requestId: string, decision: PermissionDecision): void;
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

// What a harness can do, each flag required so every adapter declares each one. `interrupt`: `AgentProcess.interrupt`
// ends a running turn; `resume`: a saved session starts again; `images`: a user message carries images;
// `midTurnSend`: `SendOptions.now` reaches the agent mid-turn.
export interface HarnessCapabilities {
  interrupt: boolean;
  resume: boolean;
  images: boolean;
  midTurnSend: boolean;
}

// The declarations a harness publishes in `core.agentHarnesses`; JSON-safe. `label` names the harness to the user;
// `clearAliases` are the names typed after `/` that clear the session beside the app's own `clear`;
// `projectConfigFolder` is the folder name the harness reads in a project (`.claude` for Claude); `profiles` are the
// profiles a session can run under, in the harness's settings order; the registry's slot entry leaves out each name
// an earlier registered harness holds, and the later of a name the harness lists twice.
// `unlisted`: true for a harness the app runs sessions on but never offers or polls: no reader that offers a profile
// to the user or an agent, or polls a profile, lists it; chat still launches on its profiles.
export interface AgentHarnessInfo {
  label: string;
  capabilities: HarnessCapabilities;
  clearAliases: readonly string[];
  projectConfigFolder: string;
  profiles: readonly HarnessProfile[];
  unlisted?: true;
}

// A profile a session can run under: `name` is unique across harnesses, `configDir` the harness's config folder as
// its profiles setting writes it, `~/` unexpanded.
export interface HarnessProfile {
  name: string;
  configDir: string;
}

// A profile's config folder (as `AgentHarness.configFolder` resolves it) and the folders the harness caches its
// installed plugins in.
export interface HarnessConfigRoots {
  configDir: string;
  pluginCacheDirs: readonly string[];
}

// One install of a plugin in a profile, as the harness lists it: `key` the harness's name for the plugin,
// `installDir` the install's folder, `version` null when the harness names none; `listedAt` the config file and
// 1-based line that list the key, null when no line does.
export interface InstalledPlugin {
  key: string;
  installDir: string;
  version: string | null;
  listedAt: { path: string; line: number } | null;
}

export interface AgentHarness {
  readonly id: string;
  // The harness's declarations as they stand now; the registry publishes them at `register` and at each `refresh`.
  info(): AgentHarnessInfo;
  // The controls a session started now under `profileDir` with empty `AgentStart.controls` begins with, each `value`
  // that start's, null when the harness cannot know it before start. A running process reports its own through
  // `AgentProcessEvents.controls`.
  controls(profileDir: string | null): SessionControl[];
  // The tool-use id the harness put in an MCP call's `_meta`; null when `meta` is null or holds none.
  toolUseIdOf(meta: Readonly<Record<string, unknown>> | null): string | null;
  // `profileDir`'s (as `AgentStart` holds it) config and plugin-cache folders; `configDir` is `configFolder`'s.
  configRoots(profileDir: string | null): HarnessConfigRoots;
  // Every plugin install `profileDir` (as `AgentStart` holds it) lists, in the harness's file order; [] when none or
  // when the harness's list cannot be read, which the adapter logs. Never rejects.
  installedPlugins(profileDir: string | null): Promise<InstalledPlugin[]>;
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
  // The name the harness itself shows for the saved session, such as one the user gave it in a terminal; null when it
  // has none yet. Rejects naming the path when the transcript is missing.
  sessionName(
    sessionId: string,
    projectDir: string,
    profileDir: string | null,
  ): Promise<string | null>;
  // The config folder `profileDir` (as `AgentStart` holds it) names, as the harness resolves it; null names the
  // harness's own default folder, whatever the app's environment sets.
  configFolder(profileDir: string | null): string;
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
  // A start of `request` that the session host runs later. Its `stdin` holds the lines `start` writes when a process
  // opens, then `firstMessage`. Its `env` holds `env`, the harness's own values and the names the adapter carries from
  // the app's environment; its `unsetEnv` the names the child must not inherit. Spawns and writes nothing; it may
  // look up the harness's program. Rejects where `start` would fail before spawning, and on a control value the
  // harness does not offer for a control whose values it checks. `request.resume` is false and `request.sessionId`
  // is set.
  prepareRun(
    request: AgentStart,
    firstMessage: UserMessage,
    env: Readonly<Record<string, string>>,
  ): Promise<HostedSpawn>;
  // The controls a new session starts from: each declared control with its choices and `value` null.
  startControls(): SessionControl[];
  // `controls` with each permission control lowered to `cap`'s value where `controls` grants more. A permission
  // control `cap` has no value for caps at the harness's launch default. Other controls stay as `controls` has them.
  capControls(
    controls: Readonly<Record<string, string>>,
    cap: Readonly<Record<string, string>>,
  ): Record<string, string>;
}

// One harness's place in the registry. `refresh` publishes the adapter's `info()` again after its declarations
// change, and does nothing after `dispose`; a second `dispose` does nothing.
export interface AgentHarnessRegistration extends Disposable {
  refresh(): void;
}

// Every harness the app runs, behind `services.agentHarnesses`. `register` throws when a live registration holds the
// harness's id, and changes nothing then. `list` is in registration order; `get` is null for an id no live
// registration holds. A harness is in `list` and `get` before the registry sets its `core.agentHarnesses` key, and
// out of them before it deletes that key.
export interface AgentHarnessRegistry {
  register(harness: AgentHarness): AgentHarnessRegistration;
  list(): readonly AgentHarness[];
  get(id: string): AgentHarness | null;
}
