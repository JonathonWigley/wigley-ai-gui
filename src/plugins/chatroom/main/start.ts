import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { argsObject, optionalString } from '../../../shared/drive-args';
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
  sessionThread,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { chatroomManifest } from '../manifest';
import { createAgentEntries } from './agent-entries';
import { createTouchTracker } from './board';
import { createBoardFeed } from './board-feed';
import { createChatroomTools } from './chatroom-tools';
import { startDelivery } from './delivery';
import { createDemoRooms } from './demo-rooms';
import { registerDemoSteps } from './demo-steps';
import { createHookHandlers, WARN_AT_POST } from './hook-handlers';
import { createJsonlRoomStore } from './jsonl-room-store';
import { createRoomService, type RoomService } from './room-service';
import { buildRoomView } from './room-views';
import { createRoster } from './roster';
import {
  type ChatroomFixtureDeps,
  seedChatroomFixture,
} from './selftest-fixture';
import { chatroomSelfTestScript } from './selftest-script';

type ChatroomApi = MainApi<
  typeof chatroomManifest,
  ChatroomChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents> &
    QualifiedEvents<'chat', ChatMainEvents>
>;

// A drive run's default project folder for `chatroom.seed`, below its home.
const DRIVE_PROJECT_FOLDER = ['dev', 'chatroom-drive'];

export const STANDING_NOTE =
  "This app runs a chatroom for each project's sessions: the auri server's tools chatroom_post, chatroom_read, chatroom_board, chatroom_claim and chatroom_release. Follow the auri:chatroom skill for when to read and what to post. Call chatroom_read at the start of a turn when the hook or the app says a message waits for you.";

// Registers the chatroom layouts. Keeps one room per project in plugin data;
// contributes the five `chatroom_*` tools to every session, subagents
// included; answers the `chatroom.pre` and `chatroom.post` hooks; wakes an
// idle app-run agent a message is for; writes a session's `joined` and `left`
// entries and its subagents' `dispatch` and `hand-back` entries; and writes
// each room's view and board to `chatroom.rooms`, rebuilt one at a time per
// room. Hands the self-test its script and offers a drive run the `seed`
// fixture. A demo step's room is a memory room service while it is held: the
// room's view and the page's channel calls go to it, while the tools, hooks,
// delivery and agent entries keep the room in plugin data.
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
      claims: (roomName) => serviceFor(roomName).claims(roomName),
      log,
    });

    let isStopped = false;
    // Room → its rebuild chain, so an older view never lands after a newer.
    const rebuilds = new Map<string, SerialQueue>();
    // Row id → the room and name of its `joined` entry.
    const joined = new Map<string, { room: string; name: string }>();
    // Row id → its room when last checked.
    const lastRooms = new Map<string, string | null>();

    // A room's view and its channel calls read the demo step's memory room
    // while one is held under its name.
    const demoRooms = createDemoRooms({
      clock: services.clock,
      randomHex: services.randomHex,
      limits: () => {
        const { bodyCap, postsPerMinute, claimMinutes } = api.settings();
        return { bodyCap, postsPerMinute, claimMinutes };
      },
      participants: (roomName) => roster.participants(roomName),
      log,
      rewriteRoom: (roomName) => rewriteRoom(roomName),
      released: (roomName) => {
        rewriteRoom(roomName);
        refreshRoom(roomName);
      },
    });
    const serviceFor = (roomName: string): RoomService =>
      demoRooms.serviceFor(roomName) ?? room;

    // Runs `rebuild` on the room's chain, after every earlier rebuild of it.
    const queueRebuild = (
      roomName: string,
      rebuild: () => Promise<void>,
    ): void => {
      if (isStopped) {
        return;
      }
      const queue = rebuilds.get(roomName) ?? createSerialQueue();
      rebuilds.set(roomName, queue);
      queue.run(rebuild).catch((error: unknown) => {
        if (isStopped) {
          return;
        }
        log(`room view of ${roomName} not written: ${errorText(error)}`);
      });
    };

    // A room with no demo hold, no saved message and no session on its board
    // has no view.
    const writeRoomView = async (roomName: string): Promise<void> => {
      const held = demoRooms.serviceFor(roomName);
      const source = held ?? room;
      const [threads, claims, userUnread, messages] = await Promise.all([
        source.threads(roomName),
        source.claims(roomName),
        source.userUnread(roomName),
        source.messages(roomName, 0),
      ]);
      if (isStopped) {
        return;
      }
      const board = boardFeed.rows(roomName);
      const isHeld = held !== null;
      const isSaved = messages.length > 0;
      const hasSessions = board.length > 0;
      if (!isHeld && !isSaved && !hasSessions) {
        roomsSlot.delete(roomName);
        return;
      }
      roomsSlot.set(
        roomName,
        buildRoomView({
          room: roomName,
          threads,
          board,
          claims,
          userUnread,
          messages,
        }),
      );
    };

    const rewriteRoom = (roomName: string): void =>
      queueRebuild(roomName, () => writeRoomView(roomName));

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
          thread: sessionThread(rowId),
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

    const connect = (session: AgentSession): void => {
      roster.connected(session);
      boardFeed.track(session.id, session.info.projectDir);
      noteRoom(session.id);
    };

    // The first step of every tool and hook call.
    const arrive = (session: AgentSession): void => {
      connect(session);
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
          if (!isStopped) {
            log(`claims of ${rowId} not ended: ${errorText(error)}`);
          }
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
      chatState: (rowId) => chatSlot.get(rowId),
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

    // A first `connected` refreshes through `track`; a repeat for a row
    // already in the roster refreshes here.
    api.events.on('sessions.connected', (event) => {
      const isRepeat = roster.has(event.id);
      connect(event);
      if (isRepeat) {
        refreshRowRoom(event.id);
      }
    });
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
      connect({
        id: row.sessionId,
        info: {
          sessionId: row.hostSessionId,
          projectDir: row.projectDir,
          harness: row.harness,
          rowId: null,
        },
      });
    }
    room
      .rooms()
      .then((roomNames) => roomNames.forEach(rewriteRoom))
      .catch((error: unknown) => {
        if (!isStopped) {
          log(`rooms not read: ${errorText(error)}`);
        }
      });

    api.channel.handle('readThread', async (roomName, thread, afterId) =>
      (await serviceFor(roomName).messages(roomName, afterId)).filter(
        (message) => message.thread === thread,
      ),
    );
    api.channel.handle('postAsUser', async (roomName, thread, post) => {
      const result = await serviceFor(roomName).postHuman({
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
      await serviceFor(roomName).markUserRead(roomName, thread, upToId);
      rewriteRoom(roomName);
    });

    // The fixture's deps but its launch and its room.
    const fixtureBase: Omit<ChatroomFixtureDeps, 'launch' | 'roomFor'> = {
      files: services.files,
      clock: services.clock,
      timers: services.timers,
      rows: rowsSlot,
      rooms: (roomName) => roomsSlot.get(roomName),
    };
    // The self-test's and the drive run's fixture: sessions on profile work in
    // `projectDir`, posting into the room in plugin data.
    const fixtureDeps = (projectDir: string): ChatroomFixtureDeps => ({
      ...fixtureBase,
      launch: (title) =>
        chat.launch({
          projectDir,
          profile: 'work',
          message: { text: title, images: [] },
        }),
      roomFor: () => room,
    });
    services.selfTest?.run(
      chatroomSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        sessions,
        fixtureDeps,
      }),
    );
    registerDemoSteps(services, {
      fixtureDeps: fixtureBase,
      // The board reads the held room's claims at each refresh.
      holdRoom: (roomName) => {
        const held = demoRooms.hold(roomName);
        refreshRoom(roomName);
        return {
          ...held,
          claim: async (request) => {
            const result = await held.claim(request);
            refreshRoom(roomName);
            return result;
          },
        };
      },
    });
    api.drive?.add('seed', {
      description:
        "Seeds a chatroom in the project folder (default <home>/dev/chatroom-drive): launches two sessions on profile work, titled chatroom lead and chatroom peer, waits for their rows and board rows, then posts as them through the room service: in thread plan-demo the lead's heads-up, the peer's question to you and the lead's result with a commit ref, the lead's progress in its session thread, and the lead's claim on src/**. Throws on a refused post or claim. Returns { room, rowIds, titles, thread, questionId }, the lead first in rowIds and titles.",
      args: '{ projectDir?: string }',
      run(rawArgs) {
        const projectDir =
          optionalString(argsObject(rawArgs), 'projectDir') ??
          services.paths.join(services.homeDir, ...DRIVE_PROJECT_FOLDER);
        return seedChatroomFixture(fixtureDeps(projectDir), projectDir);
      },
    });

    return {
      commands: {},
      exports: (consumer): ChatroomMainExports => ({
        addMirror: (mirror) => consumer.track(room.addMirror(mirror)),
      }),
      async dispose() {
        isStopped = true;
        try {
          callEach<() => void>(
            [() => boardFeed.stop(), () => delivery.dispose()],
            (step) => step(),
          );
        } finally {
          await Promise.all([
            room.settled(),
            ...[...rebuilds.values()].map((queue) => queue.settled()),
          ]);
        }
      },
    };
  },
};
