import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  createSerialQueue,
  type SerialQueue,
} from '../../../shared/serial-queue';
import {
  type ChatMainEvents,
  chatMainKey,
  chatSessionSlot,
} from '../../chat/contract';
import {
  type AgentSession,
  type SessionsMainEvents,
  sessionsActivitySlot,
  sessionsMainKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { unityPoolSnapshotSlot } from '../../unity-pool/contract';
import { workflowFlowsSlot, workflowMainKey } from '../../workflow/contract';
import {
  type ChatroomChannel,
  type ChatroomMainExports,
  chatroomRoomsSlot,
  type EntryKind,
  HOOK_POST,
  HOOK_PRE,
  SYSTEM_PARTICIPANT,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { chatroomManifest } from '../manifest';
import { createAgentEntries } from './agent-entries';
import { createTouchTracker } from './board';
import { createBoardFeed } from './board-feed';
import { createChatroomTools } from './chatroom-tools';
import { startDelivery } from './delivery';
import { createHookHandlers, WARN_AT_POST } from './hook-handlers';
import { createJsonlRoomStore } from './jsonl-room-store';
import { createRoomService } from './room-service';
import { buildRoomView } from './room-views';
import { createRoster } from './roster';

type ChatroomApi = MainApi<
  typeof chatroomManifest,
  ChatroomChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents> &
    QualifiedEvents<'chat', ChatMainEvents>
>;

export const STANDING_NOTE =
  "This app runs a chatroom for each project's sessions: the wigley-forms tools chatroom_post, chatroom_read, chatroom_board, chatroom_claim and chatroom_release. Follow the wigley:chatroom skill for when to read and what to post. Call chatroom_read at the start of a turn when the hook or the app says a message waits for you.";

// Registers the chatroom layouts. Keeps one room per project in plugin data; contributes the five
// `chatroom_*` tools to every session, subagents included; answers the
// `chatroom.pre` and `chatroom.post` hooks; wakes an idle app-run agent a
// message is for; writes a session's `joined` and `left` entries and its
// subagents' `dispatch` and `hand-back` entries; and writes each room's view
// and board to `chatroom.rooms`, rebuilt one at a time per room.
export const chatroomMainPart: MainPart<typeof chatroomManifest> = {
  manifest: chatroomManifest,
  start(api: ChatroomApi) {
    api.layouts.register({ layoutTypes });
    const { services } = api;
    const { log } = services;
    const sessions = api.dependency(sessionsMainKey);
    const chat = api.dependency(chatMainKey);
    const workflow = api.dependency(workflowMainKey);
    const rowsSlot = api.state.read(sessionsRowsSlot);
    const chatSlot = api.state.read(chatSessionSlot);
    const activitySlot = api.state.read(sessionsActivitySlot);
    const flowsSlot = api.state.read(workflowFlowsSlot);
    const poolSlot = api.state.read(unityPoolSnapshotSlot);
    const roomsSlot = api.state.publish(chatroomRoomsSlot);

    const roster = createRoster({ sessions });
    const room = createRoomService({
      store: createJsonlRoomStore({ files: api.data, log }),
      files: api.data,
      clock: services.clock,
      randomHex: services.randomHex,
      limits: () => {
        const { bodyCap, postsPerMinute, claimMinutes } = api.settings();
        return { bodyCap, postsPerMinute, claimMinutes };
      },
      participants: (roomName) => roster.participants(roomName),
      log,
    });
    const tracker = createTouchTracker(services.paths);
    const boardFeed = createBoardFeed({
      roster,
      tracker,
      git: services.git,
      paths: services.paths,
      clock: services.clock,
      timers: services.timers,
      chat: () => chatSlot.all(),
      flows: () => workflow.flows(),
      stageFinishes: (flow) => workflow.stageFinishes(flow),
      activities: () => activitySlot.all(),
      pools: () => poolSlot.get() ?? null,
      claims: (roomName) => room.claims(roomName),
      log,
    });

    let isStopped = false;
    // Room → its rebuild chain, so an older view never lands after a newer.
    const rebuilds = new Map<string, SerialQueue>();
    // Row id → the room and name of its `joined` entry.
    const joined = new Map<string, { room: string; name: string }>();
    // Row id → its room when last checked.
    const lastRooms = new Map<string, string | null>();

    const rewriteRoom = (roomName: string): void => {
      if (isStopped) {
        return;
      }
      const queue = rebuilds.get(roomName) ?? createSerialQueue();
      rebuilds.set(roomName, queue);
      queue
        .run(async () => {
          const [threads, claims, userUnread, messages] = await Promise.all([
            room.threads(roomName),
            room.claims(roomName),
            room.userUnread(roomName),
            room.messages(roomName, 0),
          ]);
          if (isStopped) {
            return;
          }
          roomsSlot.set(
            roomName,
            buildRoomView({
              room: roomName,
              threads,
              board: boardFeed.rows(roomName),
              claims,
              userUnread,
              messages,
            }),
          );
        })
        .catch((error: unknown) => {
          log(`room view of ${roomName} not written: ${errorText(error)}`);
        });
    };

    const refreshRoom = (roomName: string | null): void => {
      if (roomName !== null && !isStopped) {
        void boardFeed.refresh(roomName);
      }
    };

    const refreshRowRoom = (rowId: string): void => {
      if (roster.has(rowId)) {
        refreshRoom(roster.roomOf(rowId));
      }
    };

    const addSessionEntry = (
      roomName: string,
      rowId: string,
      kind: EntryKind,
      body: string,
    ): void => {
      room
        .addEntry({
          room: roomName,
          thread: `session:${rowId}`,
          from: SYSTEM_PARTICIPANT,
          kind,
          body,
          refs: [],
        })
        .catch((error: unknown) => {
          log(`entry not saved: ${errorText(error)}`);
        });
    };

    // Rewrites and refreshes the old and new room of a row whose room moved.
    const noteRoom = (rowId: string): void => {
      const roomName = roster.roomOf(rowId);
      const lastRoom = lastRooms.get(rowId);
      lastRooms.set(rowId, roomName);
      if (lastRoom === undefined || lastRoom === roomName) {
        return;
      }
      for (const moved of [lastRoom, roomName]) {
        if (moved !== null) {
          rewriteRoom(moved);
          refreshRoom(moved);
        }
      }
    };

    const join = (rowId: string): void => {
      const roomName = roster.roomOf(rowId);
      if (joined.has(rowId) || roomName === null) {
        return;
      }
      const name = roster.participant(rowId, null).name;
      joined.set(rowId, { room: roomName, name });
      addSessionEntry(roomName, rowId, 'joined', `${name} joined`);
    };

    const connect = (session: AgentSession, owned: boolean): void => {
      roster.connected(session, owned);
      boardFeed.track(session.id, session.info.projectDir);
      noteRoom(session.id);
    };

    // The first step of every tool and hook call.
    const arrive = (session: AgentSession): void => {
      connect(session, false);
      join(session.id);
    };

    const sessionEnded = (rowId: string): void => {
      const joinedRoom = joined.get(rowId);
      if (joinedRoom !== undefined) {
        joined.delete(rowId);
        addSessionEntry(
          joinedRoom.room,
          rowId,
          'left',
          `${joinedRoom.name} left`,
        );
      }
      const lastRoom = lastRooms.get(rowId) ?? null;
      lastRooms.delete(rowId);
      room
        .endClaimsOf(rowId)
        .then((ended) => {
          for (const roomName of new Set(ended.map((claim) => claim.room))) {
            refreshRoom(roomName);
            rewriteRoom(roomName);
          }
        })
        .catch((error: unknown) => {
          log(`claims of ${rowId} not ended: ${errorText(error)}`);
        });
      roster.ended(rowId);
      boardFeed.untrack(rowId);
      if (lastRoom !== null) {
        refreshRoom(lastRoom);
        rewriteRoom(lastRoom);
      }
    };

    const tools = createChatroomTools({
      room,
      roster,
      boardFeed,
      git: services.git,
      paths: services.paths,
      toolCaller: (sessionId, toolUseId) =>
        chat.toolCaller(sessionId, toolUseId),
      arrive,
    });
    sessions.contributeTools([...tools.definitions], tools.startSession);

    const hooks = createHookHandlers({
      room,
      roster,
      boardFeed,
      git: services.git,
      paths: services.paths,
      clock: services.clock,
      log,
      warnAtPost: WARN_AT_POST,
      arrive,
    });
    sessions.addHookHandler(HOOK_PRE, hooks.pre);
    sessions.addHookHandler(HOOK_POST, hooks.post);
    chat.addInstructions(STANDING_NOTE);

    const delivery = startDelivery({
      room,
      roster,
      chat,
      isIdle: (rowId) => chatSlot.get(rowId)?.activity === 'idle',
      onTurnFinished: (listener) =>
        api.events.on('chat.turnFinished', ({ sessionId, how }) =>
          listener(sessionId, how),
        ),
      onSessionEnded: (listener) =>
        api.events.on('sessions.ended', ({ sessionId }) => listener(sessionId)),
      log,
    });
    const entries = createAgentEntries({ room, roster, touches: tracker, log });

    room.onMessage((message) => rewriteRoom(message.room));
    boardFeed.onChanged(rewriteRoom);

    api.events.on('sessions.connected', (event) => connect(event, event.owned));
    api.events.on('sessions.hostSessionChanged', (session) => {
      roster.hostSessionChanged(session);
      refreshRowRoom(session.id);
    });
    api.events.on('sessions.ended', ({ sessionId }) => sessionEnded(sessionId));
    api.events.on('chat.agentEvent', (agentEvent) => {
      entries.heard(agentEvent);
      if (agentEvent.event.type === 'fileWritten') {
        refreshRowRoom(agentEvent.sessionId);
      }
    });
    api.events.on('chat.turnFinished', ({ sessionId }) =>
      refreshRowRoom(sessionId),
    );
    rowsSlot.on((rowId) => {
      if (roster.has(rowId)) {
        noteRoom(rowId);
        refreshRowRoom(rowId);
      }
    });
    chatSlot.on(refreshRowRoom);
    activitySlot.on(refreshRowRoom);
    flowsSlot.on(refreshRowRoom);
    poolSlot.on(() => {
      for (const { rowId } of roster.sessions()) {
        refreshRowRoom(rowId);
      }
    });

    for (const row of rowsSlot.all().values()) {
      connect(
        {
          id: row.sessionId,
          info: {
            sessionId: row.hostSessionId,
            projectDir: row.projectDir,
            harness: row.harness,
            rowId: null,
          },
        },
        chat.profileOf(row.sessionId) !== null,
      );
    }
    room
      .rooms()
      .then((roomNames) => roomNames.forEach(rewriteRoom))
      .catch((error: unknown) => {
        log(`rooms not read: ${errorText(error)}`);
      });

    api.channel.handle('readThread', async (roomName, thread, afterId) =>
      (await room.messages(roomName, afterId)).filter(
        (message) => message.thread === thread,
      ),
    );
    api.channel.handle('postAsUser', async (roomName, thread, post) => {
      const result = await room.postHuman({
        room: roomName,
        thread,
        kind: post.kind,
        body: post.body,
        to: post.to,
        refs: [],
        replyTo: post.replyTo,
        answerBy: null,
        onNoAnswer: null,
        key: null,
      });
      return result.ok
        ? { ok: true, id: result.id }
        : { ok: false, reason: result.reason };
    });
    api.channel.handle('markUserRead', async (roomName, thread, upToId) => {
      await room.markUserRead(roomName, thread, upToId);
      rewriteRoom(roomName);
    });

    return {
      commands: {},
      exports: (consumer): ChatroomMainExports => ({
        addMirror: (mirror) => consumer.track(room.addMirror(mirror)),
      }),
      async dispose() {
        isStopped = true;
        boardFeed.stop();
        delivery.dispose();
        await Promise.all([
          room.settled(),
          ...[...rebuilds.values()].map((queue) => queue.settled()),
        ]);
      },
    };
  },
};
