import { describe, expect, it, vi } from 'vitest';
import type { Git, GitCommit } from '../../../contracts/git';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { BacklogStaleness, RowKey } from '../contract';
import { rowKey } from '../row-key';
import type { BacklogRow } from './rows';
import {
  createStalenessReader,
  itemAnchor,
  namedPaths,
  STALENESS_LOG_LIMIT,
  stalenessOf,
} from './staleness';

const CLONE = '/c';
const HOME = `${CLONE}/docs/features`;
const FILE = `${HOME}/followups.md`;
const STALENESS_FILE = 'staleness.json';
const TITLE = 'Fix the cache';

function commit(sha: string, at: string): GitCommit {
  return { sha, subject: `${sha} subject`, at, paths: [] };
}

const WRITTEN = commit('w', '2026-10-01T10:00:00+00:00');
const NEWER = commit('n1', '2026-10-01T11:00:00+00:00');
const NEWEST = commit('n2', '2026-10-02T08:30:00+00:00');
// The written commit's instant, written in another offset.
const SAME_INSTANT = commit('s', '2026-10-01T12:00:00+02:00');
const OLDER = commit('o', '2026-09-30T10:00:00+00:00');

// An open row of repo `r` in HOME, its repo folder CLONE; `key` follows
// `repo` and `title`.
function row(fields: Partial<BacklogRow> = {}): BacklogRow {
  const merged = {
    repo: 'r',
    title: TITLE,
    oneLine: 'warm it first',
    tags: [],
    body: '',
    done: false,
    path: FILE,
    line: 1,
    homeRoot: HOME,
    repoFolder: CLONE,
    ...fields,
  };
  return { ...merged, key: rowKey(merged.repo, merged.title) };
}

function rowsTitled(count: number): BacklogRow[] {
  return Array.from({ length: count }, (_, index) =>
    row({ title: `Item ${index + 1}` }),
  );
}

// The `staleness.json` entry that holds for `cached` under HEAD `h1` in both
// clones.
function cacheEntry(cached: BacklogRow, facts: object) {
  return {
    heads: 'h1 h1',
    body: `${cached.oneLine}\n${cached.body}`,
    facts,
  };
}

// The reader over memory files at CLONE and memory plugin data, with git in
// one clone at HEAD `h1` whose `firstAdded` finds WRITTEN. `sent` holds each
// batch; `onSend` runs after each.
function startReader() {
  const files = createMemoryFiles();
  const data = createMemoryFiles();
  const git = {
    topLevel: vi.fn<Git['topLevel']>(async () => CLONE),
    resolveCommit: vi.fn<Git['resolveCommit']>(async () => 'h1'),
    log: vi.fn<Git['log']>(async () => []),
    firstAdded: vi.fn<Git['firstAdded']>(async () => WRITTEN),
  };
  const logged: string[] = [];
  const sent: Record<RowKey, BacklogStaleness>[] = [];
  const hooks = { onSend: (): void => undefined };
  const reader = createStalenessReader({
    git,
    files,
    data,
    paths: posixPaths,
    log: (message) => logged.push(message),
    send: (entries) => {
      sent.push(entries);
      hooks.onSend();
    },
  });
  return { reader, files, data, git, logged, sent, hooks };
}

// Lets a pass over immediate fakes run to its end.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function storedKeys(
  data: ReturnType<typeof createMemoryFiles>,
): Promise<string[]> {
  const stored = JSON.parse(await data.read(STALENESS_FILE)) as {
    entries: Record<string, unknown>;
  };
  return Object.keys(stored.entries);
}

describe('namedPaths', () => {
  it.each<[text: string, paths: string[]]>([
    [
      'See `src/main/plugin-catalog/user-folder-source.ts`.',
      ['src/main/plugin-catalog/user-folder-source.ts'],
    ],
    [
      'At `src/plugins/chat/page/activity-runs.ts:60` it',
      ['src/plugins/chat/page/activity-runs.ts'],
    ],
    ['`src/a.ts:12-20`', ['src/a.ts']],
    ['`src/a.ts:12:5`', ['src/a.ts']],
    ['`src/a.ts:fnName`', []],
    ['the folder `src/main/git/`', ['src/main/git']],
    ['`AGENTS.md`', ['AGENTS.md']],
    ['`start.test.ts`', ['start.test.ts']],
    ['`info.host`', ['info.host']],
    ['`agent-chat/claude-stream.md`', ['agent-chat/claude-stream.md']],
    ['`/clear`', []],
    ['`~/.claude`', []],
    ['`<userData>/plugin-code/<id>/<rev>/`', []],
    ['`[sessions] activated Layout preview`', []],
    ['`npm run selftest -- --plugin chat`', []],
    ['`CLAUDE_CONFIG_DIR`', []],
    ['`../other/file.ts`', []],
    ['```ts\nimport `src/fenced.ts`\n```\nthen `src/after.ts`', ['src/after.ts']],
    ['`src/a.ts` and again `./src/a.ts`, then `b/c.md`', ['src/a.ts', 'b/c.md']],
  ])('namedPaths_TokenTable_KeepsPathsOnly %j', (text, paths) => {
    expect(namedPaths(text)).toEqual(paths);
  });
});

describe('itemAnchor', () => {
  it.each<[line: string, title: string, anchor: string]>([
    ['## Fix the cache', 'Fix the cache', '## Fix the cache\n'],
    [
      '- **Fix the cache** — *agent-ready*: warm it',
      'Fix the cache',
      '**Fix the cache**',
    ],
    ['3. **Fix the cache:** warm it', 'Fix the cache', '**Fix the cache:**'],
    ['- Fix the cache. Warm it first.', 'Fix the cache', 'Fix the cache.'],
    ['- Fix the cache', 'Fix the cache', 'Fix the cache\n'],
    ['- **Fix the cache', 'Fix the cache warmup', 'Fix the cache warmup'],
  ])('itemAnchor_LineTable_HeadingFormOrTitle %j', (line, title, anchor) => {
    expect(itemAnchor(line, title)).toBe(anchor);
  });
});

describe('stalenessOf', () => {
  it.each<{
    name: string;
    gonePaths: string[];
    commitsSince: number;
    writtenAt: string | null;
    level: BacklogStaleness['level'];
  }>([
    {
      name: 'gone and commits',
      gonePaths: ['src/a.ts'],
      commitsSince: 3,
      writtenAt: WRITTEN.at,
      level: 'stale',
    },
    {
      name: 'gone and no writtenAt',
      gonePaths: ['src/a.ts'],
      commitsSince: 0,
      writtenAt: null,
      level: 'stale',
    },
    {
      name: 'commits only',
      gonePaths: [],
      commitsSince: 2,
      writtenAt: WRITTEN.at,
      level: 'moved',
    },
    {
      name: 'nothing and no writtenAt',
      gonePaths: [],
      commitsSince: 0,
      writtenAt: null,
      level: 'unknown',
    },
    {
      name: 'nothing with writtenAt',
      gonePaths: [],
      commitsSince: 0,
      writtenAt: WRITTEN.at,
      level: 'fresh',
    },
  ])(
    'stalenessOf_Facts_GoneThenMovedThenUnknownThenFresh ($name)',
    ({ gonePaths, commitsSince, writtenAt, level }) => {
      expect(stalenessOf({ gonePaths, commitsSince, writtenAt })).toBe(level);
    },
  );
});

describe('staleness reader', () => {
  it('read_FirstSegmentMissing_CandidateDropped', async () => {
    const stale = startReader();
    await stale.files.write(`${CLONE}/src/a.ts`, 'x');
    const named = row({
      body: 'Set `info.host`, see `agent-chat/x.md` and `src/a.ts`.',
    });

    await stale.reader.read([named]);
    await settle();

    expect(stale.sent[0][named.key]).toMatchObject({
      namedPaths: ['src/a.ts'],
      gonePaths: [],
    });
  });

  it.each<{
    name: string;
    fileText: string | null;
    added: Record<string, GitCommit>;
    texts: string[];
  }>([
    {
      name: 'the heading anchor dates the item, not a longer title',
      fileText: '# F\n\n## Fix the cache warmup\n\n## Fix the cache\n',
      added: { '## Fix the cache\n': WRITTEN, [TITLE]: OLDER },
      texts: ['## Fix the cache\n'],
    },
    {
      name: 'no commit added the anchor: the title next',
      fileText: '# F\n\n## Fix the cache warmup\n\n## Fix the cache\n',
      added: { [TITLE]: WRITTEN },
      texts: ['## Fix the cache\n', TITLE],
    },
    {
      name: 'the file unreadable: the title only',
      fileText: null,
      added: { [TITLE]: WRITTEN },
      texts: [TITLE],
    },
  ])(
    'read_AnchorFromFileLine_PassedToFirstAdded ($name)',
    async ({ fileText, added, texts }) => {
      const stale = startReader();
      if (fileText !== null) {
        await stale.files.write(FILE, fileText);
      }
      stale.git.firstAdded.mockImplementation(
        async (_root, _path, text) => added[text] ?? null,
      );
      const item = row({ line: 5 });

      await stale.reader.read([item]);
      await settle();

      expect(stale.git.firstAdded.mock.calls).toEqual(
        texts.map((text) => [CLONE, 'docs/features/followups.md', text]),
      );
      expect(stale.sent[0][item.key].writtenAt).toBe(WRITTEN.at);
    },
  );

  it('read_CommitsAroundWritten_CountsOnlyLater', async () => {
    const stale = startReader();
    await stale.files.write(`${CLONE}/src/a.ts`, 'x');
    stale.git.log.mockResolvedValue([
      NEWEST,
      NEWER,
      SAME_INSTANT,
      WRITTEN,
      OLDER,
    ]);
    const named = row({ body: 'In `src/a.ts`.' });

    await stale.reader.read([named]);
    await settle();

    expect(stale.sent[0][named.key]).toEqual({
      writtenAt: WRITTEN.at,
      commitsSince: 2,
      lastCommit: NEWEST,
      namedPaths: ['src/a.ts'],
      gonePaths: [],
      level: 'moved',
    });
  });

  it('read_RepoFolderBelowClone_PathsPrefixed', async () => {
    const stale = startReader();
    const repoFolder = `${CLONE}/wigley-ai-gui`;
    const homeRoot = `${repoFolder}/docs/features`;
    await stale.files.write(`${repoFolder}/src/a.ts`, 'x');
    const named = row({
      homeRoot,
      path: `${homeRoot}/followups.md`,
      repoFolder,
      body: 'In `src/a.ts`.',
    });

    await stale.reader.read([named]);
    await settle();

    expect(stale.git.firstAdded).toHaveBeenCalledWith(
      CLONE,
      'wigley-ai-gui/docs/features/followups.md',
      TITLE,
    );
    expect(stale.git.log).toHaveBeenCalledWith(
      CLONE,
      ['wigley-ai-gui/src/a.ts'],
      STALENESS_LOG_LIMIT,
    );
  });

  it('read_CacheValid_NoGitCall', async () => {
    const stale = startReader();
    await stale.files.write(`${CLONE}/src/a.ts`, 'x');
    const cached = row({ body: 'In `src/a.ts`.' });
    const facts = { writtenAt: WRITTEN.at, commitsSince: 1, lastCommit: NEWER };
    await stale.data.write(
      STALENESS_FILE,
      JSON.stringify({ entries: { [cached.key]: cacheEntry(cached, facts) } }),
    );

    const entries = await stale.reader.read([cached]);
    await settle();

    expect(entries).toEqual({
      [cached.key]: {
        ...facts,
        namedPaths: ['src/a.ts'],
        gonePaths: [],
        level: 'moved',
      },
    });
    expect(stale.git.firstAdded).not.toHaveBeenCalled();
    expect(stale.git.log).not.toHaveBeenCalled();
    expect(stale.sent).toEqual([]);
  });

  it.each<{ name: string; head: string; body: string }>([
    { name: 'HEAD moved', head: 'h2', body: '' },
    { name: 'the body edited', head: 'h1', body: 'Now `src/a.ts` too.' },
  ])('read_HeadOrBodyChanged_ReadsAgain ($name)', async ({ head, body }) => {
    const stale = startReader();
    const cached = row();
    await stale.data.write(
      STALENESS_FILE,
      JSON.stringify({
        entries: {
          [cached.key]: cacheEntry(cached, {
            writtenAt: OLDER.at,
            commitsSince: 0,
            lastCommit: null,
          }),
        },
      }),
    );
    stale.git.resolveCommit.mockResolvedValue(head);

    const entries = await stale.reader.read([row({ body })]);
    await settle();

    expect(entries).toEqual({});
    expect(stale.git.firstAdded).toHaveBeenCalledTimes(1);
    expect(stale.sent).toEqual([
      { [cached.key]: expect.objectContaining({ writtenAt: WRITTEN.at }) },
    ]);
  });

  it('read_CacheValidPathGone_RestatsAndStale', async () => {
    const stale = startReader();
    await stale.files.write(`${CLONE}/src/kept.ts`, 'x');
    const cached = row({ body: 'See `src/kept.ts` and `src/gone.ts`.' });
    await stale.data.write(
      STALENESS_FILE,
      JSON.stringify({
        entries: {
          [cached.key]: cacheEntry(cached, {
            writtenAt: WRITTEN.at,
            commitsSince: 0,
            lastCommit: null,
          }),
        },
      }),
    );

    const entries = await stale.reader.read([cached]);

    expect(entries[cached.key]).toMatchObject({
      namedPaths: ['src/kept.ts', 'src/gone.ts'],
      gonePaths: ['src/gone.ts'],
      level: 'stale',
    });
    expect(stale.git.firstAdded).not.toHaveBeenCalled();
    expect(stale.git.log).not.toHaveBeenCalled();
  });

  it('read_DoneRow_Skipped', async () => {
    const stale = startReader();

    const entries = await stale.reader.read([row({ done: true })]);
    await settle();

    expect(entries).toEqual({});
    expect(stale.git.firstAdded).not.toHaveBeenCalled();
    expect(stale.sent).toEqual([]);
  });

  it('read_GitRejects_LoggedAndLevelled', async () => {
    const stale = startReader();
    await stale.files.write(`${CLONE}/src/a.ts`, 'x');
    stale.git.firstAdded.mockRejectedValue(
      new Error('git log exited 128: index.lock exists'),
    );
    const named = row({ body: 'In `src/a.ts`.' });

    await stale.reader.read([named]);
    await settle();

    const failed: BacklogStaleness = {
      writtenAt: null,
      commitsSince: 0,
      lastCommit: null,
      namedPaths: ['src/a.ts'],
      gonePaths: [],
      level: 'unknown',
    };
    expect(stale.logged).toEqual([
      `staleness of ${TITLE}: git log exited 128: index.lock exists`,
    ]);
    expect(stale.sent).toEqual([{ [named.key]: failed }]);
    expect(stale.reader.entries()).toEqual({ [named.key]: failed });
  });

  it('read_GitRejectedThenGood_ReadsAgainUnderSameHeads', async () => {
    const stale = startReader();
    stale.git.firstAdded.mockRejectedValueOnce(new Error('index.lock'));
    const item = row();

    await stale.reader.read([item]);
    await settle();
    const afterFailure = await storedKeys(stale.data);
    const second = await stale.reader.read([item]);
    await settle();

    expect(afterFailure).toEqual([]);
    expect(second).toEqual({});
    expect(stale.git.firstAdded).toHaveBeenCalledTimes(2);
    expect(await storedKeys(stale.data)).toEqual([item.key]);
  });

  it.each<{
    name: string;
    homeClone: string | null;
    level: BacklogStaleness['level'];
  }>([
    { name: 'home outside git', homeClone: null, level: 'unknown' },
    { name: "the home's clone dates the item", homeClone: CLONE, level: 'fresh' },
  ])(
    'read_NoRepoFolder_EmptyListsUnknown ($name)',
    async ({ homeClone, level }) => {
      const stale = startReader();
      await stale.files.write(`${CLONE}/src/a.ts`, 'x');
      stale.git.topLevel.mockResolvedValue(homeClone);
      const outside = row({ repoFolder: null, body: 'In `src/a.ts`.' });

      await stale.reader.read([outside]);
      await settle();

      expect(stale.sent[0][outside.key]).toMatchObject({
        namedPaths: [],
        gonePaths: [],
        level,
      });
      expect(stale.git.log).not.toHaveBeenCalled();
    },
  );

  it('read_HomeOutsideGit_Unknown', async () => {
    const stale = startReader();
    const homeRoot = '/u/wigley-features/r';
    stale.git.topLevel.mockImplementation(async (folder) =>
      folder === CLONE ? CLONE : null,
    );
    const outside = row({ homeRoot, path: `${homeRoot}/followups.md` });

    await stale.reader.read([outside]);
    await settle();

    expect(stale.git.firstAdded).not.toHaveBeenCalled();
    expect(stale.sent[0][outside.key]).toMatchObject({
      writtenAt: null,
      level: 'unknown',
    });
  });

  it('read_DuringPass_QueuesOnceNewestRowWins', async () => {
    const stale = startReader();
    await stale.files.write(`${CLONE}/src/a.ts`, 'x');
    let releaseFirst = (): void => undefined;
    stale.git.firstAdded.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve(WRITTEN);
        }),
    );
    const alpha = row({ title: 'Alpha' });
    const beta = row({ title: 'Beta' });
    await stale.reader.read([alpha, beta]);
    await vi.waitFor(() => expect(stale.git.firstAdded).toHaveBeenCalled());

    await stale.reader.read([row({ title: 'Beta', body: 'In `src/a.ts`.' })]);
    releaseFirst();
    await settle();

    const texts = stale.git.firstAdded.mock.calls.map(([, , text]) => text);
    expect(texts).toEqual(['Alpha', 'Beta']);
    expect(stale.reader.entries()[beta.key].namedPaths).toEqual(['src/a.ts']);
  });

  it('read_CacheUnreadable_LoggedAndReadsAll', async () => {
    const stale = startReader();
    await stale.data.write(STALENESS_FILE, '{');

    const entries = await stale.reader.read(rowsTitled(2));
    await settle();

    expect(entries).toEqual({});
    expect(stale.logged).toEqual([
      'staleness.json unreadable; reading every row',
    ]);
    expect(stale.git.firstAdded).toHaveBeenCalledTimes(2);
  });

  it('read_TwelveRows_SendsTenThenTwo', async () => {
    const stale = startReader();

    await stale.reader.read(rowsTitled(12));
    await settle();

    expect(stale.sent.map((batch) => Object.keys(batch).length)).toEqual([
      10, 2,
    ]);
  });

  it.each<{
    name: string;
    written: GitCommit | null;
    repoFolder: string;
    body: string;
    commits: GitCommit[];
  }>([
    {
      name: 'kept commits, newest first',
      written: WRITTEN,
      repoFolder: CLONE,
      body: 'In `src/a.ts`.',
      commits: [NEWEST, NEWER],
    },
    {
      name: 'no written commit',
      written: null,
      repoFolder: CLONE,
      body: 'In `src/a.ts`.',
      commits: [],
    },
    {
      name: 'no repo clone',
      written: WRITTEN,
      repoFolder: '/elsewhere/r',
      body: 'In `src/a.ts`.',
      commits: [],
    },
    {
      name: 'no named paths',
      written: WRITTEN,
      repoFolder: CLONE,
      body: 'Nothing named.',
      commits: [],
    },
  ])(
    'commitsSince_Row_KeptNewestFirstAndEmptyCases ($name)',
    async ({ written, repoFolder, body, commits }) => {
      const stale = startReader();
      await stale.files.write(`${CLONE}/src/a.ts`, 'x');
      await stale.files.write('/elsewhere/r/src/a.ts', 'x');
      stale.git.topLevel.mockImplementation(async (folder) =>
        folder.startsWith(CLONE) ? CLONE : null,
      );
      stale.git.firstAdded.mockResolvedValue(written);
      stale.git.log.mockResolvedValue([NEWEST, NEWER, WRITTEN, OLDER]);

      expect(await stale.reader.commitsSince(row({ repoFolder, body }))).toEqual(
        commits,
      );
    },
  );

  it('entries_AfterRead_HoldsReadAndCached', async () => {
    const stale = startReader();
    const cached = row({ title: 'Cached' });
    const queued = row({ title: 'Queued' });
    await stale.data.write(
      STALENESS_FILE,
      JSON.stringify({
        entries: {
          [cached.key]: cacheEntry(cached, {
            writtenAt: WRITTEN.at,
            commitsSince: 0,
            lastCommit: null,
          }),
        },
      }),
    );

    await stale.reader.read([cached, queued]);
    await settle();

    expect(Object.keys(stale.reader.entries()).sort()).toEqual(
      [cached.key, queued.key].sort(),
    );
  });

  it('dispose_DuringPass_SendsAndWritesNothing', async () => {
    const stale = startReader();
    const write = vi.spyOn(stale.data, 'write');
    stale.hooks.onSend = () => stale.reader.dispose();

    await stale.reader.read(rowsTitled(12));
    await settle();

    expect(stale.sent).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(stale.git.firstAdded).toHaveBeenCalledTimes(10);
  });
});
