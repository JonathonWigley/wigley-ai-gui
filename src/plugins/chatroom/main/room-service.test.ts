import { beforeEach, describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createListeners } from '../../../shared/listeners';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import {
  type ChatroomMirror,
  type Claim,
  type ClaimTarget,
  type MessageRef,
  type Participant,
  type PostKind,
  type RoomMessage,
  type RoomStore,
  USER_PARTICIPANT,
} from '../contract';
import { createMemoryRoomStore } from './memory-room-store';
import {
  type ChatroomLimits,
  createRoomService,
  type HumanPostRequest,
  type PostRequest,
  type PostResult,
  type RoomService,
  type RoomServiceDeps,
} from './room-service';
import { newMessage } from './room-store.test-support';

const ROOM = 'shop';
const START = 1_700_000_000_000;

const shopRevamp: Participant = {
  kind: 'agent',
  rowId: 'rA',
  agentId: null,
  mirrorId: null,
  name: 'Shop Revamp',
};

const docsFix: Participant = {
  kind: 'agent',
  rowId: 'rB',
  agentId: null,
  mirrorId: null,
  name: 'Docs Fix',
};

const otherDocsFix: Participant = {
  kind: 'agent',
  rowId: 'rC',
  agentId: null,
  mirrorId: null,
  name: 'Docs Fix',
};

const workerOfShopRevamp: Participant = {
  kind: 'agent',
  rowId: 'rA',
  agentId: 'w1',
  mirrorId: null,
  name: 'Shop Revamp ▸ worker',
};

const PARTICIPANTS: readonly Participant[] = [
  shopRevamp,
  docsFix,
  otherDocsFix,
  USER_PARTICIPANT,
];

const SAVED_FILES = [
  'cursors.json',
  'user-cursors.json',
  'threads.json',
  'claims.json',
];

let now: number;
let hexCount: number;
let limits: ChatroomLimits;
let files: MemoryFiles;
let store: RoomStore;
let logged: string[];
let service: RoomService;

// A service over this test's store and files, as the next app run opens them.
function serviceOver(overrides: Partial<RoomServiceDeps> = {}): RoomService {
  return createRoomService({
    store,
    files,
    clock: { now: () => now },
    randomHex: () => (hexCount++).toString(16).padStart(8, '0'),
    limits: () => limits,
    participants: () => PARTICIPANTS,
    log: (message) => logged.push(message),
    ...overrides,
  });
}

function humanPost(fields: Partial<HumanPostRequest> = {}): HumanPostRequest {
  return {
    room: ROOM,
    kind: 'note',
    body: 'hello',
    to: [],
    thread: null,
    refs: [],
    replyTo: null,
    answerBy: null,
    onNoAnswer: null,
    key: null,
    ...fields,
  };
}

function postBy(
  from: Participant,
  fields: Partial<PostRequest> = {},
): PostRequest {
  return { ...humanPost(), from, ...fields };
}

function questionToShopRevamp(body: string): PostRequest {
  return postBy(docsFix, {
    kind: 'question',
    to: ['Shop Revamp'],
    thread: 'plan-q',
    body,
  });
}

// The id and thread of an accepted post; fails the test on a refusal.
function accepted(result: PostResult): { id: number; thread: string } {
  if (!result.ok) {
    throw new Error(`refused: ${result.reason}`);
  }
  return { id: result.id, thread: result.thread };
}

function reasonOf(result: { ok: boolean; reason?: string }): string {
  if (result.ok || result.reason === undefined) {
    throw new Error('accepted');
  }
  return result.reason;
}

async function unreadIds(
  reader: Participant,
  over: RoomService = service,
): Promise<number[]> {
  const result = await over.read(ROOM, reader, { kind: 'unread' });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.items.map((item) => item.id);
}

const idsOf = (messages: readonly RoomMessage[]) =>
  messages.map((message) => message.id);

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeMirror {
  readonly mirror: ChatroomMirror;
  readonly published: RoomMessage[];
  say(thread: string, body: string): void;
}

function fakeMirror(
  id: string,
  verified: boolean,
  publish: (message: RoomMessage) => Promise<void> = async () => {},
): FakeMirror {
  const humans = createListeners<{ thread: string; body: string }>();
  const published: RoomMessage[] = [];
  return {
    mirror: {
      id,
      verified,
      async publish(message) {
        published.push(message);
        await publish(message);
      },
      onHumanMessage: (listener) =>
        humans.add(({ thread, body }) => listener(ROOM, thread, body)),
    },
    published,
    say: (thread, body) => humans.tell({ thread, body }),
  };
}

beforeEach(() => {
  now = START;
  hexCount = 0;
  limits = { bodyCap: 1500, postsPerMinute: 10, claimMinutes: 30 };
  files = createMemoryFiles();
  store = createMemoryRoomStore();
  logged = [];
  service = serviceOver();
});

describe('createRoomService', () => {
  it.each([
    {
      row: 'kind dispatch',
      fields: { kind: 'dispatch' as PostKind },
      reasonHas: ['dispatch'],
    },
    { row: 'blank body', fields: { body: '  ' }, reasonHas: ['empty'] },
    {
      row: 'body over the cap',
      fields: { body: 'x'.repeat(1501) },
      reasonHas: ['1501', '1500'],
    },
    {
      row: 'ref type url',
      fields: {
        refs: [{ type: 'url' as MessageRef['type'], value: 'https://x' }],
      },
      reasonHas: ['url'],
    },
    {
      row: 'blank ref value',
      fields: { refs: [{ type: 'file' as const, value: ' ' }] },
      reasonHas: ['empty value'],
    },
    {
      row: 'replyTo not in the room',
      fields: { replyTo: 99 },
      reasonHas: ['#99'],
    },
    {
      row: 'answer with no replyTo',
      fields: { kind: 'answer' as const },
      reasonHas: ['answer must set replyTo'],
    },
    {
      row: 'question with empty to',
      fields: { kind: 'question' as const },
      reasonHas: ['at least one participant'],
    },
    {
      row: 'answerBy on a note',
      fields: { answerBy: START + 60_000 },
      reasonHas: ['answerBy is only for a question'],
    },
    {
      row: 'onNoAnswer on a note',
      fields: { onNoAnswer: 'I take the editor' },
      reasonHas: ['onNoAnswer is only for a question'],
    },
    {
      row: 'answerBy before now',
      fields: { kind: 'question' as const, to: ['you'], answerBy: START - 1 },
      reasonHas: ['later than now'],
    },
    {
      row: 'answerBy equal to now',
      fields: { kind: 'question' as const, to: ['you'], answerBy: START },
      reasonHas: ['later than now'],
    },
    {
      row: 'unknown name',
      fields: { to: ['Nobody'] },
      reasonHas: [
        'no participant named "Nobody"',
        'Shop Revamp, Docs Fix, Docs Fix, you',
      ],
    },
    {
      row: 'name of two sessions',
      fields: { to: ['docs fix'] },
      reasonHas: ['2 participants'],
    },
    {
      row: 'system',
      fields: { to: ['system'] },
      reasonHas: ['no participant named "system"'],
    },
    {
      row: 'own title',
      fields: { to: ['Shop Revamp'] },
      reasonHas: ['you cannot address yourself'],
    },
    {
      row: 'thread of 81 characters',
      fields: { thread: 't'.repeat(81) },
      reasonHas: ['80 characters'],
    },
    {
      row: 'thread with a line break',
      fields: { thread: 'a\nb' },
      reasonHas: ['line break'],
    },
    {
      row: 'entry kind before a blank body',
      fields: { kind: 'dispatch' as PostKind, body: '  ' },
      reasonHas: ['dispatch is an entry'],
    },
  ])('post_Refused: $row', async ({ fields, reasonHas }) => {
    const result = await service.post(postBy(shopRevamp, fields));

    const reason = reasonOf(result);
    for (const text of reasonHas) {
      expect(reason).toContain(text);
    }
    expect(await store.read(ROOM, 0)).toEqual([]);
  });

  it.each([
    { length: 1500, ok: true },
    { length: 1501, ok: false },
  ])('post_BodyCap_Boundary: $length → $ok', async ({ length, ok }) => {
    const result = await service.post(
      postBy(shopRevamp, { body: 'x'.repeat(length) }),
    );

    expect(result.ok).toBe(ok);
  });

  it('post_BodyCap_Boundary: reads the cap at each post', async () => {
    const body = 'x'.repeat(11);

    const first = await service.post(postBy(shopRevamp, { body }));
    limits = { ...limits, bodyCap: 10 };
    now += 1;
    const second = await service.post(postBy(shopRevamp, { body }));

    expect(first.ok).toBe(true);
    expect(reasonOf(second)).toMatch(/11 .*10/);
  });

  it('post_Stamps: stores the matched participants, the clock and the store id', async () => {
    now = START + 5;

    const result = await service.post(
      postBy(docsFix, { to: [' shop revamp '], kind: 'question' }),
    );

    expect(result).toEqual({
      ok: true,
      id: 1,
      thread: 'session:rB',
      duplicate: false,
    });
    expect(await store.read(ROOM, 0)).toEqual([
      {
        ...postBy(docsFix, { kind: 'question' }),
        id: 1,
        thread: 'session:rB',
        to: [shopRevamp],
        at: START + 5,
        userWord: false,
      },
    ]);
  });

  const cafe: Participant = { ...otherDocsFix, rowId: 'rD', name: 'Café' };

  it.each([
    {
      row: 'one participant named twice',
      to: ['Shop Revamp', 'shop revamp'],
      roster: PARTICIPANTS,
      stored: [shopRevamp],
    },
    {
      row: 'order of first appearance',
      to: ['you', 'Shop Revamp'],
      roster: PARTICIPANTS,
      stored: [USER_PARTICIPANT, shopRevamp],
    },
    {
      row: 'NFD name against an NFC title',
      to: ['Café'.normalize('NFD')],
      roster: [...PARTICIPANTS, { ...cafe, name: 'Café'.normalize('NFC') }],
      stored: [{ ...cafe, name: 'Café'.normalize('NFC') }],
    },
  ])('post_Stamps: $row', async ({ to, roster, stored }) => {
    const over = serviceOver({ participants: () => roster });

    accepted(await over.post(postBy(docsFix, { to })));

    const [message] = await store.read(ROOM, 0);
    expect(message.to).toEqual(stored);
  });

  it.each([
    {
      row: 'explicit thread',
      send: (over: RoomService) =>
        over.post(postBy(shopRevamp, { thread: 'plan-x' })),
      thread: 'plan-x',
    },
    {
      row: 'explicit thread with spaces',
      send: (over: RoomService) =>
        over.post(postBy(shopRevamp, { thread: ' plan-x ' })),
      thread: 'plan-x',
    },
    {
      row: 'replyTo a message in plan-x',
      send: async (over: RoomService) => {
        await over.post(postBy(docsFix, { thread: 'plan-x', body: 'first' }));
        return over.post(postBy(shopRevamp, { replyTo: 1 }));
      },
      thread: 'plan-x',
    },
    {
      row: 'agent with neither',
      send: (over: RoomService) => over.post(postBy(shopRevamp)),
      thread: 'session:rA',
    },
    {
      row: 'human with neither',
      send: (over: RoomService) => over.postHuman(humanPost()),
      thread: 'general',
    },
  ])('post_DefaultThread: $row → $thread', async ({ send, thread }) => {
    const result = accepted(await send(service));

    expect(result.thread).toBe(thread);
    expect((await store.read(ROOM, 0)).at(-1)?.thread).toBe(thread);
  });

  it.each([
    {
      row: 'same sender, same key',
      first: postBy(shopRevamp, { key: 'k1', thread: 'plan-x' }),
      fillers: 0,
      laterMs: 1,
      again: postBy(shopRevamp, { key: 'k1', body: 'retry' }),
      duplicate: true,
    },
    {
      row: 'another sender, same key',
      first: postBy(shopRevamp, { key: 'k1' }),
      fillers: 0,
      laterMs: 1,
      again: postBy(docsFix, { key: 'k1' }),
      duplicate: false,
    },
    {
      row: 'same sender, null key twice',
      first: postBy(shopRevamp, { body: 'one' }),
      fillers: 0,
      laterMs: 1,
      again: postBy(shopRevamp, { body: 'two' }),
      duplicate: false,
    },
    {
      row: 'same key after answerBy passed',
      first: postBy(shopRevamp, {
        key: 'k1',
        kind: 'question',
        to: ['you'],
        answerBy: START + 1000,
      }),
      fillers: 0,
      laterMs: 2000,
      again: postBy(shopRevamp, {
        key: 'k1',
        kind: 'question',
        to: ['you'],
        answerBy: START + 1000,
      }),
      duplicate: true,
    },
    {
      row: 'same key and body inside 2 minutes',
      first: postBy(shopRevamp, { key: 'k1' }),
      fillers: 0,
      laterMs: 1,
      again: postBy(shopRevamp, { key: 'k1' }),
      duplicate: true,
    },
    {
      row: 'same key as the 11th post in a minute',
      first: postBy(shopRevamp, { key: 'k1' }),
      fillers: 9,
      laterMs: 1,
      again: postBy(shopRevamp, { key: 'k1' }),
      duplicate: true,
    },
  ])(
    'post_Key_ReturnsTheFirstId: $row',
    async ({ first, fillers, laterMs, again, duplicate }) => {
      const original = accepted(await service.post(first));
      for (let filler = 0; filler < fillers; filler += 1) {
        now += 1;
        accepted(
          await service.post(postBy(first.from, { body: `filler ${filler}` })),
        );
      }
      now += laterMs;

      const result = await service.post(again);

      const stored = await store.read(ROOM, 0);
      if (duplicate) {
        expect(result).toEqual({ ok: true, ...original, duplicate: true });
        expect(stored).toHaveLength(1 + fillers);
      } else {
        expect(accepted(result).id).not.toBe(original.id);
        expect(stored).toHaveLength(2 + fillers);
      }
    },
  );

  it('post_SaveFails: refuses, and nothing runs after the failed append', async () => {
    const failing: RoomStore = {
      ...createMemoryRoomStore(),
      append: () => Promise.reject(new Error('disk full')),
    };
    const over = serviceOver({ store: failing });
    const heard: RoomMessage[] = [];
    over.onMessage((message) => heard.push(message));
    const mirror = fakeMirror('m1', true);
    over.addMirror(mirror.mirror);
    await over.resolveThread(ROOM, 'plan-x');

    const posted = await over.post(postBy(shopRevamp, { thread: 'plan-x' }));
    const humanPosted = await over.postHuman(humanPost({ thread: 'plan-x' }));
    const entry = over.addEntry({
      room: ROOM,
      thread: 'plan-x',
      from: shopRevamp,
      kind: 'dispatch',
      body: 'go',
      refs: [],
    });

    await expect(entry).rejects.toThrow('disk full');
    for (const result of [posted, humanPosted]) {
      expect(result).toEqual({
        ok: false,
        reason: 'could not save the message: disk full',
      });
    }
    await over.settled();
    expect(heard).toEqual([]);
    expect(mirror.published).toEqual([]);
    expect(JSON.parse(await files.read('threads.json'))).toEqual({
      [ROOM]: ['plan-x'],
    });
  });

  it('post_ThreadsUnreadable: rejects and stores nothing', async () => {
    const failing: Pick<Files, 'read' | 'write'> = {
      read: (path) =>
        path === 'threads.json'
          ? Promise.reject(new Error('EACCES'))
          : files.read(path),
      write: (path, text) => files.write(path, text),
    };
    const over = serviceOver({ files: failing });

    const posted = over.post(postBy(shopRevamp, { thread: 'plan-x' }));

    await expect(posted).rejects.toThrow('EACCES');
    expect(await store.read(ROOM, 0)).toEqual([]);
  });

  it('post_Key_Concurrent_WritesOnce', async () => {
    const [one, two] = await Promise.all([
      service.post(postBy(shopRevamp, { key: 'k1', body: 'one' })),
      service.post(postBy(shopRevamp, { key: 'k1', body: 'two' })),
    ]);

    expect(accepted(two).id).toBe(accepted(one).id);
    expect(await store.read(ROOM, 0)).toHaveLength(1);
  });

  it.each([
    {
      row: 'same sender at +119999 ms',
      second: { by: shopRevamp, body: 'same' },
      afterMs: 119_999,
      dropped: true,
    },
    {
      row: 'same sender at +120000 ms',
      second: { by: shopRevamp, body: 'same' },
      afterMs: 120_000,
      dropped: false,
    },
    {
      row: 'another sender at +1 ms',
      second: { by: docsFix, body: 'same' },
      afterMs: 1,
      dropped: false,
    },
    {
      row: 'same sender, other body',
      second: { by: shopRevamp, body: 'other' },
      afterMs: 1,
      dropped: false,
    },
  ])('post_IdenticalBody: $row', async ({ second, afterMs, dropped }) => {
    accepted(await service.post(postBy(shopRevamp, { body: 'same' })));
    now += afterMs;

    const result = await service.post(postBy(second.by, { body: second.body }));

    if (dropped) {
      expect(reasonOf(result)).toContain('dropped');
      expect(reasonOf(result)).toContain('#1');
    } else {
      expect(result.ok).toBe(true);
    }
  });

  it('post_IdenticalBody: the user is never dropped', async () => {
    const first = await service.postHuman(humanPost({ body: 'same' }));
    now += 1;
    const second = await service.postHuman(humanPost({ body: 'same' }));

    expect([first.ok, second.ok]).toEqual([true, true]);
  });

  it('post_IdenticalBody: a mirror sender is dropped', async () => {
    const mirror = fakeMirror('tg', true);
    service.addMirror(mirror.mirror);

    mirror.say('plan-x', 'from the phone');
    await service.settled();
    now += 1000;
    mirror.say('plan-x', 'from the phone');
    await service.settled();

    expect(idsOf(await store.read(ROOM, 0))).toEqual([1]);
    expect(logged).toEqual([
      'mirror tg post refused: dropped: the same body was posted as #1 1 seconds ago',
    ]);
  });

  it('post_RateCap: refuses the post past the cap until the oldest leaves the minute', async () => {
    const results: boolean[] = [];
    for (let second = 0; second < 10; second += 1) {
      now = START + second * 1000;
      results.push(
        (await service.post(postBy(shopRevamp, { body: `post ${second}` }))).ok,
      );
    }
    now = START + 10_000;
    const capped = await service.post(postBy(shopRevamp, { body: 'eleven' }));
    now = START + 60_000;
    const later = await service.post(postBy(shopRevamp, { body: 'eleven' }));

    expect(results).toEqual(Array(10).fill(true));
    expect(reasonOf(capped)).toContain('wait 50 seconds');
    expect(later.ok).toBe(true);
  });

  const entryBy = (from: Participant, body: string) => ({
    room: ROOM,
    thread: 'session:rA',
    from,
    kind: 'dispatch' as const,
    body,
    refs: [],
  });

  it.each([
    {
      row: 'the user posts 11 times in a second',
      run: async (over: RoomService) => {
        for (let post = 0; post < 10; post += 1) {
          accepted(await over.postHuman(humanPost({ body: `post ${post}` })));
        }
        return (await over.postHuman(humanPost({ body: 'eleven' }))).ok;
      },
    },
    {
      row: '10 entries, then a post',
      run: async (over: RoomService) => {
        for (let entry = 0; entry < 10; entry += 1) {
          await over.addEntry(entryBy(shopRevamp, `entry ${entry}`));
        }
        return (await over.post(postBy(shopRevamp, { body: 'eleven' }))).ok;
      },
    },
    {
      row: '10 posts, then an entry',
      run: async (over: RoomService) => {
        for (let post = 0; post < 10; post += 1) {
          accepted(
            await over.post(postBy(shopRevamp, { body: `post ${post}` })),
          );
        }
        const entry = await over.addEntry(entryBy(shopRevamp, 'eleven'));
        return entry.id === 11;
      },
    },
    {
      row: 'an entry, then a post with its body',
      run: async (over: RoomService) => {
        await over.addEntry(entryBy(shopRevamp, 'same'));
        return (await over.post(postBy(shopRevamp, { body: 'same' }))).ok;
      },
    },
  ])('post_RateCap: not held: $row', async ({ run }) => {
    expect(await run(service)).toBe(true);
  });

  it.each([
    {
      row: 'agent post',
      send: async (over: RoomService) => {
        await over.post(postBy(shopRevamp));
      },
      from: shopRevamp,
      userWord: false,
    },
    {
      row: 'human post',
      send: async (over: RoomService) => {
        await over.postHuman(humanPost());
      },
      from: USER_PARTICIPANT,
      userWord: true,
    },
    {
      row: 'unverified mirror',
      send: async (over: RoomService) => {
        const mirror = fakeMirror('tg', false);
        over.addMirror(mirror.mirror);
        mirror.say('plan-x', 'from the phone');
        await over.settled();
      },
      from: {
        kind: 'mirror' as const,
        rowId: null,
        agentId: null,
        mirrorId: 'tg',
        name: 'you via tg',
      },
      userWord: false,
    },
    {
      row: 'verified mirror',
      send: async (over: RoomService) => {
        const mirror = fakeMirror('tg', true);
        over.addMirror(mirror.mirror);
        mirror.say('plan-x', 'from the phone');
        await over.settled();
      },
      from: {
        kind: 'mirror' as const,
        rowId: null,
        agentId: null,
        mirrorId: 'tg',
        name: 'you via tg',
      },
      userWord: true,
    },
  ])('post_UserWord: $row → $userWord', async ({ send, from, userWord }) => {
    await send(service);

    const [message] = await store.read(ROOM, 0);
    expect({ from: message.from, userWord: message.userWord }).toEqual({
      from,
      userWord,
    });
  });

  it('post_IntoResolvedThread_OpensIt', async () => {
    accepted(await service.post(postBy(shopRevamp, { thread: 'plan-x' })));
    await service.resolveThread(ROOM, 'plan-x');

    await service.addEntry({ ...entryBy(shopRevamp, 'go'), thread: 'plan-x' });
    const afterEntry = await service.threads(ROOM);
    accepted(
      await service.post(postBy(docsFix, { thread: 'plan-x', body: 'reopen' })),
    );
    const afterPost = await service.threads(ROOM);

    expect(afterEntry[0].resolved).toBe(true);
    expect(afterPost[0].resolved).toBe(false);
  });

  it.each([
    { length: 1600, stored: 'x'.repeat(1499) + '…' },
    { length: 1500, stored: 'x'.repeat(1500) },
  ])(
    'addEntry_SkipsChecksAndCutsBody: $length characters',
    async ({ length, stored }) => {
      for (let post = 0; post < 10; post += 1) {
        accepted(await service.post(postBy(shopRevamp, { body: `p${post}` })));
      }

      const entry = await service.addEntry(
        entryBy(shopRevamp, 'x'.repeat(length)),
      );

      expect(entry).toEqual({
        id: 11,
        room: ROOM,
        thread: 'session:rA',
        from: shopRevamp,
        to: [],
        kind: 'dispatch',
        body: stored,
        refs: [],
        replyTo: null,
        answerBy: null,
        onNoAnswer: null,
        key: null,
        at: START,
        userWord: false,
      });
    },
  );

  it('read_Unread: returns what names the reader or sits in its open threads, then nothing', async () => {
    const steps: (() => Promise<unknown>)[] = [
      // 1: a question to Shop Revamp
      () => service.post(questionToShopRevamp('Is the editor free?\nDetails')),
      // 2: a note in Shop Revamp's own thread
      () =>
        service.post(
          postBy(docsFix, { thread: 'session:rA', body: 'note for you' }),
        ),
      // 3: a progress in it
      () =>
        service.post(
          postBy(workerOfShopRevamp, { kind: 'progress', body: 'phase 1' }),
        ),
      // 4: an entry in it
      () => service.addEntry(entryBy(shopRevamp, 'dispatched')),
      // 5: the reader's own note
      () =>
        service.post(postBy(shopRevamp, { thread: 'plan-a', body: 'mine' })),
      // 6: a thread only Docs Fix posted in
      () =>
        service.post(postBy(docsFix, { thread: 'plan-b', body: 'not yours' })),
      // 7, 8: a thread the reader posted in, then resolved
      () =>
        service.post(postBy(shopRevamp, { thread: 'plan-r', body: 'start' })),
      () =>
        service.post(postBy(docsFix, { thread: 'plan-r', body: 'resolved' })),
      () => service.resolveThread(ROOM, 'plan-r'),
      // 9, 10, 11: the reader wrote only a progress and an entry there
      () =>
        service.post(
          postBy(shopRevamp, {
            kind: 'progress',
            thread: 'plan-s',
            body: 'working',
          }),
        ),
      () =>
        service.addEntry({
          ...entryBy(shopRevamp, 'handed back'),
          kind: 'hand-back',
          thread: 'plan-s',
        }),
      () =>
        service.post(postBy(docsFix, { thread: 'plan-s', body: 'not read' })),
    ];
    for (const step of steps) {
      now += 1;
      await step();
    }

    const first = await service.read(ROOM, shopRevamp, { kind: 'unread' });
    const second = await unreadIds(shopRevamp);

    expect(first).toMatchObject({
      ok: true,
      items: [
        { id: 1, text: 'Is the editor free?', from: 'Docs Fix' },
        { id: 2, text: 'note for you', from: 'Docs Fix' },
      ],
    });
    expect(first.ok && first.items).toHaveLength(2);
    expect(second).toEqual([]);
  });

  it('read_Unread_PostDuringRead: a post made during the read shows in the next one', async () => {
    accepted(await service.post(questionToShopRevamp('first')));

    const reading = unreadIds(shopRevamp);
    const posting = service.post(questionToShopRevamp('second'));
    const [first] = await Promise.all([reading, posting]);

    expect(first).toEqual([1]);
    expect(await unreadIds(shopRevamp)).toEqual([2]);
  });

  it.each([
    { body: '\n\nfirst\nsecond', text: 'first' },
    { body: 'y'.repeat(250) + '\nnext', text: 'y'.repeat(199) + '…' },
  ])('read_TextIsFirstLineCut: $text', async ({ body, text }) => {
    accepted(await service.post(questionToShopRevamp(body)));

    const result = await service.read(ROOM, shopRevamp, { kind: 'unread' });

    expect(result.ok && result.items.map((item) => item.text)).toEqual([text]);
  });

  it('read_CursorSurvivesANewService', async () => {
    accepted(await service.post(questionToShopRevamp('Is it free?')));
    expect(await unreadIds(shopRevamp)).toEqual([1]);
    await service.settled();

    expect(await unreadIds(shopRevamp, serviceOver())).toEqual([]);
  });

  it.each([
    {
      query: { kind: 'thread' as const, thread: 'session:rA' },
      result: { ok: true, ids: [1, 2, 3] },
    },
    {
      query: { kind: 'message' as const, id: 2 },
      result: { ok: true, ids: [2] },
    },
    {
      query: { kind: 'message' as const, id: 99 },
      result: { ok: false, reason: `no message #99 in ${ROOM}` },
    },
  ])('read_ThreadAndMessage: $query', async ({ query, result }) => {
    accepted(
      await service.post(
        postBy(docsFix, { thread: 'session:rA', body: 'first\nsecond' }),
      ),
    );
    accepted(
      await service.post(
        postBy(workerOfShopRevamp, { kind: 'progress', body: 'phase\n2' }),
      ),
    );
    await service.addEntry(entryBy(shopRevamp, 'dispatched\nworker'));
    accepted(
      await service.post(postBy(docsFix, { thread: 'plan-b', body: 'b' })),
    );
    const bodies = new Map(
      (await store.read(ROOM, 0)).map((message) => [message.id, message.body]),
    );

    const read = await service.read(ROOM, shopRevamp, query);

    if (result.ok) {
      expect(
        read.ok && read.items.map(({ id, text }) => ({ id, text })),
      ).toEqual(result.ids?.map((id) => ({ id, text: bodies.get(id) })));
    } else {
      expect(read).toEqual({ ok: false, reason: result.reason });
    }
    expect(await unreadIds(shopRevamp)).toEqual([1]);
  });

  it('unreadAddressed_CountsOnlyNamed', async () => {
    const steps: (() => Promise<unknown>)[] = [
      // 1: a question naming Shop Revamp → returned
      () => service.post(questionToShopRevamp('Is the editor free?')),
      // 2: an agent note to a thread Shop Revamp takes part in
      () =>
        service.post(postBy(docsFix, { thread: 'session:rA', body: 'fyi' })),
      // 3: Shop Revamp's own message naming itself
      () =>
        store.append({
          ...newMessage(ROOM, 'note to self'),
          from: shopRevamp,
          to: [shopRevamp],
          thread: 'session:rA',
        }),
      // 4: a progress naming Shop Revamp
      () =>
        service.post(
          postBy(workerOfShopRevamp, {
            kind: 'progress',
            to: ['Shop Revamp'],
            body: 'phase 1',
          }),
        ),
      // 5: an entry naming Shop Revamp
      () =>
        store.append({
          ...newMessage(ROOM, 'dispatched'),
          kind: 'dispatch',
          from: shopRevamp,
          to: [shopRevamp],
        }),
      // 6: the user's word to Shop Revamp's thread → returned
      () =>
        service.postHuman(
          humanPost({ thread: 'session:rA', body: 'go ahead' }),
        ),
      // 7: the user's word to a thread Shop Revamp never took part in
      () =>
        service.postHuman(humanPost({ thread: 'plan-z', body: 'elsewhere' })),
    ];
    for (const step of steps) {
      now += 1;
      await step();
    }

    const addressed = idsOf(await service.unreadAddressed(ROOM, shopRevamp));
    const again = idsOf(await service.unreadAddressed(ROOM, shopRevamp));
    const unread = await unreadIds(shopRevamp);

    expect(addressed).toEqual([1, 6]);
    expect(again).toEqual(addressed);
    expect(unread).toEqual(expect.arrayContaining(addressed));
  });

  it('userUnread_PerThread', async () => {
    accepted(
      await service.post(postBy(shopRevamp, { thread: 't1', body: 'note' })),
    );
    accepted(
      await service.post(
        postBy(workerOfShopRevamp, {
          kind: 'progress',
          thread: 't1',
          body: 'phase',
        }),
      ),
    );
    await service.addEntry({ ...entryBy(shopRevamp, 'go'), thread: 't1' });
    accepted(await service.postHuman(humanPost({ thread: 't1' })));
    accepted(
      await service.post(
        postBy(docsFix, { kind: 'question', thread: 't2', to: ['you'] }),
      ),
    );
    const phone = fakeMirror('tg', true);
    service.addMirror(phone.mirror);
    phone.say('t2', 'from the phone');
    await service.settled();

    const first = idsOf(await service.userUnread(ROOM));
    await service.markUserRead(ROOM, 't1', 1);
    const afterMark = idsOf(await service.userUnread(ROOM));
    await service.markUserRead(ROOM, 't1', 0);
    const afterLowerMark = idsOf(await service.userUnread(ROOM));
    await service.settled();
    const reopened = idsOf(await serviceOver().userUnread(ROOM));
    await service.resolveThread(ROOM, 't2');
    const afterResolve = idsOf(await service.userUnread(ROOM));

    expect(first).toEqual([1, 5]);
    expect(afterMark).toEqual([5]);
    expect(afterLowerMark).toEqual([5]);
    expect(reopened).toEqual([5]);
    expect(afterResolve).toEqual([5]);
  });

  it('threads_Summaries', async () => {
    now = START + 1;
    accepted(await service.post(postBy(shopRevamp, { thread: 't1' })));
    now = START + 2;
    accepted(
      await service.post(postBy(docsFix, { thread: 't2', body: 'two' })),
    );
    now = START + 3;
    accepted(
      await service.post(postBy(docsFix, { thread: 't1', body: 'three' })),
    );
    await service.resolveThread(ROOM, 't2');

    await service.resolveThread(ROOM, 'no-message');
    await service.resolveThread('elsewhere', 't9');

    expect(await service.threads(ROOM)).toEqual([
      {
        thread: 't1',
        resolved: false,
        count: 2,
        lastId: 3,
        lastAt: START + 3,
      },
      {
        thread: 't2',
        resolved: true,
        count: 1,
        lastId: 2,
        lastAt: START + 2,
      },
    ]);
    expect(await service.threads('elsewhere')).toEqual([]);
  });

  const claimBy = (
    holder: Participant,
    target: ClaimTarget,
    minutes: number | null = null,
  ) => ({ room: ROOM, holder, target, reason: 'editing', minutes });

  // The claim of an accepted request; fails the test on a refusal.
  async function claimed(
    over: RoomService,
    request: ReturnType<typeof claimBy>,
  ): Promise<Claim> {
    const result = await over.claim(request);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    return result.claim;
  }

  it.each([
    { minutes: null, expiresAt: START + 1_800_000 },
    { minutes: 5, expiresAt: START + 300_000 },
  ])(
    'claim_ExpiryAndRenew: minutes $minutes → $expiresAt',
    async ({ minutes, expiresAt }) => {
      const claim = await claimed(
        service,
        claimBy(shopRevamp, { paths: ['a.ts'] }, minutes),
      );

      expect(claim.expiresAt).toBe(expiresAt);
    },
  );

  it.each([
    {
      row: 'same paths in another order',
      second: { holder: shopRevamp, target: { paths: ['b.ts', 'a.ts'] } },
      sameId: true,
    },
    {
      row: 'other paths',
      second: { holder: shopRevamp, target: { paths: ['c.ts'] } },
      sameId: false,
    },
    {
      row: 'renamed holder',
      second: {
        holder: { ...shopRevamp, name: 'Shop Revamp 2' },
        target: { paths: ['a.ts', 'b.ts'] },
      },
      sameId: true,
    },
  ])('claim_ExpiryAndRenew: $row', async ({ second, sameId }) => {
    const first = await claimed(
      service,
      claimBy(shopRevamp, { paths: ['a.ts', 'b.ts'] }),
    );
    now += 1000;

    const renewed = await claimed(
      service,
      claimBy(second.holder, second.target),
    );

    expect(renewed.id === first.id).toBe(sameId);
    expect(renewed.expiresAt).toBe(now + 1_800_000);
    expect(renewed.holder).toEqual(second.holder);
    expect(await service.claims(ROOM)).toHaveLength(sameId ? 1 : 2);
  });

  it('claim_ExpiryAndRenew: stores paths sorted once each', async () => {
    const claim = await claimed(
      service,
      claimBy(shopRevamp, { paths: ['b', 'a', 'b'] }),
    );

    expect(claim.target).toEqual({ paths: ['a', 'b'] });
  });

  it('claim_ExpiryAndRenew: an expired claim is not listed', async () => {
    const claim = await claimed(
      service,
      claimBy(shopRevamp, { branch: 'main' }, 5),
    );
    now = claim.expiresAt - 1;
    const beforeExpiry = await service.claims(ROOM);
    now = claim.expiresAt;

    expect(beforeExpiry).toEqual([claim]);
    expect(await service.claims(ROOM)).toEqual([]);
  });

  it.each([
    { row: 'blank reason', fields: { reason: ' ' }, reasonHas: 'reason' },
    { row: 'minutes 0', fields: { minutes: 0 }, reasonHas: 'minutes' },
    {
      row: 'absolute path',
      fields: { target: { paths: ['/abs/x'] } },
      reasonHas: '/abs/x',
    },
    {
      row: 'path with ..',
      fields: { target: { paths: ['a/../b'] } },
      reasonHas: 'a/../b',
    },
    { row: 'path .', fields: { target: { paths: ['.'] } }, reasonHas: '.' },
    {
      row: 'empty paths',
      fields: { target: { paths: [] } },
      reasonHas: 'at least one path',
    },
    {
      row: 'blank branch',
      fields: { target: { branch: ' ' } },
      reasonHas: 'branch',
    },
  ])('claim_Refused: $row', async ({ fields, reasonHas }) => {
    const result = await service.claim({
      ...claimBy(shopRevamp, { paths: ['a.ts'] }),
      ...fields,
    });

    expect(reasonOf(result)).toContain(reasonHas);
    expect(await service.claims(ROOM)).toEqual([]);
  });

  const OVERLAP_ROWS = [
    {
      row: 'paths under a held pattern',
      held: { paths: ['src/a/**'] },
      asker: docsFix,
      asked: { paths: ['src/a/b.ts'] },
      expired: false,
      listed: true,
    },
    {
      row: 'the same branch',
      held: { branch: 'main' },
      asker: docsFix,
      asked: { branch: 'main' },
      expired: false,
      listed: true,
    },
    {
      row: 'another resource',
      held: { resource: 'vite-build' },
      asker: docsFix,
      asked: { resource: 'selftest' },
      expired: false,
      listed: false,
    },
    {
      row: 'paths over a branch',
      held: { branch: 'main' },
      asker: docsFix,
      asked: { paths: ['main'] },
      expired: false,
      listed: false,
    },
    {
      row: 'a subagent of the holder',
      held: { paths: ['src/a/**'] },
      asker: workerOfShopRevamp,
      asked: { paths: ['src/a/b.ts'] },
      expired: false,
      listed: false,
    },
    {
      row: 'an expired claim',
      held: { paths: ['src/a/**'] },
      asker: docsFix,
      asked: { paths: ['src/a/b.ts'] },
      expired: true,
      listed: false,
    },
  ];

  // Shop Revamp's claim on `held`, the clock moved past it when `expired`.
  async function heldClaim(
    held: ClaimTarget,
    expired: boolean,
  ): Promise<Claim> {
    const claim = await claimed(service, claimBy(shopRevamp, held, 1));
    now = expired ? claim.expiresAt : claim.expiresAt - 1;
    return claim;
  }

  it.each(OVERLAP_ROWS)(
    'claim_Overlaps: $row',
    async ({ held, asker, asked, expired, listed }) => {
      const holderClaim = await heldClaim(held, expired);

      const result = await service.claim(claimBy(asker, asked));

      expect(result.ok && result.overlaps).toEqual(listed ? [holderClaim] : []);
    },
  );

  it.each(OVERLAP_ROWS)(
    'claimsTouching_ExcludesTheAsker: $row',
    async ({ held, asker, asked, expired, listed }) => {
      const holderClaim = await heldClaim(held, expired);

      const touching = await service.claimsTouching(ROOM, asked, asker);

      expect(touching).toEqual(listed ? [holderClaim] : []);
      expect(await service.claims(ROOM)).toEqual(expired ? [] : [holderClaim]);
    },
  );

  // A claim refuses these targets; an ask takes them as `claim` would store
  // them, leaving out the unusable paths.
  it.each([
    {
      row: 'a ./ path',
      held: { paths: ['src/a/**'] },
      asked: { paths: ['./src/a/b.ts'] },
      listed: true,
    },
    {
      row: 'a \\ path',
      held: { paths: ['src/a/**'] },
      asked: { paths: ['src\\a\\b.ts'] },
      listed: true,
    },
    {
      row: 'an absolute path beside a usable one',
      held: { paths: ['src/a/**'] },
      asked: { paths: ['/abs', 'src/a/b.ts'] },
      listed: true,
    },
    {
      row: 'only an absolute path',
      held: { paths: ['src/a/**'] },
      asked: { paths: ['/src/a/b.ts'] },
      listed: false,
    },
    {
      row: 'a branch with spaces',
      held: { branch: 'main' },
      asked: { branch: ' main ' },
      listed: true,
    },
    {
      row: 'a resource with spaces',
      held: { resource: 'selftest' },
      asked: { resource: ' selftest ' },
      listed: true,
    },
  ])(
    'claimsTouching_TakesTheAskAsStored: $row',
    async ({ held, asked, listed }) => {
      const holderClaim = await heldClaim(held, false);

      const touching = await service.claimsTouching(ROOM, asked, docsFix);

      expect(touching).toEqual(listed ? [holderClaim] : []);
    },
  );

  it.each([
    {
      row: 'own id',
      releaser: shopRevamp,
      pick: (held: Claim[]) => held[0].id,
      released: [0],
      left: [1, 2],
      refusal: null,
    },
    {
      row: 'every claim of the holder',
      releaser: shopRevamp,
      pick: () => null,
      released: [0, 1],
      left: [2],
      refusal: null,
    },
    {
      row: "another holder's id",
      releaser: docsFix,
      pick: (held: Claim[]) => held[0].id,
      released: [],
      left: [0, 1, 2],
      refusal: 'is held by Shop Revamp',
    },
    {
      row: 'unknown id',
      releaser: shopRevamp,
      pick: () => 'ffffffff',
      released: [],
      left: [0, 1, 2],
      refusal: 'no claim ffffffff',
    },
  ])('release: $row', async ({ releaser, pick, released, left, refusal }) => {
    const held = [
      await claimed(service, claimBy(shopRevamp, { paths: ['a.ts'] })),
      await claimed(service, claimBy(shopRevamp, { branch: 'main' })),
      await claimed(service, claimBy(docsFix, { resource: 'selftest' })),
    ];
    const elsewhere = await claimed(service, {
      ...claimBy(shopRevamp, { paths: ['a.ts'] }),
      room: 'elsewhere',
    });

    const result = await service.release(ROOM, releaser, pick(held));

    if (refusal === null) {
      expect(result).toEqual({
        ok: true,
        released: released.map((index) => held[index]),
      });
    } else {
      expect(reasonOf(result)).toContain(refusal);
    }
    expect(await service.claims(ROOM)).toEqual(
      left.map((index) => held[index]),
    );
    expect(await service.claims('elsewhere')).toEqual([elsewhere]);
  });

  it('endClaimsOf_EndsEveryRoom', async () => {
    const here = await claimed(
      service,
      claimBy(shopRevamp, { paths: ['a.ts'] }),
    );
    const elsewhere = await claimed(service, {
      ...claimBy(workerOfShopRevamp, { branch: 'main' }),
      room: 'elsewhere',
    });
    const other = await claimed(service, claimBy(docsFix, { paths: ['b.ts'] }));

    const ended = await service.endClaimsOf('rA');

    expect(ended).toEqual([here, elsewhere]);
    expect(await service.claims(ROOM)).toEqual([other]);
    expect(await service.claims('elsewhere')).toEqual([]);
  });

  it('claims_SurviveANewService', async () => {
    const live = await claimed(
      service,
      claimBy(shopRevamp, { paths: ['a.ts'] }),
    );
    await claimed(service, claimBy(docsFix, { branch: 'main' }, 1));
    await service.settled();
    now += 60_000;

    expect(await serviceOver().claims(ROOM)).toEqual([live]);
  });

  // Touches every saved file: a post read, a user read, a resolved thread and
  // a claim.
  async function exercise(over: RoomService): Promise<void> {
    accepted(await over.post(questionToShopRevamp('Is it free?')));
    expect(await unreadIds(shopRevamp, over)).toEqual([1]);
    expect(idsOf(await over.userUnread(ROOM))).toEqual([1]);
    await over.markUserRead(ROOM, 'plan-q', 1);
    await over.resolveThread(ROOM, 'plan-q');
    await claimed(over, claimBy(shopRevamp, { paths: ['a.ts'] }));
    await over.settled();
  }

  it.each(
    SAVED_FILES.flatMap((file) =>
      ['{', 'null', '"x"', file === 'claims.json' ? '{}' : '[]'].map(
        (text) => ({ file, text }),
      ),
    ),
  )(
    'files_Unreadable_StartEmpty: $file holding $text',
    async ({ file, text }) => {
      await files.write(file, text);

      await exercise(serviceOver());

      expect(logged).toEqual([`${file} unreadable, starting empty`]);
    },
  );

  it.each(SAVED_FILES.filter((file) => file !== 'claims.json'))(
    'files_DroppedEntry_LogsTheDrop: %s holding {"room": 5}',
    async (file) => {
      await files.write(file, '{"room": 5}');

      await exercise(serviceOver());

      expect(logged).toEqual([`${file}: dropped entries of the wrong shape`]);
    },
  );

  it('files_DroppedEntry_KeepsTheWholeClaims', async () => {
    const whole: Claim = {
      id: 'c1',
      room: ROOM,
      holder: docsFix,
      target: { paths: ['a.ts'] },
      reason: 'editing',
      expiresAt: START + 60_000,
    };
    await files.write('claims.json', JSON.stringify([whole, 5]));

    const claims = await serviceOver().claims(ROOM);

    expect(claims).toEqual([whole]);
    expect(logged).toEqual(['claims.json: dropped entries of the wrong shape']);
  });

  it('files_WriteFails_KeepsMemory', async () => {
    const failing: Pick<Files, 'read' | 'write'> = {
      read: (path) => files.read(path),
      write: () => Promise.reject(new Error('disk full')),
    };
    const over = serviceOver({ files: failing });
    accepted(await over.post(questionToShopRevamp('Is it free?')));

    const firstRead = await unreadIds(shopRevamp, over);
    const claim = await claimed(over, claimBy(shopRevamp, { paths: ['a.ts'] }));
    await over.resolveThread(ROOM, 'plan-q');
    await over.settled();

    expect(firstRead).toEqual([1]);
    expect(await unreadIds(shopRevamp, over)).toEqual([]);
    expect(await over.claims(ROOM)).toEqual([claim]);
    expect((await over.threads(ROOM))[0].resolved).toBe(true);
    expect(logged).toEqual(
      expect.arrayContaining([
        'cursors.json not saved: disk full',
        'claims.json not saved: disk full',
        'threads.json not saved: disk full',
      ]),
    );
  });

  describe('mirrors_FanOut', () => {
    it('a post reaches every mirror and listener', async () => {
      const heard: RoomMessage[] = [];
      service.onMessage((message) => heard.push(message));
      const one = fakeMirror('one', true);
      const two = fakeMirror('two', false);
      service.addMirror(one.mirror);
      service.addMirror(two.mirror);

      accepted(await service.post(postBy(shopRevamp)));
      await service.settled();

      const stored = await store.read(ROOM, 0);
      expect(heard).toEqual(stored);
      expect(one.published).toEqual(stored);
      expect(two.published).toEqual(stored);
    });

    it('a rejected publish is logged and the other mirror still gets it', async () => {
      const failing = fakeMirror('down', true, () =>
        Promise.reject(new Error('offline')),
      );
      const working = fakeMirror('up', true);
      service.addMirror(failing.mirror);
      service.addMirror(working.mirror);

      const result = await service.post(postBy(shopRevamp));
      await service.settled();

      expect(result.ok).toBe(true);
      expect(working.published).toHaveLength(1);
      expect(logged).toEqual(['mirror down publish failed: offline']);
    });

    it("a mirror's own human message is not published back to it", async () => {
      const source = fakeMirror('tg', true);
      const other = fakeMirror('dc', true);
      service.addMirror(source.mirror);
      service.addMirror(other.mirror);

      source.say('plan-x', 'from the phone');
      await service.settled();

      expect(source.published).toEqual([]);
      expect(other.published).toHaveLength(1);
    });

    it('a disposed mirror neither publishes nor posts', async () => {
      const mirror = fakeMirror('tg', true);
      service.addMirror(mirror.mirror).dispose();

      accepted(await service.post(postBy(shopRevamp)));
      mirror.say('plan-x', 'from the phone');
      await service.settled();

      expect(mirror.published).toEqual([]);
      expect(await store.read(ROOM, 0)).toHaveLength(1);
    });

    it('a listener that throws is logged and the post succeeds', async () => {
      const heard: number[] = [];
      service.onMessage(() => {
        throw new Error('broken');
      });
      service.onMessage((message) => heard.push(message.id));

      const result = await service.post(postBy(shopRevamp));

      expect(result.ok).toBe(true);
      expect(heard).toEqual([1]);
      expect(logged).toEqual(['message listener failed: broken']);
    });

    it('the listener runs before each publish', async () => {
      const order: string[] = [];
      service.onMessage(() => order.push('listener'));
      service.addMirror(
        fakeMirror('one', true, async () => {
          order.push('one');
        }).mirror,
      );
      service.addMirror(
        fakeMirror('two', true, async () => {
          order.push('two');
        }).mirror,
      );

      accepted(await service.post(postBy(shopRevamp)));
      await service.settled();

      expect(order).toEqual(['listener', 'one', 'two']);
    });

    it('a publish that never settles does not delay the post, and settled waits for it', async () => {
      let finish: () => void = () => {};
      const hanging = fakeMirror(
        'slow',
        true,
        () =>
          new Promise<void>((resolve) => {
            finish = () => resolve();
          }),
      );
      service.addMirror(hanging.mirror);
      let isSettled = false;

      const result = await service.post(postBy(shopRevamp));
      const settling = service.settled().then(() => {
        isSettled = true;
      });
      await flush();
      const settledBeforeFinish = isSettled;
      finish();
      await settling;

      expect(result.ok).toBe(true);
      expect(settledBeforeFinish).toBe(false);
      expect(isSettled).toBe(true);
    });

    it('a refused human post is logged and writes nothing', async () => {
      const mirror = fakeMirror('tg', true);
      service.addMirror(mirror.mirror);

      mirror.say('plan-x', '');
      await service.settled();

      expect(await store.read(ROOM, 0)).toEqual([]);
      expect(logged).toEqual(['mirror tg post refused: body is empty']);
    });
  });
});
