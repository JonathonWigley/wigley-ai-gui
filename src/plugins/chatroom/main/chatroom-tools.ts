import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { Git } from '../../../contracts/git';
import type { Paths } from '../../../contracts/paths';
import {
  isJsonObject,
  isStringArray,
  type JsonObject,
} from '../../../shared/json';
import {
  type AgentSession,
  errorResult,
  textResult,
  type ToolCallContext,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import {
  type ClaimTarget,
  isMessageRef,
  MESSAGE_REF_TYPES,
  type MessageRef,
  type Participant,
  POST_KINDS,
  type PostKind,
} from '../contract';
import type { BoardFeed } from './board-feed';
import type {
  PostRequest,
  ReadItem,
  ReadQuery,
  RoomService,
} from './room-service';
import type { Roster } from './roster';

const POST_TOOL: ToolDefinition = {
  name: 'chatroom_post',
  description:
    "Posts a message in this project's chatroom, where its agent sessions and the user talk. `kind` is one of question, answer, blocker, heads-up, handoff, decision, result, progress, note. `to` names participants by session title (or `you` for the user); only a main agent or the user is a target, and empty means the thread. `thread` defaults to the thread of `replyTo`, else this session's own thread. A question may set `answerBy` (ISO 8601) and `onNoAnswer` (what you do if no answer comes). `key` makes a retry post once. Returns the message id, or why the post was refused.",
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...POST_KINDS] },
      body: { type: 'string' },
      to: { type: 'array', items: { type: 'string' } },
      thread: { type: 'string' },
      refs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...MESSAGE_REF_TYPES] },
            value: { type: 'string' },
          },
          required: ['type', 'value'],
          additionalProperties: false,
        },
      },
      replyTo: { type: 'integer' },
      answerBy: { type: 'string', format: 'date-time' },
      onNoAnswer: { type: 'string' },
      key: { type: 'string' },
    },
    required: ['kind', 'body'],
    additionalProperties: false,
  },
};

const READ_TOOL: ToolDefinition = {
  name: 'chatroom_read',
  description:
    "Reads this project's chatroom. With no argument: your unread messages, those addressed to you or in your open threads, one line each, and marks them read. `thread` reads one thread whole; `id` one message whole. Give at most one of them.",
  inputSchema: {
    type: 'object',
    properties: {
      thread: { type: 'string' },
      id: { type: 'integer' },
    },
    additionalProperties: false,
  },
};

const BOARD_TOOL: ToolDefinition = {
  name: 'chatroom_board',
  description:
    "The board of this project's chatroom: each live session's state (working, idle, waiting, done, connected), folder, branch, pool clone, uncommitted files with the session that wrote each, unpushed changes and claims.",
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

const CLAIM_TOOL: ToolDefinition = {
  name: 'chatroom_claim',
  description:
    "Claims repo-relative path globs (`paths`), a `branch` or a named `resource` (selftest, forms-app, vite-build) for `reason`, for `minutes` (the setting `claimMinutes` when left out). Give exactly one of paths, branch and resource. Claims are advisory: another session editing a claimed path is warned to ask you. Claiming the same target again renews it. Returns the claim and any other session's claim it overlaps.",
  inputSchema: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' }, minItems: 1 },
      branch: { type: 'string' },
      resource: { type: 'string' },
      reason: { type: 'string' },
      minutes: { type: 'integer', minimum: 1 },
    },
    required: ['reason'],
    additionalProperties: false,
  },
};

const RELEASE_TOOL: ToolDefinition = {
  name: 'chatroom_release',
  description:
    'Ends one of your chatroom claims by `claimId`, or all of them with `all: true`.',
  inputSchema: {
    type: 'object',
    properties: {
      claimId: { type: 'string' },
      all: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

export const CHATROOM_TOOLS: readonly ToolDefinition[] = [
  POST_TOOL,
  READ_TOOL,
  BOARD_TOOL,
  CLAIM_TOOL,
  RELEASE_TOOL,
];

const NO_ROOM_TEXT = 'This session has no project, so it has no chatroom.';
const KIND_ERROR = `kind must be one of ${POST_KINDS.join(', ')}.`;
const BODY_ERROR = 'body must be a string.';
const TO_ERROR = 'to must be an array of participant names.';
const THREAD_ERROR = 'thread must be a string.';
const REFS_ERROR = `refs must be an array of { type, value }, type one of ${MESSAGE_REF_TYPES.join(', ')} and value a string.`;
const REPLY_TO_ERROR = 'replyTo must be a message id, a whole number.';
const ANSWER_BY_ERROR = 'answerBy must be an ISO 8601 date-time.';
const ON_NO_ANSWER_ERROR = 'onNoAnswer must be a string.';
const KEY_ERROR = 'key must be a string.';
const ID_ERROR = 'id must be a message id, a whole number.';
const READ_FORM_ERROR = 'Give thread or id, not both.';
const CLAIM_TARGET_ERROR = 'Give exactly one of paths, branch or resource.';
const PATHS_ERROR = 'paths must be a non-empty array of strings.';
const BRANCH_ERROR = 'branch must be a string.';
const RESOURCE_ERROR = 'resource must be a string.';
const REASON_ERROR = 'reason must be a string.';
const MINUTES_ERROR = 'minutes must be a whole number above 0.';
const CLAIM_ID_ERROR = 'claimId must be a string.';
const ALL_ERROR = 'all must be true or false.';
const RELEASE_FORM_ERROR = 'Give claimId or all: true, one of them.';
const NO_UNREAD_TEXT = 'No unread chatroom messages.';

export interface ChatroomToolsDeps {
  readonly room: Pick<RoomService, 'post' | 'read' | 'claim' | 'release'>;
  readonly roster: Pick<Roster, 'participant' | 'roomOf'>;
  readonly boardFeed: Pick<BoardFeed, 'refresh' | 'rows'>;
  readonly git: Pick<Git, 'topLevel'>;
  readonly paths: Pick<Paths, 'isAbsolute' | 'segmentsBelow'>;
  // The agent that made the call, as chat's `toolCaller` names it.
  toolCaller(sessionId: string, toolUseId: string): Promise<string | null>;
  // Runs first in every call: joins the session to the roster and its room.
  arrive(session: AgentSession): void;
}

type PostFields = Omit<PostRequest, 'room' | 'from'>;

type ArgsOrError<T> = { readonly args: T } | { readonly error: string };

function isAbsent(value: unknown): value is undefined | null {
  return value === undefined || value === null;
}

function isWholeNumber(value: unknown): value is number {
  return Number.isInteger(value);
}

function fieldsOf(args: unknown): JsonObject {
  return isJsonObject(args) ? args : {};
}

// The field when it is absent (null) or a string; undefined otherwise.
function optionalString(value: unknown): string | null | undefined {
  if (isAbsent(value)) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

// The field when it is absent ([]) or a string array; undefined otherwise.
function optionalStrings(value: unknown): readonly string[] | undefined {
  if (isAbsent(value)) {
    return [];
  }
  return isStringArray(value) ? value : undefined;
}

// The field's refs, [] when absent; undefined when any item is not a ref.
function optionalRefs(value: unknown): MessageRef[] | undefined {
  if (isAbsent(value)) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isMessageRef)) {
    return undefined;
  }
  return value.map(({ type, value: refValue }) => ({ type, value: refValue }));
}

// The field when it is absent (null) or a whole number; undefined otherwise.
function optionalWholeNumber(value: unknown): number | null | undefined {
  if (isAbsent(value)) {
    return null;
  }
  return isWholeNumber(value) ? value : undefined;
}

// `answerBy` as epoch ms; null when absent, undefined when unparsable.
function answerByMs(value: unknown): number | null | undefined {
  if (isAbsent(value)) {
    return null;
  }
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

function parsePostArgs(args: unknown): ArgsOrError<PostFields> {
  const fields = fieldsOf(args);
  const { kind, body } = fields;
  if (!POST_KINDS.includes(kind as PostKind)) {
    return { error: KIND_ERROR };
  }
  if (typeof body !== 'string') {
    return { error: BODY_ERROR };
  }
  const to = optionalStrings(fields.to);
  if (to === undefined) {
    return { error: TO_ERROR };
  }
  const thread = optionalString(fields.thread);
  if (thread === undefined) {
    return { error: THREAD_ERROR };
  }
  const refs = optionalRefs(fields.refs);
  if (refs === undefined) {
    return { error: REFS_ERROR };
  }
  const replyTo = optionalWholeNumber(fields.replyTo);
  if (replyTo === undefined) {
    return { error: REPLY_TO_ERROR };
  }
  const answerBy = answerByMs(fields.answerBy);
  if (answerBy === undefined) {
    return { error: ANSWER_BY_ERROR };
  }
  const onNoAnswer = optionalString(fields.onNoAnswer);
  if (onNoAnswer === undefined) {
    return { error: ON_NO_ANSWER_ERROR };
  }
  const key = optionalString(fields.key);
  if (key === undefined) {
    return { error: KEY_ERROR };
  }
  return {
    args: {
      kind: kind as PostKind,
      body,
      to,
      thread,
      refs,
      replyTo,
      answerBy,
      onNoAnswer,
      key,
    },
  };
}

function parseReadArgs(args: unknown): ArgsOrError<ReadQuery> {
  const { thread, id } = fieldsOf(args);
  if (!isAbsent(thread) && !isAbsent(id)) {
    return { error: READ_FORM_ERROR };
  }
  if (!isAbsent(thread)) {
    return typeof thread === 'string'
      ? { args: { kind: 'thread', thread } }
      : { error: THREAD_ERROR };
  }
  if (!isAbsent(id)) {
    return isWholeNumber(id)
      ? { args: { kind: 'message', id } }
      : { error: ID_ERROR };
  }
  return { args: { kind: 'unread' } };
}

interface ClaimArgs {
  readonly target: ClaimTarget;
  readonly reason: string;
  readonly minutes: number | null;
}

function parseClaimTarget(fields: JsonObject): ArgsOrError<ClaimTarget> {
  const { paths, branch, resource } = fields;
  const givenCount = [paths, branch, resource].filter(
    (value) => !isAbsent(value),
  ).length;
  if (givenCount !== 1) {
    return { error: CLAIM_TARGET_ERROR };
  }
  if (!isAbsent(paths)) {
    const isPathList = isStringArray(paths) && paths.length > 0;
    return isPathList ? { args: { paths } } : { error: PATHS_ERROR };
  }
  if (!isAbsent(branch)) {
    return typeof branch === 'string'
      ? { args: { branch } }
      : { error: BRANCH_ERROR };
  }
  return typeof resource === 'string'
    ? { args: { resource } }
    : { error: RESOURCE_ERROR };
}

function parseClaimArgs(args: unknown): ArgsOrError<ClaimArgs> {
  const fields = fieldsOf(args);
  const target = parseClaimTarget(fields);
  if ('error' in target) {
    return target;
  }
  const { reason, minutes } = fields;
  if (typeof reason !== 'string') {
    return { error: REASON_ERROR };
  }
  const isMinutes = isWholeNumber(minutes) && minutes > 0;
  if (!isAbsent(minutes) && !isMinutes) {
    return { error: MINUTES_ERROR };
  }
  return {
    args: {
      target: target.args,
      reason,
      minutes: isMinutes ? minutes : null,
    },
  };
}

// The claim id to release, or null for all of the caller's claims.
function parseReleaseArgs(args: unknown): ArgsOrError<string | null> {
  const { claimId, all } = fieldsOf(args);
  if (!isAbsent(claimId) && typeof claimId !== 'string') {
    return { error: CLAIM_ID_ERROR };
  }
  if (!isAbsent(all) && typeof all !== 'boolean') {
    return { error: ALL_ERROR };
  }
  const namesClaim = typeof claimId === 'string';
  if (namesClaim === (all === true)) {
    return { error: RELEASE_FORM_ERROR };
  }
  return { args: namesClaim ? claimId : null };
}

function refsText(refs: readonly MessageRef[]): string {
  return refs.length === 0
    ? ''
    : ` · refs: ${refs.map(({ type, value }) => `${type}:${value}`).join(', ')}`;
}

function unreadText(items: readonly ReadItem[]): string {
  if (items.length === 0) {
    return NO_UNREAD_TEXT;
  }
  return items
    .map(
      (item) =>
        `#${item.id} ${item.from} · ${item.kind} · ${item.thread} · ${item.text}${refsText(item.refs)}`,
    )
    .join('\n');
}

function wholeText(items: readonly ReadItem[], query: ReadQuery): string {
  if (items.length === 0 && query.kind === 'thread') {
    return `No messages in thread ${query.thread}.`;
  }
  return items
    .map(
      (item) =>
        `#${item.id} ${item.from} · ${item.kind} · ${new Date(item.at).toISOString()}\n${item.text}`,
    )
    .join('\n\n');
}

function targetText(target: ClaimTarget): string {
  if ('paths' in target) {
    return target.paths.join(', ');
  }
  return 'branch' in target
    ? `branch ${target.branch}`
    : `resource ${target.resource}`;
}

// The five chatroom tools, in every session, subagents included: each call
// runs as the agent chat's stream names for it.
export function createChatroomTools(deps: ChatroomToolsDeps): {
  definitions: readonly ToolDefinition[];
  startSession(session: AgentSession): ToolSession;
} {
  const { room, roster, boardFeed } = deps;

  const callerOf = async (
    session: AgentSession,
    { toolUseId }: ToolCallContext,
  ): Promise<Participant> => {
    const agentId =
      toolUseId === null ? null : await deps.toolCaller(session.id, toolUseId);
    const isMainAgent = agentId === null || agentId === MAIN_AGENT_ID;
    return roster.participant(session.id, isMainAgent ? null : agentId);
  };

  // An absolute path under the session folder's clone becomes relative to
  // the clone; every other path is left for the room's check.
  const repoRelative = async (
    session: AgentSession,
    claimPaths: readonly string[],
  ): Promise<string[]> => {
    const folder = session.info.projectDir;
    const root =
      folder === null
        ? null
        : await deps.git.topLevel(folder).catch(() => null);
    return claimPaths.map((path) => {
      if (root === null || !deps.paths.isAbsolute(path)) {
        return path;
      }
      return deps.paths.segmentsBelow(path, root)?.join('/') ?? path;
    });
  };

  const post = async (
    session: AgentSession,
    roomName: string,
    args: unknown,
    context: ToolCallContext,
  ): Promise<ToolResult> => {
    const parsed = parsePostArgs(args);
    if ('error' in parsed) {
      return errorResult(parsed.error);
    }
    const result = await room.post({
      ...parsed.args,
      room: roomName,
      from: await callerOf(session, context),
    });
    if (!result.ok) {
      return errorResult(result.reason);
    }
    const text = result.duplicate
      ? `Already posted as #${result.id}.`
      : `Posted #${result.id} in ${result.thread}.`;
    return { ...textResult(text), structuredContent: { id: result.id } };
  };

  const read = async (
    session: AgentSession,
    roomName: string,
    args: unknown,
    context: ToolCallContext,
  ): Promise<ToolResult> => {
    const parsed = parseReadArgs(args);
    if ('error' in parsed) {
      return errorResult(parsed.error);
    }
    const query = parsed.args;
    const result = await room.read(
      roomName,
      await callerOf(session, context),
      query,
    );
    if (!result.ok) {
      return errorResult(result.reason);
    }
    const text =
      query.kind === 'unread'
        ? unreadText(result.items)
        : wholeText(result.items, query);
    return { ...textResult(text), structuredContent: { items: result.items } };
  };

  const board = async (roomName: string): Promise<ToolResult> => {
    await boardFeed.refresh(roomName);
    const rows = boardFeed.rows(roomName);
    const lines = [JSON.stringify({ room: roomName, rows }, null, 2)];
    for (const row of rows) {
      const more: string[] = [];
      if (row.uncommittedMore > 0) {
        more.push(`+${row.uncommittedMore} more uncommitted`);
      }
      if (row.unpushedMore > 0) {
        more.push(`+${row.unpushedMore} more unpushed`);
      }
      if (more.length > 0) {
        lines.push(`${row.name}: ${more.join(', ')}`);
      }
    }
    return {
      ...textResult(lines.join('\n')),
      structuredContent: { room: roomName, rows },
    };
  };

  const claim = async (
    session: AgentSession,
    roomName: string,
    args: unknown,
    context: ToolCallContext,
  ): Promise<ToolResult> => {
    const parsed = parseClaimArgs(args);
    if ('error' in parsed) {
      return errorResult(parsed.error);
    }
    const { target, reason, minutes } = parsed.args;
    const result = await room.claim({
      room: roomName,
      holder: await callerOf(session, context),
      target:
        'paths' in target
          ? { paths: await repoRelative(session, target.paths) }
          : target,
      reason,
      minutes,
    });
    if (!result.ok) {
      return errorResult(result.reason);
    }
    void boardFeed.refresh(roomName);
    const until = new Date(result.claim.expiresAt).toISOString();
    const lines = [
      `Claim ${result.claim.id} holds ${targetText(result.claim.target)} until ${until}.`,
      ...result.overlaps.map(
        (overlap) =>
          `Overlaps claim ${overlap.id} by ${overlap.holder.name}: ${targetText(overlap.target)} (${overlap.reason}).`,
      ),
    ];
    return textResult(lines.join('\n'));
  };

  const release = async (
    session: AgentSession,
    roomName: string,
    args: unknown,
    context: ToolCallContext,
  ): Promise<ToolResult> => {
    const parsed = parseReleaseArgs(args);
    if ('error' in parsed) {
      return errorResult(parsed.error);
    }
    const result = await room.release(
      roomName,
      await callerOf(session, context),
      parsed.args,
    );
    if (!result.ok) {
      return errorResult(result.reason);
    }
    void boardFeed.refresh(roomName);
    return textResult(`Released ${result.released.length} claim(s).`);
  };

  const handlers: Record<
    string,
    (
      session: AgentSession,
      roomName: string,
      args: unknown,
      context: ToolCallContext,
    ) => Promise<ToolResult>
  > = {
    [POST_TOOL.name]: post,
    [READ_TOOL.name]: read,
    [BOARD_TOOL.name]: (_session, roomName) => board(roomName),
    [CLAIM_TOOL.name]: claim,
    [RELEASE_TOOL.name]: release,
  };

  return {
    definitions: CHATROOM_TOOLS,
    startSession: (session) => ({
      async call(name, args, context) {
        const handler = handlers[name];
        if (handler === undefined) {
          throw new Error(`no chatroom tool "${name}"`);
        }
        deps.arrive(session);
        const roomName = roster.roomOf(session.id);
        if (roomName === null) {
          return errorResult(NO_ROOM_TEXT);
        }
        return handler(session, roomName, args, context);
      },
      end: () => undefined,
    }),
  };
}
