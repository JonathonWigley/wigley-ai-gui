import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { Clock } from '../../../contracts/ambient';
import type { Git } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { isJsonObject, isStringArray } from '../../../shared/json';
import type { AgentSession, HookHandler } from '../../sessions/contract';
import type { ChatroomHookRequest } from '../contract';
import type { BoardFeed } from './board-feed';
import type { RoomService } from './room-service';
import type { Roster } from './roster';

// True sends the pre warning lines again in the post reply, for a harness
// whose PreToolUse context does not reach the agent.
export const WARN_AT_POST = false;

const MAX_WARNING_LINES = 5;
const MINUTE_MS = 60_000;
const HOOK_TOOLS: readonly ChatroomHookRequest['tool'][] = [
  'edit',
  'write',
  'commit',
];

export interface HookHandlersDeps {
  readonly room: Pick<RoomService, 'claimsTouching' | 'unreadAddressed'>;
  readonly roster: Pick<Roster, 'participant' | 'roomOf'>;
  readonly boardFeed: Pick<BoardFeed, 'noteTouched' | 'uncommittedByOthers'>;
  readonly git: Pick<Git, 'topLevel'>;
  readonly paths: Pick<Paths, 'segmentsBelow'>;
  readonly clock: Clock;
  readonly log: PluginLog;
  readonly warnAtPost: boolean;
  // Runs first in every hook call: joins the session to the roster and its room.
  arrive(session: AgentSession): void;
}

type HookReplyText = { text: string | null };

function parseHookRequest(request: unknown): ChatroomHookRequest | null {
  if (!isJsonObject(request)) {
    return null;
  }
  const { tool, paths, agentId, cwd } = request;
  const isHookTool = HOOK_TOOLS.includes(tool as ChatroomHookRequest['tool']);
  const isAgentId = agentId === null || typeof agentId === 'string';
  if (
    !isHookTool ||
    !isStringArray(paths) ||
    !isAgentId ||
    typeof cwd !== 'string'
  ) {
    return null;
  }
  return {
    tool: tool as ChatroomHookRequest['tool'],
    paths,
    agentId,
    cwd,
  };
}

function capLines(lines: readonly string[]): string[] {
  if (lines.length <= MAX_WARNING_LINES) {
    return [...lines];
  }
  const kept = lines.slice(0, MAX_WARNING_LINES);
  return [...kept, `… and ${lines.length - MAX_WARNING_LINES} more.`];
}

function unreadLine(count: number): string | null {
  if (count === 0) {
    return null;
  }
  return count === 1
    ? '1 chatroom message for you — chatroom_read'
    : `${count} chatroom messages for you — chatroom_read`;
}

// The chatroom's two hooks around an agent's edit, write or commit: `pre`
// warns of other sessions' claims and uncommitted changes on its paths, and
// `post` records an edit or write and counts the agent's unread messages.
export function createHookHandlers(deps: HookHandlersDeps): {
  pre: HookHandler;
  post: HookHandler;
} {
  const { room, roster, boardFeed, paths } = deps;

  // A path below `cwd` relative to it, `/`-separated; any other path as given.
  const shownPath = (path: string, cwd: string): string => {
    const segments = paths.segmentsBelow(path, cwd);
    return segments === null || segments.length === 0
      ? path
      : segments.join('/');
  };

  const warningLines = async (
    session: AgentSession,
    roomName: string,
    request: ChatroomHookRequest,
  ): Promise<string[]> => {
    const root = await deps.git.topLevel(request.cwd).catch(() => null);
    if (root === null) {
      return [];
    }
    const isCommit = request.tool === 'commit';
    const asker = roster.participant(session.id, request.agentId);
    const now = deps.clock.now();
    const lines: string[] = [];
    for (const path of request.paths) {
      const segments = paths.segmentsBelow(path, root);
      if (segments === null) {
        continue;
      }
      const relative = segments.join('/');
      const target = isCommit
        ? relative === ''
          ? '**'
          : `${relative}/**`
        : relative;
      const claims = await room.claimsTouching(
        roomName,
        { paths: [target] },
        asker,
      );
      for (const claim of claims) {
        const minutesLeft = Math.max(
          1,
          Math.ceil((claim.expiresAt - now) / MINUTE_MS),
        );
        lines.push(
          `Chatroom: ${shownPath(path, request.cwd)} is claimed by ${claim.holder.name} (${claim.reason}; ${minutesLeft} min left) — ask them in the room before you change it.`,
        );
      }
      for (const touch of boardFeed.uncommittedByOthers(
        session.id,
        [path],
        isCommit,
      )) {
        const toucher = roster.participant(
          touch.rowId,
          touch.agentId === MAIN_AGENT_ID ? null : touch.agentId,
        );
        lines.push(
          `Chatroom: ${shownPath(touch.path, request.cwd)} has uncommitted changes from ${toucher.name} — ask them in the room before you change or commit it.`,
        );
      }
    }
    return capLines(lines);
  };

  // The parsed request and the session's room, or null after logging why not.
  const begin = (
    hook: string,
    session: AgentSession,
    request: unknown,
  ): { request: ChatroomHookRequest; roomName: string } | null => {
    deps.arrive(session);
    const parsed = parseHookRequest(request);
    if (parsed === null) {
      deps.log(`${hook} hook request not understood from ${session.id}`);
      return null;
    }
    const roomName = roster.roomOf(session.id);
    if (roomName === null) {
      deps.log(`${hook} hook from ${session.id}, which has no room`);
      return null;
    }
    return { request: parsed, roomName };
  };

  const reply = (lines: readonly (string | null)[]): HookReplyText => {
    const shown = lines.filter((line): line is string => line !== null);
    return { text: shown.length === 0 ? null : shown.join('\n') };
  };

  return {
    async pre(session, request) {
      const call = begin('pre', session, request);
      if (call === null) {
        return { text: null };
      }
      return reply(await warningLines(session, call.roomName, call.request));
    },
    async post(session, request) {
      const call = begin('post', session, request);
      if (call === null) {
        return { text: null };
      }
      const { agentId, tool } = call.request;
      // Read before this call's touch replaces a peer's on the same path. For
      // an app-run row chat's `fileWritten` may have replaced it already, so
      // the uncommitted line can be missing.
      const warnings = deps.warnAtPost
        ? await warningLines(session, call.roomName, call.request)
        : [];
      if (tool !== 'commit') {
        boardFeed.noteTouched(
          session.id,
          agentId ?? MAIN_AGENT_ID,
          call.request.paths,
        );
      }
      const unread = await room.unreadAddressed(
        roster.participant(session.id, agentId),
      );
      return reply([...warnings, unreadLine(unread.length)]);
    },
  };
}
