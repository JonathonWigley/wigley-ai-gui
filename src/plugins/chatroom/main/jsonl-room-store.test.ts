import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import type { RoomMessage, RoomStore } from '../contract';
import { createJsonlRoomStore } from './jsonl-room-store';
import {
  describeRoomStoreContract,
  messageWithEveryField,
  newMessage,
} from './room-store.test-support';

const ROOM_FILE = 'rooms/shop.jsonl';

const stored = (id: number, body = `message ${id}`): RoomMessage => ({
  ...newMessage('shop', body),
  id,
});

const lineOf = (value: unknown) => JSON.stringify(value) + '\n';

const textOf = (...values: unknown[]) => values.map(lineOf).join('');

let files: MemoryFiles;
let logged: string[];
let store: RoomStore;

// Another store over the same files, as the next app run opens them.
function reopened(): RoomStore {
  return createJsonlRoomStore({ files, log: () => {} });
}

beforeEach(() => {
  files = createMemoryFiles();
  logged = [];
  store = createJsonlRoomStore({
    files,
    log: (message) => logged.push(message),
  });
});

describe('createJsonlRoomStore', () => {
  describeRoomStoreContract(() => store);

  it('reopen_ContinuesIds', async () => {
    const one = await store.append(messageWithEveryField('shop', 'one'));
    const two = await store.append(newMessage('shop', 'two'));

    const second = reopened();
    const [three, four] = await Promise.all([
      second.append(newMessage('shop', 'three')),
      second.append(newMessage('shop', 'four')),
    ]);

    expect([three.id, four.id]).toEqual([3, 4]);
    expect(await reopened().read('shop', 0)).toEqual([one, two, three, four]);
  });

  it.each([
    {
      name: 'a cut last line',
      text: lineOf(stored(1)) + lineOf(stored(2)) + '{"id":3,"ro',
      brokenLine: 3,
    },
    {
      name: 'a line {}',
      text: lineOf(stored(1)) + '{}\n' + lineOf(stored(2)),
      brokenLine: 2,
    },
    {
      name: 'a line that is not JSON',
      text: lineOf(stored(1)) + 'not json\n' + lineOf(stored(2)),
      brokenLine: 2,
    },
    {
      name: 'a line whose from is 5',
      text: textOf(stored(1), { ...stored(3), from: 5 }, stored(2)),
      brokenLine: 2,
    },
    {
      name: 'a line with id 0',
      text: textOf(stored(1), stored(0), stored(2)),
      brokenLine: 2,
    },
    {
      name: 'a repeated id',
      text: textOf(stored(1), stored(2), stored(1, 'again')),
      brokenLine: 3,
    },
  ])('reopen_SkipsBrokenLines: $name', async ({ text, brokenLine }) => {
    await files.write(ROOM_FILE, text);

    const read = await store.read('shop', 0);
    const next = await store.append(newMessage('shop', 'next'));

    expect(read).toEqual([stored(1), stored(2)]);
    expect(logged).toEqual([
      expect.stringContaining(`${ROOM_FILE} line ${brokenLine} `),
    ]);
    expect(next.id).toBe(3);
    expect(await reopened().read('shop', 0)).toEqual([
      stored(1),
      stored(2),
      next,
    ]);
  });

  it.each([
    { name: 'an empty line', blank: '\n' },
    { name: 'a line of only whitespace', blank: ' \t\n' },
  ])('reopen_BlankLinesSkippedSilently: $name', async ({ blank }) => {
    await files.write(
      ROOM_FILE,
      lineOf(stored(1)) + blank + lineOf(stored(2)) + 'not json\n',
    );

    expect(await store.read('shop', 0)).toEqual([stored(1), stored(2)]);
    expect(logged).toEqual([expect.stringContaining(`${ROOM_FILE} line 4 `)]);
  });

  it('reopen_OutOfOrderIds_ReadsSorted', async () => {
    await files.write(ROOM_FILE, lineOf(stored(2)) + lineOf(stored(1)));

    expect(await store.read('shop', 0)).toEqual([stored(1), stored(2)]);
    expect((await store.append(newMessage('shop', 'next'))).id).toBe(3);
  });

  it.each([
    { name: 'an empty file', text: '', expected: [] },
    {
      name: 'a file with only a cut line',
      text: '{"id":1,"ro',
      expected: [],
    },
    {
      name: 'a file with one whole line',
      text: lineOf(stored(1)),
      expected: ['shop'],
    },
  ])(
    'rooms_FileWithNoWholeLine_NotListed: $name',
    async ({ text, expected }) => {
      await files.write(ROOM_FILE, text);
      await files.write('rooms/notes.txt', lineOf(stored(1)));

      expect(await store.rooms()).toEqual(expected);
    },
  );

  it('load_ReadFails_RejectsThenRetries', async () => {
    await files.write(ROOM_FILE, lineOf(stored(1)));
    let readFailures = 1;
    const flaky = createJsonlRoomStore({
      files: {
        read(path) {
          if (readFailures > 0) {
            readFailures -= 1;
            return Promise.reject(new Error('disk busy'));
          }
          return files.read(path);
        },
        append: files.append,
        list: () => Promise.reject(new Error('folder busy')),
      },
      log: () => {},
    });

    await expect(flaky.append(newMessage('shop', 'first'))).rejects.toThrow(
      'disk busy',
    );
    const second = await flaky.append(newMessage('shop', 'second'));

    expect(second.id).toBe(2);
    await expect(flaky.rooms()).rejects.toThrow('folder busy');
  });

  it('append_WriteFails_RejectsAndUsesNoId', async () => {
    let appendCalls = 0;
    const flaky = createJsonlRoomStore({
      files: {
        read: files.read,
        list: files.list,
        async append(path, text) {
          appendCalls += 1;
          if (appendCalls === 2) {
            throw new Error('disk full');
          }
          await files.append(path, text);
        },
      },
      log: () => {},
    });

    const first = await flaky.append(newMessage('shop', 'first'));
    await expect(flaky.append(newMessage('shop', 'lost'))).rejects.toThrow(
      'disk full',
    );
    const third = await flaky.append(newMessage('shop', 'third'));

    expect(third.id).toBe(2);
    expect(await flaky.read('shop', 0)).toEqual([first, third]);
    expect(await files.read(ROOM_FILE)).toBe(
      '\n' + lineOf(first) + '\n' + lineOf(third),
    );
  });

  it('append_UnsafeRoom_StaysUnderRooms', async () => {
    await store.append(newMessage('../x', 'hello'));

    const writtenFiles = (await files.list('', { recursive: true }))
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path);

    expect(writtenFiles).toEqual(['rooms/%2E%2E%2Fx.jsonl']);
    expect(await reopened().rooms()).toEqual(['../x']);
  });
});
