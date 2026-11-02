import {
  MAIN_AGENT_ID,
  type AccountStatus,
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
import type { Clock } from '../contracts/ambient';
import { createEntryStamp, type EntryDraft } from './entry-stamp';

// A scripted harness behind `AgentHarness`, for the tests and the self-test.
// Every emission runs in a microtask the causing call queues, never inside the
// call, so a caller's state is in place before its events arrive. Each emitted
// entry carries the clock's time when its id first arrived; `history` entries
// carry fixed times one second apart. Every finished turn reports a `usage`
// agent event and a plan row update after its result, and `planUsage` answers
// every profile with `fakePlanUsage`. The process emits the agent events Claude
// would for what it simulates, each at the clock's time: `sessionStarted` first,
// `userMessage` after each user entry, tool and subagent events beside their
// entries, and `sessionEnded` just before each `ended`.

// A send of this text opens a turn that stays open until `interrupt` or `end`.
export const FAKE_HOLD_TEXT = 'fake: hold';
// A send of this text runs one tool before the reply.
export const FAKE_TOOL_TEXT = 'fake: tool';
// A send of this text runs six finished tools, one failed, and a thought, then
// stays open as `FAKE_HOLD_TEXT`'s turn does.
export const FAKE_STEPS_TEXT = 'fake: steps';
// A send of this text spawns two subagents, each running one tool, then stays
// open as `FAKE_HOLD_TEXT`'s turn does. The subagents run until an interrupt
// (failed), the next send (done) or the process's end (no `agentFinished`).
export const FAKE_AGENTS_TEXT = 'fake: agents';
// A send of this text ends the process on its own, as a CLI that exits.
export const FAKE_END_TEXT = 'fake: end';
// The link every `logIn` reports, and the one code that finishes it.
export const FAKE_SIGN_IN_URL = 'https://example.invalid/fake-sign-in';
export const FAKE_SIGN_IN_CODE = 'fake-code';
// The account every profile is signed in as until `logOut`.
const FAKE_ACCOUNT = 'fake@example.invalid';
const SIGNED_OUT: AccountStatus = { signedIn: false, account: null };
// The `at` of a fake past session's first history entry.
const FAKE_HISTORY_AT = 1767236645000;

export type FakeAgentCall =
  | { method: 'send'; text: string; imageCount: number }
  | { method: 'interrupt' }
  | { method: 'setControl'; id: string; value: string }
  | { method: 'end' }
  | { method: 'kill' };

// `request` and `events` are the very objects `start` received; `calls` lists
// every call on the process in call order, refused ones included.
export interface FakeAgentProcessRecord {
  request: AgentStart;
  events: AgentProcessEvents;
  calls: FakeAgentCall[];
  ended: boolean;
}

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

// One `listSessions` or `history` call; `sessionId` is null for
// `listSessions`.
export interface FakePastSessionCall {
  method: 'listSessions' | 'history';
  sessionId: string | null;
  projectDir: string;
  profileDir: string | null;
}

// `processes` holds one record per `start` that did not throw, in start order:
// the same array for the harness's life, each record changing in place.
// `failNextStart` makes the next `start` throw `message`. Every `end` on a
// process returns the promise its first `end` returned, or, once a
// `FAKE_END_TEXT` send ended it, the promise of that exit. Between `holdEnd`
// and `releaseEnd`, a first `end` marks its process ended and leaves that
// promise pending; `releaseEnd` emits `ended` for each held process in call
// order and resolves them. A `FAKE_END_TEXT` exit is never held.
// `pastSessionCalls` lists every `listSessions` and `history` call in call
// order, failed ones included; `failNextHistory` makes the next `history`
// reject `message`. Every profile starts signed in as `fake@example.invalid`;
// `logOut` signs it out and a `logIn` given `FAKE_SIGN_IN_CODE` signs it back
// in. `listProjects` lists the folders `start` ran under the profile, the last
// started first. `planUsage` resolves `fakePlanUsage` at the clock's time in a
// later microtask; `failNextPlanUsage` makes the next one reject `message`.
export interface FakeAgentHarness extends AgentHarness {
  readonly processes: readonly FakeAgentProcessRecord[];
  readonly pastSessionCalls: readonly FakePastSessionCall[];
  failNextStart(message: string): void;
  failNextHistory(message: string): void;
  failNextPlanUsage(message: string): void;
  holdEnd(): void;
  releaseEnd(): void;
}

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

// One control for each pick key, and one no pick key reaches.
function startingControls(): SessionControl[] {
  return [
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

// Emits one entry, stamped with its `at`.
type EmitEntry = (draft: EntryDraft) => void;

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
  events.activity('idle');
}

function emitToolTurn(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  turn: number,
) {
  const tool = {
    kind: 'tool' as const,
    id: `tool-${turn}`,
    toolUseId: `fake-tool-${turn}`,
    name: 'Bash',
    input: { command: 'echo fake' },
    summary: 'echo fake',
  };
  emitEntry({ ...tool, result: null, raw: [{ fake: 'tool' }] });
  events.agentEvent({
    type: 'toolStarted',
    at: clock.now(),
    agentId: MAIN_AGENT_ID,
    toolUseId: tool.toolUseId,
    tool: tool.name,
  });
  emitEntry({
    ...tool,
    result: { text: 'fake', isError: false },
    raw: [{ fake: 'tool' }, { fake: 'tool-result' }],
  });
  events.agentEvent({
    type: 'toolFinished',
    at: clock.now(),
    agentId: MAIN_AGENT_ID,
    toolUseId: tool.toolUseId,
    ok: true,
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
    const toolUseId = `fake-step-${turn}-${n}`;
    const result = tool.result ?? { text: 'ok', isError: false };
    emitEntry({
      kind: 'tool',
      id: `step-${turn}-${n}`,
      toolUseId,
      name: tool.name,
      input: tool.input,
      summary: tool.summary,
      result,
      raw: [{ fake: 'step' }],
    });
    events.agentEvent({
      type: 'toolStarted',
      at: clock.now(),
      agentId: MAIN_AGENT_ID,
      toolUseId,
      tool: tool.name,
    });
    events.agentEvent({
      type: 'toolFinished',
      at: clock.now(),
      agentId: MAIN_AGENT_ID,
      toolUseId,
      ok: !result.isError,
    });
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
// tool it runs.
const FAKE_SUBAGENTS = [
  {
    agentType: 'wigley:sonnet-medium',
    description: 'Map the stream decoder',
    tool: {
      name: 'Read',
      input: { file_path: 'src/main/claude-code/stream-decoder.ts' },
      summary: 'src/main/claude-code/stream-decoder.ts',
    },
  },
  {
    agentType: 'Explore',
    description: 'Find every Files adapter',
    tool: {
      name: 'Grep',
      input: { pattern: 'append' },
      summary: 'append',
    },
  },
];

type ToolEntryDraft = Extract<EntryDraft, { kind: 'tool' }>;

// A running subagent's Agent tool entry, without its result and raw events.
type SubagentEntry = Omit<ToolEntryDraft, 'result' | 'raw'>;

// Spawns turn `turn`'s subagents, ids `fake-agent-<turn>-<n>`, and runs each
// one's tool; returns their Agent entries in spawn order. The turn stays open.
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
      toolUseId: agentId,
      name: 'Agent',
      input: {
        subagent_type: subagent.agentType,
        description: subagent.description,
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
    });
    return entry;
  });
  FAKE_SUBAGENTS.forEach(({ tool }, index) => {
    const agentId = spawned[index].toolUseId;
    const toolCall = {
      kind: 'tool' as const,
      id: `${spawned[index].id}-tool`,
      toolUseId: `${agentId}-tool`,
      name: tool.name,
      input: tool.input,
      summary: tool.summary,
    };
    emitEntry({ ...toolCall, result: null, raw: [{ fake: 'tool' }] });
    events.agentEvent({
      type: 'toolStarted',
      at: clock.now(),
      agentId,
      toolUseId: toolCall.toolUseId,
      tool: tool.name,
    });
    emitEntry({
      ...toolCall,
      result: { text: 'fake', isError: false },
      raw: [{ fake: 'tool' }, { fake: 'tool-result' }],
    });
    events.agentEvent({
      type: 'toolFinished',
      at: clock.now(),
      agentId,
      toolUseId: toolCall.toolUseId,
      ok: true,
    });
  });
  return spawned;
}

// Re-sends each running subagent's Agent entry with `result`, then its
// `agentFinished`, in spawn order.
function finishSubagents(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  clock: Clock,
  running: readonly SubagentEntry[],
  result: { text: string; isError: boolean },
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

export function createFakeAgentHarness(clock: Clock): FakeAgentHarness {
  const processes: FakeAgentProcessRecord[] = [];
  const pastSessionCalls: FakePastSessionCall[] = [];
  let nextStartFailure: string | null = null;
  let nextHistoryFailure: string | null = null;
  let nextPlanUsageFailure: string | null = null;
  let isEndHeld = false;
  const heldEnds: (() => void)[] = [];
  // Profiles `logOut` signed out and no sign-in has signed in since.
  const signedOutProfiles = new Set<string | null>();
  // Each profile's started folders, by the count of `start` calls when each
  // last started: the fake's stand-in for a modified time.
  const startedFolders = new Map<string | null, Map<string, number>>();
  let startCount = 0;

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

  function startProcess(record: FakeAgentProcessRecord): AgentProcess {
    const { events, calls } = record;
    let controls = startingControls();
    let turn = 0;
    let isTurnOpen = false;
    // The Agent entries of the subagents still running, in spawn order.
    let runningSubagents: SubagentEntry[] = [];
    let endPromise: Promise<void> | null = null;
    const stamp = createEntryStamp(clock);
    const emitEntry: EmitEntry = (draft) => {
      events.entry(stamp(draft));
    };
    const requireRunning = () => {
      if (record.ended) {
        throw new Error('fake agent process has ended');
      }
    };
    const emitSessionEnded = () => {
      events.agentEvent({ type: 'sessionEnded', at: clock.now() });
    };
    queueMicrotask(() => {
      events.agentEvent({ type: 'sessionStarted', at: clock.now() });
      events.controls(controls);
      events.commands(['fake-command']);
      events.activity('idle');
    });
    return {
      send(message) {
        const { text, images } = message;
        calls.push({ method: 'send', text, imageCount: images.length });
        requireRunning();
        turn += 1;
        const sentTurn = turn;
        const emitUserEntry = () => {
          emitEntry({
            kind: 'user',
            id: `user-${sentTurn}`,
            text,
            images,
            raw: [{ fake: 'user', text }],
          });
          events.agentEvent({ type: 'userMessage', at: clock.now() });
          events.activity('working');
        };
        if (text === FAKE_END_TEXT) {
          record.ended = true;
          isTurnOpen = false;
          runningSubagents = [];
          endPromise = new Promise<void>((resolve) => {
            queueMicrotask(() => {
              emitUserEntry();
              emitSessionEnded();
              events.ended({ code: 0, error: null });
              resolve();
            });
          });
          return;
        }
        const isHold = text === FAKE_HOLD_TEXT;
        const isSteps = text === FAKE_STEPS_TEXT;
        const isAgents = text === FAKE_AGENTS_TEXT;
        isTurnOpen = isHold || isSteps || isAgents;
        queueMicrotask(() => {
          finishSubagents(events, emitEntry, clock, runningSubagents, {
            text: 'fake subagent done',
            isError: false,
          });
          runningSubagents = [];
          emitUserEntry();
          if (isHold) {
            return;
          }
          if (isAgents) {
            runningSubagents = emitAgentsTurn(
              events,
              emitEntry,
              clock,
              sentTurn,
            );
          } else if (isSteps) {
            emitStepsTurn(events, emitEntry, clock, sentTurn);
          } else if (text === FAKE_TOOL_TEXT) {
            emitToolTurn(events, emitEntry, clock, sentTurn);
          } else {
            emitEchoTurn(events, emitEntry, clock, sentTurn, text);
          }
        });
      },
      interrupt() {
        calls.push({ method: 'interrupt' });
        requireRunning();
        if (!isTurnOpen) {
          return;
        }
        isTurnOpen = false;
        const interruptedTurn = turn;
        queueMicrotask(() => {
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
        if (endPromise !== null) {
          return endPromise;
        }
        record.ended = true;
        isTurnOpen = false;
        runningSubagents = [];
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
        if (endPromise !== null) {
          return;
        }
        record.ended = true;
        isTurnOpen = false;
        runningSubagents = [];
        endPromise = new Promise<void>((resolve) => {
          queueMicrotask(() => {
            emitSessionEnded();
            events.ended({ code: null, error: null });
            resolve();
          });
        });
      },
    };
  }

  const harness: FakeAgentHarness = {
    id: 'claude',
    processes,
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
      };
      processes.push(record);
      recordStart(request);
      return startProcess(record);
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
      });
      return FAKE_PAST_SESSIONS.map((session) => ({ ...session }));
    },
    async history(sessionId, projectDir, profileDir) {
      pastSessionCalls.push({
        method: 'history',
        sessionId,
        projectDir,
        profileDir,
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
      return fakeHistory(sessionId);
    },
    failNextHistory(message) {
      nextHistoryFailure = message;
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
