import type { ChatEntry, ChatImage } from '../../contracts/agent';
import { asArray, asJson, asString, type Json, parsed } from './json-fields';
import { pairToolResult, type ToolEntry, toolUseEntry } from './tool-entries';

// Claude's saved session transcripts: one JSON object per line in
// `<config>/projects/<projectFolderName>/<session id>.jsonl`. The format is
// undocumented; every rule reading it lives in this file.

// How much of a transcript the session list reads for its folder and title.
export const TRANSCRIPT_HEAD_BYTES = 65536;
export const TITLE_LENGTH = 80;
export const UNTITLED_SESSION = 'Untitled session';
export const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

export interface TranscriptHead {
  cwd: string | null;
  firstMessage: string | null;
}

// The folder Claude keeps a project's transcripts in: the project path with
// every character outside `[A-Za-z0-9]` turned to `-`.
export function projectFolderName(projectDir: string): string {
  return projectDir.replace(/[^A-Za-z0-9]/g, '-');
}

// The folder and first user message a transcript's opening bytes hold. A line
// that does not parse, such as the one the cut ends inside, is skipped.
export function readTranscriptHead(head: string): TranscriptHead {
  let cwd: string | null = null;
  let firstMessage: string | null = null;
  for (const piece of head.split('\n')) {
    const json = parsed(piece);
    if (!json.ok) {
      continue;
    }
    const line = asJson(json.value);
    if (cwd === null && typeof line.cwd === 'string') {
      cwd = line.cwd;
    }
    if (firstMessage === null && line.type === 'user') {
      firstMessage = userText(line);
    }
  }
  return { cwd, firstMessage };
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

// A transcript as chat entries, oldest first, every id starting `history:`.
// A line this reader does not know, and a `user` line the CLI wrote, becomes a
// raw entry; a sidechain line (a subagent's) and the CLI's bookkeeping lines
// become nothing.
export function transcriptEntries(text: string): ChatEntry[] {
  const entries: ChatEntry[] = [];
  const toolEntries = new Map<string, ToolEntry>();
  const lines = text.split('\n');
  for (const [index, lineText] of lines.entries()) {
    if (lineText.trim() === '') {
      continue;
    }
    const lineNumber = index + 1;
    const json = parsed(lineText);
    if (!json.ok) {
      entries.push(lineRaw(lineNumber, lineText));
      continue;
    }
    addLineEntries(json.value, lineNumber, entries, toolEntries);
  }
  return entries;
}

function addLineEntries(
  value: unknown,
  lineNumber: number,
  entries: ChatEntry[],
  toolEntries: Map<string, ToolEntry>,
) {
  const line = asJson(value);
  const type = asString(line.type);
  if (line.isSidechain === true || SKIPPED_LINE_TYPES.has(type)) {
    return;
  }
  if (type === 'system') {
    entries.push(...systemEntries(line, lineNumber));
    return;
  }
  const content = asJson(line.message).content;
  const isConversationLine = type === 'user' || type === 'assistant';
  const isReadable =
    (typeof content === 'string' || Array.isArray(content)) &&
    typeof line.uuid === 'string';
  if (!isConversationLine || !isReadable) {
    entries.push(lineRaw(lineNumber, line));
    return;
  }
  if (type === 'user') {
    addUserEntries(line, entries, toolEntries);
  } else {
    addAssistantEntries(line, entries, toolEntries);
  }
}

// A local command's output is a notice; every other system line is nothing.
function systemEntries(line: Json, lineNumber: number): ChatEntry[] {
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
  const id = typeof line.uuid === 'string' ? line.uuid : `line-${lineNumber}`;
  return [
    {
      kind: 'notice',
      id: `${ID_PREFIX}${id}`,
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
  entries: ChatEntry[],
  toolEntries: Map<string, ToolEntry>,
) {
  const id = `${ID_PREFIX}${asString(line.uuid)}`;
  const text = userText(line);
  if (isCliWrittenUserLine(line)) {
    entries.push({ kind: 'raw', id, raw: [line] });
  } else if (text !== null) {
    entries.push({
      kind: 'user',
      id,
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
      entries.push({ kind: 'raw', id: `${id}-${index}`, raw: [line] });
    }
  }
}

function addAssistantEntries(
  line: Json,
  entries: ChatEntry[],
  toolEntries: Map<string, ToolEntry>,
) {
  const uuid = asString(line.uuid);
  for (const [index, item] of asArray(asJson(line.message).content).entries()) {
    const block = asJson(item);
    const id = `${ID_PREFIX}${uuid}-${index}`;
    if (block.type === 'text') {
      entries.push({
        kind: 'assistant',
        id,
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
          text: thinking,
          streaming: false,
          raw: [line],
        });
      }
    } else if (block.type === 'tool_use') {
      const entry = toolUseEntry(id, block, line);
      toolEntries.set(entry.toolUseId, entry);
      entries.push(entry);
    } else {
      entries.push({ kind: 'raw', id, raw: [line] });
    }
  }
}

function lineRaw(lineNumber: number, raw: unknown): ChatEntry {
  return { kind: 'raw', id: `${ID_PREFIX}line-${lineNumber}`, raw: [raw] };
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
