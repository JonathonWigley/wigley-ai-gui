import {
  type AgentCommand,
  type AgentEvent,
  type AgentStart,
  type ChatEntry,
  type CompactionTrigger,
  type ControlChoice,
  MAIN_AGENT_ID,
  type PlanRowUpdate,
  type ProcessActivity,
  type SessionControl,
  type UsageAgentEvent,
  type UserDelivery,
  type UserMessage,
} from '../../../contracts/agent';
import type { PipeLine } from '../../../contracts/session-host';
import type { EntryDraft } from '../../../shared/entry-stamp';
import { isSameJson } from '../../../shared/json';
import { type TypedSkill, typedSkill } from '../../../shared/typed-skill';
import type { AgentDefinitions } from './agent-definitions';
import {
  commandRecordsOf,
  mergeInitNames,
  withNameAfterPlugin,
} from './claude-commands';
import {
  appliedControlsOf,
  type ClaudeControlId,
  CONTROL_COMMAND,
  controlValue,
  EFFORT_CLEARING_VALUE,
  isChoice,
  startingControls,
} from './claude-controls';
import { contextBreakdownOf } from './context-breakdown';
import { asArray, asJson, asString, type Json, parsed } from './json-fields';
import {
  contextUsageOf,
  configuredAutocompactLimit,
  EMPTY_SESSION_USAGE,
  foldContextUsage,
  foldReply,
  foldTurn,
  type SavedReply,
  type SessionUsageState,
  usageEvent,
  withCompactedContext,
  withSavedReplies,
} from './session-usage';
import {
  type AgentEventDraft,
  type CompactionLine,
  createStreamDecoder,
  type DecodedLine,
  type StreamDecoder,
} from './stream-decoder';
import {
  type ControlCommand,
  createTurnTracker,
  TERMINAL_STATES,
  type TurnTracker,
} from './turn-tracker';

// One Claude session's state as a fold over its pipe lines, both directions.
// The fold reads no clock, makes no random value and does no I/O: the same seed
// and the same lines give equal state and equal effects, so a live process and a
// replay of its pipe log share it. The state is mutable and one process owns it.
//
// A user entry's `delivery` reads the lines by message uuid: `sent` on its
// `started` line, `received` on the first main `message_start` or non-synthetic
// `assistant` line after a main `requesting` line named it, and on its terminal
// state or the process's close with neither, `notReceived`, or null for text that
// starts with `/` and no `requesting` line named. A fallback mode entry stays null.
//
// Replay matches live except for:
// - the "Interrupted again" notice: a call makes it, not a line, and the process
//   ends right after;
// - the agent definitions: a live line read before they load decodes without
//   them, and a replay loads them first;
// - the side inputs: the `settings.json` percent is not a pipe line, so its live
//   usage event is not replayed. A resumed session's saved replies fold ahead of
//   the log in a replay, and live when read, so a live reply that beats the read
//   keeps them out live alone;
// - order: live folds in the order the harness wrote and read, a log in the
//   order the host saw, so an `in` and an `out` line can swap. Two cases read
//   that order: fallback mode's turn end, and an interrupt that crosses its
//   turn's `result`. An interrupt's final activity and `graceDeadline` agree
//   either way; fallback mode's turn end can read working in a replay where live
//   read idle, until the next `init`;
// - what a replay leaves out: the refusal of a host request; `owedHostRequests`
//   holds the requests no refusal answered.
//
// In fallback mode a model turn's `result` ends a `/compact` queued behind it as
// `failed`, and that command's real run reads `harness`: no measured field tells
// the two `result`s apart there.

// How long an interrupt waits for the turn to end before the session shows
// idle.
export const INTERRUPT_GRACE_MS = 5000;

// The first group of the uuid on a command message the app wrote itself.
export const APP_COMMAND_UUID_PREFIX = '00000000-';

const REQUEST_ID = /^wigley-(\d+)$/;

// What `AgentProcess.compact` writes, under an app command uuid.
export const APP_COMPACT_TEXT = '/compact';
const COMPACT_COMMAND = /^\/compact(\s|$)/;
const COMPACT_CONTROL_COMMAND: ControlCommand = { id: 'compact', value: '' };

// `uuid` with its first group replaced by `APP_COMMAND_UUID_PREFIX`.
export function appCommandUuid(uuid: string): string {
  return `${APP_COMMAND_UUID_PREFIX}${uuid.slice(uuid.indexOf('-') + 1)}`;
}

// A sent message's user entry and the skill it starts (null for none), held
// until the CLI takes the message in. `draft.delivery` is null while held.
export interface HeldMessage {
  draft: Extract<EntryDraft, { kind: 'user' }>;
  skill: TypedSkill | null;
}

export function heldUserMessage({ draft }: HeldMessage): UserMessage {
  return { text: draft.text, images: draft.images };
}

// A started message's `sent` draft, until a response marks it received or it
// ends. `isRequested` means a main `requesting` line named it.
interface AwaitingResponse {
  draft: HeldMessage['draft'];
  isRequested: boolean;
}

export type PendingRequest =
  | { kind: 'mode'; value: string }
  | { kind: 'interrupt' }
  | { kind: 'stopTask'; taskId: string }
  | { kind: 'contextUsage' }
  | { kind: 'initialize' }
  | { kind: 'appliedSettings' };

// A `/compact` written and not yet taken by a compaction or ended.
interface ArmedCompact {
  uuid: string;
  trigger: Exclude<CompactionTrigger, 'harness'>;
  hasStarted: boolean;
}

// The compaction kept from its start to its closing line. `uuid` is the armed
// command it took, null for one the harness started. `hasEnded` means its
// `compactionEnded` went out while it waits for a boundary that may still come.
interface OpenCompaction {
  uuid: string | null;
  trigger: CompactionTrigger;
  startedAt: number;
  isInterruptWritten: boolean;
  hasEnded: boolean;
}

// The fold owns the compaction's start and end, because a call, a timer and the
// process's close end one as well as a line.
export interface CompactionFoldState {
  // In write order.
  armed: ArmedCompact[];
  // The command an interrupt caught before any compaction took it. It outlives
  // the tracker closing its uuid, since its compaction may still start, and the
  // caller is owed an end either way.
  interrupted: ArmedCompact | null;
  open: OpenCompaction | null;
  // The compaction interrupt grace's end, epoch ms; null when none is pending.
  // Apart from `graceDeadline`, which an interrupt reply can clear by idling the
  // session while `/compact` still runs.
  graceDeadline: number | null;
  // The newest compaction entry, until a `get_context_usage` reply or the next main
  // reply gives its after-size. No `usage` event goes out while it is set.
  awaitingAfterSize: Extract<EntryDraft, { kind: 'compaction' }> | null;
  entryCount: number;
}

export interface SessionFoldState {
  readonly decoder: StreamDecoder;
  readonly tracker: TurnTracker;
  // Empty until the harness sets the loaded ones.
  definitions: AgentDefinitions;
  controls: SessionControl[];
  // From the `initialize` answer, each `init` merged over them.
  commandRecords: AgentCommand[];
  activity: ProcessActivity;
  // User entry ids are `user-<n>`.
  sendCount: number;
  // The highest `wigley-<n>` request id an `in` line carried.
  requestCount: number;
  // Harness notice ids are `control-notice-<n>`.
  noticeCount: number;
  pendingRequests: Map<string, PendingRequest>;
  // By message uuid, in write order; never filled in fallback mode.
  heldMessages: Map<string, HeldMessage>;
  // By message uuid, in write order; never filled in fallback mode.
  awaitingResponses: Map<string, AwaitingResponse>;
  // Each entry id's first `at`.
  firstAt: Map<string, number>;
  usage: SessionUsageState;
  lastUsageEvent: UsageAgentEvent | null;
  lastStderr: string | null;
  // The interrupt grace's end, epoch ms; null when none is pending.
  graceDeadline: number | null;
  // The background tasks the CLI last listed as running.
  backgroundTaskIds: string[];
  // True from a turn's end until the next `get_context_usage` `in` line.
  isContextRequestOwed: boolean;
  // True from the start and from a turn's end until the next `get_settings` `in`
  // line.
  isSettingsRequestOwed: boolean;
  // Subtype by request id, from a host request's `out` line until the `in` line
  // answering it.
  owedHostRequests: Map<string, string>;
  compaction: CompactionFoldState;
}

export type FoldEffect =
  | { kind: 'entry'; entry: ChatEntry }
  | { kind: 'agentEvent'; event: AgentEvent }
  | { kind: 'controls'; controls: SessionControl[] }
  | { kind: 'activity'; activity: ProcessActivity }
  | { kind: 'commands'; commands: AgentCommand[] }
  | { kind: 'planUsage'; update: PlanRowUpdate }
  | { kind: 'messageQueued'; entryId: string }
  | { kind: 'messageDropped'; entryId: string; message: UserMessage }
  | { kind: 'requestContextUsage' }
  | { kind: 'requestAppliedSettings' }
  | { kind: 'refuseHostRequest'; requestId: string; subtype: string }
  | { kind: 'log'; text: string };

export interface FoldStep {
  state: SessionFoldState;
  effects: FoldEffect[];
}

// `request.resume` and `request.controls` must be what the process was launched
// with. A new session knows its context from the start; a resumed one waits for
// its transcript or its first live reply. Mode starts at the mode the launch
// passes; model and effort at the request's value, else null.
export function createSessionFoldState(request: AgentStart): SessionFoldState {
  const pendingRequests = new Map<string, PendingRequest>();
  const state: SessionFoldState = {
    // The adapter's own `get_context_usage`, `get_settings` and `initialize` replies
    // stay out of the chat.
    decoder: createStreamDecoder(
      (requestId) => {
        const kind = pendingRequests.get(requestId)?.kind;
        return (
          kind === 'contextUsage' ||
          kind === 'appliedSettings' ||
          kind === 'initialize'
        );
      },
      (agentType) => state.definitions.get(agentType) ?? null,
    ),
    tracker: createTurnTracker(),
    definitions: new Map(),
    controls: startingControls(request),
    commandRecords: [],
    activity: 'idle',
    sendCount: 0,
    requestCount: 0,
    noticeCount: 0,
    pendingRequests,
    heldMessages: new Map(),
    awaitingResponses: new Map(),
    firstAt: new Map(),
    usage: request.resume
      ? EMPTY_SESSION_USAGE
      : withSavedReplies(EMPTY_SESSION_USAGE, []),
    lastUsageEvent: null,
    lastStderr: null,
    graceDeadline: null,
    backgroundTaskIds: [],
    isContextRequestOwed: false,
    isSettingsRequestOwed: true,
    owedHostRequests: new Map(),
    compaction: {
      armed: [],
      interrupted: null,
      open: null,
      graceDeadline: null,
      awaitingAfterSize: null,
      entryCount: 0,
    },
  };
  return state;
}

function pushEntry(
  state: SessionFoldState,
  draft: EntryDraft,
  at: number,
  effects: FoldEffect[],
): void {
  const firstAt = state.firstAt.get(draft.id) ?? at;
  state.firstAt.set(draft.id, firstAt);
  const entry = { ...draft, at: firstAt } as ChatEntry;
  effects.push({ kind: 'entry', entry });
}

function pushNotice(
  state: SessionFoldState,
  notice: { text: string; tone: 'info' | 'error'; raw: unknown; at: number },
  effects: FoldEffect[],
): void {
  state.noticeCount += 1;
  pushEntry(
    state,
    {
      kind: 'notice',
      id: `control-notice-${state.noticeCount}`,
      text: notice.text,
      tone: notice.tone,
      raw: [notice.raw],
    },
    notice.at,
    effects,
  );
}

function pushAgentEvent(
  draft: AgentEventDraft,
  at: number,
  effects: FoldEffect[],
): void {
  effects.push({
    kind: 'agentEvent',
    event: { ...draft, at } as AgentEvent,
  });
}

// An `agentReplied` with the limit the profile's override gives its model's window.
function withAutocompactLimit(
  draft: AgentEventDraft,
  usage: SessionUsageState,
): AgentEventDraft {
  return draft.type === 'agentReplied'
    ? {
        ...draft,
        autocompactLimit: configuredAutocompactLimit(
          usage.configuredPercent,
          draft.contextWindow,
        ),
      }
    : draft;
}

function pushUserMessage(
  state: SessionFoldState,
  { draft, skill }: HeldMessage,
  at: number,
  effects: FoldEffect[],
): void {
  pushEntry(state, draft, at, effects);
  pushAgentEvent({ type: 'userMessage' }, at, effects);
  if (skill !== null) {
    pushAgentEvent(
      { type: 'skillStarted', agentId: MAIN_AGENT_ID, ...skill },
      at,
      effects,
    );
  }
}

// Gives the usage event when it differs from the last one in any field but
// `at`. From a boundary to the after-size the state still holds the size and the
// cache expiry from before the compaction, so nothing goes out.
function pushUsage(
  state: SessionFoldState,
  at: number,
  effects: FoldEffect[],
): void {
  if (state.compaction.awaitingAfterSize !== null) {
    return;
  }
  const event = usageEvent(state.usage, at);
  const last = state.lastUsageEvent;
  const isRepeat =
    event !== null &&
    last !== null &&
    isSameJson({ ...event, at: 0 }, { ...last, at: 0 });
  if (event === null || isRepeat) {
    return;
  }
  state.lastUsageEvent = event;
  effects.push({ kind: 'agentEvent', event });
}

function reportedControls(state: SessionFoldState): SessionControl[] {
  return state.controls.map((control) => ({ ...control }));
}

// True when the value changed.
function setControlValue(
  state: SessionFoldState,
  id: ClaudeControlId,
  value: string | null,
): boolean {
  const current = state.controls.find((control) => control.id === id);
  if (current?.value === value) {
    return false;
  }
  state.controls = state.controls.map((control) =>
    control.id === id ? { ...control, value } : control,
  );
  return true;
}

// The choices control `id` offers now; [] when the state holds no control `id`.
function controlChoices(
  state: SessionFoldState,
  id: ClaudeControlId,
): ControlChoice[] {
  return state.controls.find((control) => control.id === id)?.choices ?? [];
}

// True when the choices changed.
function setControlChoices(
  state: SessionFoldState,
  id: ClaudeControlId,
  choices: ControlChoice[],
): boolean {
  if (isSameJson(controlChoices(state, id), choices)) {
    return false;
  }
  state.controls = state.controls.map((control) =>
    control.id === id ? { ...control, choices } : control,
  );
  return true;
}

function syncActivity(state: SessionFoldState, effects: FoldEffect[]): void {
  const next = state.tracker.activity();
  if (next !== state.activity) {
    state.activity = next;
    effects.push({ kind: 'activity', activity: next });
  }
  if (next === 'idle') {
    state.graceDeadline = null;
  }
}

// The text and images of the content `userMessage` built.
function sentMessage(content: unknown): UserMessage {
  if (typeof content === 'string') {
    return { text: content, images: [] };
  }
  const blocks = asArray(content).map(asJson);
  const images = blocks
    .filter((block) => block.type === 'image')
    .map((block) => {
      const source = asJson(block.source);
      return {
        mediaType: asString(source.media_type),
        data: asString(source.data),
      };
    });
  const textBlock = blocks.find((block) => block.type === 'text');
  return { text: asString(textBlock?.text), images };
}

function controlCommandOf(text: string): ControlCommand | null {
  const typed = CONTROL_COMMAND.exec(text);
  return typed === null
    ? null
    : { id: typed[1] as ControlCommand['id'], value: typed[2] };
}

function pushCompactionEnded(
  trigger: CompactionTrigger,
  outcome: 'done' | 'failed' | 'interrupted',
  sizes: { beforeTokens: number | null; durationMs: number | null },
  at: number,
  effects: FoldEffect[],
): void {
  pushAgentEvent(
    { type: 'compactionEnded', trigger, outcome, ...sizes },
    at,
    effects,
  );
}

// An end clears the grace, unless that grace still waits on an interrupted
// command.
function markOpenCompactionEnded(
  fold: CompactionFoldState,
  open: OpenCompaction,
): void {
  open.hasEnded = true;
  if (fold.interrupted === null) {
    fold.graceDeadline = null;
  }
}

// The armed command a new compaction belongs to, taken out of the armed list:
// one an interrupt caught, the one whose `started` frame came last (the CLI starts
// messages in write order), or in fallback mode, which has no frames, the oldest.
function takeCompactCommand(state: SessionFoldState): ArmedCompact | null {
  const fold = state.compaction;
  const taken =
    fold.interrupted ??
    fold.armed.findLast((command) => command.hasStarted) ??
    (state.tracker.mode() === 'fallback' ? fold.armed.at(0) : undefined) ??
    null;
  fold.armed = fold.armed.filter((command) => command !== taken);
  return taken;
}

function startCompaction(
  state: SessionFoldState,
  at: number,
  effects: FoldEffect[],
): OpenCompaction {
  const fold = state.compaction;
  const taken = takeCompactCommand(state);
  const open: OpenCompaction = {
    uuid: taken?.uuid ?? null,
    trigger: taken?.trigger ?? 'harness',
    startedAt: at,
    isInterruptWritten: taken !== null && taken === fold.interrupted,
    hasEnded: false,
  };
  if (open.isInterruptWritten) {
    fold.interrupted = null;
  }
  fold.open = open;
  pushAgentEvent(
    { type: 'compactionStarted', trigger: open.trigger },
    at,
    effects,
  );
  return open;
}

// The compaction entry comes again with its after-size, which ends the `usage` hold.
function settleAfterSize(
  state: SessionFoldState,
  afterTokens: number,
  at: number,
  effects: FoldEffect[],
): void {
  const fold = state.compaction;
  if (fold.awaitingAfterSize === null) {
    return;
  }
  const entry = { ...fold.awaitingAfterSize, afterTokens };
  fold.awaitingAfterSize = null;
  pushEntry(state, entry, at, effects);
}

// The compaction entry goes out even when the grace already sent the end: the
// compaction happened, and history shows it.
function finishCompaction(
  state: SessionFoldState,
  line: Extract<CompactionLine, { phase: 'done' }>,
  at: number,
  effects: FoldEffect[],
): void {
  const fold = state.compaction;
  const open = fold.open ?? startCompaction(state, at, effects);
  const durationMs = line.durationMs ?? at - open.startedAt;
  const { beforeTokens } = line;
  fold.entryCount += 1;
  const entry: CompactionFoldState['awaitingAfterSize'] = {
    kind: 'compaction',
    id: `compaction-${fold.entryCount}`,
    trigger: open.trigger,
    beforeTokens,
    afterTokens: null,
    durationMs,
    raw: [line.boundary],
  };
  fold.awaitingAfterSize = entry;
  pushEntry(state, entry, at, effects);
  if (!open.hasEnded) {
    markOpenCompactionEnded(fold, open);
    pushCompactionEnded(
      open.trigger,
      'done',
      { beforeTokens, durationMs },
      at,
      effects,
    );
  }
  fold.open = null;
}

// A line closed the kept compaction with no boundary.
function closeOpenCompaction(
  fold: CompactionFoldState,
  at: number,
  effects: FoldEffect[],
): void {
  const { open } = fold;
  if (open === null) {
    return;
  }
  if (!open.hasEnded) {
    markOpenCompactionEnded(fold, open);
    pushCompactionEnded(
      open.trigger,
      open.isInterruptWritten ? 'interrupted' : 'failed',
      { beforeTokens: null, durationMs: at - open.startedAt },
      at,
      effects,
    );
  }
  fold.open = null;
}

// A command that ended with no compaction still reports one, so a caller
// waiting on `compactionEnded` is released.
function pushCompactionThatNeverRan(
  { trigger }: ArmedCompact,
  outcome: 'failed' | 'interrupted',
  at: number,
  effects: FoldEffect[],
): void {
  pushAgentEvent({ type: 'compactionStarted', trigger }, at, effects);
  pushCompactionEnded(
    trigger,
    outcome,
    { beforeTokens: null, durationMs: null },
    at,
    effects,
  );
}

function endInterruptedCommand(
  fold: CompactionFoldState,
  command: ArmedCompact,
  at: number,
  effects: FoldEffect[],
): void {
  fold.interrupted = null;
  if (fold.open === null || fold.open.hasEnded) {
    fold.graceDeadline = null;
  }
  pushCompactionThatNeverRan(command, 'interrupted', at, effects);
}

function endCompactionOnTerminalFrame(
  fold: CompactionFoldState,
  uuid: string,
  at: number,
  effects: FoldEffect[],
): void {
  if (fold.open?.uuid === uuid) {
    closeOpenCompaction(fold, at, effects);
    return;
  }
  if (fold.interrupted?.uuid === uuid) {
    endInterruptedCommand(fold, fold.interrupted, at, effects);
    return;
  }
  const command = fold.armed.find((armed) => armed.uuid === uuid);
  if (command !== undefined) {
    fold.armed = fold.armed.filter((armed) => armed !== command);
    pushCompactionThatNeverRan(command, 'failed', at, effects);
  }
}

// Turns are serial, so any `result` closes the turn a harness compaction began
// in; a stuck compaction is worse than an early `failed`. In fallback mode a
// `result` also closes every message, the armed ones included.
function endCompactionOnTurnEnd(
  state: SessionFoldState,
  turnOpener: string | null,
  at: number,
  effects: FoldEffect[],
): void {
  const fold = state.compaction;
  const isFallback = state.tracker.mode() === 'fallback';
  const { open, interrupted } = fold;
  const isOpenEnded =
    open !== null &&
    (isFallback || open.uuid === null || open.uuid === turnOpener);
  if (isOpenEnded) {
    closeOpenCompaction(fold, at, effects);
  }
  if (!isFallback) {
    return;
  }
  const oldest = fold.armed.at(0);
  fold.armed = [];
  if (interrupted !== null) {
    if (isOpenEnded) {
      fold.interrupted = null;
      fold.graceDeadline = null;
    } else {
      endInterruptedCommand(fold, interrupted, at, effects);
    }
  } else if (oldest !== undefined && !isOpenEnded) {
    pushCompactionThatNeverRan(oldest, 'failed', at, effects);
  }
}

function foldCompactionPhase(
  state: SessionFoldState,
  line: CompactionLine,
  at: number,
  effects: FoldEffect[],
): void {
  const fold = state.compaction;
  if (line.phase === 'done') {
    finishCompaction(state, line, at, effects);
  } else if (line.phase === 'failed') {
    closeOpenCompaction(fold, at, effects);
  } else if (fold.open === null || fold.open.hasEnded) {
    // One whose end was sent waits only for its boundary and blocks no new start.
    startCompaction(state, at, effects);
  }
}

// What a line says about the compaction. Each end is sent once per start, whatever
// closes it: this line, a grace (`endCompactionGrace`) or the process's close
// (`foldProcessClosed`).
function foldCompactionLine(
  state: SessionFoldState,
  decoded: DecodedLine,
  at: number,
  effects: FoldEffect[],
): void {
  const fold = state.compaction;
  const { lifecycle, compaction, replyUsage } = decoded;
  if (lifecycle?.state === 'started') {
    for (const command of fold.armed) {
      command.hasStarted ||= command.uuid === lifecycle.uuid;
    }
  }
  if (compaction !== null) {
    foldCompactionPhase(state, compaction, at, effects);
  }
  if (replyUsage !== null) {
    settleAfterSize(state, replyUsage.contextTokens, at, effects);
  }
  if (decoded.turnEnded) {
    endCompactionOnTurnEnd(state, decoded.turnOpener, at, effects);
  }
  if (lifecycle !== null && TERMINAL_STATES.has(lifecycle.state)) {
    endCompactionOnTerminalFrame(fold, lifecycle.uuid, at, effects);
  }
}

// Probe B measured a plain interrupt stopping `/compact`: a `failed` status ends
// the compaction `interrupted` well before this grace. The grace is the guard for
// an interrupt that does not stop it (a later boundary then sends only its entry),
// and for one that comes before the command's first status. A command queued
// behind a running turn is out of its reach: it still runs.
function armCompactionGrace(state: SessionFoldState, at: number): void {
  const fold = state.compaction;
  const { open } = fold;
  if (open !== null && !open.hasEnded) {
    open.isInterruptWritten = true;
  } else if (fold.interrupted === null) {
    const running = runningCompactCommand(state);
    if (running === undefined) {
      return;
    }
    fold.armed = fold.armed.filter((command) => command !== running);
    fold.interrupted = running;
  }
  fold.graceDeadline ??= at + INTERRUPT_GRACE_MS;
}

// The armed command that is the message running: started, or next up with no turn
// open.
function runningCompactCommand(
  state: SessionFoldState,
): ArmedCompact | undefined {
  const { armed } = state.compaction;
  const nextUp = state.tracker.isTurnOpen() ? null : state.tracker.oldestOpen();
  return (
    armed.findLast((command) => command.hasStarted) ??
    armed.find((command) => command.uuid === nextUp)
  );
}

// A `/compact` past its first status prints its own synthetic
// `Compaction canceled.` line when interrupted. A model turn's interrupt prints
// none, and neither does one before the status.
function isInterruptShownByCompaction({
  compaction: { open },
  tracker,
}: SessionFoldState): boolean {
  const isCommandCompacting =
    open !== null && !open.hasEnded && open.uuid !== null;
  return isCommandCompacting && !tracker.isTurnOpen();
}

// Nothing will end the armed commands, so the app's gets its end here: its caller
// waits on it.
function endOwedAppCommands(
  fold: CompactionFoldState,
  at: number,
  effects: FoldEffect[],
): void {
  for (const command of fold.armed) {
    if (command.trigger === 'app') {
      pushCompactionThatNeverRan(command, 'failed', at, effects);
    }
  }
  fold.armed = [];
}

// The tracker closed its uuids, and a compaction whose end went out has nothing
// left to wait for.
function forgetEndedCompaction(fold: CompactionFoldState): void {
  if (fold.open?.hasEnded === true) {
    fold.open = null;
  }
}

function foldUserLine(
  state: SessionFoldState,
  message: Json,
  uuid: string,
  at: number,
  effects: FoldEffect[],
): void {
  const { text, images } = sentMessage(asJson(message.message).content);
  const command = controlCommandOf(text);
  const isCompact = COMPACT_COMMAND.test(text);
  const isAppCommand = uuid.startsWith(APP_COMMAND_UUID_PREFIX);
  if (isCompact) {
    state.compaction.armed.push({
      uuid,
      trigger: isAppCommand ? 'app' : 'manual',
      hasStarted: false,
    });
  }
  if (isAppCommand) {
    state.tracker.written(uuid, isCompact ? COMPACT_CONTROL_COMMAND : command);
    return;
  }
  state.sendCount += 1;
  const sent: HeldMessage = {
    draft: {
      kind: 'user',
      id: `user-${state.sendCount}`,
      text,
      images,
      delivery: null,
      raw: [message],
    },
    // Claude prints no skill line for a typed skill, so it starts with the
    // message.
    skill: command === null ? typedSkill(text) : null,
  };
  if (state.tracker.mode() === 'fallback') {
    pushUserMessage(state, sent, at, effects);
  } else {
    state.heldMessages.set(uuid, sent);
  }
  state.tracker.written(uuid, command);
}

function foldRequestLine(
  state: SessionFoldState,
  message: Json,
  at: number,
  effects: FoldEffect[],
): void {
  const requestId = asString(message.request_id);
  const match = REQUEST_ID.exec(requestId);
  if (match === null) {
    return;
  }
  state.requestCount = Math.max(state.requestCount, Number(match[1]));
  const request = asJson(message.request);
  if (request.subtype === 'get_context_usage') {
    state.pendingRequests.set(requestId, { kind: 'contextUsage' });
    state.isContextRequestOwed = false;
  } else if (request.subtype === 'get_settings') {
    state.pendingRequests.set(requestId, { kind: 'appliedSettings' });
    state.isSettingsRequestOwed = false;
  } else if (request.subtype === 'initialize') {
    state.pendingRequests.set(requestId, { kind: 'initialize' });
  } else if (request.subtype === 'stop_task') {
    state.pendingRequests.set(requestId, {
      kind: 'stopTask',
      taskId: asString(request.task_id),
    });
  } else if (request.subtype === 'interrupt') {
    state.pendingRequests.set(requestId, { kind: 'interrupt' });
    state.graceDeadline = at + INTERRUPT_GRACE_MS;
    armCompactionGrace(state, at);
    if (!isInterruptShownByCompaction(state)) {
      pushNotice(
        state,
        { text: 'Interrupted', tone: 'info', raw: message, at },
        effects,
      );
    }
  } else if (request.subtype === 'set_permission_mode') {
    state.pendingRequests.set(requestId, {
      kind: 'mode',
      value: asString(request.mode),
    });
  }
}

function foldInLine(
  state: SessionFoldState,
  line: PipeLine,
  effects: FoldEffect[],
): void {
  const json = parsed(line.text);
  if (!json.ok) {
    return;
  }
  const message = asJson(json.value);
  if (message.type === 'user' && typeof message.uuid === 'string') {
    foldUserLine(state, message, message.uuid, line.at, effects);
  } else if (message.type === 'control_request') {
    foldRequestLine(state, message, line.at, effects);
  } else if (message.type === 'control_response') {
    state.owedHostRequests.delete(
      asString(asJson(message.response).request_id),
    );
  }
}

// Reports a held message queued on its `queued` line, gives its entry on its
// `started` line, and reports one that ended without starting as dropped.
function releaseHeldMessage(
  state: SessionFoldState,
  lifecycle: NonNullable<DecodedLine['lifecycle']>,
  at: number,
  effects: FoldEffect[],
): void {
  const held = state.heldMessages.get(lifecycle.uuid);
  if (held === undefined) {
    return;
  }
  if (lifecycle.state === 'queued') {
    effects.push({ kind: 'messageQueued', entryId: held.draft.id });
  } else if (lifecycle.state === 'started') {
    state.heldMessages.delete(lifecycle.uuid);
    const draft: HeldMessage['draft'] = { ...held.draft, delivery: 'sent' };
    pushUserMessage(state, { ...held, draft }, at, effects);
    state.awaitingResponses.set(lifecycle.uuid, { draft, isRequested: false });
  } else if (TERMINAL_STATES.has(lifecycle.state)) {
    state.heldMessages.delete(lifecycle.uuid);
    effects.push({
      kind: 'messageDropped',
      entryId: held.draft.id,
      message: heldUserMessage(held),
    });
  }
}

function releaseAllHeldMessages(
  state: SessionFoldState,
  at: number,
  effects: FoldEffect[],
): void {
  for (const held of state.heldMessages.values()) {
    pushUserMessage(state, held, at, effects);
  }
  state.heldMessages.clear();
}

// Sends the entry again in its final state. It sends no `userMessage` or skill
// event: those went out with `sent`.
function endAwaitingResponse(
  state: SessionFoldState,
  uuid: string,
  { draft, isRequested }: AwaitingResponse,
  at: number,
  effects: FoldEffect[],
): void {
  const isLocalCommand = draft.text.startsWith('/') && !isRequested;
  const delivery: UserDelivery | null = isLocalCommand ? null : 'notReceived';
  pushEntry(state, { ...draft, delivery }, at, effects);
  state.awaitingResponses.delete(uuid);
}

function foldMessageDelivery(
  state: SessionFoldState,
  { requestedMessages, responseStarted, lifecycle }: DecodedLine,
  at: number,
  effects: FoldEffect[],
): void {
  const { awaitingResponses } = state;
  for (const uuid of requestedMessages) {
    const awaiting = awaitingResponses.get(uuid);
    if (awaiting !== undefined) {
      awaiting.isRequested = true;
    }
  }
  if (responseStarted) {
    for (const [uuid, { draft, isRequested }] of awaitingResponses) {
      if (isRequested) {
        pushEntry(state, { ...draft, delivery: 'received' }, at, effects);
        awaitingResponses.delete(uuid);
      }
    }
  }
  if (lifecycle !== null && TERMINAL_STATES.has(lifecycle.state)) {
    const awaiting = awaitingResponses.get(lifecycle.uuid);
    if (awaiting !== undefined) {
      endAwaitingResponse(state, lifecycle.uuid, awaiting, at, effects);
    }
  }
}

// A control command's success sets the control, since the turn's init still
// reports the value from before. `/effort auto` clears effort. Claude answers a
// refused value with a success result too, so any other value outside the
// control's choices changes nothing. A known value is reported even when the
// control already held it, since that report confirms a pick of the held value.
// The app's `/compact` sets no control.
function foldControlValues(
  state: SessionFoldState,
  decoded: DecodedLine,
  command: ControlCommand | null,
  effects: FoldEffect[],
): void {
  let hasChanged = false;
  for (const [id, value] of Object.entries(decoded.reported)) {
    const controlId = id as ClaudeControlId;
    const held = controlValue(
      controlId,
      value,
      controlChoices(state, controlId),
    );
    hasChanged = setControlValue(state, controlId, held) || hasChanged;
  }
  if (command !== null && command.id !== 'compact' && !decoded.turnFailed) {
    const value = controlValue(
      command.id,
      command.value,
      controlChoices(state, command.id),
    );
    const clearsEffort =
      command.id === 'effort' && value === EFFORT_CLEARING_VALUE;
    if (isChoice(state.controls, command.id, value)) {
      setControlValue(state, command.id, value);
      hasChanged = true;
    } else if (clearsEffort) {
      hasChanged = setControlValue(state, command.id, null) || hasChanged;
    }
  }
  if (hasChanged) {
    effects.push({ kind: 'controls', controls: reportedControls(state) });
  }
}

function foldLineUsage(
  state: SessionFoldState,
  decoded: DecodedLine,
  at: number,
  effects: FoldEffect[],
): void {
  const { planRows, replyUsage, turnUsage } = decoded;
  if (planRows !== null) {
    effects.push({ kind: 'planUsage', update: { rows: planRows, at } });
  }
  if (replyUsage !== null) {
    state.usage = foldReply(state.usage, replyUsage, at);
  }
  if (turnUsage !== null) {
    state.usage = foldTurn(state.usage, turnUsage);
  }
  if (replyUsage !== null || turnUsage !== null) {
    pushUsage(state, at, effects);
  }
}

function foldAppliedSettings(
  state: SessionFoldState,
  response: NonNullable<DecodedLine['controlResponse']>,
  effects: FoldEffect[],
): void {
  if (response.error !== null) {
    effects.push({
      kind: 'log',
      text: `get_settings failed: ${response.error}`,
    });
    return;
  }
  const applied = appliedControlsOf(response.response);
  if (applied === null) {
    effects.push({
      kind: 'log',
      text: 'get_settings reply has no applied model',
    });
    return;
  }
  const { model, effort } = applied;
  const hasModelChanged = setControlValue(
    state,
    'model',
    controlValue('model', model, controlChoices(state, 'model')),
  );
  const hasEffortChanged = setControlValue(
    state,
    'effort',
    effort === null
      ? null
      : controlValue('effort', effort, controlChoices(state, 'effort')),
  );
  if (hasModelChanged || hasEffortChanged) {
    effects.push({ kind: 'controls', controls: reportedControls(state) });
  }
}

// The `models` of an `initialize` answer's data as model choices, in order: each
// item with a `value`, labelled by its `displayName`, else by its `value`. []
// when the field is no list or no item has a `value`.
function modelChoicesOf(initializeReply: Json): ControlChoice[] {
  return asArray(initializeReply.models).flatMap((item) => {
    const model = asJson(item);
    const value = asString(model.value);
    if (value === '') {
      return [];
    }
    const displayName = asString(model.displayName);
    return [{ value, label: displayName === '' ? value : displayName }];
  });
}

// A failed answer only logs: the list waits for `init`, the controls keep what
// they hold, and the user lost nothing they can act on. A success answer sets
// the command list, the model control's choices and the mode control's value
// from whichever of `commands`, `models` and `current_permission_mode` it holds.
function foldInitializeAnswer(
  state: SessionFoldState,
  response: NonNullable<DecodedLine['controlResponse']>,
  effects: FoldEffect[],
): void {
  if (response.error !== null) {
    effects.push({
      kind: 'log',
      text: `Could not list commands: ${response.error}`,
    });
    return;
  }
  const reply = response.response;
  if (Array.isArray(reply.commands)) {
    state.commandRecords = commandRecordsOf(reply);
    effects.push({
      kind: 'commands',
      commands: withNameAfterPlugin(state.commandRecords),
    });
  } else {
    effects.push({
      kind: 'log',
      text: 'Could not list commands: no list in the answer',
    });
  }
  const modelChoices = modelChoicesOf(reply);
  if (modelChoices.length === 0) {
    effects.push({ kind: 'log', text: 'initialize listed no models' });
  }
  const hasChoicesChanged =
    modelChoices.length > 0 && setControlChoices(state, 'model', modelChoices);
  const permissionMode = asString(reply.current_permission_mode);
  const hasModeChanged =
    permissionMode !== '' &&
    setControlValue(
      state,
      'mode',
      controlValue('mode', permissionMode, controlChoices(state, 'mode')),
    );
  if (hasChoicesChanged || hasModeChanged) {
    effects.push({ kind: 'controls', controls: reportedControls(state) });
  }
}

// An `init` with no names leaves the held list, so a malformed line cannot empty
// a good one.
function foldInitNames(
  state: SessionFoldState,
  names: readonly string[],
  effects: FoldEffect[],
): void {
  if (names.length === 0) {
    return;
  }
  state.commandRecords = mergeInitNames(state.commandRecords, names);
  effects.push({
    kind: 'commands',
    commands: withNameAfterPlugin(state.commandRecords),
  });
}

function answerControlResponse(
  state: SessionFoldState,
  response: NonNullable<DecodedLine['controlResponse']>,
  at: number,
  effects: FoldEffect[],
): void {
  const pending = state.pendingRequests.get(response.requestId);
  if (pending === undefined) {
    return;
  }
  state.pendingRequests.delete(response.requestId);
  if (pending.kind === 'contextUsage') {
    if (response.error !== null) {
      effects.push({
        kind: 'log',
        text: `get_context_usage failed: ${response.error}`,
      });
      return;
    }
    const contextUsage = contextUsageOf(response.response);
    const { totalTokens } = contextUsage;
    state.usage = foldContextUsage(state.usage, contextUsage);
    // `post_tokens` counts the conversation messages only, not the system prompt and tools `pre_tokens` holds, so the
    // after-size is this total or the next main reply's context (claude-stream.md § Compaction).
    if (totalTokens !== null && state.compaction.awaitingAfterSize !== null) {
      state.usage = withCompactedContext(state.usage, totalTokens);
      settleAfterSize(state, totalTokens, at, effects);
    }
    pushUsage(state, at, effects);
    const configuredLimit = configuredAutocompactLimit(
      state.usage.configuredPercent,
      state.usage.contextWindow,
    );
    const breakdown = contextBreakdownOf(
      response.response,
      at,
      configuredLimit,
    );
    if (breakdown !== null) {
      effects.push({ kind: 'agentEvent', event: breakdown });
    }
    return;
  }
  if (pending.kind === 'appliedSettings') {
    foldAppliedSettings(state, response, effects);
    return;
  }
  if (pending.kind === 'stopTask') {
    if (response.error !== null) {
      effects.push({
        kind: 'log',
        text: `stop_task ${pending.taskId} failed: ${response.error}`,
      });
    }
    return;
  }
  if (pending.kind === 'interrupt') {
    if (response.error !== null) {
      pushNotice(
        state,
        {
          text: `Could not interrupt: ${response.error}`,
          tone: 'error',
          raw: response,
          at,
        },
        effects,
      );
    }
    state.tracker.interruptAnswered();
    if (state.tracker.activity() === 'idle') {
      forgetEndedCompaction(state.compaction);
    }
    return;
  }
  if (pending.kind === 'initialize') {
    foldInitializeAnswer(state, response, effects);
    return;
  }
  if (response.error !== null) {
    pushNotice(
      state,
      {
        text: `Could not set Mode to ${pending.value}: ${response.error}`,
        tone: 'error',
        raw: response,
        at,
      },
      effects,
    );
    return;
  }
  if (setControlValue(state, 'mode', pending.value)) {
    effects.push({ kind: 'controls', controls: reportedControls(state) });
  }
}

function foldOutLine(
  state: SessionFoldState,
  line: PipeLine,
  effects: FoldEffect[],
): void {
  const { at } = line;
  const decoded = state.decoder.decode(line.text);
  const { command, fellBack } = state.tracker.read(decoded);
  if (decoded.lifecycle !== null) {
    releaseHeldMessage(state, decoded.lifecycle, at, effects);
  }
  foldMessageDelivery(state, decoded, at, effects);
  if (fellBack) {
    releaseAllHeldMessages(state, at, effects);
  }
  for (const entry of decoded.entries) {
    const isCommandResult = command !== null && entry.kind === 'result';
    if (!isCommandResult) {
      pushEntry(state, entry, at, effects);
    }
  }
  if (fellBack) {
    effects.push({
      kind: 'log',
      text: 'msg_lifecycle_v1 missing from init capabilities; tracking turns by results',
    });
    pushNotice(
      state,
      {
        text: 'This Claude Code version reports no message lifecycle; the working state follows turn results only.',
        tone: 'info',
        raw: line.text,
        at,
      },
      effects,
    );
  }
  for (const draft of decoded.agentEvents) {
    pushAgentEvent(withAutocompactLimit(draft, state.usage), at, effects);
  }
  foldCompactionLine(state, decoded, at, effects);
  foldControlValues(state, decoded, command, effects);
  if (decoded.commands !== null) {
    foldInitNames(state, decoded.commands, effects);
  }
  foldLineUsage(state, decoded, at, effects);
  if (decoded.backgroundTaskIds !== null) {
    state.backgroundTaskIds = decoded.backgroundTaskIds;
  }
  if (decoded.controlResponse !== null) {
    answerControlResponse(state, decoded.controlResponse, at, effects);
  }
  if (decoded.hostRequest !== null) {
    const { requestId, subtype } = decoded.hostRequest;
    state.owedHostRequests.set(requestId, subtype);
    effects.push({ kind: 'refuseHostRequest', requestId, subtype });
  }
  if (decoded.turnEnded) {
    state.graceDeadline = null;
    state.isContextRequestOwed = true;
    effects.push({ kind: 'requestContextUsage' });
    state.isSettingsRequestOwed = true;
    effects.push({ kind: 'requestAppliedSettings' });
  }
}

// Folds one line after ending a grace whose deadline the line's time passed, so
// the grace's effects come before the line's own.
export function foldPipeLine(
  state: SessionFoldState,
  line: PipeLine,
): FoldStep {
  const { effects } = advanceFold(state, line.at);
  if (line.dir === 'in') {
    foldInLine(state, line, effects);
  } else if (line.dir === 'out') {
    foldOutLine(state, line, effects);
  } else {
    state.lastStderr = line.text;
    effects.push({ kind: 'log', text: line.text });
  }
  syncActivity(state, effects);
  return { state, effects };
}

// The earliest deadline `advanceFold` waits on, null when none is pending.
export function nextFoldDeadline(state: SessionFoldState): number | null {
  const deadlines = [
    state.graceDeadline,
    state.compaction.graceDeadline,
  ].filter((deadline) => deadline !== null);
  return deadlines.length === 0 ? null : Math.min(...deadlines);
}

// Ends every grace `at` has reached. What it sends is stamped at the deadline,
// however late the call.
export function advanceFold(state: SessionFoldState, at: number): FoldStep {
  const effects: FoldEffect[] = [];
  endInterruptGrace(state, at, effects);
  endCompactionGrace(state.compaction, at, effects);
  return { state, effects };
}

function endInterruptGrace(
  state: SessionFoldState,
  at: number,
  effects: FoldEffect[],
): void {
  const deadline = state.graceDeadline;
  if (deadline === null || at < deadline) {
    return;
  }
  state.graceDeadline = null;
  if (state.activity !== 'working') {
    return;
  }
  state.tracker.abandon();
  endOwedAppCommands(state.compaction, deadline, effects);
  forgetEndedCompaction(state.compaction);
  const grace = `${INTERRUPT_GRACE_MS / 1000} s`;
  pushNotice(
    state,
    {
      text: `The agent did not stop within ${grace}; showing the session idle.`,
      tone: 'info',
      raw: null,
      at: deadline,
    },
    effects,
  );
  effects.push({
    kind: 'log',
    text: `interrupt unanswered after ${grace}; dropping turn state`,
  });
  syncActivity(state, effects);
}

// The compaction stays kept after this end: its boundary may still come.
function endCompactionGrace(
  fold: CompactionFoldState,
  at: number,
  effects: FoldEffect[],
): void {
  const deadline = fold.graceDeadline;
  if (deadline === null || at < deadline) {
    return;
  }
  fold.graceDeadline = null;
  if (fold.interrupted !== null) {
    endInterruptedCommand(fold, fold.interrupted, deadline, effects);
  }
  const { open } = fold;
  if (open?.isInterruptWritten === true && !open.hasEnded) {
    markOpenCompactionEnded(fold, open);
    pushCompactionEnded(
      open.trigger,
      'interrupted',
      { beforeTokens: null, durationMs: deadline - open.startedAt },
      deadline,
      effects,
    );
  }
}

// The process closed: a compaction still running ends here, before `sessionEnded`,
// and so do a command that never got to run and a message awaiting its response.
export function foldProcessClosed(
  state: SessionFoldState,
  at: number,
): FoldStep {
  const effects: FoldEffect[] = [];
  for (const [uuid, awaiting] of state.awaitingResponses) {
    endAwaitingResponse(state, uuid, awaiting, at, effects);
  }
  const fold = state.compaction;
  const { open } = fold;
  if (open !== null && !open.hasEnded) {
    pushCompactionEnded(
      open.trigger,
      'failed',
      { beforeTokens: null, durationMs: at - open.startedAt },
      at,
      effects,
    );
  }
  if (fold.interrupted !== null) {
    endInterruptedCommand(fold, fold.interrupted, at, effects);
  }
  endOwedAppCommands(fold, at, effects);
  fold.open = null;
  fold.graceDeadline = null;
  return { state, effects };
}

// Applies a usage input no pipe line records.
export function foldUsageInput(
  state: SessionFoldState,
  change: (usage: SessionUsageState) => SessionUsageState,
  at: number,
): FoldStep {
  const effects: FoldEffect[] = [];
  state.usage = change(state.usage);
  pushUsage(state, at, effects);
  return { state, effects };
}

// Folds `savedReplies` (null when the process is not resumed or they could not be
// read) at the replay's start, then `log` in order, ends a grace `now` passed, and
// returns what a replay emits. It writes nothing, gives no plan update, and gives
// each entry id once, at its first place, carrying its last version.
export function replayPipeLog(
  state: SessionFoldState,
  log: readonly PipeLine[],
  now: number,
  savedReplies: readonly SavedReply[] | null,
): FoldEffect[] {
  const startedAt = log.at(0)?.at ?? now;
  const folded: FoldEffect[] = [];
  if (savedReplies !== null) {
    const seeded = foldUsageInput(
      state,
      (usage) => withSavedReplies(usage, savedReplies),
      startedAt,
    );
    folded.push(...seeded.effects);
  }
  for (const line of log) {
    folded.push(...foldPipeLine(state, line).effects);
  }
  folded.push(...advanceFold(state, now).effects);
  const lastEntries = new Map<string, ChatEntry>();
  let lastCommands: AgentCommand[] | null = null;
  for (const effect of folded) {
    if (effect.kind === 'entry') {
      lastEntries.set(effect.entry.id, effect.entry);
    } else if (effect.kind === 'commands') {
      lastCommands = effect.commands;
    }
  }
  const replayed: FoldEffect[] = [
    {
      kind: 'agentEvent',
      event: { type: 'sessionStarted', at: startedAt },
    },
  ];
  const emittedIds = new Set<string>();
  for (const effect of folded) {
    if (effect.kind === 'agentEvent' || effect.kind === 'messageDropped') {
      replayed.push(effect);
    } else if (effect.kind === 'entry' && !emittedIds.has(effect.entry.id)) {
      emittedIds.add(effect.entry.id);
      replayed.push({
        kind: 'entry',
        entry: lastEntries.get(effect.entry.id) ?? effect.entry,
      });
    }
  }
  replayed.push({ kind: 'controls', controls: reportedControls(state) });
  if (lastCommands !== null) {
    replayed.push({ kind: 'commands', commands: lastCommands });
  }
  replayed.push({ kind: 'activity', activity: state.activity });
  return replayed;
}
