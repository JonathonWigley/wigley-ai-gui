import type { ChatEntry } from '../../contracts/agent';
import type { ClaudeControlId } from './claude-controls';
import { toolSummary } from './tool-summary';

// What one stdout line of `claude` in stream-json mode means to the chat.
// `entries` are whole entries, each replacing an earlier one with its id;
// `reported` holds control values as Claude names them (`controlValue` maps
// them); `turnFailed` is true on a turn-ending line that reports an error.
export interface DecodedLine {
  entries: ChatEntry[];
  reported: Partial<Record<ClaudeControlId, string>>;
  commands: string[] | null;
  turnEnded: boolean;
  turnFailed: boolean;
  controlResponse: { requestId: string; error: string | null } | null;
  hostRequest: { requestId: string; subtype: string } | null;
}

export interface StreamDecoder {
  decode(line: string): DecodedLine;
}

type Json = Record<string, unknown>;
type TextEntry = Extract<ChatEntry, { kind: 'assistant' | 'thinking' }>;
type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>;
type RawEntry = Extract<ChatEntry, { kind: 'raw' }>;

// Local slash commands answer with an assistant event of this model.
const SYNTHETIC_MODEL = '<synthetic>';
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

function asJson(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parsed(line: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
}

function emptyLine(): DecodedLine {
  return {
    entries: [],
    reported: {},
    commands: null,
    turnEnded: false,
    turnFailed: false,
    controlResponse: null,
    hostRequest: null,
  };
}

// A copy the decoder's later changes cannot reach.
function snapshot<E extends ChatEntry>(entry: E): E {
  return { ...entry, raw: [...entry.raw] };
}

// `slash_commands` then `skills`, without a leading `/`, first kept.
function commandNames(init: Json): string[] {
  const names = [...asArray(init.slash_commands), ...asArray(init.skills)].map(
    (name) => asString(name).replace(/^\//, ''),
  );
  return [...new Set(names)];
}

// A tool result's content as text: a string as it stands, a block array as
// its text blocks' texts, each other block written `[<type>]`.
function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return asArray(content)
    .map((block) => {
      const fields = asJson(block);
      return fields.type === 'text'
        ? asString(fields.text)
        : `[${asString(fields.type)}]`;
    })
    .join('\n');
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

// One decoder reads one process's stdout: it keeps the entries it built, so a
// later line updates them. An event joins the entry it belongs to; a known
// event that belongs to none joins the turn's events entry, one raw entry per
// turn re-sent as it grows; an event of a type the decoder does not know gets a
// raw entry of its own. An entry is re-sent whenever it changes, its `raw`
// included, except a thinking entry's `system/thinking_tokens`: those arrive
// once per delta, so they ride with the entry's next send, which the block's
// `content_block_stop` always brings.
export function createStreamDecoder(): StreamDecoder {
  const textEntries = new Map<string, TextEntry>();
  const toolEntries = new Map<string, ToolEntry>();
  // Stream entries an assistant event has already confirmed.
  const confirmed = new Set<string>();
  // The current message id and open blocks of each stream, keyed by
  // `parent_tool_use_id` (null for the main conversation).
  const currentMessage = new Map<string | null, string>();
  const openBlocks = new Map<string, TextEntry>();
  // The thinking block streaming last, which `system/thinking_tokens` joins.
  let openThinking: TextEntry | null = null;
  // Assistant blocks with no streamed entry, per message id.
  const unstreamedCounts = new Map<string, number>();
  let rawCount = 0;
  let turnCount = 0;
  // Null until the turn's first gathered event; a result closes it.
  let turnEvents: RawEntry | null = null;
  let noticeCount = 0;
  let resultCount = 0;
  // `total_cost_usd` is the process's cost so far.
  let lastTotalCost = 0;

  // An event of a type the decoder does not know, alone in its entry.
  function rawEntry(raw: unknown): ChatEntry {
    rawCount += 1;
    return { kind: 'raw', id: `raw-${rawCount}`, raw: [raw] };
  }

  // The turn's events entry with `event` added: hooks at process start open
  // the first one.
  function gathered(event: unknown): ChatEntry {
    if (turnEvents === null) {
      turnCount += 1;
      turnEvents = { kind: 'raw', id: `turn-events-${turnCount}`, raw: [] };
    }
    turnEvents.raw.push(event);
    return snapshot(turnEvents);
  }

  function noticeEntry(
    text: string,
    tone: 'info' | 'error',
    raw: unknown,
  ): ChatEntry {
    noticeCount += 1;
    return {
      kind: 'notice',
      id: `notice-${noticeCount}`,
      text,
      tone,
      raw: [raw],
    };
  }

  function decodeSystem(event: Json, out: DecodedLine) {
    if (event.subtype === 'init') {
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
        ? gathered(event)
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
    const toolUseId = asString(block.id);
    const name = asString(block.name);
    const entry: ToolEntry = {
      kind: 'tool',
      id: `tool-${toolUseId}`,
      toolUseId,
      name,
      input: block.input,
      summary: toolSummary(name, block.input),
      result: null,
      raw: [event],
    };
    toolEntries.set(toolUseId, entry);
    return entry;
  }

  function decodeAssistant(event: Json, out: DecodedLine) {
    const message = asJson(event.message);
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
        out.entries.push(snapshot(toolEntry(block, event)));
      }
    }
  }

  function decodeToolResult(block: Json, event: Json): ChatEntry {
    const entry = toolEntries.get(asString(block.tool_use_id));
    if (entry === undefined) {
      return rawEntry(event);
    }
    entry.result = {
      text: toolResultText(block.content),
      isError: block.is_error === true,
    };
    entry.raw.push(event);
    return snapshot(entry);
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
  // turn's events entry.
  function decodeResult(event: Json, out: DecodedLine) {
    const isError = event.is_error === true;
    out.turnEnded = true;
    out.turnFailed = isError;
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
      durationMs:
        typeof event.duration_ms === 'number' ? event.duration_ms : null,
      raw: [event],
    });
    turnEvents = null;
  }

  function decodeControlResponse(event: Json, out: DecodedLine) {
    const response = asJson(event.response);
    const isError = response.subtype === 'error';
    out.controlResponse = {
      requestId: asString(response.request_id),
      error: isError ? asString(response.error) || 'unknown error' : null,
    };
    out.entries.push(gathered(event));
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
