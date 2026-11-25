import {
  CONTROL_ROLES,
  MAIN_AGENT_ID,
  type AccountStatus,
  type AgentAsk,
  type AgentEvent,
  type AgentHarness,
  type AgentProcess,
  type AgentProcessEvents,
  type AgentStart,
  type ChatEntry,
  type ChatImage,
  type CompactionTrigger,
  type HarnessProfile,
  type ContextBreakdownAgentEvent,
  type InstalledPlugin,
  type LogInEvents,
  type LogInProcess,
  type PastSession,
  type PermissionDecision,
  type PlanRowUpdate,
  type PlanUsage,
  type ProjectFolder,
  type SessionControl,
  type UsageAgentEvent,
  type UserMessage,
} from '../contracts/agent';
import type { Clock, Timers } from '../contracts/ambient';
import type { Files } from '../contracts/files';
import type { HostedSpawn, IdleRule } from '../contracts/session-host';
import { createEntryStamp, type EntryDraft } from './entry-stamp';
import { errorText } from './error-text';
import { capPermission } from './permission-cap';
import { sampleQualified } from './sample-plugin';
import {
  SAMPLE_VISUALS_OPEN_TEXT,
  SAMPLE_VISUALS_TEXT,
} from './sample-visuals';
import { SESSION_ROW_ENV } from './session-env';
import { toolSummary } from './tool-summary';
import { typedSkill } from './typed-skill';

// A scripted harness behind `AgentHarness`, for the tests and the self-test.
// Every emission runs in a microtask the causing call queues, never inside the
// call, so a caller's state is in place before its events arrive. Each emitted
// entry carries the clock's time when its id first arrived; `history` entries
// carry fixed times one second apart. Every turn that ends with a result reports
// a `usage` agent event and a plan row update after that result, except that no
// `usage` goes out between a done compaction and the next main reply, and
// `planUsage` answers every profile with `fakePlanUsage`. The process emits
// the agent events Claude would for what it simulates, each at the clock's
// time: `sessionStarted` first, `userMessage` after each user entry, then
// `skillStarted` for a typed `/<skill>` message and `turnStarted` for every
// send that runs a turn, tool and subagent events (`agentReplied` included)
// beside their entries, `taskStarted` and `taskFinished` for background tasks,
// `contextBreakdown` after `FAKE_CONTEXT_TEXT`'s turn's `usage`,
// `compactionStarted` and one `compactionEnded` for each compaction
// (`compact()`, `/compact`, `FAKE_COMPACT_TEXT`), `turnEnded` when a turn or a
// compaction closes or is interrupted, and `sessionEnded` just before each
// `ended`. A started process reports its session id
// (`FakeAgentProcessRecord.sessionId`) before every other event, and
// `FAKE_AGENT_PID` through `pid` right after `sessionStarted`. A process
// `attach` resolves reports the request's session id, then the test's replay,
// and opens with none of `start`'s emissions, its pid included: the replay
// stands for them. An `attach` with a null session id rejects. Once a process
// has detached, it emits nothing. The workflow sends
// (`FAKE_WORKFLOW_FEATURE_TEXT`, the sample plugin's
// `/<plugin>:make <plan folder>`, `FAKE_WORKFLOW_STEP_TEXT`) change a fake plan
// through the injected `files`.

// A send of this text opens a turn that stays open until `interrupt` or `end`.
export const FAKE_HOLD_TEXT = 'fake: hold';
// A send of this text runs one tool before the reply.
export const FAKE_TOOL_TEXT = 'fake: tool';
// A send of this text runs one Bash tool, `unity command editor_play` on the
// process's own project folder, before the reply.
export const FAKE_PLAYTEST_TEXT = 'fake: playtest';
// A send of this text streams a reply holding two visuals, holds it with the
// second block still open for `FAKE_VISUAL_HOLD_MS`, then sends the whole
// reply; an interrupt during the hold ends the turn as a held turn's does,
// and a send, end or kill during it drops the rest of the reply.
export const FAKE_VISUAL_TEXT = 'fake: visual';
export const FAKE_VISUAL_HOLD_MS = 1500;
// A send of this text replies with three paragraphs, a two-item list and a
// `ts` code block, for the chat cursor's block stops, then ends the turn.
export const FAKE_BLOCKS_TEXT = 'fake: blocks';
// A send of this text runs six finished tools, one failed, and a thought, then
// stays open as `FAKE_HOLD_TEXT`'s turn does.
export const FAKE_STEPS_TEXT = 'fake: steps';
// A send of this text spawns two subagents, each running one tool, then stays
// open as `FAKE_HOLD_TEXT`'s turn does. The subagents run until an interrupt
// (failed), the next send other than `FAKE_END_TEXT` (done) or the process's
// end (no `agentFinished`). An interrupt or send queued before the end still
// finishes them. The turn also starts two tasks, one owned by `main` and one by
// the first subagent; the next send leaves them running, and an interrupt, with a
// turn open or none, ends them (failed); the process's end sends no
// `taskFinished`, since `sessionEnded` ends a roster's running items. Real Claude
// keeps a launched subagent running past a send, and fills its Agent entry's
// result at the receipt; the fake's launched subagent ends with the other and
// its entry keeps `result: null`, so a self-test here does not prove a background
// box survives a send.
export const FAKE_AGENTS_TEXT = 'fake: agents';
// A send of this text ends the process on its own, as a CLI that exits.
export const FAKE_END_TEXT = 'fake: end';
// A send of this text runs a `harness` compaction, then a reply and a normal turn
// end. The `usage` event after a done compaction, whatever started it, reads
// `FAKE_COMPACTED_CONTEXT_TOKENS`, and the compaction entry comes again with that
// size as its `afterTokens` just before that event.
export const FAKE_COMPACT_TEXT = 'fake: compact';
export const FAKE_COMPACTED_CONTEXT_TOKENS = 24_000;
// A send of this text runs the echo turn, with a `usage` event whose cache has
// already expired and whose context reads `FAKE_COLD_CONTEXT_TOKENS`, even right
// after a compaction.
export const FAKE_COLD_TEXT = 'fake: cold';
const FAKE_COLD_CONTEXT_TOKENS = 200_000;
// A send of this text runs the echo turn, then reports `fakeContextBreakdownEvent` after its `usage`.
export const FAKE_CONTEXT_TEXT = 'fake: context';
// A send of this text starts one Bash tool, raises its permission request
// through `permission`, then, once `answerPermission` answers it, finishes the
// tool, allowed or refused, and replies. The turn stays open while the request
// waits.
export const FAKE_PERMISSION_TEXT = 'fake: permission';
// A send of this text, or the sample plugin's `/<plugin>:feature ` before it
// (`sample-plugin.ts`), runs a feature-skill turn that writes
// `fakeWorkflowPlan(0, 0)` at `FAKE_WORKFLOW_PLAN_PATH` under the process's
// project folder.
export const FAKE_WORKFLOW_FEATURE_TEXT = 'fake: workflow feature';
// After the sample plugin's `/<plugin>:make <that plan's folder>`, each
// send of this text runs the
// next make step: a tick, a tick with a review round, then the folder removed.
export const FAKE_WORKFLOW_STEP_TEXT = 'fake: workflow step';
// Relative to the process's project folder.
export const FAKE_WORKFLOW_PLAN_PATH =
  'docs/features/fake-flow/plan-fake-flow/plan.md';
export const FAKE_WORKFLOW_TITLE = 'Fake flow';
// The OS pid every started process reports.
export const FAKE_AGENT_PID = 4242;
// The link every `logIn` reports, and the one code that finishes it.
export const FAKE_SIGN_IN_URL = 'https://example.invalid/fake-sign-in';
export const FAKE_SIGN_IN_CODE = 'fake-code';
// The text every `ask` answers until `setAskReply` sets another.
export const FAKE_ASK_REPLY =
  '{"summary":"Deletes the file fake.txt from the project folder.","verdict":"deny","risk":"medium"}';
// The account every profile is signed in as until `logOut`.
const FAKE_ACCOUNT = 'fake@example.invalid';
const SIGNED_OUT: AccountStatus = { signedIn: false, account: null };
// The `at` of a fake past session's first history entry.
const FAKE_HISTORY_AT = 1767236645000;

// A tool call a fake process raises a permission request for.
export interface FakePermissionCall {
  toolName: string;
  input: unknown;
  toolUseId: string;
}

// The reason a request the process's end cancelled is denied with; the fake's
// own copy of the Claude adapter's, which `src/shared` may not import.
export const FAKE_CANCELLED_REASON =
  'The tool call was cancelled before the user answered.';
const CANCELLED: PermissionDecision = {
  allowed: false,
  reason: FAKE_CANCELLED_REASON,
};

type PermissionEntry = Extract<ChatEntry, { kind: 'permission' }>;

export type FakeAgentCall =
  | { method: 'send'; text: string; imageCount: number; now?: true }
  | { method: 'interrupt' }
  | { method: 'setControl'; id: string; value: string }
  | { method: 'compact' }
  | { method: 'end' }
  | { method: 'kill' }
  | { method: 'detach' }
  | {
      method: 'answerPermission';
      requestId: string;
      decision: PermissionDecision;
    };

// `request` and `events` are the very objects `start` or `attach` received;
// `sessionId` is the id the process reported: the request's, or the
// `fake-session-<n>` a start with a null one minted, `n` counting from 1 per
// fake harness;
// `calls` lists every call on the process in call order, refused ones included.
// `attached` marks a process `attach` resolved; `detached` one `detach` was called
// on.
export interface FakeAgentProcessRecord {
  request: AgentStart;
  sessionId: string;
  events: AgentProcessEvents;
  calls: FakeAgentCall[];
  ended: boolean;
  attached: boolean;
  detached: boolean;
}

// The outcome of one `attach`. Each fires `replay`, when it has one, before the
// promise settles. `process` starts the process's turn counter at `turns` (0 when
// left out), so its ids follow the ones the replay used.
export type FakeAttachScript =
  | {
      outcome: 'process';
      turns?: number;
      replay(events: AgentProcessEvents): void;
    }
  | { outcome: 'null'; replay?(events: AgentProcessEvents): void }
  | {
      outcome: 'reject';
      message: string;
      replay?(events: AgentProcessEvents): void;
    };

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

// One `prepareRun` call of the fake and the spec it returned.
export interface FakePreparedRun {
  request: AgentStart;
  firstMessage: UserMessage;
  env: Readonly<Record<string, string>>;
  spawn: HostedSpawn;
}

// The command of every spec the fake's `prepareRun` returns.
export const FAKE_AGENT_COMMAND = 'fake-agent';

// A stdout `result` line ends a turn; the stdin `user` line a spec opens with
// starts one.
const FAKE_IDLE_RULE: IdleRule = {
  key: 'type',
  value: 'result',
  busyStdoutValues: [],
  busyStdinValues: ['user'],
  sideKey: null,
  messageIdKey: null,
  messageEnd: null,
  turnEndIdsKey: null,
  background: null,
};

// `processes` holds one record per `start` that did not throw and per `attach`
// that resolved a process, in call order: the same array for the harness's life,
// each record changing in place. `attachCalls` lists every `attach` request in
// call order. `scriptAttach` sets the outcome of the next `attach` for that
// process id, once, replacing an unused script; with none, `attach` resolves null.
// `failNextStart` makes the next `start` throw, or the next `prepareRun` reject with, `message`.
// `preparedRuns` holds one record per `prepareRun` that returned a spec, in call
// order; a prepared run starts no process. Every `end` on a
// process returns the promise its first `end` returned, or, once a
// `FAKE_END_TEXT` send ended it, the promise of that exit. Between `holdEnd`
// and `releaseEnd`, a first `end` marks its process ended and leaves that
// promise pending; `releaseEnd` emits `ended` for each held process in call
// order and resolves them, and a `detach` resolves its own process's with no
// `ended`. A `FAKE_END_TEXT` exit is never held. Between `holdCompactions` and
// `releaseCompactions`, a compaction stops after `compactionStarted` with its
// process busy; `releaseCompactions` finishes each one still running as done, in
// start order across processes. An interrupt (`interrupted`), an end, kill or
// `FAKE_END_TEXT` send (`failed`), or any other send (done, before the send's own
// emissions) ends a held one sooner, and a release then skips it.
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
// `ask` resolves, in a later microtask, the reply set when it was called:
// `FAKE_ASK_REPLY` before any `setAskReply`. `failNextAsk` makes the next one
// reject `message`, and `askCalls` lists every `ask` request in call order,
// failed ones included. The fake ignores the ask's `signal`.
// `timers` runs the `fake: visual` hold. Each process numbers its permission
// requests `fake-permission-<n>`, each entry's `summary` built by
// `toolSummary`, as the real harness builds it; `answerPermission` emits the
// answered entry and settles the request in a later microtask, and an interrupt of an open turn,
// the process's end, kill or `FAKE_END_TEXT` exit cancel every waiting request
// with `FAKE_CANCELLED_REASON`, emitting its cancelled entry (before
// `sessionEnded` on an exit); a detach cancels them emitting nothing.
// `askPermission` raises a request for `call` on the newest process record whose
// `request.rowId` is `rowId` and that is neither ended nor detached, and
// resolves to its decision; it rejects when there is none. `controls` declares the starting controls a process with
// no launch values begins with; `toolUseIdOf` reads `FAKE_TOOL_USE_ID_META_KEY`;
// `configRoots` names `configFolder`'s folder, its `plugins/cache` and its
// `plugins/installed_plugins.json`.
// `installedPlugins` resolves what `setInstalledPlugins` last set for the
// profile's `configFolder`, [] before.
export interface FakeAgentHarness extends AgentHarness {
  readonly processes: readonly FakeAgentProcessRecord[];
  readonly preparedRuns: readonly FakePreparedRun[];
  readonly attachCalls: readonly AgentStart[];
  scriptAttach(processId: string, script: FakeAttachScript): void;
  readonly pastSessionCalls: readonly FakePastSessionCall[];
  failNextStart(message: string): void;
  failNextHistory(message: string): void;
  failNextPlanUsage(message: string): void;
  setAskReply(text: string): void;
  failNextAsk(message: string): void;
  readonly askCalls: readonly AgentAsk[];
  readonly lastUsageCalls: readonly string[];
  setLastUsage(sessionId: string, event: UsageAgentEvent | null): void;
  failNextLastUsage(message: string): void;
  holdNextLastUsage(): () => void;
  holdEnd(): void;
  releaseEnd(): void;
  holdCompactions(): void;
  releaseCompactions(): void;
  askPermission(
    rowId: string,
    call: FakePermissionCall,
  ): Promise<PermissionDecision>;
  setInstalledPlugins(
    configDir: string,
    plugins: readonly InstalledPlugin[],
  ): void;
}

// The fake's harness id.
export const FAKE_HARNESS_ID = 'fake';

// The `_meta` key the fake reads a tool call's id under.
export const FAKE_TOOL_USE_ID_META_KEY = 'fake/toolUseId';

// The fake's profiles, named and foldered as the `claude-code` plugin's
// default, since a run on the fake leaves that plugin out.
export const FAKE_PROFILES: readonly HarnessProfile[] = [
  { name: 'work', configDir: '~/.claude' },
  { name: 'personal', configDir: '~/.claude-personal' },
];

// The id, label and profiles a fake harness declares; `unlisted` carries into its info.
export interface FakeHarnessIdentity {
  id: string;
  label: string;
  profiles: readonly HarnessProfile[];
  unlisted?: true;
}

const FAKE_IDENTITY: FakeHarnessIdentity = {
  id: FAKE_HARNESS_ID,
  label: 'Fake',
  profiles: FAKE_PROFILES,
};

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

// This run's fake records for `project`, in start order.
export function projectRecords(
  marks: readonly RunMark[],
  project: string,
): FakeAgentProcessRecord[] {
  return marks
    .flatMap((mark) => mark.harness.processes.slice(mark.processes))
    .filter((record) => record.request.projectDir === project);
}

// The texts a record's process was sent, in order.
export const sendTexts = (record: FakeAgentProcessRecord): string[] =>
  record.calls.flatMap((call) => (call.method === 'send' ? [call.text] : []));

// One control for each pick key, and one no pick key reaches; a value in
// `launchValues` replaces that control's fixed starting value.
function startingControls(
  launchValues: AgentStart['controls'],
): SessionControl[] {
  const controls: SessionControl[] = [
    {
      id: 'mode',
      label: 'Mode',
      role: CONTROL_ROLES.permissionMode,
      choices: [
        { value: 'auto', label: 'Auto' },
        { value: 'plan', label: 'Plan' },
      ],
      value: 'auto',
    },
    {
      id: 'effort',
      label: 'Effort',
      role: CONTROL_ROLES.effort,
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
      role: CONTROL_ROLES.model,
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

// The `usage` event turn `turn` ends with, unless a compaction just ran or the
// turn is `FAKE_COLD_TEXT`'s; its two autocompact limits differ.
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

// The breakdown `FAKE_CONTEXT_TEXT`'s turn reports: 128k of a 1M window, its sources largest first.
export function fakeContextBreakdownEvent(
  at: number,
): ContextBreakdownAgentEvent {
  const named = (label: string, tokens: number) => ({
    label,
    isPath: false,
    tokens,
  });
  return {
    type: 'contextBreakdown',
    agentId: MAIN_AGENT_ID,
    at,
    totalTokens: 128_000,
    contextWindow: 1_000_000,
    autocompactAt: 967_000,
    deferredTokens: 23_000,
    sources: [
      {
        id: 'messages.attachments',
        label: 'Attachments',
        tokens: 73_000,
        items: [
          named('prompt_snapshot', 16_000),
          named('invoked_skills', 10_000),
        ],
      },
      {
        id: 'messages.tool-results',
        label: 'Tool results',
        tokens: 27_000,
        items: [named('Bash', 13_000), named('Read', 9_000)],
      },
      {
        id: 'memory_files',
        label: 'Memory files',
        tokens: 11_000,
        items: [{ label: '/fake/AGENTS.md', isPath: true, tokens: 11_000 }],
      },
      { id: 'skills', label: 'Skills', tokens: 9_000, items: [] },
      { id: 'system_tools', label: 'System tools', tokens: 6_000, items: [] },
      { id: 'system_prompt', label: 'System prompt', tokens: 2_000, items: [] },
    ],
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
    sessionId: (id) => whileAttached(() => events.sessionId(id)),
    entry: (entry) => whileAttached(() => events.entry(entry)),
    controls: (controls) => whileAttached(() => events.controls(controls)),
    activity: (activity) => whileAttached(() => events.activity(activity)),
    pid: (pid) => whileAttached(() => events.pid(pid)),
    commands: (commands) => whileAttached(() => events.commands(commands)),
    planUsage: (update) => whileAttached(() => events.planUsage(update)),
    agentEvent: (event) => whileAttached(() => events.agentEvent(event)),
    messageQueued: (entryId) =>
      whileAttached(() => events.messageQueued(entryId)),
    messageDropped: (entryId, message) =>
      whileAttached(() => events.messageDropped(entryId, message)),
    permission: (request) => whileAttached(() => events.permission(request)),
    ended: (end) => whileAttached(() => events.ended(end)),
  };
}

// Emits one entry, stamped with its `at`.
type EmitEntry = (draft: EntryDraft) => void;

// Emits the main `usage` event that closes turn `turn`.
type EmitTurnUsage = (turn: number) => void;

type ToolEntryDraft = Extract<EntryDraft, { kind: 'tool' }>;

// A tool entry without its result and raw events.
type ToolCall = Omit<ToolEntryDraft, 'result' | 'raw'>;

type ToolResult = { text: string; isError: boolean };

// The Bash command a one-tool turn runs, its result, and the reply after it.
interface FakeBashRun {
  command: string;
  result: ToolResult;
  reply: string;
}

type CompactionEntryDraft = Extract<EntryDraft, { kind: 'compaction' }>;

// One compaction, from its start call to its end. `n` counts the process's
// compactions from 1; `turn` is the turn a `harness` compaction replies in.
interface FakeCompaction {
  n: number;
  trigger: CompactionTrigger;
  turn: number;
  startedAt: number;
}

const compactionEndedEvent = (
  clock: Clock,
  compaction: FakeCompaction,
  outcome: 'done' | 'failed' | 'interrupted',
  beforeTokens: number | null,
): AgentEvent => ({
  type: 'compactionEnded',
  at: clock.now(),
  trigger: compaction.trigger,
  outcome,
  beforeTokens,
  durationMs: clock.now() - compaction.startedAt,
});

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
  emitTurnUsage: EmitTurnUsage,
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
  emitTurnUsage(turn);
  events.planUsage(fakePlanRowUpdate(turn, clock.now()));
  events.agentEvent({ type: 'turnEnded', at: clock.now() });
  events.activity('idle');
}

function emitToolTurn(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  emitTurnUsage: EmitTurnUsage,
  clock: Clock,
  turn: number,
  run: FakeBashRun,
) {
  const tool: ToolCall = {
    kind: 'tool',
    id: `tool-${turn}`,
    agentId: MAIN_AGENT_ID,
    toolUseId: `fake-tool-${turn}`,
    name: 'Bash',
    input: { command: run.command },
    summary: toolSummary('Bash', { command: run.command }),
  };
  startFakeTool(events, emitEntry, clock, tool, 'tool');
  finishFakeTool(events, emitEntry, clock, tool, 'tool', run.result);
  const { reply } = run;
  emitEntry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    agentId: MAIN_AGENT_ID,
    text: reply,
    streaming: false,
    raw: [{ fake: 'assistant', text: reply }],
  });
  emitTurnEnd(events, emitEntry, emitTurnUsage, clock, turn);
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
    agentId: MAIN_AGENT_ID,
    text: thought,
    streaming: false,
    raw: [{ fake: 'thinking', text: thought }],
  });
}

// The subagents `FAKE_AGENTS_TEXT`'s turn spawns, in order, each with the one
// tool it runs and the model, spend and context its reply reports. `name` is
// the Agent call's `name` input, null when the call names none; `isLaunched`
// marks a subagent that runs in the background.
const FAKE_SUBAGENTS = [
  {
    agentType: sampleQualified('sonnet-medium'),
    description: 'Map the stream decoder',
    name: 'map-decoder',
    model: 'sonnet',
    effort: 'medium',
    isLaunched: false,
    reply: {
      model: 'claude-sonnet-5-5',
      spendUsd: 0.0421,
      contextTokens: 84_000,
      contextWindow: 200_000,
      autocompactLimit: null,
    },
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
    isLaunched: true,
    reply: {
      model: 'claude-haiku-5-5',
      spendUsd: 0.0019,
      contextTokens: 166_000,
      contextWindow: 200_000,
      autocompactLimit: null,
    },
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
// one's tool after its `agentReplied` and, for a launched one, its
// `agentLaunched`; returns their Agent entries in spawn order. The turn stays
// open.
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
  FAKE_SUBAGENTS.forEach(({ tool, reply, isLaunched }, index) => {
    const agentId = spawned[index].toolUseId;
    events.agentEvent({
      type: 'agentReplied',
      at: clock.now(),
      agentId,
      ...reply,
    });
    if (isLaunched) {
      events.agentEvent({ type: 'agentLaunched', at: clock.now(), agentId });
    }
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
    typed?.skill === sampleQualified('feature') &&
    typed.args === FAKE_WORKFLOW_FEATURE_TEXT;
  if (isTypedFeature) {
    return { kind: 'feature', runsSkill: false };
  }
  const typedMakeFolder =
    typed?.skill === sampleQualified('make') ? typed.args : null;
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
  emitTurnUsage: EmitTurnUsage,
  clock: Clock,
  turn: number,
  text: string,
) {
  const prefix = 'fake agent heard: ';
  const first = { fake: 'assistant', text: prefix };
  emitEntry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    agentId: MAIN_AGENT_ID,
    text: prefix,
    streaming: true,
    raw: [first],
  });
  emitEntry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    agentId: MAIN_AGENT_ID,
    text: `${prefix}${text}`,
    streaming: false,
    raw: [first, { fake: 'assistant', text }],
  });
  emitTurnEnd(events, emitEntry, emitTurnUsage, clock, turn);
}

// The reply of `FAKE_BLOCKS_TEXT`'s turn.
export const FAKE_BLOCKS_REPLY = [
  'The first paragraph.',
  'The second paragraph.',
  'The third paragraph.',
  '- The first item\n- The second item',
  '```ts\nconst answer = 42;\n```',
  ':::details Fixture details\nThe hidden line.\n:::',
].join('\n\n');

function emitBlocksTurn(
  events: AgentProcessEvents,
  emitEntry: EmitEntry,
  emitTurnUsage: EmitTurnUsage,
  clock: Clock,
  turn: number,
) {
  emitEntry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    agentId: MAIN_AGENT_ID,
    text: FAKE_BLOCKS_REPLY,
    streaming: false,
    raw: [{ fake: 'assistant', text: FAKE_BLOCKS_REPLY }],
  });
  emitTurnEnd(events, emitEntry, emitTurnUsage, clock, turn);
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
      delivery: null,
      raw: [{ fake: 'history-user' }],
    },
    {
      kind: 'assistant',
      id: `history:${sessionId}-assistant`,
      at: FAKE_HISTORY_AT + 1000,
      agentId: MAIN_AGENT_ID,
      text: 'fake earlier reply',
      streaming: false,
      raw: [{ fake: 'history-assistant' }],
    },
  ];
}

// The config folder the fake names for a session with no profile.
export const FAKE_DEFAULT_CONFIG_FOLDER = '~/.fake-agent';

// `identity` sets the harness's id, label and profiles; with none it is the
// fake: `FAKE_HARNESS_ID`, `Fake` and `FAKE_PROFILES`.
export function createFakeAgentHarness(
  clock: Clock,
  files: Pick<Files, 'write' | 'trash'>,
  timers: Timers,
  identity: FakeHarnessIdentity = FAKE_IDENTITY,
): FakeAgentHarness {
  const processes: FakeAgentProcessRecord[] = [];
  const preparedRuns: FakePreparedRun[] = [];
  const attachCalls: AgentStart[] = [];
  const attachScripts = new Map<string, FakeAttachScript>();
  const pastSessionCalls: FakePastSessionCall[] = [];
  let nextStartFailure: string | null = null;
  // The session ids starts with a null `sessionId` minted.
  let mintedSessionIds = 0;
  let nextHistoryFailure: string | null = null;
  let nextPlanUsageFailure: string | null = null;
  let askReply = FAKE_ASK_REPLY;
  let nextAskFailure: string | null = null;
  const askCalls: AgentAsk[] = [];
  const lastUsages = new Map<string, UsageAgentEvent | null>();
  const lastUsageCalls: string[] = [];
  let nextLastUsageFailure: string | null = null;
  let nextLastUsageHold: Promise<void> | null = null;
  let isEndHeld = false;
  // In call order.
  const heldEnds = new Map<FakeAgentProcessRecord, () => void>();
  let isCompactionHeld = false;
  // Each held compaction's done finish, in start order.
  const heldCompactions = new Map<FakeCompaction, () => void>();
  // Profiles `logOut` signed out and no sign-in has signed in since.
  const signedOutProfiles = new Set<string | null>();
  // Each profile's started folders, by the count of `start` calls when each
  // last started: the fake's stand-in for a modified time.
  const startedFolders = new Map<string | null, Map<string, number>>();
  let startCount = 0;
  // Each fake plan's progress by plan folder, kept across processes so a make
  // run outlives a clear.
  const workflowPlans = new Map<string, WorkflowPlan>();
  // Raises a permission request on each process record's process.
  const permissionRaisers = new Map<
    FakeAgentProcessRecord,
    (call: FakePermissionCall) => Promise<PermissionDecision>
  >();
  // By config folder.
  const installedPlugins = new Map<string, readonly InstalledPlugin[]>();
  const configFolder = (profileDir: string | null) =>
    profileDir ?? FAKE_DEFAULT_CONFIG_FOLDER;

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
    // Sends may overlap, so workflow turns are counted; `interrupt` leaves them run.
    let workflowTurnsRunning = 0;
    // The Agent entries of the subagents still running, in spawn order.
    let runningSubagents: SubagentEntry[] = [];
    // The ids of the tasks still running, in start order.
    let runningTasks: string[] = [];
    // The plan folder this process's make run works on.
    let makeFolder: string | null = null;
    let endPromise: Promise<void> | null = null;
    let visualHold: number | null = null;
    let compactionCount = 0;
    let openCompaction: FakeCompaction | null = null;
    // The newest done compaction's entry, until the next main `usage` gives its
    // after-size.
    let entryAwaitingAfterSize: CompactionEntryDraft | null = null;
    let lastMainContextTokens: number | null = null;
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
    // The permission requests waiting on an answer, by entry id.
    const waitingPermissions = new Map<
      string,
      { entry: PermissionEntry; resolve(decision: PermissionDecision): void }
    >();
    let permissionCount = 0;
    const raisePermission = (
      call: FakePermissionCall,
    ): Promise<PermissionDecision> => {
      permissionCount += 1;
      const entry: PermissionEntry = {
        kind: 'permission',
        id: `fake-permission-${permissionCount}`,
        at: clock.now(),
        toolName: call.toolName,
        input: call.input,
        summary: toolSummary(call.toolName, call.input),
        answer: null,
        raw: [{ fake: 'permission', toolUseId: call.toolUseId }],
      };
      return new Promise<PermissionDecision>((resolve) => {
        waitingPermissions.set(entry.id, { entry, resolve });
        queueMicrotask(() => events.permission({ entry }));
      });
    };
    permissionRaisers.set(record, raisePermission);
    // Settles the waiting request `id`, emitting its answered entry when
    // `isShown`; does nothing for an id not waiting.
    const settlePermission = (
      id: string,
      decision: PermissionDecision,
      isShown: boolean,
    ) => {
      const waiting = waitingPermissions.get(id);
      if (waiting === undefined) {
        return;
      }
      waitingPermissions.delete(id);
      if (isShown) {
        events.entry({
          ...waiting.entry,
          answer: { allowed: decision.allowed, reason: decision.reason },
        });
      }
      waiting.resolve(decision);
    };
    const cancelWaitingPermissions = (isShown: boolean) => {
      for (const id of waitingPermissions.keys()) {
        settlePermission(id, CANCELLED, isShown);
      }
    };
    const emitSessionEnded = () => {
      cancelWaitingPermissions(true);
      events.agentEvent({ type: 'sessionEnded', at: clock.now() });
    };
    const clearVisualHold = () => {
      if (visualHold !== null) {
        timers.clear(visualHold);
        visualHold = null;
      }
    };

    // Every main `usage` event goes through here.
    const emitMainUsage = (usage: UsageAgentEvent) => {
      if (entryAwaitingAfterSize !== null) {
        emitEntry({
          ...entryAwaitingAfterSize,
          afterTokens: usage.contextTokens,
          raw: [...entryAwaitingAfterSize.raw, { fake: 'compaction-after' }],
        });
        entryAwaitingAfterSize = null;
      }
      lastMainContextTokens = usage.contextTokens;
      events.agentEvent(usage);
    };
    const emitTurnUsage: EmitTurnUsage = (usageTurn) => {
      const usage = fakeUsageEvent(usageTurn, clock.now());
      emitMainUsage(
        entryAwaitingAfterSize === null
          ? usage
          : { ...usage, contextTokens: FAKE_COMPACTED_CONTEXT_TOKENS },
      );
    };
    const emitContextTurnUsage: EmitTurnUsage = (usageTurn) => {
      emitTurnUsage(usageTurn);
      events.agentEvent(fakeContextBreakdownEvent(clock.now()));
    };
    const emitColdTurnUsage: EmitTurnUsage = (usageTurn) => {
      const at = clock.now();
      emitMainUsage({
        ...fakeUsageEvent(usageTurn, at),
        contextTokens: FAKE_COLD_CONTEXT_TOKENS,
        cacheExpiresAt: at,
      });
    };

    const echoTurnUsage = (text: string): EmitTurnUsage => {
      if (text === FAKE_COLD_TEXT) {
        return emitColdTurnUsage;
      }
      return text === FAKE_CONTEXT_TEXT ? emitContextTurnUsage : emitTurnUsage;
    };

    const openNewCompaction = (
      trigger: CompactionTrigger,
      compactionTurn: number,
    ): FakeCompaction => {
      compactionCount += 1;
      const compaction: FakeCompaction = {
        n: compactionCount,
        trigger,
        turn: compactionTurn,
        startedAt: clock.now(),
      };
      openCompaction = compaction;
      return compaction;
    };
    // Ends the open compaction's claim on the process at call time, so that its
    // queued emissions and a later release leave its end to the caller.
    const takeOpenCompaction = (): FakeCompaction | null => {
      const compaction = openCompaction;
      openCompaction = null;
      if (compaction !== null) {
        heldCompactions.delete(compaction);
      }
      return compaction;
    };
    const emitCompactionDone = (compaction: FakeCompaction) => {
      const { trigger } = compaction;
      const beforeTokens = lastMainContextTokens;
      const entry: CompactionEntryDraft = {
        kind: 'compaction',
        id: `compaction-${compaction.n}`,
        trigger,
        beforeTokens,
        afterTokens: null,
        durationMs: clock.now() - compaction.startedAt,
        raw: [{ fake: 'compaction' }],
      };
      emitEntry(entry);
      entryAwaitingAfterSize = entry;
      events.agentEvent(
        compactionEndedEvent(clock, compaction, 'done', beforeTokens),
      );
      if (trigger !== 'harness') {
        events.agentEvent({ type: 'turnEnded', at: clock.now() });
        events.activity('idle');
        return;
      }
      const reply = 'fake agent compacted';
      emitEntry({
        kind: 'assistant',
        id: `assistant-${compaction.turn}`,
        agentId: MAIN_AGENT_ID,
        text: reply,
        streaming: false,
        raw: [{ fake: 'assistant', text: reply }],
      });
      emitTurnEnd(events, emitEntry, emitTurnUsage, clock, compaction.turn);
    };
    const emitCompactionFailed = (compaction: FakeCompaction | null) => {
      if (compaction !== null) {
        events.agentEvent(
          compactionEndedEvent(clock, compaction, 'failed', null),
        );
      }
    };
    const finishCompactionIfOpen = (compaction: FakeCompaction) => {
      if (openCompaction !== compaction) {
        return;
      }
      openCompaction = null;
      isTurnOpen = false;
      emitCompactionDone(compaction);
    };
    // Emits `compactionStarted` even for a compaction already ended in this tick:
    // its ender emits the one `compactionEnded` that pairs with it.
    const emitCompactionStarted = (compaction: FakeCompaction) => {
      compaction.startedAt = clock.now();
      events.agentEvent({
        type: 'compactionStarted',
        at: compaction.startedAt,
        trigger: compaction.trigger,
      });
      if (openCompaction !== compaction) {
        return;
      }
      if (isCompactionHeld) {
        heldCompactions.set(compaction, () =>
          finishCompactionIfOpen(compaction),
        );
        return;
      }
      finishCompactionIfOpen(compaction);
    };

    // The reply with its second visual's block open, then, after the hold, the
    // whole reply and the turn's end.
    const emitVisualTurn = (turn: number) => {
      const first = { fake: 'assistant', text: SAMPLE_VISUALS_OPEN_TEXT };
      emitEntry({
        kind: 'assistant',
        id: `assistant-${turn}`,
        agentId: MAIN_AGENT_ID,
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
          agentId: MAIN_AGENT_ID,
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
        emitTurnEnd(events, emitEntry, emitTurnUsage, clock, turn);
      }, FAKE_VISUAL_HOLD_MS);
    };

    // Starts the turn's tool, raises its permission request, then finishes the
    // tool with the decision and closes the turn, unless an interrupt, a later
    // send or the process's end came while the request waited.
    const runPermissionTurn = async (askedTurn: number) => {
      const call = permissionToolCall(askedTurn);
      startFakeTool(events, emitEntry, clock, call, 'tool');
      const decision = await raisePermission({
        toolName: call.name,
        input: call.input,
        toolUseId: call.toolUseId,
      });
      const result: ToolResult = decision.allowed
        ? { text: 'fake', isError: false }
        : { text: 'Permission denied', isError: true };
      const isStillTheTurn =
        !record.ended &&
        isTurnOpen &&
        turn === askedTurn &&
        openCompaction === null;
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
        agentId: MAIN_AGENT_ID,
        text: reply,
        streaming: false,
        raw: [{ fake: 'assistant', text: reply }],
      });
      emitTurnEnd(events, emitEntry, emitTurnUsage, clock, askedTurn);
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
        {
          name: toolName,
          input: { file_path: planPath },
          summary: toolSummary(toolName, { file_path: planPath }),
        },
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
          agentId: MAIN_AGENT_ID,
          text: reply,
          streaming: false,
          raw: [{ fake: 'assistant', text: reply }],
        });
      }
      const isInCompactionGap =
        change === 'failed' && entryAwaitingAfterSize !== null;
      emitTurnEnd(
        events,
        emitEntry,
        isInCompactionGap ? () => undefined : emitTurnUsage,
        clock,
        turn,
      );
    };

    const countWorkflowTurn = async (run: () => Promise<void>) => {
      workflowTurnsRunning += 1;
      try {
        await run();
      } finally {
        workflowTurnsRunning -= 1;
      }
    };

    const runWorkflowFeature = async (turn: number, runsSkill: boolean) => {
      const planPath = workflowPlanPathOf(record.request.projectDir);
      if (runsSkill) {
        emitWorkflowSkill(
          events,
          emitEntry,
          clock,
          turn,
          1,
          sampleQualified('feature'),
        );
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
        emitWorkflowSkill(
          events,
          emitEntry,
          clock,
          turn,
          1,
          sampleQualified('review'),
        );
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
        {
          name: 'Bash',
          input: { command },
          summary: toolSummary('Bash', { command }),
        },
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
        events.sessionId(record.sessionId);
        events.agentEvent({ type: 'sessionStarted', at: clock.now() });
        events.pid(FAKE_AGENT_PID);
        events.controls(controls);
        events.commands([
          {
            name: 'fake-command',
            description: 'A fake agent command',
            argumentHint: '',
            aliases: ['fake-alias'],
          },
        ]);
        events.activity('idle');
      });
    }
    return {
      send(message, options) {
        const { text, images } = message;
        calls.push({
          method: 'send',
          text,
          imageCount: images.length,
          ...(options?.now === true ? { now: true as const } : {}),
        });
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
            delivery: null,
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
        const cutShort = takeOpenCompaction();
        if (text === FAKE_END_TEXT) {
          record.ended = true;
          isTurnOpen = false;
          endPromise = new Promise<void>((resolve) => {
            queueMicrotask(() => {
              emitUserEntry(false);
              emitCompactionFailed(cutShort);
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
        const isTypedCompact = typedSkill(text)?.skill === 'compact';
        const isHarnessCompact = text === FAKE_COMPACT_TEXT;
        const startedCompaction =
          isTypedCompact || isHarnessCompact
            ? openNewCompaction(isTypedCompact ? 'manual' : 'harness', sentTurn)
            : null;
        isTurnOpen =
          isHold ||
          isSteps ||
          isAgents ||
          isVisual ||
          isPermission ||
          startedCompaction !== null;
        queueMicrotask(() => {
          if (cutShort !== null) {
            emitCompactionDone(cutShort);
          }
          finishSubagents(events, emitEntry, clock, runningSubagents, {
            text: 'fake subagent done',
            isError: false,
          });
          runningSubagents = [];
          emitUserEntry(true);
          if (isHold) {
            return;
          }
          if (startedCompaction !== null) {
            emitCompactionStarted(startedCompaction);
            return;
          }
          const workflowTurn = workflowTurnOf(text, makeFolder, workflowPlans);
          if (workflowTurn?.kind === 'feature') {
            void countWorkflowTurn(() =>
              runWorkflowFeature(sentTurn, workflowTurn.runsSkill),
            );
          } else if (workflowTurn?.kind === 'make') {
            makeFolder = workflowTurn.folder;
            void countWorkflowTurn(() =>
              runWorkflowMakeStep(
                sentTurn,
                workflowTurn.folder,
                workflowTurn.plan,
              ),
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
            emitToolTurn(events, emitEntry, emitTurnUsage, clock, sentTurn, {
              command: 'echo fake',
              result: { text: 'fake', isError: false },
              reply: 'fake agent ran a tool',
            });
          } else if (text === FAKE_PLAYTEST_TEXT) {
            emitToolTurn(events, emitEntry, emitTurnUsage, clock, sentTurn, {
              command: `unity command editor_play --result-only --project-path '${record.request.projectDir}'`,
              result: { text: 'Entered Play Mode.', isError: false },
              reply: 'fake agent entered Play Mode',
            });
          } else if (isVisual) {
            emitVisualTurn(sentTurn);
          } else if (text === FAKE_BLOCKS_TEXT) {
            emitBlocksTurn(events, emitEntry, emitTurnUsage, clock, sentTurn);
          } else if (isPermission) {
            void runPermissionTurn(sentTurn);
          } else {
            emitEchoTurn(
              events,
              emitEntry,
              echoTurnUsage(text),
              clock,
              sentTurn,
              text,
            );
          }
        });
        return `user-${sentTurn}`;
      },
      interrupt() {
        calls.push({ method: 'interrupt' });
        requireRunning();
        const finishBackgroundWork = () => {
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
        };
        if (!isTurnOpen) {
          if (runningTasks.length > 0 || runningSubagents.length > 0) {
            const lastTurn = turn;
            queueMicrotask(() => {
              finishBackgroundWork();
              emitEntry({
                kind: 'notice',
                id: `notice-idle-${lastTurn}`,
                text: 'Interrupted',
                tone: 'info',
                raw: [{ fake: 'interrupt' }],
              });
            });
          }
          return;
        }
        clearVisualHold();
        isTurnOpen = false;
        const interruptedTurn = turn;
        const interrupted = takeOpenCompaction();
        queueMicrotask(() => {
          // The interrupt ends the waiting tool call's ask, as Claude's ends its
          // `permission_prompt` call.
          cancelWaitingPermissions(true);
          finishBackgroundWork();
          if (interrupted !== null) {
            events.agentEvent(
              compactionEndedEvent(clock, interrupted, 'interrupted', null),
            );
          }
          // A `/compact`'s or `compact()`'s own line says it was canceled; a
          // harness compaction runs inside a model turn, whose interrupt prints none.
          const isCommandCanceled =
            interrupted !== null && interrupted.trigger !== 'harness';
          emitEntry({
            kind: 'notice',
            id:
              interrupted === null
                ? `notice-${interruptedTurn}`
                : `notice-compaction-${interrupted.n}`,
            text: isCommandCanceled ? 'Compaction canceled.' : 'Interrupted',
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
      compact() {
        calls.push({ method: 'compact' });
        requireRunning();
        if (isTurnOpen || openCompaction !== null || workflowTurnsRunning > 0) {
          throw new Error('fake agent is running a turn');
        }
        isTurnOpen = true;
        const compaction = openNewCompaction('app', turn);
        queueMicrotask(() => {
          events.agentEvent({ type: 'turnStarted', at: clock.now() });
          events.activity('working');
          emitCompactionStarted(compaction);
        });
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
        const cutShort = takeOpenCompaction();
        const isHeld = isEndHeld;
        endPromise = new Promise<void>((resolve) => {
          const exit = () => {
            emitCompactionFailed(cutShort);
            emitSessionEnded();
            events.ended({ code: 0, error: null });
            resolve();
          };
          if (isHeld) {
            heldEnds.set(record, exit);
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
        const cutShort = takeOpenCompaction();
        endPromise = new Promise<void>((resolve) => {
          queueMicrotask(() => {
            emitCompactionFailed(cutShort);
            emitSessionEnded();
            events.ended({ code: null, error: null });
            resolve();
          });
        });
      },
      detach() {
        calls.push({ method: 'detach' });
        record.detached = true;
        cancelWaitingPermissions(false);
        clearVisualHold();
        const heldEnd = heldEnds.get(record);
        heldEnds.delete(record);
        heldEnd?.();
      },
      answerPermission(requestId, decision) {
        calls.push({
          method: 'answerPermission',
          requestId,
          decision: { allowed: decision.allowed, reason: decision.reason },
        });
        queueMicrotask(() => settlePermission(requestId, decision, true));
      },
    };
  }

  // Throws the `failNextStart` message once, if one is set.
  const throwStartFailure = () => {
    if (nextStartFailure !== null) {
      const message = nextStartFailure;
      nextStartFailure = null;
      throw new Error(message);
    }
  };

  const harness: FakeAgentHarness = {
    id: identity.id,
    info: () => ({
      label: identity.label,
      capabilities: {
        interrupt: true,
        resume: true,
        images: true,
        midTurnSend: true,
      },
      clearAliases: ['reset'],
      projectConfigFolder: '.claude',
      profiles: identity.profiles,
      ...(identity.unlisted === true ? { unlisted: true } : {}),
    }),
    controls: () => startingControls({}),
    toolUseIdOf(meta) {
      const id = meta?.[FAKE_TOOL_USE_ID_META_KEY];
      return typeof id === 'string' && id !== '' ? id : null;
    },
    configRoots(profileDir) {
      const configDir = configFolder(profileDir);
      return {
        configDir,
        pluginCacheDirs: [`${configDir}/plugins/cache`],
        installedPluginsFile: `${configDir}/plugins/installed_plugins.json`,
      };
    },
    async installedPlugins(profileDir) {
      return [...(installedPlugins.get(configFolder(profileDir)) ?? [])];
    },
    setInstalledPlugins(configDir, plugins) {
      installedPlugins.set(configDir, [...plugins]);
    },
    processes,
    preparedRuns,
    attachCalls,
    pastSessionCalls,
    start(request, events) {
      throwStartFailure();
      const record: FakeAgentProcessRecord = {
        request,
        sessionId: request.sessionId ?? `fake-session-${++mintedSessionIds}`,
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
      const { sessionId } = request;
      if (sessionId === null) {
        throw new Error('attach needs a session id');
      }
      if (script === undefined) {
        return null;
      }
      if (script.outcome === 'null') {
        script.replay?.(events);
        return null;
      }
      if (script.outcome === 'reject') {
        script.replay?.(events);
        throw new Error(script.message);
      }
      const record: FakeAgentProcessRecord = {
        request,
        sessionId,
        events,
        calls: [],
        ended: false,
        attached: true,
        detached: false,
      };
      processes.push(record);
      events.sessionId(sessionId);
      script.replay(events);
      return startProcess(record, script.turns ?? 0);
    },
    scriptAttach(processId, script) {
      attachScripts.set(processId, script);
    },
    failNextStart(message) {
      nextStartFailure = message;
    },
    async prepareRun(request, firstMessage, env) {
      throwStartFailure();
      if (request.resume) {
        throw new Error('A prepared run starts a new session');
      }
      const spawn: HostedSpawn = {
        id: request.processId,
        command: FAKE_AGENT_COMMAND,
        args: [],
        cwd: request.projectDir,
        env: { ...env, [SESSION_ROW_ENV]: request.rowId },
        inheritEnv: true,
        unsetEnv: [],
        stdin: [JSON.stringify({ type: 'user', ...firstMessage })],
        idleRule: FAKE_IDLE_RULE,
        droppedOutKeys: [],
      };
      preparedRuns.push({ request, firstMessage, env, spawn });
      return spawn;
    },
    startControls: () =>
      startingControls({}).map((control) => ({ ...control, value: null })),
    capControls: (controls, cap) =>
      capPermission(controls, cap, {
        controlId: 'mode',
        order: ['plan', 'auto'],
        launchDefault: 'auto',
      }),
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
    sessionName: async () => null,
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
    configFolder,
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
    askCalls,
    async ask(request) {
      askCalls.push(request);
      const reply = askReply;
      const failure = nextAskFailure;
      nextAskFailure = null;
      await Promise.resolve();
      if (failure !== null) {
        throw new Error(failure);
      }
      return reply;
    },
    setAskReply(text) {
      askReply = text;
    },
    failNextAsk(message) {
      nextAskFailure = message;
    },
    holdEnd() {
      isEndHeld = true;
    },
    holdCompactions() {
      isCompactionHeld = true;
    },
    releaseCompactions() {
      isCompactionHeld = false;
      const released = [...heldCompactions.values()];
      heldCompactions.clear();
      queueMicrotask(() => {
        for (const finish of released) {
          finish();
        }
      });
    },
    askPermission(rowId, call) {
      const record = processes.findLast(
        (each) => each.request.rowId === rowId && !each.ended && !each.detached,
      );
      const raise =
        record === undefined ? undefined : permissionRaisers.get(record);
      if (raise === undefined) {
        return Promise.reject(
          new Error(`fake harness has no live process for row ${rowId}`),
        );
      }
      return raise(call);
    },
    releaseEnd() {
      isEndHeld = false;
      const released = [...heldEnds.values()];
      heldEnds.clear();
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
