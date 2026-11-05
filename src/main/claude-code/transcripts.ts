import {
  type ChatEntry,
  type ChatImage,
  MAIN_AGENT_ID,
} from '../../contracts/agent';
import { isJsonObject } from '../../shared/json';
import {
  asArray,
  asJson,
  asString,
  type Json,
  numberOrNull,
  parsed,
} from './json-fields';
import {
  type ReplyUsage,
  replyUsageOf,
  type SavedReply,
} from './session-usage';
import { pairToolResult, toolUseEntry } from './tool-entries';

// Claude's saved session transcripts: one JSON object per line in
// `<config>/projects/<projectFolderName>/<session id>.jsonl`. The format is
// undocumented; every rule reading it lives in this file.

// How much of a transcript the session list reads first for its folder and
// title.
export const TRANSCRIPT_HEAD_BYTES = 65536;
// The most of a transcript the session list reads to reach the end of its
// first user message: that line holds its pasted images' base64 ahead of its
// text, and this is room for four images at the 5 MB per-image limit.
export const TRANSCRIPT_HEAD_MAX_BYTES = 24 * 1024 * 1024;
export const TITLE_LENGTH = 80;
export const UNTITLED_SESSION = 'Untitled session';
export const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Local slash commands answer with an assistant message of this model.
export const SYNTHETIC_MODEL = '<synthetic>';

// Line types that carry the CLI's bookkeeping, not the conversation.
const SKIPPED_LINE_TYPES: ReadonlySet<string> = new Set([
  'attachment',
  'mode',
  'permission-mode',
  'atis-latch',
  'isolation-latch',
  'file-history-snapshot',
  'file-history-delta',
  'last-prompt',
  'queue-operation',
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'ai-title',
  'custom-title',
  'agent-name',
  'cost-state',
]);

const LOCAL_OUTPUT_OPEN = '<local-command-stdout>';
const LOCAL_OUTPUT_CLOSE = '</local-command-stdout>';
const LOCAL_CAVEAT_OPEN = '<local-command-caveat>';
const TASK_NOTIFICATION_OPEN = '<task-notification>';
const SHELL_INPUT_OPEN = '<bash-input>';
const SHELL_OUTPUT_OPEN = '<bash-stdout>';
const SHELL_INPUT = /<bash-input>([\s\S]*?)<\/bash-input>/;
const INTERRUPT_MARKER = /^\[Request interrupted by user( for tool use)?\]$/;
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const ID_PREFIX = 'history:';

type StampedToolEntry = Extract<ChatEntry, { kind: 'tool' }>;
type CompactionEntry = Extract<ChatEntry, { kind: 'compaction' }>;

// What a transcript's opening bytes hold: its folder, its first typed user
// message, and whether any `user` line in them parsed whole.
export interface TranscriptHead {
  cwd: string | null;
  firstMessage: string | null;
  sawUserLine: boolean;
}

// The folder Claude keeps a project's transcripts in: the project path with
// every character outside `[A-Za-z0-9]` turned to `-`.
export function projectFolderName(projectDir: string): string {
  return projectDir.replace(/[^A-Za-z0-9]/g, '-');
}

// The folder, first typed user message, and whether a `user` line parsed, in
// a transcript's opening bytes. A line that does not parse, such as the one
// the cut ends inside, is skipped.
export function readTranscriptHead(head: string): TranscriptHead {
  let cwd: string | null = null;
  let firstMessage: string | null = null;
  let sawUserLine = false;
  for (const piece of head.split('\n')) {
    const json = parsed(piece);
    if (!json.ok) {
      continue;
    }
    const line = asJson(json.value);
    if (cwd === null && typeof line.cwd === 'string') {
      cwd = line.cwd;
    }
    if (line.type === 'user') {
      sawUserLine = true;
      firstMessage ??= userText(line);
    }
  }
  return { cwd, firstMessage, sawUserLine };
}

// Whether `head` ends inside a line: its text after the last newline is not a
// whole JSON line, so the cut fell inside it.
export function endsInsideLine(head: string): boolean {
  const tail = head.slice(head.lastIndexOf('\n') + 1);
  return tail.trim() !== '' && !parsed(tail).ok;
}

// The session list's title for a first user message, at most `TITLE_LENGTH`
// code points.
export function sessionTitle(message: string | null): string {
  const collapsed = (message ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed === '') {
    return UNTITLED_SESSION;
  }
  const codePoints = [...collapsed];
  return codePoints.length > TITLE_LENGTH
    ? `${codePoints.slice(0, TITLE_LENGTH - 1).join('')}…`
    : collapsed;
}

// The name Claude shows for a session: its last `custom-title` (a `/rename`),
// else its last `ai-title`; null for a transcript with neither.
export function transcriptName(text: string): string | null {
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  for (const piece of text.split('\n')) {
    if (!piece.includes('-title"')) {
      continue;
    }
    const json = parsed(piece);
    if (!json.ok) {
      continue;
    }
    const line = asJson(json.value);
    if (line.type === 'custom-title') {
      customTitle = asString(line.customTitle) ?? customTitle;
    } else if (line.type === 'ai-title') {
      aiTitle = asString(line.aiTitle) ?? aiTitle;
    }
  }
  return customTitle ?? aiTitle;
}

// A transcript as chat entries, oldest first, every id starting `history:`.
// A line this reader does not know, and a `user` line the CLI wrote, becomes a
// raw entry; a sidechain line (a subagent's) and the CLI's bookkeeping lines
// become nothing. Each entry's `at` is its line's `timestamp`, or, when the
// line has none, that of the last line that had one, entry or not (`0` before
// any); a tool entry keeps its `tool_use` line's time when its result pairs.
// A compaction boundary becomes a compaction entry, whose `afterTokens` is the
// context of the first main reply before the next boundary.
// With `before` set, a line timed at or after it gives no entry and pairs no
// tool result, though it may still give an earlier compaction its after-size;
// each line is tested alone, since sidechain lines may interleave.
export function transcriptEntries(
  text: string,
  before: number | null = null,
): ChatEntry[] {
  const entries: ChatEntry[] = [];
  const toolEntries = new Map<string, StampedToolEntry>();
  const lines = text.split('\n');
  let lastAt = 0;
  let awaitingAfterSize: CompactionEntry | null = null;
  const isCut = (at: number) => before !== null && at >= before;
  for (const [index, lineText] of lines.entries()) {
    if (lineText.trim() === '') {
      continue;
    }
    const lineNumber = index + 1;
    const json = parsed(lineText);
    if (!json.ok) {
      if (!isCut(lastAt)) {
        entries.push(lineRaw(lineNumber, lineText, lastAt));
      }
      continue;
    }
    const line = asJson(json.value);
    lastAt = lineAt(line, lastAt);
    const reply = mainReplyUsage(line);
    if (reply !== null && awaitingAfterSize !== null) {
      awaitingAfterSize.afterTokens = reply.contextTokens;
      awaitingAfterSize = null;
    }
    if (isMainCompactBoundary(line)) {
      awaitingAfterSize = compactionEntry(line, lineNumber, lastAt);
      if (!isCut(lastAt)) {
        entries.push(awaitingAfterSize);
      }
    } else if (!isCut(lastAt)) {
      addLineEntries(line, lineNumber, lastAt, entries, toolEntries);
    }
  }
  return entries;
}

// The main conversation's model replies since its last compaction, oldest first:
// every `assistant` line that is not a sidechain's, whose model is not
// `SYNTHETIC_MODEL`, and that carries `message.usage`. Each `at` follows
// `transcriptEntries`' rule; a line that does not parse is skipped.
export function mainReplies(text: string): SavedReply[] {
  const replies: SavedReply[] = [];
  let lastAt = 0;
  for (const lineText of text.split('\n')) {
    const json = parsed(lineText);
    if (!json.ok) {
      continue;
    }
    const line = asJson(json.value);
    lastAt = lineAt(line, lastAt);
    if (isMainCompactBoundary(line)) {
      replies.length = 0;
    }
    const reply = mainReplyUsage(line);
    if (reply !== null) {
      replies.push({ reply, at: lastAt });
    }
  }
  return replies;
}

// The usage of a line `mainReplies` counts; null on any other line.
function mainReplyUsage(line: Json): ReplyUsage | null {
  const message = asJson(line.message);
  const isMainReply =
    line.type === 'assistant' &&
    line.isSidechain !== true &&
    message.model !== SYNTHETIC_MODEL &&
    isJsonObject(message.usage);
  return isMainReply ? replyUsageOf(asJson(message.usage)) : null;
}

function isMainCompactBoundary(line: Json): boolean {
  return (
    line.type === 'system' &&
    line.subtype === 'compact_boundary' &&
    line.isSidechain !== true
  );
}

// The transcript cannot tell the app's own compact from a typed `/compact`, so it
// reads back `manual`; the binary writes any other trigger as `auto`.
function compactionEntry(
  line: Json,
  lineNumber: number,
  at: number,
): CompactionEntry {
  const metadata = asJson(line.compactMetadata);
  return {
    kind: 'compaction',
    id: systemLineId(line, lineNumber),
    at,
    trigger: metadata.trigger === 'manual' ? 'manual' : 'harness',
    beforeTokens: numberOrNull(metadata.preTokens),
    afterTokens: null,
    durationMs: numberOrNull(metadata.durationMs),
    raw: [line],
  };
}

function systemLineId(line: Json, lineNumber: number): string {
  const id = typeof line.uuid === 'string' ? line.uuid : `line-${lineNumber}`;
  return `${ID_PREFIX}${id}`;
}

// A line's top-level `timestamp` (ISO 8601) in epoch milliseconds, or
// `fallback` when it has none that parses.
function lineAt(line: Json, fallback: number): number {
  const at =
    typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
  return Number.isNaN(at) ? fallback : at;
}

function addLineEntries(
  line: Json,
  lineNumber: number,
  at: number,
  entries: ChatEntry[],
  toolEntries: Map<string, StampedToolEntry>,
) {
  const type = asString(line.type);
  if (line.isSidechain === true || SKIPPED_LINE_TYPES.has(type)) {
    return;
  }
  if (type === 'system') {
    entries.push(...systemEntries(line, lineNumber, at));
    return;
  }
  const content = asJson(line.message).content;
  const isConversationLine = type === 'user' || type === 'assistant';
  const isReadable =
    (typeof content === 'string' || Array.isArray(content)) &&
    typeof line.uuid === 'string';
  if (!isConversationLine || !isReadable) {
    entries.push(lineRaw(lineNumber, line, at));
    return;
  }
  if (type === 'user') {
    addUserEntries(line, at, entries, toolEntries);
  } else {
    addAssistantEntries(line, at, entries, toolEntries);
  }
}

// A local command's output is a notice; every other system line but a compaction
// boundary, which `transcriptEntries` reads, is nothing.
function systemEntries(
  line: Json,
  lineNumber: number,
  at: number,
): ChatEntry[] {
  const content = line.content;
  const isLocalOutput =
    line.subtype === 'local_command' &&
    typeof content === 'string' &&
    content.includes(LOCAL_OUTPUT_OPEN);
  if (!isLocalOutput) {
    return [];
  }
  const text = content
    .replace(LOCAL_OUTPUT_OPEN, '')
    .replace(LOCAL_OUTPUT_CLOSE, '')
    .trim();
  if (text === '') {
    return [];
  }
  return [
    {
      kind: 'notice',
      id: systemLineId(line, lineNumber),
      at,
      text,
      tone: 'info',
      raw: [line],
    },
  ];
}

// The user's text and images, or a raw entry for a line the CLI wrote, then
// each tool result joined to its tool entry.
function addUserEntries(
  line: Json,
  at: number,
  entries: ChatEntry[],
  toolEntries: Map<string, StampedToolEntry>,
) {
  const id = `${ID_PREFIX}${asString(line.uuid)}`;
  const text = userText(line);
  if (isCliWrittenUserLine(line)) {
    entries.push({ kind: 'raw', id, at, raw: [line] });
  } else if (text !== null) {
    entries.push({
      kind: 'user',
      id,
      at,
      text,
      images: userImages(line),
      raw: [line],
    });
  }
  for (const [index, item] of asArray(asJson(line.message).content).entries()) {
    const block = asJson(item);
    if (block.type !== 'tool_result') {
      continue;
    }
    if (pairToolResult(toolEntries, block, line) === undefined) {
      entries.push({ kind: 'raw', id: `${id}-${index}`, at, raw: [line] });
    }
  }
}

function addAssistantEntries(
  line: Json,
  at: number,
  entries: ChatEntry[],
  toolEntries: Map<string, StampedToolEntry>,
) {
  const uuid = asString(line.uuid);
  for (const [index, item] of asArray(asJson(line.message).content).entries()) {
    const block = asJson(item);
    const id = `${ID_PREFIX}${uuid}-${index}`;
    if (block.type === 'text') {
      entries.push({
        kind: 'assistant',
        id,
        at,
        text: asString(block.text),
        streaming: false,
        raw: [line],
      });
    } else if (block.type === 'thinking') {
      const thinking = asString(block.thinking);
      if (thinking !== '') {
        entries.push({
          kind: 'thinking',
          id,
          at,
          text: thinking,
          streaming: false,
          raw: [line],
        });
      }
    } else if (block.type === 'tool_use') {
      const entry = { ...toolUseEntry(id, block, line, MAIN_AGENT_ID), at };
      toolEntries.set(entry.toolUseId, entry);
      entries.push(entry);
    } else {
      entries.push({ kind: 'raw', id, at, raw: [line] });
    }
  }
}

function lineRaw(lineNumber: number, raw: unknown, at: number): ChatEntry {
  return {
    kind: 'raw',
    id: `${ID_PREFIX}line-${lineNumber}`,
    at,
    raw: [raw],
  };
}

// A `user` line the CLI wrote in the user's place: a compaction summary, a
// background task's notification, an interrupt marker, or the output of a `!`
// shell command. The live stream shows such a line as an event, never as the
// user's message.
function isCliWrittenUserLine(line: Json): boolean {
  const content = asJson(line.message).content;
  const texts = asArray(content)
    .map((block) => asJson(block))
    .filter((block) => block.type === 'text')
    .map((block) => asString(block.text));
  const isInterruptMarker =
    texts.length > 0 && texts.every((text) => INTERRUPT_MARKER.test(text));
  const opening = typeof content === 'string' ? content.trimStart() : '';
  const isTaskNotification = opening.startsWith(TASK_NOTIFICATION_OPEN);
  const isShellOutput = opening.startsWith(SHELL_OUTPUT_OPEN);
  return (
    line.isCompactSummary === true ||
    line.isVisibleInTranscriptOnly === true ||
    isTaskNotification ||
    isShellOutput ||
    isInterruptMarker
  );
}

// What the user typed on a `user` line, or null for a line the user did not
// type: a meta or sidechain line (the `[Image: source: …]` line that follows
// an image is meta), a line the CLI wrote, a local command's caveat or output,
// or a tool-result line. A slash command reads as its name and its arguments;
// a `!` shell command reads as `!` and the command. A line of text and image
// blocks reads as its text blocks alone, `''` when it holds only images.
function userText(line: Json): string | null {
  const isNotTyped =
    line.isMeta === true ||
    line.isSidechain === true ||
    isCliWrittenUserLine(line);
  if (isNotTyped) {
    return null;
  }
  const content = asJson(line.message).content;
  if (typeof content === 'string') {
    return typedText(content);
  }
  const blocks = asArray(content).map((block) => asJson(block));
  const isTyped = blocks.some(
    (block) => block.type === 'text' || block.type === 'image',
  );
  if (!isTyped) {
    return null;
  }
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => asString(block.text))
    .join('\n');
}

// The base64 images a `user` line's content blocks hold, in order.
function userImages(line: Json): ChatImage[] {
  const images: ChatImage[] = [];
  for (const item of asArray(asJson(line.message).content)) {
    const block = asJson(item);
    const source = asJson(block.source);
    if (block.type === 'image' && source.type === 'base64') {
      images.push({
        mediaType: asString(source.media_type),
        data: asString(source.data),
      });
    }
  }
  return images;
}

function typedText(content: string): string | null {
  const opening = content.trimStart();
  const isLocalCommandLine =
    opening.startsWith(LOCAL_CAVEAT_OPEN) ||
    opening.startsWith(LOCAL_OUTPUT_OPEN);
  if (isLocalCommandLine) {
    return null;
  }
  const shellInput = opening.startsWith(SHELL_INPUT_OPEN)
    ? SHELL_INPUT.exec(opening)
    : null;
  if (shellInput !== null) {
    return `!${shellInput[1].trim()}`;
  }
  const name = COMMAND_NAME.exec(content);
  if (name === null) {
    return content;
  }
  const args = (COMMAND_ARGS.exec(content)?.[1] ?? '').trim();
  return args === '' ? name[1] : `${name[1]} ${args}`;
}
