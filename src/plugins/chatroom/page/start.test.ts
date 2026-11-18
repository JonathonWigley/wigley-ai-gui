import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusTarget, PaneDirection } from '../../../contracts/panes';
import type { PagePart } from '../../../contracts/plugin';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import { PLAIN_MARKDOWN } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  asHtml,
  FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  deferred,
  fakeDependency,
} from '../../../shared/plugin-part-harness.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type SessionsPageExports,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import {
  type ChatroomPlace,
  chatroomPlaceSlot,
  chatroomRoomsSlot,
  type Participant,
  type RoomMessage,
  type RoomView,
  USER_PARTICIPANT,
  type UserPostResult,
} from '../contract';
import type { chatroomManifest } from '../manifest';
import { threadKey } from './chatroom-state';
import { chatroomPagePart } from './start';

const ROOM = 'shop';
const THREAD = 'plan-demo';
const ROW = 'r1';
const MODE = 'chatroom.main';

const lead: Participant = {
  kind: 'agent',
  rowId: ROW,
  agentId: null,
  mirrorId: null,
  name: 'Shop Revamp',
};

function message(
  id: number,
  kind: RoomMessage['kind'] = 'note',
  thread = THREAD,
): RoomMessage {
  return {
    id,
    room: ROOM,
    thread,
    from: lead,
    to: [USER_PARTICIPANT],
    kind,
    body: `body ${id}`,
    refs: [],
    replyTo: null,
    answerBy: null,
    onNoAnswer: null,
    key: null,
    at: 0,
    userWord: false,
  };
}

// The shop room with `threads` open at their last ids, the lead on its
// board, and the lead's row `unread` posts, the newest in `newestThread`.
function shopRoom(
  threads: Record<string, number>,
  unread: { unread: number; newestThread: string | null } = {
    unread: 0,
    newestThread: null,
  },
): RoomView {
  return {
    room: ROOM,
    threads: Object.entries(threads).map(([thread, lastId]) => ({
      thread,
      resolved: false,
      lastId,
      userUnread: 0,
      userMentions: 0,
    })),
    board: [
      {
        rowId: ROW,
        name: 'Shop Revamp',
        harness: 'claude',
        state: 'working',
        folder: null,
        branch: null,
        clone: null,
        uncommitted: [],
        uncommittedMore: 0,
        unpushedPaths: null,
        unpushedMore: 0,
        claims: [],
      },
    ],
    claims: [],
    rowUnread: [{ rowId: ROW, mentions: 0, ...unread }],
    userAsks: [],
  };
}

interface HeldRead {
  thread: string;
  afterId: number;
  answer(messages: RoomMessage[]): void;
}

interface PageOptions {
  room?: RoomView;
  // Each thread's messages, answered above the asked id at once, unless
  // `holdsReads`: then each read waits in `reads` for its answer.
  messages?: Record<string, RoomMessage[]>;
  holdsReads?: boolean;
  postResult?: UserPostResult;
  // Holds the post's reply until the test settles it.
  heldPost?: ReturnType<typeof deferred<UserPostResult>>;
  place?: ChatroomPlace;
}

// The chatroom page on the harness, drawing its layout for real, with the
// shop room and the lead's row seeded and the mode hidden behind another.
// `calls` holds each channel invoke; `rooms` writes `chatroom.rooms`.
function startChatroomPage(options: PageOptions = {}) {
  installFocusFakeDom(vi.stubGlobal);
  const calls: { method: string; args: unknown[] }[] = [];
  const reads: HeldRead[] = [];
  const state = createSlotStore(() => undefined);
  if (options.place !== undefined) {
    const lastPage = state.publish(chatroomPlaceSlot);
    lastPage.set(options.place);
    lastPage.dispose();
  }
  const rooms = state.publish(chatroomRoomsSlot);
  rooms.set(ROOM, options.room ?? shopRoom({ [THREAD]: 3 }));
  state.publish(sessionsRowsSlot).set(ROW, sessionRow(ROW, { project: ROOM }));
  const messages = options.messages ?? {
    [THREAD]: [message(1), message(2), message(3)],
  };
  // The part as it starts, but keeping the focus target it set last: the
  // harness's panes drop it.
  let focusTarget: FocusTarget | null = null;
  const part: PagePart<typeof chatroomManifest> = {
    ...chatroomPagePart,
    start: (api) =>
      chatroomPagePart.start({
        ...api,
        panes: {
          ...api.panes,
          setFocusTarget(target) {
            focusTarget = target;
            api.panes.setFocusTarget(target);
          },
        },
      }),
  };
  const harness = startDrawingPagePart(part, {
    firstModeTaken: true,
    state,
    services: { markdown: PLAIN_MARKDOWN },
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addRowPart(part: Parameters<SessionsPageExports['addRowPart']>[0]) {
              const built = part.build(
                asHtml(new FocusFakeElement('div')),
                ROW,
              );
              return consumer.track({ dispose: () => built.dispose?.() });
            },
            setActivity: () => undefined,
            activate: () => undefined,
          }) as unknown as SessionsPageExports,
      ),
    ],
    invoke: async (method, ...args) => {
      calls.push({ method, args });
      if (method === 'readThread') {
        const [, thread, afterId] = args as [string, string, number];
        const above = (messages[thread] ?? []).filter(
          (held) => held.id > afterId,
        );
        if (options.holdsReads !== true) {
          return above;
        }
        const held = deferred<RoomMessage[]>();
        reads.push({ thread, afterId, answer: held.resolve });
        return held.promise;
      }
      if (method === 'postAsUser') {
        if (options.heldPost !== undefined) {
          return options.heldPost.promise;
        }
        return options.postResult ?? { ok: true, id: 40 };
      }
      return undefined;
    },
  });
  harness.ready();
  const commands = harness.started().commands;
  const element = () => asFake(harness.mode(MODE).element);
  const box = () => {
    const found = element().querySelector('.chatroom-composer-input');
    if (found === null) {
      throw new Error('no composer box');
    }
    return found as unknown as { value: string };
  };
  const callsOf = (method: string) =>
    calls.filter((call) => call.method === method).map((call) => call.args);
  const logged = () => harness.logs.map((line) => line.message);
  const open = (thread = THREAD) =>
    commands.openThreadRow({ arg: threadKey(ROOM, thread) });
  // A press of the core's focus key toward `direction`, as the core asks the
  // view's focus target first while main holds the keys.
  const move = (direction: PaneDirection) => focusTarget?.move(direction);
  return {
    move,
    harness,
    commands,
    rooms,
    reads,
    state,
    element,
    box,
    callsOf,
    logged,
    open,
  };
}

type Page = ReturnType<typeof startChatroomPage>;

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const show = (page: Page) => page.commands.showMode({ arg: undefined });

describe('chatroomPagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('openThread_ModeShown_MarksReadUpToTheLastId', async () => {
    const page = startChatroomPage();
    show(page);

    page.open();
    await settle();

    expect(page.callsOf('markUserRead')).toEqual([[ROOM, THREAD, 3]]);
  });

  it('openThread_ModeHidden_MarksNothingUntilShown', async () => {
    const page = startChatroomPage();

    page.open();
    await settle();
    const whileHidden = page.callsOf('markUserRead');
    show(page);

    expect([whileHidden, page.callsOf('markUserRead')]).toEqual([
      [],
      [[ROOM, THREAD, 3]],
    ]);
  });

  it('send_ReplyToAQuestion_PostsTheAnswerToItsSender', async () => {
    const page = startChatroomPage({
      messages: { [THREAD]: [message(2), message(4, 'question')] },
      room: shopRoom({ [THREAD]: 4 }),
    });
    show(page);
    page.open();
    await settle();

    page.commands.reply({ arg: undefined });
    page.box().value = 'ship it';
    page.commands.send({ arg: undefined });
    await settle();

    expect(page.callsOf('postAsUser')).toEqual([
      [
        ROOM,
        THREAD,
        { kind: 'answer', body: 'ship it', to: ['Shop Revamp'], replyTo: 4 },
      ],
    ]);
  });

  it('send_EmptyBody_PostsNothing', async () => {
    const page = startChatroomPage();
    show(page);
    page.open();
    await settle();

    page.commands.compose({ arg: undefined });
    page.box().value = '   ';
    page.commands.send({ arg: undefined });
    await settle();

    expect(page.callsOf('postAsUser')).toEqual([]);
  });

  it('send_PostRefused_KeepsTheDraftAndLogsTheReason', async () => {
    const page = startChatroomPage({
      postResult: { ok: false, reason: 'room is closed' },
    });
    show(page);
    page.open();
    await settle();

    page.commands.compose({ arg: undefined });
    page.box().value = 'a note';
    page.commands.send({ arg: undefined });
    await settle();

    expect([page.box().value, page.logged()]).toEqual([
      'a note',
      expect.arrayContaining(['post refused: room is closed']),
    ]);
  });

  it.each([
    { case: 'accepts', outcome: 'resolve' },
    { case: 'refuses', outcome: 'refuse' },
    { case: 'rejects', outcome: 'reject' },
  ] as const)(
    'a post reply that $case after the page stops logs nothing and keeps the draft',
    async ({ outcome }) => {
      const heldPost = deferred<UserPostResult>();
      const page = startChatroomPage({ heldPost });
      show(page);
      page.open();
      await settle();
      page.commands.compose({ arg: undefined });
      const box = page.box();
      box.value = 'a note';
      page.commands.send({ arg: undefined });
      await page.harness.stop();
      const loggedBefore = page.logged();

      if (outcome === 'resolve') {
        heldPost.resolve({ ok: true, id: 40 });
      } else if (outcome === 'refuse') {
        heldPost.resolve({ ok: false, reason: 'room is closed' });
      } else {
        heldPost.reject(new Error('channel closed'));
      }
      await settle();

      expect([box.value, page.logged()]).toEqual(['a note', loggedBefore]);
    },
  );

  it('roomChanged_TwiceBeforeTheFirstReadLands_ShowsEachMessageOnce', async () => {
    const page = startChatroomPage({
      holdsReads: true,
      messages: { [THREAD]: [message(1), message(2), message(3), message(4)] },
      room: shopRoom({ [THREAD]: 2 }),
    });
    show(page);
    page.open();
    page.rooms.set(ROOM, shopRoom({ [THREAD]: 3 }));
    page.rooms.set(ROOM, shopRoom({ [THREAD]: 4 }));

    page.reads[0].answer([message(1), message(2)]);
    await settle();
    page.reads[1].answer([message(2), message(3), message(4)]);
    await settle();

    expect([
      page.reads.map((read) => read.afterId),
      findAll(page.element(), 'chatroom-log-item').length,
    ]).toEqual([[0, 2], 4]);
  });

  it('readLands_AfterAnotherThreadOpened_AppendsNothing', async () => {
    const page = startChatroomPage({
      holdsReads: true,
      room: shopRoom({ [THREAD]: 3, other: 1 }),
    });
    show(page);
    page.open(THREAD);
    page.open('other');

    page.reads[0].answer([message(1), message(2), message(3)]);
    await settle();

    expect([
      findAll(page.element(), 'chatroom-log-item').length,
      page.callsOf('markUserRead'),
      page.reads.map((read) => read.thread),
    ]).toEqual([0, [], [THREAD, 'other']]);
  });

  // The core holds main as the keys area after every base scope change, so
  // Alt+l from the thread list reaches the log only through the view's target.
  it.each([
    { from: 'threads', direction: 'right', moved: true, scope: 'log' },
    { from: 'threads', direction: 'left', moved: false, scope: 'threads' },
    { from: 'log', direction: 'right', moved: false, scope: 'log' },
    { from: 'log', direction: 'left', moved: false, scope: 'log' },
  ] as const)(
    'focusMove_MainHoldsTheKeysArea_OnlyRightFromThreadsMoves: $direction from $from',
    async ({ from, direction, moved, scope }) => {
      const page = startChatroomPage();
      show(page);
      page.open();
      await settle();
      if (from === 'log') {
        page.harness.mode(MODE).focusMain();
      }

      const result = page.move(direction);

      expect([result, page.harness.scope()]).toEqual([
        moved,
        `chatroom.${scope}`,
      ]);
    },
  );

  it.each([
    { name: 'newest unread thread', newestThread: 'review', opens: 'review' },
    { name: 'no unread', newestThread: null, opens: `session:${ROW}` },
  ])(
    'openRowRoom_RowClicked_OpensThatThread: $name',
    async ({ newestThread, opens }) => {
      const page = startChatroomPage({
        room: shopRoom({ [THREAD]: 3 }, { unread: 1, newestThread }),
      });

      page.commands.openRowRoom({ arg: ROW });
      await settle();

      expect(page.callsOf('readThread')).toEqual([[ROOM, opens, 0]]);
    },
  );

  it('send_InPreview_PostsNothingAndSaysSo', async () => {
    const page = startChatroomPage();
    page.commands.preview({ arg: undefined });
    await settle();

    page.commands.compose({ arg: undefined });
    page.box().value = 'hello';
    page.commands.send({ arg: undefined });

    expect([page.callsOf('postAsUser'), page.logged()]).toEqual([
      [],
      expect.arrayContaining(['preview: not posted']),
    ]);
  });

  it('restart_AfterOpeningAThread_OpensItAgain', async () => {
    const page = startChatroomPage({
      room: shopRoom({ [THREAD]: 3, other: 1 }),
    });
    page.open('other');
    await settle();
    const written = page.state.read(chatroomPlaceSlot, 'test').get();

    await page.harness.restart();
    await settle();

    expect([written, page.callsOf('readThread')]).toEqual([
      { room: ROOM, thread: 'other' },
      [
        [ROOM, 'other', 0],
        [ROOM, 'other', 0],
      ],
    ]);
  });

  it('restorePlace_SavedThreadAbsentThenArrives_OpensItOnTheRoomChange', async () => {
    const page = startChatroomPage({
      place: { room: ROOM, thread: 'late' },
      messages: { late: [message(1)] },
    });
    await settle();
    const beforeArrival = page.callsOf('readThread');

    page.rooms.set(ROOM, shopRoom({ [THREAD]: 3, late: 1 }));
    await settle();

    expect([beforeArrival, page.callsOf('readThread')]).toEqual([
      [],
      [[ROOM, 'late', 0]],
    ]);
  });

  it('roomsChange_BadgeTextSameOrNew_LogsOnlyTheChanges', () => {
    const page = startChatroomPage({
      room: shopRoom({ [THREAD]: 3 }, { unread: 1, newestThread: THREAD }),
    });

    page.rooms.set(
      ROOM,
      shopRoom({ [THREAD]: 4 }, { unread: 1, newestThread: THREAD }),
    );
    page.rooms.set(
      ROOM,
      shopRoom({ [THREAD]: 5 }, { unread: 2, newestThread: THREAD }),
    );

    expect(page.logged().filter((line) => line.startsWith('badge in'))).toEqual(
      [`badge in label ${ROW}: 1 new`, `badge in label ${ROW}: 2 new`],
    );
  });
});
