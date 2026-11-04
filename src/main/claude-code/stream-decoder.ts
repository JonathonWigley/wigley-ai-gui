import {
  type AgentEvent,
  MAIN_AGENT_ID,
  type PlanRowPatch,
  type UsageAgentEvent,
} from '../../contracts/agent';
import type { AgentDefinition } from './agent-definitions';
import type { ClaudeControlId } from './claude-controls';
import type { EntryDraft, WithoutAt } from '../../shared/entry-stamp';
import { isJsonObject } from '../../shared/json';
import {
  asArray,
  asJson,
  asString,
  type Json,
  numberOrNull,
  parsed,
} from './json-fields';
import { CONTEXT_SUFFIX, replySpendUsd } from './model-prices';
import { rateLimitRows } from './plan-usage';
import {
  replyInputTokens,
  type ReplyUsage,
  replyUsageOf,
  type TurnUsage,
  turnUsageOf,
} from './session-usage';
import { pairToolResult, type ToolEntry, toolUseEntry } from './tool-entries';
import { SYNTHETIC_MODEL } from './transcripts';

// What one stdout line of `claude` in stream-json mode means to the chat.
// `entries` are whole entries, not yet stamped with `at`, each replacing an
// earlier one with its id; `reported` holds control values as Claude names
// them (`controlValue` maps them); `turnFailed` is true on a turn-ending line
// that reports an error; `turnUnrequested` is true on a `result` whose
// `origin` marks a turn Claude ran with no stdin message behind it.
// `turnStarted` is true on a `system/init`, and `capabilities` holds that
// init's `capabilities` strings, null on any other line; `lifecycle` is a
// `command_lifecycle` line's `command_uuid` and `state`; `turnOpener` is a
// `result`'s `user_message_uuid` and `turnMessages` its `user_message_uuids`.
// `agentEvents` are the line's agent events other than
// `usage`, not yet stamped with `at`, in the order the line gave them. The
// usage side channels: `planRows` from a `rate_limit_event`, `replyUsage` from
// a main-conversation reply, `turnUsage` from every `result`;
// `controlResponse.response` is the reply's data, `{}` when it carries none.
export interface DecodedLine {
  entries: EntryDraft[];
  agentEvents: AgentEventDraft[];
  reported: Partial<Record<ClaudeControlId, string>>;
  commands: string[] | null;
  turnEnded: boolean;
  turnFailed: boolean;
  turnUnrequested: boolean;
  turnStarted: boolean;
  capabilities: string[] | null;
  lifecycle: { uuid: string; state: string } | null;
  turnOpener: string | null;
  turnMessages: string[];
  controlResponse: {
    requestId: string;
    error: string | null;
    response: Json;
  } | null;
  hostRequest: { requestId: string; subtype: string } | null;
  planRows: PlanRowPatch[] | null;
  replyUsage: ReplyUsage | null;
  turnUsage: TurnUsage | null;
}

// An agent event as the decoder builds it, before it is stamped with its `at`.
// `usage` is left out: the harness builds it from the usage side channels.
export type AgentEventDraft = WithoutAt<Exclude<AgentEvent, UsageAgentEvent>>;

export interface StreamDecoder {
  decode(line: string): DecodedLine;
}

type TextEntry = Extract<EntryDraft, { kind: 'assistant' | 'thinking' }>;
type RawEntry = Extract<EntryDraft, { kind: 'raw' }>;

const LOCAL_OUTPUT_OPEN = '<local-command-stdout>';
const LOCAL_OUTPUT_CLOSE = '</local-command-stdout>';

const TEXT_KINDS: Readonly<Record<string, TextEntry['kind']>> = {
  text: 'assistant',
  thinking: 'thinking',
};
const ID_PREFIXES: Readonly<Record<TextEntry['kind'], string>> = {
  assistant: 'text',
  thinking: 'thinking',
};

// System subtypes that join the turn's events entry; any other subtype is a
// new CLI event and gets a raw entry of its own.
const GATHERED_SYSTEM_SUBTYPES: ReadonlySet<string> = new Set([
  'init',
  'status',
  'hook_started',
  'hook_response',
  'thinking_tokens',
]);

// The `origin.kind` of a `result` Claude ran on its own: a subagent's
// hand-back and the task notification after it.
const UNREQUESTED_ORIGINS: ReadonlySet<string> = new Set([
  'peer',
  'task-notification',
]);

// The names of the tool that starts a subagent: the `tool_use` carries
// `Agent`, and init's tool list still names it `Task`.
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);
// The type Claude gives an Agent call whose input names none.
const DEFAULT_AGENT_TYPE = 'general-purpose';
// The tool that runs a skill: its input names the skill and, when passed, its
// args.
const SKILL_TOOL = 'Skill';
// The input field that names the file each file-changing tool writes.
const WRITE_TOOL_PATHS: Readonly<Record<string, string>> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

// What the decoder last knows of a subagent. `sentWindow` is the context window
// its last `agentReplied` carried.
interface SubagentFacts {
  model: string;
  contextTokens: number | null;
  sentWindow: number | null;
}

function emptyLine(): DecodedLine {
  return {
    entries: [],
    agentEvents: [],
    reported: {},
    commands: null,
    turnEnded: false,
    turnFailed: false,
    turnUnrequested: false,
    turnStarted: false,
    capabilities: null,
    lifecycle: null,
    turnOpener: null,
    turnMessages: [],
    controlResponse: null,
    hostRequest: null,
    planRows: null,
    replyUsage: null,
    turnUsage: null,
  };
}

// A copy the decoder's later changes cannot reach.
function snapshot<E extends EntryDraft>(entry: E): E {
  return { ...entry, raw: [...entry.raw] };
}

// `slash_commands` then `skills`, without a leading `/`, first kept.
function commandNames(init: Json): string[] {
  const names = [...asArray(init.slash_commands), ...asArray(init.skills)].map(
    (name) => asString(name).replace(/^\//, ''),
  );
  return [...new Set(names)];
}

// The string items of a list field; [] when the field is no list.
function stringItems(value: unknown): string[] {
  return asArray(value).filter((item) => typeof item === 'string');
}

// The agent whose line `event` is: a subagent's lines carry its Agent call's id.
function agentOf(event: Json): string {
  return typeof event.parent_tool_use_id === 'string'
    ? event.parent_tool_use_id
    : MAIN_AGENT_ID;
}

// The text of a message's text content, a string or text blocks.
function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return asArray(content)
    .map((block) => asJson(block))
    .filter((block) => block.type === 'text')
    .map((block) => asString(block.text))
    .join('\n');
}

// A Skill call of `agentId` that names its skill starts that skill.
function reportSkillCall(
  name: string,
  input: Json,
  agentId: string,
  out: DecodedLine,
) {
  const skill = asString(input.skill);
  if (name !== SKILL_TOOL || skill === '') {
    return;
  }
  out.agentEvents.push({
    type: 'skillStarted',
    agentId,
    skill,
    args: asString(input.args).trim(),
  });
}

// One decoder reads one process's stdout: it keeps the entries it built, so a
// later line updates them. An event joins the entry it belongs to; a known
// event that belongs to none joins the turn's events entry, one raw entry per
// turn re-sent as it grows, which an event between turns joins too; an event
// of a type the decoder does not know gets a raw entry of its own. An entry is
// re-sent whenever it changes, its `raw` included, except a thinking entry's
// `system/thinking_tokens`: those arrive once per delta, so they ride with the
// entry's next send, which the block's `content_block_stop` brings, or the
// turn's result when an interrupt ends the block with no stop. Of the stream
// events, an entry's `raw` keeps only a text or thinking block's
// `content_block_start`; every other stream event is left out, since the
// entry's start event or the final `assistant` event holds its content. A
// `control_response` whose request id `isKeptOut` names joins no entry.
// `definitionOf` gives the agent definition of an Agent call's type, null when
// none is known.
export function createStreamDecoder(
  isKeptOut: (requestId: string) => boolean = () => false,
  definitionOf: (agentType: string) => AgentDefinition | null = () => null,
): StreamDecoder {
  const textEntries = new Map<string, TextEntry>();
  const toolEntries = new Map<string, ToolEntry>();
  // Stream entries an assistant event has already confirmed.
  const confirmed = new Set<string>();
  // The current message id and open blocks of each stream, keyed by
  // `parent_tool_use_id` (null for the main conversation). A result closes
  // every block still open.
  const currentMessage = new Map<string | null, string>();
  const openBlocks = new Map<string, TextEntry>();
  // The thinking block streaming last, which `system/thinking_tokens` joins.
  let openThinking: TextEntry | null = null;
  // Assistant blocks with no streamed entry, per message id.
  const unstreamedCounts = new Map<string, number>();
  // Agent calls with no `tool_result` and no end event yet, in spawn order,
  // each mapped to the agent that made the call.
  const pendingAgents = new Map<string, string>();
  // Background Agent calls whose launch receipt came, waiting for their end
  // event.
  const launchedAgents = new Set<string>();
  // The agent each pending tool call runs under, by tool call id.
  const toolAgents = new Map<string, string>();
  // The file each pending write call writes, by tool call id.
  const writePaths = new Map<string, string>();
  // Each subagent's Agent call id, by the subagent's `task_id`; kept after the
  // subagent ends, so a task it started still names it.
  const subagentTasks = new Map<string, string>();
  // Tasks started and not yet ended, by `task_id`.
  const startedTasks = new Set<string>();
  // Each subagent's reply spends by message id, by its Agent call id: null for
  // a reply whose model has no list price.
  const replySpends = new Map<string, Map<string, number | null>>();
  // Each subagent with a known model, by its Agent call id, until it ends. A
  // late reply may re-create an ended one's entry, which nothing reads again.
  const subagentFacts = new Map<string, SubagentFacts>();
  // The context windows results have named, by `modelUsage` key.
  const modelWindows = new Map<string, number>();
  let rawCount = 0;
  let turnCount = 0;
  // The events entry gathered events join: the first gathered event opens the
  // first one (the start hooks, ahead of the first init), and each later
  // turn's `system/init`, which starts every turn, opens that turn's. From a
  // result to the next init it stays the ended turn's, so an event with no
  // turn running joins the turn before.
  let turnEvents: RawEntry | null = null;
  // True from a result until the next turn's init.
  let betweenTurns = false;
  let noticeCount = 0;
  let resultCount = 0;
  // `total_cost_usd` is the process's cost so far.
  let lastTotalCost = 0;
  // The model of the main conversation's last reply, whose context window a
  // result reports.
  let lastMainModel: string | null = null;

  // An event of a type the decoder does not know, alone in its entry.
  function rawEntry(raw: unknown): EntryDraft {
    rawCount += 1;
    return { kind: 'raw', id: `raw-${rawCount}`, raw: [raw] };
  }

  // The events entry with `event` added; `startsTurn` marks a turn's init.
  function gathered(event: unknown, startsTurn = false): EntryDraft {
    let entry = turnEvents;
    if (entry === null || (startsTurn && betweenTurns)) {
      turnCount += 1;
      entry = { kind: 'raw', id: `turn-events-${turnCount}`, raw: [] };
      turnEvents = entry;
    }
    if (startsTurn) {
      betweenTurns = false;
    }
    entry.raw.push(event);
    return snapshot(entry);
  }

  // Every block still open, closed and re-sent: an interrupt can end a block
  // with no `content_block_stop`, leaving it streaming and its folded
  // `system/thinking_tokens` unsent.
  function closeOpenBlocks(out: DecodedLine) {
    for (const entry of openBlocks.values()) {
      entry.streaming = false;
      out.entries.push(snapshot(entry));
    }
    openBlocks.clear();
    openThinking = null;
  }

  function noticeEntry(
    text: string,
    tone: 'info' | 'error',
    raw: unknown,
  ): EntryDraft {
    noticeCount += 1;
    return {
      kind: 'notice',
      id: `notice-${noticeCount}`,
      text,
      tone,
      raw: [raw],
    };
  }

  // A `tool_use` block starts a subagent when it calls the Agent tool, and a
  // tool call of the line's agent otherwise, described by `summary`; a Skill
  // call also starts its skill, and a write call keeps its path for its result.
  // A spawn's model and effort are the call's own inputs, else its type's
  // definition's.
  function startAgentOrTool(
    block: Json,
    event: Json,
    summary: string,
    out: DecodedLine,
  ) {
    const id = asString(block.id);
    const name = asString(block.name);
    const agentId = agentOf(event);
    const input = asJson(block.input);
    if (!SUBAGENT_TOOLS.has(name)) {
      toolAgents.set(id, agentId);
      out.agentEvents.push({
        type: 'toolStarted',
        agentId,
        toolUseId: id,
        tool: name,
        summary,
      });
      reportSkillCall(name, input, agentId, out);
      keepWritePath(id, name, input);
      return;
    }
    pendingAgents.set(id, agentId);
    const agentType = asString(input.subagent_type) || DEFAULT_AGENT_TYPE;
    const definition = definitionOf(agentType);
    out.agentEvents.push({
      type: 'agentSpawned',
      agentId: id,
      parentAgentId: agentId,
      agentType,
      description: asString(input.description),
      name: asString(input.name) || agentType,
      model: asString(input.model) || (definition?.model ?? null),
      effort: asString(input.effort) || (definition?.effort ?? null),
    });
  }

  // The subagent's estimated spend over its recorded replies; null before its
  // first reply or when any reply has no price.
  function spendOf(agentId: string): number | null {
    const spends = replySpends.get(agentId);
    if (spends === undefined) {
      return null;
    }
    let total = 0;
    for (const spend of spends.values()) {
      if (spend === null) {
        return null;
      }
      total += spend;
    }
    return total;
  }

  // Every window a result's `modelUsage` names. A result that names a `[…]` key
  // and drops the plain key replaces the plain key's window. `modelUsage` is
  // cumulative, so a model moved to `[…]` mid-process usually keeps both keys, and
  // a subagent replying under the plain id keeps the plain window.
  function learnWindows(modelUsage: Json) {
    for (const [key, usage] of Object.entries(modelUsage)) {
      const window = asJson(usage).contextWindow;
      if (typeof window !== 'number') {
        continue;
      }
      modelWindows.set(key, window);
      const plainKey = key.replace(CONTEXT_SUFFIX, '');
      if (!Object.hasOwn(modelUsage, plainKey)) {
        modelWindows.delete(plainKey);
      }
    }
  }

  // The window of the entry keyed `model`, else of the entry keyed `model` with
  // a `[…]` suffix; null when no result named either.
  function windowFor(model: string): number | null {
    const exact = modelWindows.get(model);
    if (exact !== undefined) {
      return exact;
    }
    for (const [key, window] of modelWindows) {
      if (key.replace(CONTEXT_SUFFIX, '') === model) {
        return window;
      }
    }
    return null;
  }

  // Keeps a subagent's latest model and context and reports them with its spend
  // so far and its model's window.
  function reportSubagentFacts(
    agentId: string,
    model: string,
    contextTokens: number | null,
    out: DecodedLine,
  ) {
    const contextWindow = windowFor(model);
    subagentFacts.set(agentId, {
      model,
      contextTokens,
      sentWindow: contextWindow,
    });
    out.agentEvents.push({
      type: 'agentReplied',
      agentId,
      model,
      spendUsd: spendOf(agentId),
      contextTokens,
      contextWindow,
    });
  }

  // A subagent's model reply records its spend under its message id (Claude
  // sends one line per content block, each with the message's usage) and
  // reports the agent's model, spend so far and context.
  function reportSubagentReply(event: Json, message: Json, out: DecodedLine) {
    const agentId = event.parent_tool_use_id;
    const model = message.model;
    const isSubagentReply =
      typeof agentId === 'string' &&
      typeof model === 'string' &&
      model !== SYNTHETIC_MODEL &&
      isJsonObject(message.usage);
    if (!isSubagentReply) {
      return;
    }
    const spends = replySpends.get(agentId) ?? new Map<string, number | null>();
    replySpends.set(agentId, spends);
    const usage = asJson(message.usage);
    spends.set(asString(message.id), replySpendUsd(model, usage));
    reportSubagentFacts(agentId, model, replyInputTokens(usage), out);
  }

  function keepWritePath(id: string, name: string, input: Json) {
    const path = Object.hasOwn(WRITE_TOOL_PATHS, name)
      ? asString(input[WRITE_TOOL_PATHS[name]])
      : '';
    if (path !== '') {
      writePaths.set(id, path);
    }
  }

  // An agent's end also fails every Agent call still pending under it, nested
  // calls included, since a foreground call cannot outlive the agent waiting
  // on it: the agent finishes first, then its calls breadth-first, each level
  // in its parents' order and then in spawn order under each parent. A launched
  // background call waits for its own end event. Each ending agent's open tool
  // calls fail just ahead of its `agentFinished`, and its kept facts go.
  function finishAgent(agentId: string, isOk: boolean, out: DecodedLine) {
    const ending = [agentId];
    for (let index = 0; index < ending.length; index += 1) {
      const endingId = ending[index];
      pendingAgents.delete(endingId);
      launchedAgents.delete(endingId);
      subagentFacts.delete(endingId);
      failOpenTools(endingId, out);
      out.agentEvents.push({
        type: 'agentFinished',
        agentId: endingId,
        outcome: isOk && endingId === agentId ? 'done' : 'failed',
      });
      for (const [callId, parentAgentId] of pendingAgents) {
        if (parentAgentId === endingId) {
          ending.push(callId);
        }
      }
    }
  }

  // Every tool call still open under an ending agent, finished as failed and
  // forgotten, so a later `tool_result` for one finishes nothing.
  function failOpenTools(agentId: string, out: DecodedLine) {
    for (const [toolUseId, toolAgentId] of toolAgents) {
      if (toolAgentId === agentId) {
        toolAgents.delete(toolUseId);
        writePaths.delete(toolUseId);
        out.agentEvents.push({
          type: 'toolFinished',
          agentId,
          toolUseId,
          ok: false,
        });
      }
    }
  }

  // A pending Agent call's `tool_result` is its subagent's end, except a
  // background call's launch receipt, which reports it launched and leaves it
  // running until its end event. Any other paired result finishes its tool
  // call, and an ok result of a write call reports its file written. The receipt check
  // reads the line's `tool_use_result`, which describes the whole line: it
  // assumes a user line carries one `tool_result`, as every measured one did.
  function finishAgentOrTool(block: Json, event: Json, out: DecodedLine) {
    const id = asString(block.tool_use_id);
    const isOk = block.is_error !== true;
    if (pendingAgents.has(id)) {
      reportResolvedModel(id, event, out);
      const isLaunchReceipt =
        isOk && asJson(event.tool_use_result).isAsync === true;
      if (isLaunchReceipt) {
        pendingAgents.delete(id);
        launchedAgents.add(id);
        out.agentEvents.push({ type: 'agentLaunched', agentId: id });
        return;
      }
      finishAgent(id, isOk, out);
      return;
    }
    const agentId = toolAgents.get(id);
    if (agentId === undefined) {
      return;
    }
    toolAgents.delete(id);
    const path = writePaths.get(id);
    writePaths.delete(id);
    out.agentEvents.push({
      type: 'toolFinished',
      agentId,
      toolUseId: id,
      ok: isOk,
    });
    if (isOk && path !== undefined) {
      out.agentEvents.push({ type: 'fileWritten', agentId, path });
    }
  }

  // An Agent call's receipt names the model its subagent runs on.
  function reportResolvedModel(agentId: string, event: Json, out: DecodedLine) {
    const model = asString(asJson(event.tool_use_result).resolvedModel);
    if (model === '') {
      return;
    }
    const contextTokens = subagentFacts.get(agentId)?.contextTokens ?? null;
    reportSubagentFacts(agentId, model, contextTokens, out);
  }

  // Each running subagent whose model's window has changed since its last
  // `agentReplied` gets one with the new window.
  function reportChangedWindows(out: DecodedLine) {
    for (const agentId of [...pendingAgents.keys(), ...launchedAgents]) {
      const facts = subagentFacts.get(agentId);
      const hasNewWindow =
        facts !== undefined && windowFor(facts.model) !== facts.sentWindow;
      if (hasNewWindow) {
        reportSubagentFacts(agentId, facts.model, facts.contextTokens, out);
      }
    }
  }

  // A subagent's end event; it also comes for other background tasks, whose
  // `tool_use_id` is no Agent call's.
  function finishByNotification(event: Json, out: DecodedLine) {
    const id = asString(event.tool_use_id);
    if (pendingAgents.has(id) || launchedAgents.has(id)) {
      finishAgent(id, event.status === 'completed', out);
    }
  }

  // A `local_agent` start pairs a subagent's `task_id` with its Agent call;
  // any other typed start begins a task of the subagent its `parent_task_id`
  // names, or of the main agent, running the `command` input of the tool call
  // its `tool_use_id` names.
  function startTask(event: Json, out: DecodedLine) {
    const taskId = asString(event.task_id);
    const taskType = asString(event.task_type);
    if (taskType === 'local_agent') {
      subagentTasks.set(taskId, asString(event.tool_use_id));
      return;
    }
    if (taskType === '' || startedTasks.has(taskId)) {
      return;
    }
    startedTasks.add(taskId);
    out.agentEvents.push({
      type: 'taskStarted',
      taskId,
      agentId:
        subagentTasks.get(asString(event.parent_task_id)) ?? MAIN_AGENT_ID,
      description: asString(event.description),
      command:
        asString(
          asJson(toolEntries.get(asString(event.tool_use_id))?.input).command,
        ) || null,
    });
  }

  function finishTask(event: Json, out: DecodedLine) {
    const taskId = asString(event.task_id);
    if (!startedTasks.delete(taskId)) {
      return;
    }
    out.agentEvents.push({
      type: 'taskFinished',
      taskId,
      outcome: event.status === 'completed' ? 'done' : 'failed',
    });
  }

  // A turn's result fails every Agent call the main agent made that is still
  // pending, a guard for a call whose end never came, and with it the calls
  // pending under that call. A launched background call waits for its end
  // event, and so does a call a running subagent made: a background subagent
  // keeps running past the main turn's result, and a call ends with its parent.
  function failPendingAgents(out: DecodedLine) {
    for (const [agentId, parentAgentId] of pendingAgents) {
      if (parentAgentId === MAIN_AGENT_ID) {
        finishAgent(agentId, false, out);
      }
    }
  }

  function decodeSystem(event: Json, out: DecodedLine) {
    if (event.subtype === 'task_started') {
      startTask(event, out);
    }
    if (event.subtype === 'task_notification') {
      finishByNotification(event, out);
      finishTask(event, out);
    }
    if (event.subtype === 'compact_boundary') {
      // `post_tokens` counts the conversation messages only, not the system prompt and tools `pre_tokens` holds, so
      // the after-size is left to the next usage event (claude-stream.md § Compaction).
      out.agentEvents.push({
        type: 'compacted',
        beforeTokens: numberOrNull(asJson(event.compact_metadata).pre_tokens),
        afterTokens: null,
      });
    }
    if (event.subtype === 'init') {
      out.agentEvents.push({ type: 'turnStarted' });
      out.turnStarted = true;
      out.capabilities = stringItems(event.capabilities);
      out.commands = commandNames(event);
      if (typeof event.permissionMode === 'string') {
        out.reported.mode = event.permissionMode;
      }
      if (typeof event.model === 'string') {
        out.reported.model = event.model;
      }
    }
    const isModeStatus =
      event.subtype === 'status' && typeof event.permissionMode === 'string';
    if (isModeStatus) {
      out.reported.mode = event.permissionMode as string;
    }
    const isThinkingTokens = event.subtype === 'thinking_tokens';
    if (isThinkingTokens && openThinking !== null) {
      openThinking.raw.push(event);
      return;
    }
    out.entries.push(
      GATHERED_SYSTEM_SUBTYPES.has(asString(event.subtype))
        ? gathered(event, event.subtype === 'init')
        : rawEntry(event),
    );
  }

  function decodeStreamEvent(event: Json, out: DecodedLine) {
    const stream =
      typeof event.parent_tool_use_id === 'string'
        ? event.parent_tool_use_id
        : null;
    const inner = asJson(event.event);
    const blockKey = `${stream ?? ''}:${String(inner.index)}`;
    if (inner.type === 'message_start') {
      currentMessage.set(stream, asString(asJson(inner.message).id));
      return;
    }
    if (inner.type === 'content_block_start') {
      const kind = TEXT_KINDS[asString(asJson(inner.content_block).type)];
      if (kind === undefined) {
        return;
      }
      const messageId = currentMessage.get(stream) ?? '';
      const entry: TextEntry = {
        kind,
        id: `${ID_PREFIXES[kind]}-${messageId}-${String(inner.index)}`,
        text: '',
        streaming: true,
        raw: [event],
      };
      textEntries.set(entry.id, entry);
      openBlocks.set(blockKey, entry);
      if (kind === 'thinking') {
        openThinking = entry;
      }
      out.entries.push(snapshot(entry));
      return;
    }
    const entry = openBlocks.get(blockKey);
    if (entry === undefined) {
      return;
    }
    if (inner.type === 'content_block_delta') {
      const delta = asJson(inner.delta);
      const isOwnDelta =
        (delta.type === 'text_delta' && entry.kind === 'assistant') ||
        (delta.type === 'thinking_delta' && entry.kind === 'thinking');
      const addedText = asString(
        entry.kind === 'assistant' ? delta.text : delta.thinking,
      );
      // Claude streams no thinking text: each thinking delta adds "".
      if (!isOwnDelta || addedText === '') {
        return;
      }
      entry.text += addedText;
      out.entries.push(snapshot(entry));
      return;
    }
    if (inner.type === 'content_block_stop') {
      openBlocks.delete(blockKey);
      if (openThinking === entry) {
        openThinking = null;
      }
      entry.streaming = false;
      out.entries.push(snapshot(entry));
    }
  }

  // The streamed entry an assistant block confirms: the first of its message
  // and kind not yet confirmed, since blocks complete in order, one per
  // assistant event.
  function streamedEntry(
    kind: TextEntry['kind'],
    messageId: string,
  ): TextEntry | undefined {
    const idStart = `${ID_PREFIXES[kind]}-${messageId}-`;
    for (const entry of textEntries.values()) {
      const isCandidate =
        entry.kind === kind &&
        entry.id.startsWith(idStart) &&
        !confirmed.has(entry.id);
      if (isCandidate) {
        return entry;
      }
    }
    return undefined;
  }

  function unstreamedEntry(
    kind: TextEntry['kind'],
    messageId: string,
    text: string,
    event: Json,
  ): TextEntry {
    const position = unstreamedCounts.get(messageId) ?? 0;
    unstreamedCounts.set(messageId, position + 1);
    const entry: TextEntry = {
      kind,
      id: `${ID_PREFIXES[kind]}-${messageId}-f${position}`,
      text,
      streaming: false,
      raw: [event],
    };
    textEntries.set(entry.id, entry);
    confirmed.add(entry.id);
    return entry;
  }

  // The assistant block's text stands over the streamed one: an interrupt can
  // end the stream short of the block.
  function decodeTextBlock(
    kind: TextEntry['kind'],
    messageId: string,
    block: Json,
    event: Json,
  ): TextEntry {
    const text = asString(kind === 'assistant' ? block.text : block.thinking);
    const entry = streamedEntry(kind, messageId);
    if (entry === undefined) {
      return unstreamedEntry(kind, messageId, text, event);
    }
    confirmed.add(entry.id);
    entry.text = text;
    entry.streaming = false;
    entry.raw.push(event);
    return entry;
  }

  function toolEntry(block: Json, event: Json): ToolEntry {
    const entry = toolUseEntry(
      `tool-${asString(block.id)}`,
      block,
      event,
      agentOf(event),
    );
    toolEntries.set(entry.toolUseId, entry);
    return entry;
  }

  // A subagent's reply is out of scope, and a synthetic reply's zero usage
  // would reset the context, so only a main model reply reports usage.
  function readReplyUsage(event: Json, message: Json, out: DecodedLine) {
    const isMainReply =
      typeof event.parent_tool_use_id !== 'string' &&
      message.model !== SYNTHETIC_MODEL;
    if (!isMainReply || !isJsonObject(message.usage)) {
      return;
    }
    out.replyUsage = replyUsageOf(message.usage);
    lastMainModel = typeof message.model === 'string' ? message.model : null;
  }

  function decodeAssistant(event: Json, out: DecodedLine) {
    const message = asJson(event.message);
    readReplyUsage(event, message, out);
    reportSubagentReply(event, message, out);
    if (message.model === SYNTHETIC_MODEL) {
      const text = messageText(message.content).trim();
      out.entries.push(
        text === '' ? gathered(event) : noticeEntry(text, 'info', event),
      );
      return;
    }
    const messageId = asString(message.id);
    for (const item of asArray(message.content)) {
      const block = asJson(item);
      const kind = TEXT_KINDS[asString(block.type)];
      if (kind !== undefined) {
        out.entries.push(
          snapshot(decodeTextBlock(kind, messageId, block, event)),
        );
      } else if (block.type === 'tool_use') {
        const entry = toolEntry(block, event);
        out.entries.push(snapshot(entry));
        startAgentOrTool(block, event, entry.summary, out);
      }
    }
  }

  function decodeToolResult(block: Json, event: Json): EntryDraft {
    const entry = pairToolResult(toolEntries, block, event);
    return entry === undefined ? rawEntry(event) : snapshot(entry);
  }

  // Tool results pair with their tool entries. Local command output (the
  // `set_model` replay) wrapped in `<local-command-stdout>` is a notice; any
  // other text (the interrupt marker) joins the turn's events.
  function decodeUser(event: Json, out: DecodedLine) {
    const content = asJson(event.message).content;
    const toolResults = asArray(content)
      .map((block) => asJson(block))
      .filter((block) => block.type === 'tool_result');
    if (toolResults.length > 0) {
      for (const block of toolResults) {
        out.entries.push(decodeToolResult(block, event));
        finishAgentOrTool(block, event, out);
      }
      return;
    }
    const text = messageText(content).trim();
    const isLocalOutput = text.startsWith(LOCAL_OUTPUT_OPEN);
    const output = text
      .replace(LOCAL_OUTPUT_OPEN, '')
      .replace(LOCAL_OUTPUT_CLOSE, '')
      .trim();
    out.entries.push(
      isLocalOutput && output !== ''
        ? noticeEntry(output, 'info', event)
        : gathered(event),
    );
  }

  // An error turn's stop reason is its subtype: an interrupted turn reports
  // the `stop_reason` of the last message it finished. A cumulative total below
  // the last one has no turn share, so its cost is null. A result ends the
  // turn's open blocks, and its events entry takes events until the next init.
  // Every result ends a turn of the main conversation, an unrequested one
  // included, and teaches the windows its `modelUsage` names.
  function decodeResult(event: Json, out: DecodedLine) {
    closeOpenBlocks(out);
    failPendingAgents(out);
    learnWindows(asJson(event.modelUsage));
    reportChangedWindows(out);
    out.agentEvents.push({ type: 'turnEnded' });
    const isError = event.is_error === true;
    out.turnEnded = true;
    out.turnUsage = turnUsageOf(event, lastMainModel);
    out.turnFailed = isError;
    out.turnUnrequested = UNREQUESTED_ORIGINS.has(
      asString(asJson(event.origin).kind),
    );
    out.turnOpener =
      typeof event.user_message_uuid === 'string'
        ? event.user_message_uuid
        : null;
    out.turnMessages = stringItems(event.user_message_uuids);
    const errorText = asString(event.result);
    if (isError && errorText !== '') {
      out.entries.push(noticeEntry(errorText, 'error', event));
    }
    const hasStopReason = !isError && typeof event.stop_reason === 'string';
    const totalCost = event.total_cost_usd;
    const hasTurnShare =
      typeof totalCost === 'number' && totalCost >= lastTotalCost;
    let costUsd: number | null = null;
    if (hasTurnShare) {
      costUsd = totalCost - lastTotalCost;
      lastTotalCost = totalCost;
    }
    resultCount += 1;
    out.entries.push({
      kind: 'result',
      id: `result-${resultCount}`,
      stopReason: hasStopReason
        ? (event.stop_reason as string)
        : asString(event.subtype),
      costUsd,
      durationMs: numberOrNull(event.duration_ms),
      raw: [event],
    });
    betweenTurns = true;
  }

  function decodeControlResponse(event: Json, out: DecodedLine) {
    const response = asJson(event.response);
    const isError = response.subtype === 'error';
    const requestId = asString(response.request_id);
    out.controlResponse = {
      requestId,
      error: isError ? asString(response.error) || 'unknown error' : null,
      response: asJson(response.response),
    };
    if (!isKeptOut(requestId)) {
      out.entries.push(gathered(event));
    }
  }

  function decodeControlRequest(event: Json, out: DecodedLine) {
    out.hostRequest = {
      requestId: asString(event.request_id),
      subtype: asString(asJson(event.request).subtype),
    };
    out.entries.push(gathered(event));
  }

  // A heartbeat's `parent_tool_use_id` is the pending call's id, not a
  // subagent's.
  function decodeToolProgress(event: Json, out: DecodedLine) {
    const entry = toolEntries.get(asString(event.parent_tool_use_id));
    if (entry === undefined) {
      out.entries.push(gathered(event));
      return;
    }
    entry.raw.push(event);
    out.entries.push(snapshot(entry));
  }

  function decodeRateLimit(event: Json, out: DecodedLine) {
    out.planRows = rateLimitRows(asJson(event.rate_limit_info));
    out.entries.push(gathered(event));
  }

  function decodeLifecycle(event: Json, out: DecodedLine) {
    const uuid = asString(event.command_uuid);
    if (uuid !== '') {
      out.lifecycle = { uuid, state: asString(event.state) };
    }
    out.entries.push(gathered(event));
  }

  const DECODERS: Readonly<
    Record<string, (event: Json, out: DecodedLine) => void>
  > = {
    system: decodeSystem,
    stream_event: decodeStreamEvent,
    assistant: decodeAssistant,
    user: decodeUser,
    result: decodeResult,
    control_response: decodeControlResponse,
    control_request: decodeControlRequest,
    tool_progress: decodeToolProgress,
    rate_limit_event: decodeRateLimit,
    command_lifecycle: decodeLifecycle,
  };

  return {
    decode(line) {
      const out = emptyLine();
      if (line.trim() === '') {
        return out;
      }
      const json = parsed(line);
      if (!json.ok) {
        out.entries.push(rawEntry(line));
        return out;
      }
      const event = asJson(json.value);
      const decoder = Object.hasOwn(DECODERS, asString(event.type))
        ? DECODERS[asString(event.type)]
        : undefined;
      if (decoder === undefined) {
        out.entries.push(rawEntry(json.value));
        return out;
      }
      decoder(event, out);
      return out;
    },
  };
}
