import {
  type AgentEvent,
  type AgentStart,
  type ChatEntry,
  MAIN_AGENT_ID,
  type PlanRowUpdate,
  type ProcessActivity,
  type SessionControl,
  type UsageAgentEvent,
  type UserMessage,
} from '../../contracts/agent';
import type { PipeLine } from '../../contracts/session-host';
import type { EntryDraft } from '../../shared/entry-stamp';
import { isSameJson } from '../../shared/json';
import { type TypedSkill, typedSkill } from '../../shared/typed-skill';
import type { AgentDefinitions } from './agent-definitions';
import {
  CLAUDE_CONTROLS,
  type ClaudeControlId,
  CONTROL_COMMAND,
  controlValue,
  isChoice,
} from './claude-controls';
import { asArray, asJson, asString, type Json, parsed } from './json-fields';
import {
  contextUsageOf,
  EMPTY_SESSION_USAGE,
  foldContextUsage,
  foldReply,
  foldTurn,
  type SessionUsageState,
  usageEvent,
  withSavedReplies,
} from './session-usage';
import {
  type AgentEventDraft,
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
// Replay matches live except for:
// - the "Interrupted again" notice: a call makes it, not a line, and the process
//   ends right after;
// - the agent definitions: a live line read before they load decodes without
//   them, and a replay loads them first;
// - the side inputs: the `settings.json` percent and a resumed session's saved
//   replies are not pipe lines, so their live usage events are not replayed;
// - order: live folds in the order the harness wrote and read, a log in the
//   order the host saw, so an `in` and an `out` line can swap. Two cases read
//   that order: fallback mode's turn end, and an interrupt that crosses its
//   turn's `result`. The final activity and `graceDeadline` agree either way.

// How long an interrupt waits for the turn to end before the session shows
// idle.
export const INTERRUPT_GRACE_MS = 5000;

// The first group of the uuid on a command message the app wrote itself.
export const APP_COMMAND_UUID_PREFIX = '00000000-';

const REQUEST_ID = /^wigley-(\d+)$/;

// `uuid` with its first group replaced by `APP_COMMAND_UUID_PREFIX`.
export function appCommandUuid(uuid: string): string {
  return `${APP_COMMAND_UUID_PREFIX}${uuid.slice(uuid.indexOf('-') + 1)}`;
}

// A sent message's user entry and the skill it starts (null for none), held
// until the CLI takes the message in.
export interface HeldMessage {
  draft: EntryDraft;
  skill: TypedSkill | null;
}

export type PendingRequest =
  | { kind: 'mode'; value: string }
  | { kind: 'interrupt' }
  | { kind: 'contextUsage' };

export interface SessionFoldState {
  readonly decoder: StreamDecoder;
  readonly tracker: TurnTracker;
  // Empty until the harness sets the loaded ones.
  definitions: AgentDefinitions;
  controls: SessionControl[];
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
  // Each entry id's first `at`.
  firstAt: Map<string, number>;
  usage: SessionUsageState;
  lastUsageEvent: UsageAgentEvent | null;
  lastStderr: string | null;
  // The interrupt grace's end, epoch ms; null when none is pending.
  graceDeadline: number | null;
  // True from a turn's end until the next `get_context_usage` `in` line.
  isContextRequestOwed: boolean;
}

export type FoldEffect =
  | { kind: 'entry'; entry: ChatEntry }
  | { kind: 'agentEvent'; event: AgentEvent }
  | { kind: 'controls'; controls: SessionControl[] }
  | { kind: 'activity'; activity: ProcessActivity }
  | { kind: 'commands'; commands: string[] }
  | { kind: 'planUsage'; update: PlanRowUpdate }
  | { kind: 'messageDropped'; entryId: string }
  | { kind: 'requestContextUsage' }
  | { kind: 'refuseHostRequest'; requestId: string; subtype: string }
  | { kind: 'log'; text: string };

export interface FoldStep {
  state: SessionFoldState;
  effects: FoldEffect[];
}

// `request.resume` must be the value the process was launched with. A new
// session knows its context from the start; a resumed one waits for its
// transcript or its first live reply.
export function createSessionFoldState(request: AgentStart): SessionFoldState {
  const pendingRequests = new Map<string, PendingRequest>();
  const state: SessionFoldState = {
    // The adapter's own `get_context_usage` replies stay out of the chat.
    decoder: createStreamDecoder(
      (requestId) => pendingRequests.get(requestId)?.kind === 'contextUsage',
      (agentType) => state.definitions.get(agentType) ?? null,
    ),
    tracker: createTurnTracker(),
    definitions: new Map(),
    controls: CLAUDE_CONTROLS.map((control) => ({
      ...control,
      value: request.controls[control.id] ?? null,
    })),
    activity: 'idle',
    sendCount: 0,
    requestCount: 0,
    noticeCount: 0,
    pendingRequests,
    heldMessages: new Map(),
    firstAt: new Map(),
    usage: request.resume
      ? EMPTY_SESSION_USAGE
      : withSavedReplies(EMPTY_SESSION_USAGE, []),
    lastUsageEvent: null,
    lastStderr: null,
    graceDeadline: null,
    isContextRequestOwed: false,
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
// `at`.
function pushUsage(
  state: SessionFoldState,
  at: number,
  effects: FoldEffect[],
): void {
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

function foldUserLine(
  state: SessionFoldState,
  message: Json,
  uuid: string,
  at: number,
  effects: FoldEffect[],
): void {
  const { text, images } = sentMessage(asJson(message.message).content);
  const command = controlCommandOf(text);
  if (uuid.startsWith(APP_COMMAND_UUID_PREFIX)) {
    state.tracker.written(uuid, command);
    return;
  }
  state.sendCount += 1;
  const sent: HeldMessage = {
    draft: {
      kind: 'user',
      id: `user-${state.sendCount}`,
      text,
      images,
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
  } else if (request.subtype === 'interrupt') {
    state.pendingRequests.set(requestId, { kind: 'interrupt' });
    state.graceDeadline = at + INTERRUPT_GRACE_MS;
    pushNotice(
      state,
      { text: 'Interrupted', tone: 'info', raw: message, at },
      effects,
    );
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
  }
}

// Gives a held message's entry on its `started` line, and reports one that
// ended without starting as dropped.
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
  if (lifecycle.state === 'started') {
    state.heldMessages.delete(lifecycle.uuid);
    pushUserMessage(state, held, at, effects);
  } else if (TERMINAL_STATES.has(lifecycle.state)) {
    state.heldMessages.delete(lifecycle.uuid);
    effects.push({ kind: 'messageDropped', entryId: held.draft.id });
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

// A control command's success sets the control, since the turn's init still
// reports the value from before. A value that is not among the control's
// choices leaves the control unknown.
function foldControlValues(
  state: SessionFoldState,
  decoded: DecodedLine,
  command: ControlCommand | null,
  effects: FoldEffect[],
): void {
  let hasChanged = false;
  for (const [id, value] of Object.entries(decoded.reported)) {
    const controlId = id as ClaudeControlId;
    hasChanged =
      setControlValue(state, controlId, controlValue(controlId, value)) ||
      hasChanged;
  }
  if (command !== null && !decoded.turnFailed) {
    const value = controlValue(command.id, command.value);
    const known = isChoice(command.id, value) ? value : null;
    hasChanged = setControlValue(state, command.id, known) || hasChanged;
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
    state.usage = foldContextUsage(
      state.usage,
      contextUsageOf(response.response),
    );
    pushUsage(state, at, effects);
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
    pushAgentEvent(draft, at, effects);
  }
  foldControlValues(state, decoded, command, effects);
  if (decoded.commands !== null) {
    effects.push({ kind: 'commands', commands: decoded.commands });
  }
  foldLineUsage(state, decoded, at, effects);
  if (decoded.controlResponse !== null) {
    answerControlResponse(state, decoded.controlResponse, at, effects);
  }
  if (decoded.hostRequest !== null) {
    effects.push({ kind: 'refuseHostRequest', ...decoded.hostRequest });
  }
  if (decoded.turnEnded) {
    state.graceDeadline = null;
    state.isContextRequestOwed = true;
    effects.push({ kind: 'requestContextUsage' });
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

// Ends the interrupt grace once `at` reaches its deadline. Its notice is stamped
// at the deadline, however late the call.
export function advanceFold(state: SessionFoldState, at: number): FoldStep {
  const effects: FoldEffect[] = [];
  const deadline = state.graceDeadline;
  if (deadline === null || at < deadline) {
    return { state, effects };
  }
  state.graceDeadline = null;
  if (state.activity !== 'working') {
    return { state, effects };
  }
  state.tracker.abandon();
  const grace = `${INTERRUPT_GRACE_MS / 1000} s`;
  pushNotice(
    state,
    {
      text: `Claude did not stop within ${grace}; showing the session idle.`,
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

// Folds `log` in order, ends a grace `now` passed, and returns what a replay
// emits. It writes nothing, gives no plan update, and gives each entry id once,
// at its first place, carrying its last version.
export function replayPipeLog(
  state: SessionFoldState,
  log: readonly PipeLine[],
  now: number,
): FoldEffect[] {
  const folded: FoldEffect[] = [];
  for (const line of log) {
    folded.push(...foldPipeLine(state, line).effects);
  }
  folded.push(...advanceFold(state, now).effects);
  const lastEntries = new Map<string, ChatEntry>();
  let lastCommands: string[] | null = null;
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
      event: { type: 'sessionStarted', at: log.at(0)?.at ?? now },
    },
  ];
  const emittedIds = new Set<string>();
  for (const effect of folded) {
    if (effect.kind === 'agentEvent') {
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
