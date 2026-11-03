import {
  MAIN_AGENT_ID,
  type AccountStatus,
  type AgentEvent,
  type AgentHarness,
  type AgentProcess,
  type AgentProcessEvents,
  type AgentStart,
  type ChatEntry,
  type ChatImage,
  type LogInEvents,
  type LogInProcess,
  type PastSession,
  type PlanRowUpdate,
  type PlanUsage,
  type ProjectFolder,
  type SessionControl,
  type UsageAgentEvent,
} from '../contracts/agent';
import type { Clock, Timers } from '../contracts/ambient';
import type { Files } from '../contracts/files';
import { createEntryStamp, type EntryDraft } from './entry-stamp';
import { errorText } from './error-text';
import {
  SAMPLE_VISUALS_OPEN_TEXT,
  SAMPLE_VISUALS_TEXT,
} from './sample-visuals';
import { typedSkill } from './typed-skill';

// A scripted harness behind `AgentHarness`, for the tests and the self-test.
// Every emission runs in a microtask the causing call queues, never inside the
// call, so a caller's state is in place before its events arrive. Each emitted
// entry carries the clock's time when its id first arrived; `history` entries
// carry fixed times one second apart. Every finished turn reports a `usage`
// agent event and a plan row update after its result, and `planUsage` answers
// every profile with `fakePlanUsage`. The process emits the agent events Claude
// would for what it simulates, each at the clock's time: `sessionStarted` first,
// `userMessage` after each user entry, then `skillStarted` for a typed
// `/<skill>` message and `turnStarted` for every send that runs a turn, tool
// and subagent events (`agentReplied` included) beside their entries,
// `taskStarted` and `taskFinished`
// for background tasks, `turnEnded` when a turn closes or is interrupted, and
// `sessionEnded` just before each `ended`. A process `attach` resolves opens with
// none of `start`'s emissions: the test's replay stands for them. Once a process
// has detached, it emits nothing. The workflow
// sends (`FAKE_WORKFLOW_FEATURE_TEXT`, `/wigley:make <plan folder>`,
// `FAKE_WORKFLOW_STEP_TEXT`) change a fake plan through the injected `files`.

// A send of this text opens a turn that stays open until `interrupt` or `end`.
export const FAKE_HOLD_TEXT = 'fake: hold';
// A send of this text runs one tool before the reply.
export const FAKE_TOOL_TEXT = 'fake: tool';
// A send of this text streams a reply holding two visuals, holds it with the
// second block still open for `FAKE_VISUAL_HOLD_MS`, then sends the whole
// reply; an interrupt during the hold ends the turn as a held turn's does,
// and a send, end or kill during it drops the rest of the reply.
export const FAKE_VISUAL_TEXT = 'fake: visual';
export const FAKE_VISUAL_HOLD_MS = 1500;
// A send of this text runs six finished tools, one failed, and a thought, then
// stays open as `FAKE_HOLD_TEXT`'s turn does.
export const FAKE_STEPS_TEXT = 'fake: steps';
// A send of this text spawns two subagents, each running one tool, then stays
// open as `FAKE_HOLD_TEXT`'s turn does. The subagents run until an interrupt
// (failed), the next send other than `FAKE_END_TEXT` (done) or the process's
// end (no `agentFinished`). An interrupt or send queued before the end still
// finishes them. The turn also starts two tasks, one owned by `main` and one by
// the first subagent; the next send leaves them running, and an interrupt of an
// open turn, this one or a later one, ends them (failed); the process's end
// sends no `taskFinished`, since `sessionEnded` ends a roster's running items.
// Real Claude may keep a background Bash past an interrupt; the fake ends it to
// keep the self-test row's count exact.
export const FAKE_AGENTS_TEXT = 'fake: agents';
// A send of this text ends the process on its own, as a CLI that exits.
export const FAKE_END_TEXT = 'fake: end';
// A send of this text starts one Bash tool, asks its permission through the
// harness's `askPermissionsWith` ask, then finishes the tool, allowed or
// refused, and replies. The turn stays open while the ask waits.
export const FAKE_PERMISSION_TEXT = 'fake: permission';
// A send of this text, or `/wigley:feature ` before it, runs a wigley:feature
// turn that writes `fakeWorkflowPlan(0, 0)` at `FAKE_WORKFLOW_PLAN_PATH` under
// the process's project folder.
export const FAKE_WORKFLOW_FEATURE_TEXT = 'fake: workflow feature';
// After `/wigley:make <that plan's folder>`, each send of this text runs the
// next make step: a tick, a tick with a review round, then the folder removed.
export const FAKE_WORKFLOW_STEP_TEXT = 'fake: workflow step';
// Relative to the process's project folder.
export const FAKE_WORKFLOW_PLAN_PATH =
  'docs/features/fake-flow/plan-fake-flow/plan.md';
export const FAKE_WORKFLOW_TITLE = 'Fake flow';
// The link every `logIn` reports, and the one code that finishes it.
export const FAKE_SIGN_IN_URL = 'https://example.invalid/fake-sign-in';
export const FAKE_SIGN_IN_CODE = 'fake-code';
// The account every profile is signed in as until `logOut`.
const FAKE_ACCOUNT = 'fake@example.invalid';
const SIGNED_OUT: AccountStatus = { signedIn: false, account: null };
// The `at` of a fake past session's first history entry.
const FAKE_HISTORY_AT = 1767236645000;

// The tool call a `FAKE_PERMISSION_TEXT` turn asks permission for.
export interface FakePermissionCall {
  toolName: string;
  input: unknown;
  toolUseId: string;
}

// Asks the user whether the process `request` started may run `call`, as
// Claude Code asks through chat's permission tool; resolves to whether it was
// allowed.
export type FakePermissionAsk = (
  request: AgentStart,
  call: FakePermissionCall,
) => Promise<boolean>;

export type FakeAgentCall =
  | { method: 'send'; text: string; imageCount: number }
  | { method: 'interrupt' }
  | { method: 'setControl'; id: string; value: string }
  | { method: 'end' }
  | { method: 'kill' }
  | { method: 'detach' };

// `request` and `events` are the very objects `start` or `attach` received;
// `calls` lists every call on the process in call order, refused ones included.
// `attached` marks a process `attach` resolved; `detached` one `detach` was called
// on.
export interface FakeAgentProcessRecord {
  request: AgentStart;
  events: AgentProcessEvents;
  calls: FakeAgentCall[];
  ended: boolean;
  attached: boolean;
  detached: boolean;
}

// The outcome of one `attach`. `process` fires `replay` before the promise
// resolves and starts the process's turn counter at `turns` (0 when left out), so
// its ids follow the ones the replay used.
export type FakeAttachScript =
  | {
      outcome: 'process';
      turns?: number;
      replay(events: AgentProcessEvents): void;
    }
  | { outcome: 'null' }
  | { outcome: 'reject'; message: string };

// The sessions `listSessions` returns for every folder and profile, newest
// first; `history` answers for these ids alone.
export const FAKE_PAST_SESSIONS: readonly PastSession[] = [
  {
    sessionId: '00000000-0000-4000-8000-000000000001',
    title: 'fake past session one',
    modified: 1767323045000,
  },
  {
    sessionId: '00000000-0000-4000-8000-000000000002',
    title: 'fake past session two',
    modified: 1767236645000,
  },
];

// One `listSessions` or `history` call; `sessionId` and `before` are null for
// `listSessions`.
export interface FakePastSessionCall {
  method: 'listSessions' | 'history';
  sessionId: string | null;
  projectDir: string;
  profileDir: string | null;
  before: number | null;
}

// `processes` holds one record per `start` that did not throw and per `attach`
// that resolved a process, in call order: the same array for the harness's life,
// each record changing in place. `attachCalls` lists every `attach` request in
// call order. `scriptAttach` sets the outcome of the next `attach` for that
// process id, once, replacing an unused script; with none, `attach` resolves null.
// `failNextStart` makes the next `start` throw `message`. Every `end` on a
// process returns the promise its first `end` returned, or, once a
// `FAKE_END_TEXT` send ended it, the promise of that exit. Between `holdEnd`
// and `releaseEnd`, a first `end` marks its process ended and leaves that
// promise pending; `releaseEnd` emits `ended` for each held process in call
// order and resolves them. A `FAKE_END_TEXT` exit is never held.
// `pastSessionCalls` lists every `listSessions` and `history` call in call
// order, failed ones included; `history` returns the entries timed before its
// `before`, all for null; `failNextHistory` makes the next `history` reject
// `message`. Every profile starts signed in as `fake@example.invalid`;
// `logOut` signs it out and a `logIn` given `FAKE_SIGN_IN_CODE` signs it back
// in. `listProjects` lists the folders `start` ran under the profile, the last
// started first. `planUsage` resolves `fakePlanUsage` at the clock's time in a
// later microtask; `failNextPlanUsage` makes the next one reject `message`.
// `lastUsage` resolves the event `setLastUsage` gave its session id, null for
// an id given none; `failNextLastUsage` makes the next one reject `message`,
// and `holdNextLastUsage` makes the next one wait until the release it returns
// runs. `lastUsageCalls` lists every `lastUsage` call's session id in call
// order, failed ones included. The fake's processes emit no startup `usage`.
// `timers` runs the `fake: visual` hold. `askPermissionsWith` sets the ask a
// `fake: permission` turn calls, replacing any earlier one; with none set, the
// turn's tool fails.
export interface FakeAgentHarness extends AgentHarness {
  readonly processes: readonly FakeAgentProcessRecord[];
  readonly attachCalls: readonly AgentStart[];
  scriptAttach(processId: string, script: FakeAttachScript): void;
  readonly pastSessionCalls: readonly FakePastSessionCall[];
  failNextStart(message: string): void;
  failNextHistory(message: string): void;
  failNextPlanUsage(message: string): void;
  readonly lastUsageCalls: readonly string[];
  setLastUsage(sessionId: string, event: UsageAgentEvent | null): void;
  failNextLastUsage(message: string): void;
  holdNextLastUsage(): () => void;
  holdEnd(): void;
  releaseEnd(): void;
  askPermissionsWith(ask: FakePermissionAsk): void;
}

// Timers for tests that never look at a fake's hold: each `set` runs its `run`
// in a microtask, whatever its `ms`, unless `clear` took its handle first.
export const FAKE_MICROTASK_TIMERS: Timers = (() => {
  let lastHandle = 0;
  const cleared = new Set<number>();
  return {
    set(run) {
      lastHandle += 1;
      const handle = lastHandle;
      queueMicrotask(() => {
        if (!cleared.has(handle)) {
          run();
        }
      });
      return handle;
    },
    clear(handle) {
      cleared.add(handle);
    },
  };
})();

const fakeHarnesses = new WeakSet<AgentHarness>();

export function isFakeAgentHarness(
  harness: AgentHarness,
): harness is FakeAgentHarness {
  return fakeHarnesses.has(harness);
}

// Each fake harness with how many records it held when this run opened: a
// fake keeps its records for the app's whole life, and the self-test scripts
// run again on every page load, so a run reads only the records past its mark.
export interface RunMark {
  harness: FakeAgentHarness;
  processes: number;
  pastSessionCalls: number;
}

export const markRun = (harnesses: readonly AgentHarness[]): RunMark[] =>
  harnesses.filter(isFakeAgentHarness).map((harness) => ({
    harness,
    processes: harness.processes.length,
    pastSessionCalls: harness.pastSessionCalls.length,
  }));

// One control for each pick key, and one no pick key reaches; a value in
// `launchValues` replaces that control's fixed starting value.
function startingControls(
  launchValues: AgentStart['controls'],
): SessionControl[] {
  const controls: SessionControl[] = [
    {
      id: 'mode',
      label: 'Mode',
      choices: [
        { value: 'auto', label: 'Auto' },
        { value: 'plan', label: 'Plan' },
      ],
      value: 'auto',
    },
    {
      id: 'effort',
      label: 'Effort',
      choices: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
      value: 'medium',
    },
    {
      id: 'model',
      label: 'Model',
      choices: [
        { value: 'fake-small', label: 'Small' },
        { value: 'fake-large', label: 'Large' },
      ],
      value: 'fake-small',
    },
    {
      id: 'verbosity',
      label: 'Verbosity',
      choices: [
        { value: 'brief', label: 'Brief' },
        { value: 'full', label: 'Full' },
      ],
      value: 'brief',
    },
  ];
  return controls.map((control) => ({
    ...control,
    value: launchValues[control.id] ?? control.value,
  }));
}

// Every profile's plan usage at `at`: a 5-hour row, a critical active weekly
// row and a scoped weekly row, with extra usage on.
export function fakePlanUsage(at: number): PlanUsage {
  return {
    rows: [
      {
        kind: 'session',
        group: 'session',
        label: '5h',
        percent: 35,
        resetsAt: at + 7_200_000,
        severity: 'normal',
        isActive: false,
      },
      {
        kind: 'weekly_all',
        group: 'weekly',
        label: 'Week',
        percent: 97,
        resetsAt: at + 259_200_000,
        severity: 'critical',
        isActive: true,
      },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        label: 'Fable',
        percent: 0,
        resetsAt: at + 259_200_000,
        severity: 'normal',
        isActive: false,
      },
    ],
    extraUsage: {
      enabled: true,
      usedMinor: 1250,
      limitMinor: 5000,
      currency: 'USD',
    },
    at,
  };
}

// The `usage` event turn `turn` ends with; its two autocompact limits differ.
export function fakeUsageEvent(turn: number, at: number): UsageAgentEvent {
  return {
    type: 'usage',
    agentId: MAIN_AGENT_ID,
    at,
    contextTokens: 42_000 * turn,
    contextWindow: 1_000_000,
    autocompact: { configured: 300_000, reported: 967_000 },
    cacheExpiresAt: at + 3_600_000,
    spendUsd: 0.25 * turn,
  };
}

// The plan rows turn `turn` saw: the 5-hour row one point past the poll's per
// turn.
export function fakePlanRowUpdate(turn: number, at: number): PlanRowUpdate {
  return {
    rows: [
      {
        kind: 'session',
        percent: 35 + turn,
        resetsAt: at + 7_200_000,
        severity: 'normal',
      },
      {
        kind: 'weekly_all',
        percent: 97,
        resetsAt: at + 259_200_000,
        severity: 'critical',
      },
    ],
    at,
  };
}

// The fake plan with its first `ticked` boxes ticked, in task order, and
// `reviewRounds` lines under its review rounds heading.
export function fakeWorkflowPlan(ticked: number, reviewRounds: number): string {
  const box = (index: number) => (index < ticked ? '[x]' : '[ ]');
  const roundLines = Array.from(
    { length: reviewRounds },
    (_, index) => `- round ${index + 1} · no findings`,
  );
  return [
    `# ${FAKE_WORKFLOW_TITLE} — plan`,
    '',
    '## Tasks',
    '',
    '### Wave 1',
    '',
    `- ${box(0)} [Fake first task](01-fake-first.md)`,
    `- ${box(1)} [Fake second task](02-fake-second.md)`,
    '',
    '### Wave 2',
    '',
    `- ${box(2)} [Fake third task](03-fake-third.md) — after 01, 02`,
    '',
    '## Run log',
    '',
    '### Review rounds',
    ...(roundLines.length > 0 ? ['', ...roundLines] : []),
    '',
  ].join('\n');
}

// `record`'s events until it detaches, then nothing. `record.events` stays the
// very object the caller gave.
function untilDetached(record: FakeAgentProcessRecord): AgentProcessEvents {
  const { events } = record;
  const whileAttached = (fire: () => void) => {
    if (!record.detached) {
      fire();
    }
  };
  return {
    entry: (entry) => whileAttached(() => events.entry(entry)),
    controls: (controls) => whileAttached(() => events.controls(controls)),
    activity: (activity) => whileAttached(() => events.activity(activity)),
    commands: (names) => whileAttached(() => events.commands(names)),
    planUsage: (update) => whileAttached(() => events.planUsage(update)),
    agentEvent: (event) => whileAttached(() => events.agentEvent(event)),
    messageDropped: (entryId) =>
      whileAttached(() => events.messageDropped(entryId)),
    ended: (end) => whileAttached(() => events.ended(end)),
  };
}

// Emits one entry, stamped with its `at`.
type EmitEntry = (draft: EntryDraft) => void;

type ToolEntryDraft = Extract<EntryDraft, { kind: 'tool' }>;

// A tool entry without its result and raw events.
type ToolCall = Omit<ToolEntryDraft, 'result' | 'raw'>;

type ToolResult = { text: string; isError: boolean };

const toolStartedEvent = (clock: Clock, call: ToolCall): AgentEvent => ({
  type: 'toolStarted',
  at: clock.now(),
  agentId: call.agentId,
  toolUseId: call.toolUseId,
  tool: call.name,
  summary: call.summary,
});

const toolFinishedEvent = (
  clock: Clock,
  call: ToolCall,
  result: ToolResult,
): AgentEvent => ({
  type: 'toolFinished',
  at: clock.now(),
  agentId: call.agentId,
  toolUseId: call.toolUseId,
  ok: !result.isError,
});

// Emits `call` without its result, raw `[{ fake: tag }]`,
// then its `toolStarted`.
function startFakeTool(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  call: ToolCall,
  tag: string,
) {
  emitEntry({ ...call, result: null, raw: [{ fake: tag }] });
  events.agentEvent(toolStartedEvent(clock, call));
}

// Re-sends `call` with `result`, raw `[{ fake: tag }, { fake: tag-result }]`,
// then its `toolFinished`.
function finishFakeTool(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  call: ToolCall,
  tag: string,
  result: ToolResult,
) {
  emitEntry({
    ...call,
    result,
    raw: [{ fake: tag }, { fake: `${tag}-result` }],
  });
  events.agentEvent(toolFinishedEvent(clock, call, result));
}

// The entries, usage and activity that close turn `turn`.
function emitTurnEnd(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  turn: number,
) {
  emitEntry({
    kind: 'result',
    id: `result-${turn}`,
    stopReason: 'end_turn',
    costUsd: null,
    durationMs: null,
    raw: [{ fake: 'result' }],
  });
  events.agentEvent(fakeUsageEvent(turn, clock.now()));
  events.planUsage(fakePlanRowUpdate(turn, clock.now()));
  events.agentEvent({ type: 'turnEnded', at: clock.now() });
  events.activity('idle');
}

function emitToolTurn(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  turn: number,
) {
  const tool: ToolCall = {
    kind: 'tool',
    id: `tool-${turn}`,
    agentId: MAIN_AGENT_ID,
    toolUseId: `fake-tool-${turn}`,
    name: 'Bash',
    input: { command: 'echo fake' },
    summary: 'echo fake',
  };
  startFakeTool(events, emitEntry, clock, tool, 'tool');
  finishFakeTool(events, emitEntry, clock, tool, 'tool', {
    text: 'fake',
    isError: false,
  });
  const reply = 'fake agent ran a tool';
  emitEntry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    text: reply,
    streaming: false,
    raw: [{ fake: 'assistant', text: reply }],
  });
  emitTurnEnd(events, emitEntry, clock, turn);
}

// The tools `FAKE_STEPS_TEXT`'s turn runs, in order, each with its result.
const FAKE_STEP_TOOLS = [
  { name: 'Read', input: { file_path: 'src/app.ts' }, summary: 'src/app.ts' },
  { name: 'Read', input: { file_path: 'src/view.ts' }, summary: 'src/view.ts' },
  {
    name: 'Read',
    input: { file_path: 'src/state.ts' },
    summary: 'src/state.ts',
  },
  {
    name: 'Bash',
    input: { command: 'false' },
    summary: 'false',
    result: { text: 'exit code 1', isError: true },
  },
  { name: 'Edit', input: { file_path: 'src/app.ts' }, summary: 'src/app.ts' },
  { name: 'Bash', input: { command: 'npm test' }, summary: 'npm test' },
];

// The steps of turn `turn`, ids `step-<turn>-<n>`: the tools, each with its
// tool events, then one finished thought. The turn stays open.
function emitStepsTurn(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  turn: number,
) {
  FAKE_STEP_TOOLS.forEach((tool, index) => {
    const n = index + 1;
    const call: ToolCall = {
      kind: 'tool',
      id: `step-${turn}-${n}`,
      agentId: MAIN_AGENT_ID,
      toolUseId: `fake-step-${turn}-${n}`,
      name: tool.name,
      input: tool.input,
      summary: tool.summary,
    };
    const result = tool.result ?? { text: 'ok', isError: false };
    emitEntry({ ...call, result, raw: [{ fake: 'step' }] });
    events.agentEvent(toolStartedEvent(clock, call));
    events.agentEvent(toolFinishedEvent(clock, call, result));
  });
  const thought = 'Checking the test output.';
  emitEntry({
    kind: 'thinking',
    id: `step-${turn}-${FAKE_STEP_TOOLS.length + 1}`,
    text: thought,
    streaming: false,
    raw: [{ fake: 'thinking', text: thought }],
  });
}

// The subagents `FAKE_AGENTS_TEXT`'s turn spawns, in order, each with the one
// tool it runs and the model and spend its reply reports. `name` is the Agent
// call's `name` input, null when the call names none.
const FAKE_SUBAGENTS = [
  {
    agentType: 'wigley:sonnet-medium',
    description: 'Map the stream decoder',
    name: 'map-decoder',
    model: 'sonnet',
    effort: 'medium',
    reply: { model: 'claude-sonnet-5-5', spendUsd: 0.0421 },
    tool: {
      name: 'Read',
      input: { file_path: 'src/main/claude-code/stream-decoder.ts' },
      summary: 'src/main/claude-code/stream-decoder.ts',
    },
  },
  {
    agentType: 'Explore',
    description: 'Find every Files adapter',
    name: null,
    model: null,
    effort: null,
    reply: { model: 'claude-haiku-5-5', spendUsd: 0.0019 },
    tool: {
      name: 'Grep',
      input: { pattern: 'append' },
      summary: 'append',
    },
  },
];

// A running subagent's Agent tool entry.
type SubagentEntry = ToolCall;

// Spawns turn `turn`'s subagents, ids `fake-agent-<turn>-<n>`, and runs each
// one's tool after its `agentReplied`; returns their Agent entries in spawn
// order. The turn stays open.
function emitAgentsTurn(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  turn: number,
): SubagentEntry[] {
  const spawned = FAKE_SUBAGENTS.map((subagent, index) => {
    const agentId = `fake-agent-${turn}-${index + 1}`;
    const entry: SubagentEntry = {
      kind: 'tool',
      id: `agent-${turn}-${index + 1}`,
      agentId: MAIN_AGENT_ID,
      toolUseId: agentId,
      name: 'Agent',
      input: {
        subagent_type: subagent.agentType,
        description: subagent.description,
        ...(subagent.name === null ? {} : { name: subagent.name }),
      },
      summary: subagent.description,
    };
    emitEntry({ ...entry, result: null, raw: [{ fake: 'agent' }] });
    events.agentEvent({
      type: 'agentSpawned',
      at: clock.now(),
      agentId,
      parentAgentId: MAIN_AGENT_ID,
      agentType: subagent.agentType,
      description: subagent.description,
      name: subagent.name ?? subagent.agentType,
      model: subagent.model,
      effort: subagent.effort,
    });
    return entry;
  });
  FAKE_SUBAGENTS.forEach(({ tool, reply }, index) => {
    const agentId = spawned[index].toolUseId;
    events.agentEvent({
      type: 'agentReplied',
      at: clock.now(),
      agentId,
      model: reply.model,
      spendUsd: reply.spendUsd,
    });
    const toolCall: ToolCall = {
      kind: 'tool',
      id: `${spawned[index].id}-tool`,
      agentId,
      toolUseId: `${agentId}-tool`,
      name: tool.name,
      input: tool.input,
      summary: tool.summary,
    };
    startFakeTool(events, emitEntry, clock, toolCall, 'tool');
    finishFakeTool(events, emitEntry, clock, toolCall, 'tool', {
      text: 'fake',
      isError: false,
    });
  });
  return spawned;
}

// The tasks `FAKE_AGENTS_TEXT`'s turn starts, in order: `subagent` is the
// index of the turn's subagent that starts it, null for the main agent.
const FAKE_TASKS = [
  {
    subagent: null,
    description: 'Run the self-test',
    command: 'npm run selftest',
  },
  {
    subagent: 0,
    description: 'Watch the build',
    command: 'npm run build -- --watch',
  },
];

// Starts turn `turn`'s tasks, ids `fake-task-<turn>-<n>`, each owned by its
// agent among `subagents`; returns their ids in start order.
function startFakeTasks(
  events: AgentProcessEvents,
  clock: Clock,
  turn: number,
  subagents: readonly SubagentEntry[],
): string[] {
  return FAKE_TASKS.map((task, index) => {
    const taskId = `fake-task-${turn}-${index + 1}`;
    events.agentEvent({
      type: 'taskStarted',
      at: clock.now(),
      taskId,
      agentId:
        task.subagent === null
          ? MAIN_AGENT_ID
          : subagents[task.subagent].toolUseId,
      description: task.description,
      command: task.command,
    });
    return taskId;
  });
}

// Re-sends each running subagent's Agent entry with `result`, then its
// `agentFinished`, in spawn order.
function finishSubagents(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  running: readonly SubagentEntry[],
  result: ToolResult,
) {
  for (const entry of running) {
    emitEntry({
      ...entry,
      result,
      raw: [{ fake: 'agent' }, { fake: 'agent-result' }],
    });
    events.agentEvent({
      type: 'agentFinished',
      at: clock.now(),
      agentId: entry.toolUseId,
      outcome: result.isError ? 'failed' : 'done',
    });
  }
}

// One fake plan's progress, kept by plan folder.
interface WorkflowPlan {
  ticked: number;
  reviewRounds: number;
}

// What a workflow send runs: the feature turn, with or without its Skill call,
// or the next make step of the plan in `folder`.
type WorkflowTurn =
  | { kind: 'feature'; runsSkill: boolean }
  | { kind: 'make'; folder: string; plan: WorkflowPlan };

// How a workflow tool's file change went: `ended` when the process ended
// while it was pending.
type WorkflowChange = 'landed' | 'failed' | 'ended';

const WORKFLOW_TOOL_OK = { text: 'ok', isError: false };

// The fake plan's full path under `projectDir`.
function workflowPlanPathOf(projectDir: string): string {
  return `${projectDir}/${FAKE_WORKFLOW_PLAN_PATH}`;
}

// The plan folder of a full plan path.
function workflowFolderOf(planPath: string): string {
  return planPath.slice(0, -'/plan.md'.length);
}

// The workflow turn `text` runs, or null when it runs as any other send.
// `makeFolder` is the plan folder the process's make run works on.
function workflowTurnOf(
  text: string,
  makeFolder: string | null,
  workflowPlans: ReadonlyMap<string, WorkflowPlan>,
): WorkflowTurn | null {
  if (text === FAKE_WORKFLOW_FEATURE_TEXT) {
    return { kind: 'feature', runsSkill: true };
  }
  const typed = typedSkill(text);
  const isTypedFeature =
    typed?.skill === 'wigley:feature' &&
    typed.args === FAKE_WORKFLOW_FEATURE_TEXT;
  if (isTypedFeature) {
    return { kind: 'feature', runsSkill: false };
  }
  const typedMakeFolder = typed?.skill === 'wigley:make' ? typed.args : null;
  const folder =
    typedMakeFolder ?? (text === FAKE_WORKFLOW_STEP_TEXT ? makeFolder : null);
  const plan = folder === null ? undefined : workflowPlans.get(folder);
  if (folder === null || plan === undefined) {
    return null;
  }
  return { kind: 'make', folder, plan };
}

// Tool `n` of workflow turn `turn`, run by the main agent.
function workflowToolCall(
  turn: number,
  n: number,
  tool: Pick<ToolCall, 'name' | 'input' | 'summary'>,
): ToolCall {
  return {
    kind: 'tool',
    id: `workflow-${turn}-${n}`,
    agentId: MAIN_AGENT_ID,
    toolUseId: `fake-workflow-${turn}-${n}`,
    ...tool,
  };
}

// Tool `n` of workflow turn `turn`: a Skill call of `skill`, with its
// `skillStarted` after its `toolStarted`.
function emitWorkflowSkill(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  turn: number,
  n: number,
  skill: string,
) {
  const call = workflowToolCall(turn, n, {
    name: 'Skill',
    input: { skill },
    summary: skill,
  });
  startFakeTool(events, emitEntry, clock, call, 'workflow');
  events.agentEvent({
    type: 'skillStarted',
    at: clock.now(),
    agentId: MAIN_AGENT_ID,
    skill,
    args: '',
  });
  finishFakeTool(events, emitEntry, clock, call, 'workflow', WORKFLOW_TOOL_OK);
}

// The Bash call a `FAKE_PERMISSION_TEXT` turn asks permission for.
function permissionToolCall(turn: number): ToolCall {
  return {
    kind: 'tool',
    id: `tool-${turn}`,
    agentId: MAIN_AGENT_ID,
    toolUseId: `fake-permission-${turn}`,
    name: 'Bash',
    input: { command: 'rm fake.txt' },
    summary: 'rm fake.txt',
  };
}

function emitEchoTurn(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  turn: number,
  text: string,
) {
  const prefix = 'fake agent heard: ';
  const first = { fake: 'assistant', text: prefix };
  emitEntry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    text: prefix,
    streaming: true,
    raw: [first],
  });
  emitEntry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    text: `${prefix}${text}`,
    streaming: false,
    raw: [first, { fake: 'assistant', text }],
  });
  emitTurnEnd(events, emitEntry, clock, turn);
}

// The images on a fake past session's user message: a red and a blue 16×16
// PNG.
export const FAKE_HISTORY_IMAGES: readonly ChatImage[] = [
  {
    mediaType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO44OBAEmIY1TCqYfhqAAAxPVAQGiLq9QAAAABJRU5ErkJggg==',
  },
  {
    mediaType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mNwSLhAEmIY1TCqYfhqAAAUDXAQquIenAAAAABJRU5ErkJggg==',
  },
];

// The two entries a fake past session's history holds, the user message
// carrying `FAKE_HISTORY_IMAGES`.
function fakeHistory(sessionId: string): ChatEntry[] {
  return [
    {
      kind: 'user',
      id: `history:${sessionId}-user`,
      at: FAKE_HISTORY_AT,
      text: 'fake earlier message',
      images: FAKE_HISTORY_IMAGES.map((image) => ({ ...image })),
      raw: [{ fake: 'history-user' }],
    },
    {
      kind: 'assistant',
      id: `history:${sessionId}-assistant`,
      at: FAKE_HISTORY_AT + 1000,
      text: 'fake earlier reply',
      streaming: false,
      raw: [{ fake: 'history-assistant' }],
    },
  ];
}

export function createFakeAgentHarness(
  clock: Clock,
  files: Pick<Files, 'write' | 'trash'>,
  timers: Timers,
): FakeAgentHarness {
  const processes: FakeAgentProcessRecord[] = [];
  const attachCalls: AgentStart[] = [];
  const attachScripts = new Map<string, FakeAttachScript>();
  const pastSessionCalls: FakePastSessionCall[] = [];
  let nextStartFailure: string | null = null;
  let nextHistoryFailure: string | null = null;
  let nextPlanUsageFailure: string | null = null;
  const lastUsages = new Map<string, UsageAgentEvent | null>();
  const lastUsageCalls: string[] = [];
  let nextLastUsageFailure: string | null = null;
  let nextLastUsageHold: Promise<void> | null = null;
  let isEndHeld = false;
  const heldEnds: (() => void)[] = [];
  // Profiles `logOut` signed out and no sign-in has signed in since.
  const signedOutProfiles = new Set<string | null>();
  // Each profile's started folders, by the count of `start` calls when each
  // last started: the fake's stand-in for a modified time.
  const startedFolders = new Map<string | null, Map<string, number>>();
  let startCount = 0;
  // Each fake plan's progress by plan folder, kept across processes so a make
  // run outlives a clear.
  const workflowPlans = new Map<string, WorkflowPlan>();
  let permissionAsk: FakePermissionAsk | null = null;

  const statusOf = (profileDir: string | null): AccountStatus =>
    signedOutProfiles.has(profileDir)
      ? SIGNED_OUT
      : { signedIn: true, account: FAKE_ACCOUNT };

  function recordStart(request: AgentStart) {
    startCount += 1;
    const folders =
      startedFolders.get(request.profileDir) ?? new Map<string, number>();
    folders.set(request.projectDir, startCount);
    startedFolders.set(request.profileDir, folders);
  }

  // Emits `link` at once; `FAKE_SIGN_IN_CODE` signs the profile in, any other
  // code ends with `Wrong code` and the profile's status unchanged.
  function startLogIn(
    profileDir: string | null,
    events: LogInEvents,
  ): LogInProcess {
    let hasEnded = false;
    const end = (status: AccountStatus | null, error: string | null) => {
      hasEnded = true;
      queueMicrotask(() => events.ended({ status, error }));
    };
    queueMicrotask(() => events.link(FAKE_SIGN_IN_URL));
    return {
      sendCode(code) {
        if (hasEnded) {
          return;
        }
        if (code !== FAKE_SIGN_IN_CODE) {
          end(statusOf(profileDir), 'Wrong code');
          return;
        }
        signedOutProfiles.delete(profileDir);
        end(statusOf(profileDir), null);
      },
      cancel() {
        if (hasEnded) {
          return;
        }
        end(null, 'Sign-in cancelled');
      },
    };
  }

  // `turns` is the turn counter's start. A process `attach` resolved skips the
  // opening emissions.
  function startProcess(
    record: FakeAgentProcessRecord,
    turns: number,
  ): AgentProcess {
    const { calls } = record;
    const events = untilDetached(record);
    let controls = startingControls(record.request.controls);
    let turn = turns;
    let isTurnOpen = false;
    // The Agent entries of the subagents still running, in spawn order.
    let runningSubagents: SubagentEntry[] = [];
    // The ids of the tasks still running, in start order.
    let runningTasks: string[] = [];
    // The plan folder this process's make run works on.
    let makeFolder: string | null = null;
    let endPromise: Promise<void> | null = null;
    let visualHold: number | null = null;
    const stamp = createEntryStamp(clock);
    const emitEntry: EmitEntry = (draft) => {
      events.entry(stamp(draft));
    };
    const requireRunning = () => {
      if (record.detached) {
        throw new Error('fake agent process has detached');
      }
      if (record.ended) {
        throw new Error('fake agent process has ended');
      }
    };
    const emitSessionEnded = () => {
      events.agentEvent({ type: 'sessionEnded', at: clock.now() });
    };
    const clearVisualHold = () => {
      if (visualHold !== null) {
        timers.clear(visualHold);
        visualHold = null;
      }
    };

    // The reply with its second visual's block open, then, after the hold, the
    // whole reply and the turn's end.
    const emitVisualTurn = (turn: number) => {
      const first = { fake: 'assistant', text: SAMPLE_VISUALS_OPEN_TEXT };
      emitEntry({
        kind: 'assistant',
        id: `assistant-${turn}`,
        text: SAMPLE_VISUALS_OPEN_TEXT,
        streaming: true,
        raw: [first],
      });
      visualHold = timers.set(() => {
        visualHold = null;
        isTurnOpen = false;
        emitEntry({
          kind: 'assistant',
          id: `assistant-${turn}`,
          text: SAMPLE_VISUALS_TEXT,
          streaming: false,
          raw: [
            first,
            {
              fake: 'assistant',
              text: SAMPLE_VISUALS_TEXT.slice(SAMPLE_VISUALS_OPEN_TEXT.length),
            },
          ],
        });
        emitTurnEnd(events, emitEntry, clock, turn);
      }, FAKE_VISUAL_HOLD_MS);
    };

    // Starts the turn's tool, asks its permission, then finishes the tool with
    // the answer and closes the turn, unless an interrupt, a later send or the
    // process's end came while the ask waited.
    const runPermissionTurn = async (askedTurn: number) => {
      const call = permissionToolCall(askedTurn);
      startFakeTool(events, emitEntry, clock, call, 'tool');
      let result: ToolResult;
      try {
        if (permissionAsk === null) {
          throw new Error('fake harness has no permission ask');
        }
        const allowed = await permissionAsk(record.request, {
          toolName: call.name,
          input: call.input,
          toolUseId: call.toolUseId,
        });
        result = allowed
          ? { text: 'fake', isError: false }
          : { text: 'Permission denied', isError: true };
      } catch (error) {
        result = { text: errorText(error), isError: true };
      }
      const isStillTheTurn = !record.ended && isTurnOpen && turn === askedTurn;
      if (!isStillTheTurn) {
        return;
      }
      isTurnOpen = false;
      finishFakeTool(events, emitEntry, clock, call, 'tool', result);
      const reply = result.isError
        ? 'fake agent was refused'
        : 'fake agent ran an allowed tool';
      emitEntry({
        kind: 'assistant',
        id: `assistant-${askedTurn}`,
        text: reply,
        streaming: false,
        raw: [{ fake: 'assistant', text: reply }],
      });
      emitTurnEnd(events, emitEntry, clock, askedTurn);
    };

    // Runs `change` between workflow tool `n`'s call and its result; a
    // rejection gives an error result and a notice naming `path`.
    const runWorkflowChange = async (
      turn: number,
      n: number,
      tool: Pick<ToolCall, 'name' | 'input' | 'summary'>,
      path: string,
      change: () => Promise<void>,
    ): Promise<WorkflowChange> => {
      const call = workflowToolCall(turn, n, tool);
      const finish = (result: ToolResult) =>
        finishFakeTool(events, emitEntry, clock, call, 'workflow', result);
      startFakeTool(events, emitEntry, clock, call, 'workflow');
      try {
        await change();
      } catch (error) {
        if (record.ended) {
          return 'ended';
        }
        const message = errorText(error);
        finish({ text: message, isError: true });
        emitEntry({
          kind: 'notice',
          id: `notice-${turn}`,
          text: `fake workflow could not change ${path}: ${message}`,
          tone: 'error',
          raw: [{ fake: 'workflow-error' }],
        });
        return 'failed';
      }
      if (record.ended) {
        return 'ended';
      }
      finish(WORKFLOW_TOOL_OK);
      return 'landed';
    };

    // Workflow tool `n`: `toolName` writes `plan` to `planPath`, then
    // `fileWritten`; once the write lands, ended process or not, the plan's
    // folder holds `plan` in the map.
    const writeWorkflowPlan = async (
      turn: number,
      n: number,
      toolName: 'Write' | 'Edit',
      planPath: string,
      plan: WorkflowPlan,
    ): Promise<WorkflowChange> => {
      const change = await runWorkflowChange(
        turn,
        n,
        { name: toolName, input: { file_path: planPath }, summary: planPath },
        planPath,
        async () => {
          await files.write(
            planPath,
            fakeWorkflowPlan(plan.ticked, plan.reviewRounds),
          );
          workflowPlans.set(workflowFolderOf(planPath), plan);
        },
      );
      if (change === 'landed') {
        events.agentEvent({
          type: 'fileWritten',
          at: clock.now(),
          agentId: MAIN_AGENT_ID,
          path: planPath,
        });
      }
      return change;
    };

    // Ends workflow turn `turn` with `reply` once its change landed, with no
    // reply once it failed, and with nothing once the process ended.
    const closeWorkflowTurn = (
      turn: number,
      change: WorkflowChange,
      reply: string,
    ) => {
      if (change === 'ended') {
        return;
      }
      if (change === 'landed') {
        emitEntry({
          kind: 'assistant',
          id: `assistant-${turn}`,
          text: reply,
          streaming: false,
          raw: [{ fake: 'assistant', text: reply }],
        });
      }
      emitTurnEnd(events, emitEntry, clock, turn);
    };

    const runWorkflowFeature = async (turn: number, runsSkill: boolean) => {
      const planPath = workflowPlanPathOf(record.request.projectDir);
      if (runsSkill) {
        emitWorkflowSkill(events, emitEntry, clock, turn, 1, 'wigley:feature');
      }
      const change = await writeWorkflowPlan(
        turn,
        runsSkill ? 2 : 1,
        'Write',
        planPath,
        { ticked: 0, reviewRounds: 0 },
      );
      closeWorkflowTurn(turn, change, `fake feature wrote ${planPath}`);
    };

    // Ticks the first and second box, then ticks the third with a review, then
    // removes the plan folder and ends the make run.
    const runWorkflowMakeStep = async (
      turn: number,
      folder: string,
      plan: WorkflowPlan,
    ) => {
      const planPath = `${folder}/plan.md`;
      if (plan.ticked < 2) {
        const ticked = plan.ticked + 1;
        const change = await writeWorkflowPlan(turn, 1, 'Edit', planPath, {
          ...plan,
          ticked,
        });
        closeWorkflowTurn(turn, change, `fake make ticked task ${ticked}`);
        return;
      }
      if (plan.ticked === 2) {
        emitWorkflowSkill(events, emitEntry, clock, turn, 1, 'wigley:review');
        const change = await writeWorkflowPlan(turn, 2, 'Edit', planPath, {
          ticked: 3,
          reviewRounds: plan.reviewRounds + 1,
        });
        closeWorkflowTurn(turn, change, 'fake make ticked task 3 and reviewed');
        return;
      }
      const command = `rm -r ${folder}`;
      const change = await runWorkflowChange(
        turn,
        1,
        { name: 'Bash', input: { command }, summary: command },
        folder,
        async () => {
          await files.trash(folder);
          workflowPlans.delete(folder);
          makeFolder = null;
        },
      );
      closeWorkflowTurn(turn, change, 'fake make closed the plan');
    };
    if (!record.attached) {
      queueMicrotask(() => {
        events.agentEvent({ type: 'sessionStarted', at: clock.now() });
        events.controls(controls);
        events.commands(['fake-command']);
        events.activity('idle');
      });
    }
    return {
      send(message) {
        const { text, images } = message;
        calls.push({ method: 'send', text, imageCount: images.length });
        requireRunning();
        clearVisualHold();
        turn += 1;
        const sentTurn = turn;
        // The user entry and its events; `startsTurn` is false for a send
        // that ends the process instead of running a turn.
        const emitUserEntry = (startsTurn: boolean) => {
          emitEntry({
            kind: 'user',
            id: `user-${sentTurn}`,
            text,
            images,
            raw: [{ fake: 'user', text }],
          });
          events.agentEvent({ type: 'userMessage', at: clock.now() });
          const typed = typedSkill(text);
          if (typed !== null) {
            events.agentEvent({
              type: 'skillStarted',
              at: clock.now(),
              agentId: MAIN_AGENT_ID,
              skill: typed.skill,
              args: typed.args,
            });
          }
          if (startsTurn) {
            events.agentEvent({ type: 'turnStarted', at: clock.now() });
          }
          events.activity('working');
        };
        if (text === FAKE_END_TEXT) {
          record.ended = true;
          isTurnOpen = false;
          endPromise = new Promise<void>((resolve) => {
            queueMicrotask(() => {
              emitUserEntry(false);
              emitSessionEnded();
              events.ended({ code: 0, error: null });
              resolve();
            });
          });
          return `user-${sentTurn}`;
        }
        const isHold = text === FAKE_HOLD_TEXT;
        const isSteps = text === FAKE_STEPS_TEXT;
        const isAgents = text === FAKE_AGENTS_TEXT;
        const isVisual = text === FAKE_VISUAL_TEXT;
        const isPermission = text === FAKE_PERMISSION_TEXT;
        isTurnOpen = isHold || isSteps || isAgents || isVisual || isPermission;
        queueMicrotask(() => {
          finishSubagents(events, emitEntry, clock, runningSubagents, {
            text: 'fake subagent done',
            isError: false,
          });
          runningSubagents = [];
          emitUserEntry(true);
          if (isHold) {
            return;
          }
          const workflowTurn = workflowTurnOf(text, makeFolder, workflowPlans);
          if (workflowTurn?.kind === 'feature') {
            void runWorkflowFeature(sentTurn, workflowTurn.runsSkill);
          } else if (workflowTurn?.kind === 'make') {
            makeFolder = workflowTurn.folder;
            void runWorkflowMakeStep(
              sentTurn,
              workflowTurn.folder,
              workflowTurn.plan,
            );
          } else if (isAgents) {
            runningSubagents = emitAgentsTurn(
              events,
              emitEntry,
              clock,
              sentTurn,
            );
            runningTasks.push(
              ...startFakeTasks(events, clock, sentTurn, runningSubagents),
            );
          } else if (isSteps) {
            emitStepsTurn(events, emitEntry, clock, sentTurn);
          } else if (text === FAKE_TOOL_TEXT) {
            emitToolTurn(events, emitEntry, clock, sentTurn);
          } else if (isVisual) {
            emitVisualTurn(sentTurn);
          } else if (isPermission) {
            void runPermissionTurn(sentTurn);
          } else {
            emitEchoTurn(events, emitEntry, clock, sentTurn, text);
          }
        });
        return `user-${sentTurn}`;
      },
      interrupt() {
        calls.push({ method: 'interrupt' });
        requireRunning();
        if (!isTurnOpen) {
          return;
        }
        clearVisualHold();
        isTurnOpen = false;
        const interruptedTurn = turn;
        queueMicrotask(() => {
          for (const taskId of runningTasks) {
            events.agentEvent({
              type: 'taskFinished',
              at: clock.now(),
              taskId,
              outcome: 'failed',
            });
          }
          runningTasks = [];
          finishSubagents(events, emitEntry, clock, runningSubagents, {
            text: 'Interrupted',
            isError: true,
          });
          runningSubagents = [];
          emitEntry({
            kind: 'notice',
            id: `notice-${interruptedTurn}`,
            text: 'Interrupted',
            tone: 'info',
            raw: [{ fake: 'interrupt' }],
          });
          events.agentEvent({ type: 'turnEnded', at: clock.now() });
          events.activity('idle');
        });
      },
      setControl(id, value) {
        calls.push({ method: 'setControl', id, value });
        requireRunning();
        const control = controls.find((declared) => declared.id === id);
        if (!control) {
          throw new Error(`fake agent has no control ${id}`);
        }
        if (!control.choices.some((choice) => choice.value === value)) {
          throw new Error(`fake agent control ${id} has no choice ${value}`);
        }
        controls = controls.map((declared) =>
          declared.id === id ? { ...declared, value } : declared,
        );
        const reported = controls;
        queueMicrotask(() => events.controls(reported));
      },
      end() {
        calls.push({ method: 'end' });
        clearVisualHold();
        if (endPromise !== null) {
          return endPromise;
        }
        if (record.detached) {
          return Promise.resolve();
        }
        record.ended = true;
        isTurnOpen = false;
        const isHeld = isEndHeld;
        endPromise = new Promise<void>((resolve) => {
          const exit = () => {
            emitSessionEnded();
            events.ended({ code: 0, error: null });
            resolve();
          };
          if (isHeld) {
            heldEnds.push(exit);
          } else {
            queueMicrotask(exit);
          }
        });
        return endPromise;
      },
      kill() {
        calls.push({ method: 'kill' });
        clearVisualHold();
        if (endPromise !== null || record.detached) {
          return;
        }
        record.ended = true;
        isTurnOpen = false;
        endPromise = new Promise<void>((resolve) => {
          queueMicrotask(() => {
            emitSessionEnded();
            events.ended({ code: null, error: null });
            resolve();
          });
        });
      },
      detach() {
        calls.push({ method: 'detach' });
        record.detached = true;
        clearVisualHold();
      },
    };
  }

  const harness: FakeAgentHarness = {
    id: 'claude',
    processes,
    attachCalls,
    pastSessionCalls,
    start(request, events) {
      if (nextStartFailure !== null) {
        const message = nextStartFailure;
        nextStartFailure = null;
        throw new Error(message);
      }
      const record: FakeAgentProcessRecord = {
        request,
        events,
        calls: [],
        ended: false,
        attached: false,
        detached: false,
      };
      processes.push(record);
      recordStart(request);
      return startProcess(record, 0);
    },
    async attach(request, events) {
      attachCalls.push(request);
      const script = attachScripts.get(request.processId);
      attachScripts.delete(request.processId);
      await Promise.resolve();
      if (script === undefined || script.outcome === 'null') {
        return null;
      }
      if (script.outcome === 'reject') {
        throw new Error(script.message);
      }
      const record: FakeAgentProcessRecord = {
        request,
        events,
        calls: [],
        ended: false,
        attached: true,
        detached: false,
      };
      processes.push(record);
      script.replay(events);
      return startProcess(record, script.turns ?? 0);
    },
    scriptAttach(processId, script) {
      attachScripts.set(processId, script);
    },
    failNextStart(message) {
      nextStartFailure = message;
    },
    async listSessions(projectDir, profileDir) {
      pastSessionCalls.push({
        method: 'listSessions',
        sessionId: null,
        projectDir,
        profileDir,
        before: null,
      });
      return FAKE_PAST_SESSIONS.map((session) => ({ ...session }));
    },
    async history(sessionId, projectDir, profileDir, before) {
      pastSessionCalls.push({
        method: 'history',
        sessionId,
        projectDir,
        profileDir,
        before,
      });
      if (nextHistoryFailure !== null) {
        const message = nextHistoryFailure;
        nextHistoryFailure = null;
        throw new Error(message);
      }
      const isSaved = FAKE_PAST_SESSIONS.some(
        (session) => session.sessionId === sessionId,
      );
      if (!isSaved) {
        throw new Error(`fake agent has no saved session ${sessionId}`);
      }
      return fakeHistory(sessionId).filter(
        (entry) => before === null || entry.at < before,
      );
    },
    failNextHistory(message) {
      nextHistoryFailure = message;
    },
    lastUsageCalls,
    async lastUsage(sessionId) {
      lastUsageCalls.push(sessionId);
      const failure = nextLastUsageFailure;
      const hold = nextLastUsageHold;
      nextLastUsageFailure = null;
      nextLastUsageHold = null;
      if (hold !== null) {
        await hold;
      }
      if (failure !== null) {
        throw new Error(failure);
      }
      return lastUsages.get(sessionId) ?? null;
    },
    setLastUsage(sessionId, event) {
      lastUsages.set(sessionId, event);
    },
    failNextLastUsage(message) {
      nextLastUsageFailure = message;
    },
    holdNextLastUsage() {
      let release = () => {};
      nextLastUsageHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    async accountStatus(profileDir) {
      return statusOf(profileDir);
    },
    logIn: startLogIn,
    async logOut(profileDir) {
      signedOutProfiles.add(profileDir);
    },
    async listProjects(profileDir) {
      const folders = startedFolders.get(profileDir) ?? new Map();
      const projects: ProjectFolder[] = [...folders].map(
        ([projectDir, modified]) => ({ projectDir, modified }),
      );
      return projects.sort((a, b) => b.modified - a.modified);
    },
    async planUsage() {
      if (nextPlanUsageFailure !== null) {
        const message = nextPlanUsageFailure;
        nextPlanUsageFailure = null;
        throw new Error(message);
      }
      return fakePlanUsage(clock.now());
    },
    failNextPlanUsage(message) {
      nextPlanUsageFailure = message;
    },
    holdEnd() {
      isEndHeld = true;
    },
    askPermissionsWith(ask) {
      permissionAsk = ask;
    },
    releaseEnd() {
      isEndHeld = false;
      const released = heldEnds.splice(0);
      queueMicrotask(() => {
        for (const release of released) {
          release();
        }
      });
    },
  };
  fakeHarnesses.add(harness);
  return harness;
}
