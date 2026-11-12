import { describe, expect, it, vi } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { ChatMainExports } from '../../chat/contract';
import type { BacklogChunk, ChunkStart } from '../contract';
import { rowKey } from '../row-key';
import { createChunkStarter, noFolderRefusal } from './chunk-start';
import { createChunkStore } from './chunk-store';
import type { BacklogRow } from './rows';

const FOLLOWUPS = '/dev/r/docs/features/followups.md';

function chunk(
  id: string,
  titles: string[],
  fields: Partial<BacklogChunk> = {},
): BacklogChunk {
  return {
    id,
    repo: 'r',
    name: id,
    titles,
    headless: false,
    sessionId: null,
    ...fields,
  };
}

// A row of repo `r` in FOLLOWUPS, its folder `/dev/r`.
function row(title: string, fields: Partial<BacklogRow> = {}): BacklogRow {
  return {
    key: rowKey('r', title),
    repo: 'r',
    title,
    oneLine: `${title} gist`,
    tags: [],
    body: `${title} body.`,
    done: false,
    path: FOLLOWUPS,
    line: 3,
    homeRoot: '/dev/r/docs/features',
    repoFolder: '/dev/r',
    ...fields,
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type FakeChat = Pick<ChatMainExports, 'launch' | 'defaultProfile' | 'profileOf'>;

// A starter over a real store holding `chunks`, whose prune, retireUnheld and
// setSession are spies. Chat holds the sessions in `held`; its `launch`
// resolves to `sess-1`, `sess-2`, … and holds each, unless `chat` replaces a
// member. The launch brief is `Brief.`.
async function starterOver(
  chunks: BacklogChunk[],
  {
    rows = [row('a'), row('b')],
    held = [] as string[],
    chat = {} as Partial<FakeChat>,
  } = {},
) {
  const data = createMemoryFiles();
  await data.write('chunks.json', JSON.stringify({ chunks }));
  const holding = new Set(held);
  const logged: string[] = [];
  const store = createChunkStore({
    data,
    randomHex: () => 'new',
    restored: async () => undefined,
    isHeld: (sessionId) => holding.has(sessionId),
    log: () => undefined,
    changed: () => undefined,
  });
  const prune = vi.spyOn(store, 'prune');
  const retireUnheld = vi.spyOn(store, 'retireUnheld');
  const setSession = vi.spyOn(store, 'setSession');
  let launched = 0;
  const fakeChat = {
    launch: vi.fn<FakeChat['launch']>(
      chat.launch ??
        (async () => {
          const sessionId = `sess-${String(++launched)}`;
          holding.add(sessionId);
          return sessionId;
        }),
    ),
    defaultProfile: vi.fn<FakeChat['defaultProfile']>(
      chat.defaultProfile ?? (() => 'work'),
    ),
    profileOf: (sessionId: string) => (holding.has(sessionId) ? 'work' : null),
  };
  const starter = createChunkStarter({
    store,
    rows: async () => rows,
    chat: fakeChat,
    launchBrief: () => 'Brief.',
    log: (message) => logged.push(message),
  });
  return {
    starter,
    chat: fakeChat,
    holding,
    logged,
    prune,
    retireUnheld,
    setSession,
    saved: async (): Promise<BacklogChunk[]> =>
      (JSON.parse(await data.read('chunks.json')) as { chunks: BacklogChunk[] })
        .chunks,
  };
}

describe('chunk starter', () => {
  const C = chunk('C', ['a']);
  const STARTED = chunk('S', ['b'], { sessionId: 'sess' });
  // A chunk of a repo with no rows read, which prune leaves as it is.
  const UNREAD = chunk('U', ['u'], { repo: 'q' });

  it.each<{
    case: string;
    ids: string[];
    held?: string[];
    rows?: BacklogRow[];
    chat?: Partial<FakeChat>;
    results: ChunkStart[];
    launched: boolean;
    stored: boolean;
  }>([
    {
      case: 'no chunk with the id',
      ids: ['Z'],
      results: [{ chunkId: 'Z', refusal: 'No chunk Z' }],
      launched: false,
      stored: false,
    },
    {
      case: 'a started chunk',
      ids: ['S'],
      held: ['sess'],
      results: [{ chunkId: 'S', refusal: 'S has started' }],
      launched: false,
      stored: false,
    },
    {
      case: 'no row for any title',
      ids: ['U'],
      results: [
        { chunkId: 'U', refusal: "None of U's follow-ups are in the backlog" },
      ],
      launched: false,
      stored: false,
    },
    {
      case: 'a repo with no folder',
      ids: ['C'],
      rows: [row('a', { repoFolder: null })],
      results: [{ chunkId: 'C', refusal: noFolderRefusal('r') }],
      launched: false,
      stored: false,
    },
    {
      case: 'chat with no profiles',
      ids: ['C'],
      chat: { defaultProfile: () => null },
      results: [{ chunkId: 'C', refusal: 'Chat has no profiles' }],
      launched: false,
      stored: false,
    },
    {
      case: 'a launch that rejects',
      ids: ['C'],
      chat: {
        launch: async () => {
          throw new Error('spawn failed');
        },
      },
      results: [{ chunkId: 'C', refusal: 'spawn failed' }],
      launched: true,
      stored: false,
    },
    {
      case: 'a session closed before it was stored',
      ids: ['C'],
      chat: { launch: async () => 'sess-9' },
      results: [{ chunkId: 'C', refusal: "C's session closed as it started" }],
      launched: true,
      stored: false,
    },
    {
      case: 'a launch',
      ids: ['C'],
      results: [{ chunkId: 'C', sessionId: 'sess-1' }],
      launched: true,
      stored: true,
    },
    {
      case: 'a started chunk whose session chat no longer holds',
      ids: ['S', 'C'],
      held: [],
      results: [
        { chunkId: 'S', refusal: 'No chunk S' },
        { chunkId: 'C', sessionId: 'sess-1' },
      ],
      launched: true,
      stored: true,
    },
  ])(
    'startChunks_Cases given $case',
    async ({ ids, held, rows, chat, results, launched, stored }) => {
      const starting = await starterOver([C, STARTED, UNREAD], {
        held: held ?? [],
        rows,
        chat,
      });

      expect(await starting.starter.start(ids)).toEqual(results);
      expect(starting.chat.launch.mock.calls.length > 0).toBe(launched);
      expect(starting.setSession.mock.calls.length > 0).toBe(stored);
    },
  );

  it('startChunks_Launch_PassesFolderProfileHeadlessAndMessage', async () => {
    const starting = await starterOver(
      [chunk('H', ['b', 'gone', 'a'], { headless: true })],
      {
        rows: [
          row('a', { line: 3 }),
          row('b', { line: 9, oneLine: '', body: 'B body.' }),
        ],
      },
    );

    const results = await starting.starter.start(['H']);

    expect(results).toEqual([{ chunkId: 'H', sessionId: 'sess-1' }]);
    expect(starting.chat.defaultProfile).toHaveBeenCalledWith(null);
    expect(starting.chat.launch).toHaveBeenCalledWith({
      projectDir: '/dev/r',
      profile: 'work',
      message: {
        text: `Brief.\n\n## b\n\nB body.\n\nFrom ${FOLLOWUPS}:9\n\n## a\n\na gist\n\na body.\n\nFrom ${FOLLOWUPS}:3`,
        images: [],
      },
      headless: true,
    });
    expect(await starting.saved()).toEqual([
      chunk('H', ['b', 'a'], { headless: true, sessionId: 'sess-1' }),
    ]);
  });

  it('startChunks_TwoIds_RunInOrder', async () => {
    const starting = await starterOver([chunk('C1', ['a']), chunk('C2', ['b'])]);

    const results = await starting.starter.start(['C2', 'C1']);

    expect(results).toEqual([
      { chunkId: 'C2', sessionId: 'sess-1' },
      { chunkId: 'C1', sessionId: 'sess-2' },
    ]);
  });

  it('startChunks_TwoCallsAtOnce_LaunchOnce', async () => {
    let release: () => void = () => undefined;
    const starting = await starterOver([C], {
      chat: {
        launch: () =>
          new Promise<string>((resolve) => {
            release = () => {
              starting.holding.add('sess-1');
              resolve('sess-1');
            };
          }),
      },
    });

    const first = starting.starter.start(['C']);
    await settle();
    const second = await starting.starter.start(['C']);
    release();

    expect(second).toEqual([{ chunkId: 'C', refusal: 'C is starting' }]);
    expect(await first).toEqual([{ chunkId: 'C', sessionId: 'sess-1' }]);
    expect(starting.chat.launch).toHaveBeenCalledTimes(1);
  });

  it('startChunks_RowClosedBeforeStored_ChunkNotStarted', async () => {
    const starting = await starterOver([C], {
      chat: { launch: async () => 'sess-9' },
    });

    await starting.starter.start(['C']);

    expect(starting.setSession).not.toHaveBeenCalled();
    expect(await starting.saved()).toEqual([C]);
    expect(starting.logged).toEqual([
      'chunk C: session sess-9 closed before it was stored',
    ]);
  });

  it('startChunks_LaunchRejects_StartingCleared', async () => {
    const starting = await starterOver([C]);
    starting.chat.launch.mockRejectedValueOnce(new Error('spawn failed'));

    const failed = await starting.starter.start(['C']);
    const retried = await starting.starter.start(['C']);

    expect(failed).toEqual([{ chunkId: 'C', refusal: 'spawn failed' }]);
    expect(starting.logged).toEqual(['chunk C not started: spawn failed']);
    expect(retried).toEqual([{ chunkId: 'C', sessionId: 'sess-1' }]);
  });

  it('startChunks_PrunesThenRetiresOnce', async () => {
    const starting = await starterOver([chunk('C1', ['a']), chunk('C2', ['b'])]);

    await starting.starter.start(['C1', 'C2']);

    const [pruned] = starting.prune.mock.invocationCallOrder;
    const [retired] = starting.retireUnheld.mock.invocationCallOrder;
    const [launched] = starting.chat.launch.mock.invocationCallOrder;
    expect(pruned).toBeLessThan(retired);
    expect(retired).toBeLessThan(launched);
    expect(starting.retireUnheld).toHaveBeenCalledTimes(1);
  });
});
