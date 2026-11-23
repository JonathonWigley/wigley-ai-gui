import { describe, expect, it, vi } from 'vitest';
import type { Git } from '../../../contracts/git';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { IndexEntry } from '../contract';
import { readPluginStatus } from './plugin-status';

const ROOT = '/Users/u/dev/m';
const PLUGIN = `${ROOT}/plugins/w`;
const CLAUDE_CACHE = '/Users/u/.claude/plugins/cache/m/w/1.0.0';
const CODEX_CACHE = '/Users/u/.codex/plugins/cache/m/w/0.1.0';
const HOOKS_JSON = `${PLUGIN}/hooks/hooks.json`;
const HOOKS_TEXT = '{"hooks":{}}\n';
// `git hash-object` of `a\n` and of HOOKS_TEXT.
const A_BLOB = '78981922613b2afb6025042ff6bd878ac1994e85';
const HOOKS_BLOB = 'bd0b5424fe275aa7a198b425a5621b5807b6da3a';

function entry(fields: Partial<IndexEntry> & { id: string }): IndexEntry {
  return {
    kind: 'skill',
    source: 'repo',
    owner: 'mine',
    repo: 'm',
    root: ROOT,
    plugin: 'w@m',
    path: fields.id,
    line: null,
    title: fields.id,
    meta: {},
    walked: [],
    headings: [],
    links: [],
    lastLoaded: null,
    ...fields,
  };
}

function installed(claudePath: string, codexPath: string) {
  return {
    installed: [
      { harness: 'claude', version: '1.0.0', path: claudePath },
      { harness: 'codex', version: '0.1.0', path: codexPath },
    ],
  };
}

const A = entry({
  id: `${PLUGIN}/skills/a/SKILL.md`,
  meta: installed(
    `${CLAUDE_CACHE}/skills/a/SKILL.md`,
    `${CODEX_CACHE}/skills/a/SKILL.md`,
  ),
});
const B = entry({ id: `${PLUGIN}/skills/b/SKILL.md`, meta: { installed: [] } });
const H0 = entry({
  id: `${HOOKS_JSON}#hook:PreToolUse:0`,
  kind: 'hook',
  path: HOOKS_JSON,
  meta: installed(
    `${CLAUDE_CACHE}/hooks/hooks.json`,
    `${CODEX_CACHE}/hooks/hooks.json`,
  ),
});
const H1 = { ...H0, id: `${HOOKS_JSON}#hook:PreToolUse:1` };
const CLAUDE_PLUGIN = entry({
  id: `${CLAUDE_CACHE}/.claude-plugin/plugin.json`,
  kind: 'plugin',
  source: 'plugin',
  repo: null,
  root: CLAUDE_CACHE,
  meta: { harness: 'claude' },
});
const CODEX_PLUGIN = entry({
  id: `${CODEX_CACHE}/.codex-plugin/plugin.json`,
  kind: 'plugin',
  source: 'plugin',
  repo: null,
  root: CODEX_CACHE,
  meta: { harness: 'codex' },
});
const AGENTS = entry({
  id: `${ROOT}/AGENTS.md`,
  kind: 'instructions',
  plugin: null,
});

const EVERY_ENTRY = [A, B, H0, H1, CLAUDE_PLUGIN, CODEX_PLUGIN, AGENTS];

const SCOPE = 'plugins/w';

const CLEAN_BLOBS: [string, string][] = [
  ['plugins/w/skills/a/SKILL.md', A_BLOB],
  ['plugins/w/hooks/hooks.json', HOOKS_BLOB],
];

// A clone with an upstream, nothing changed or unpushed, the upstream holding
// CLEAN_BLOBS, never fetched; every method a mock a test can rescript.
function cleanGit() {
  return {
    topLevel: vi.fn<Git['topLevel']>(async () => ROOT),
    originRepoName: vi.fn<Git['originRepoName']>(async () => null),
    currentBranch: vi.fn<Git['currentBranch']>(async () => 'main'),
    isLinkedWorktree: vi.fn<Git['isLinkedWorktree']>(async () => false),
    worktrees: vi.fn<Git['worktrees']>(async () => [
      { path: ROOT, branch: 'main', isMain: true },
    ]),
    commonDir: vi.fn<Git['commonDir']>(async () => `${ROOT}/.git`),
    hasUpstream: vi.fn<Git['hasUpstream']>(async () => true),
    changedPaths: vi.fn<Git['changedPaths']>(async () => []),
    unpushedPaths: vi.fn<Git['unpushedPaths']>(async () => []),
    upstreamBlobs: vi.fn<Git['upstreamBlobs']>(
      async () => new Map(CLEAN_BLOBS),
    ),
    fetch: vi.fn<Git['fetch']>(async () => false),
    lastFetch: vi.fn<Git['lastFetch']>(async () => null),
    resolveCommit: vi.fn<Git['resolveCommit']>(async () => null),
    isAncestor: vi.fn<Git['isAncestor']>(async () => false),
    fileAtHead: vi.fn<Git['fileAtHead']>(async () => null),
    log: vi.fn<Git['log']>(async () => []),
    firstAdded: vi.fn<Git['firstAdded']>(async () => null),
    branches: vi.fn<Git['branches']>(async () => []),
    commitsMatching: vi.fn<Git['commitsMatching']>(async () => []),
  } satisfies Git;
}

// A clean clone at ROOT: every copy matches the upstream blob.
async function setUp() {
  const files = createMemoryFiles();
  await files.write(`${CLAUDE_CACHE}/skills/a/SKILL.md`, 'a\n');
  await files.write(`${CODEX_CACHE}/skills/a/SKILL.md`, 'a\n');
  await files.write(`${CLAUDE_CACHE}/hooks/hooks.json`, HOOKS_TEXT);
  await files.write(`${CODEX_CACHE}/hooks/hooks.json`, HOOKS_TEXT);
  const git = cleanGit();
  const logged: string[] = [];
  const deps = {
    git,
    files,
    paths: posixPaths,
    log: (message: string) => logged.push(message),
  };
  const read = (
    entries: readonly IndexEntry[],
    fetch = false,
    harnesses: readonly string[] = ['claude', 'codex'],
  ) => readPluginStatus(entries, deps, { fetch, harnesses });
  return { files, git, logged, read };
}

async function filesOf(
  read: Awaited<ReturnType<typeof setUp>>['read'],
  entries: readonly IndexEntry[] = EVERY_ENTRY,
) {
  const status = await read(entries);
  return status.clones[0].files;
}

describe('readPluginStatus', () => {
  it('readPluginStatus_NoCloneEntries_NoClones', async () => {
    const test = await setUp();

    expect(await test.read([AGENTS])).toEqual({ clones: [] });
    expect(test.git.hasUpstream).not.toHaveBeenCalled();
    expect(test.git.lastFetch).not.toHaveBeenCalled();
  });

  it('readPluginStatus_CleanClone_NoFiles', async () => {
    const test = await setUp();

    const status = await test.read([A, H0, H1, CLAUDE_PLUGIN, CODEX_PLUGIN]);

    expect(status).toEqual({
      clones: [{ root: ROOT, fetchedAt: null, fetchFailed: false, files: {} }],
    });
  });

  it('readPluginStatus_Fetch_FirstRunCapped', async () => {
    const test = await setUp();

    await test.read(EVERY_ENTRY, true);

    expect(test.git.fetch).toHaveBeenCalledWith(ROOT, 15000);
    expect(test.git.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      test.git.hasUpstream.mock.invocationCallOrder[0],
    );
  });

  it('readPluginStatus_NoFetch_NoFetchRun', async () => {
    const test = await setUp();

    await test.read(EVERY_ENTRY, false);

    expect(test.git.fetch).not.toHaveBeenCalled();
  });

  it('readPluginStatus_FetchFails_FetchFailedStatusesKept', async () => {
    const test = await setUp();
    test.git.fetch.mockResolvedValue(true);
    test.git.changedPaths.mockResolvedValue(['plugins/w/skills/a/SKILL.md']);

    const status = await test.read(EVERY_ENTRY, true);

    expect(status.clones[0].fetchFailed).toBe(true);
    expect(status.clones[0].files[A.id].uncommitted).toBe(true);
  });

  it('readPluginStatus_TwoReadsFetchAtOnce_OneFetch', async () => {
    const test = await setUp();
    let finishFetch!: (failed: boolean) => void;
    test.git.fetch.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishFetch = resolve;
      }),
    );

    const first = test.read(EVERY_ENTRY, true);
    const second = test.read(EVERY_ENTRY, true);
    finishFetch(true);
    const reads = await Promise.all([first, second]);

    expect(test.git.fetch).toHaveBeenCalledTimes(1);
    expect(reads.map((read) => read.clones[0].fetchFailed)).toEqual([
      true,
      true,
    ]);
  });

  it('readPluginStatus_ChangedPaths_Uncommitted', async () => {
    const test = await setUp();
    test.git.changedPaths.mockResolvedValue([
      'plugins/w/skills/a/SKILL.md',
      'plugins/w/skills/b/SKILL.md',
    ]);

    const files = await filesOf(test.read);

    expect(test.git.changedPaths).toHaveBeenCalledWith(ROOT, SCOPE);
    expect(files[A.id].uncommitted).toBe(true);
    expect(files[B.id].uncommitted).toBe(true);
  });

  it('readPluginStatus_HooksJsonChanged_EveryHookUncommitted', async () => {
    const test = await setUp();
    test.git.changedPaths.mockResolvedValue(['plugins/w/hooks/hooks.json']);

    const files = await filesOf(test.read);

    expect(files[H0.id].uncommitted).toBe(true);
    expect(files[H1.id].uncommitted).toBe(true);
  });

  it('readPluginStatus_HooksJsonUnpushed_EveryHookUnpushed', async () => {
    const test = await setUp();
    test.git.unpushedPaths.mockResolvedValue(['plugins/w/hooks/hooks.json']);

    const files = await filesOf(test.read);

    const unpushedOnly = {
      uncommitted: false,
      unpushed: true,
      notInstalled: [],
    };
    expect(test.git.unpushedPaths).toHaveBeenCalledWith(ROOT, SCOPE);
    expect(files[H0.id]).toEqual(unpushedOnly);
    expect(files[H1.id]).toEqual(unpushedOnly);
  });

  it('readPluginStatus_CrlfCopy_Installed', async () => {
    const test = await setUp();
    await test.files.write(`${CLAUDE_CACHE}/skills/a/SKILL.md`, 'a\r\n');

    const files = await filesOf(test.read);

    expect(files[A.id]).toBeUndefined();
  });

  it('readPluginStatus_CodexCopyDiffers_NotInstalledCodex', async () => {
    const test = await setUp();
    await test.files.write(`${CODEX_CACHE}/skills/a/SKILL.md`, 'old\n');

    const files = await filesOf(test.read);

    expect(files[A.id].notInstalled).toEqual(['codex']);
  });

  it('readPluginStatus_UnregisteredHarness_NotChecked', async () => {
    const test = await setUp();
    await test.files.write(`${CODEX_CACHE}/skills/a/SKILL.md`, 'old\n');

    const status = await test.read(EVERY_ENTRY, false, ['claude']);

    expect(status.clones[0].files[A.id]).toBeUndefined();
  });

  it('readPluginStatus_NoCopies_NotInstalledEveryHarness', async () => {
    const test = await setUp();
    test.git.upstreamBlobs.mockResolvedValue(
      new Map([...CLEAN_BLOBS, ['plugins/w/skills/b/SKILL.md', A_BLOB]]),
    );

    const files = await filesOf(test.read);

    expect(test.git.upstreamBlobs).toHaveBeenCalledWith(ROOT, SCOPE);
    expect(files[B.id].notInstalled).toEqual(['claude', 'codex']);
  });

  it('readPluginStatus_AbsentUpstream_NotInstalled', async () => {
    const test = await setUp();
    test.git.upstreamBlobs.mockResolvedValue(
      new Map([['plugins/w/hooks/hooks.json', HOOKS_BLOB]]),
    );

    const files = await filesOf(test.read);

    expect(files[A.id].notInstalled).toEqual(['claude', 'codex']);
  });

  it('readPluginStatus_OnlyClaudePlugin_CodexNotChecked', async () => {
    const test = await setUp();
    test.git.upstreamBlobs.mockResolvedValue(
      new Map([...CLEAN_BLOBS, ['plugins/w/skills/b/SKILL.md', A_BLOB]]),
    );

    const files = await filesOf(
      test.read,
      EVERY_ENTRY.filter((item) => item !== CODEX_PLUGIN),
    );

    expect(files[B.id].notInstalled).toEqual(['claude']);
  });

  it('readPluginStatus_NoUpstream_OnlyUncommitted', async () => {
    const test = await setUp();
    test.git.hasUpstream.mockResolvedValue(false);
    test.git.changedPaths.mockResolvedValue(['plugins/w/skills/a/SKILL.md']);

    const files = await filesOf(test.read);

    expect(files).toEqual({
      [A.id]: { uncommitted: true, unpushed: false, notInstalled: [] },
    });
    expect(test.git.unpushedPaths).not.toHaveBeenCalled();
    expect(test.git.upstreamBlobs).not.toHaveBeenCalled();
  });

  it('readPluginStatus_LastFetch_FetchedAt', async () => {
    const test = await setUp();
    test.git.lastFetch.mockResolvedValue('2026-10-24T09:30:00.000Z');

    const status = await test.read(EVERY_ENTRY);

    expect(test.git.lastFetch).toHaveBeenCalledWith(ROOT);
    expect(status.clones[0].fetchedAt).toBe('2026-10-24T09:30:00.000Z');
  });

  it('readPluginStatus_GitCannotStart_CloneKept', async () => {
    const test = await setUp();
    const cannotStart = new Error('Could not run git: spawn git ENOENT');
    test.git.fetch.mockResolvedValue(true);
    test.git.hasUpstream.mockRejectedValue(cannotStart);
    test.git.changedPaths.mockRejectedValue(cannotStart);

    const status = await test.read(EVERY_ENTRY, true);

    expect(status).toEqual({
      clones: [{ root: ROOT, fetchedAt: null, fetchFailed: true, files: {} }],
    });
  });

  it('readPluginStatus_UnpushedFails_KeepsUncommitted', async () => {
    const test = await setUp();
    test.git.changedPaths.mockResolvedValue(['plugins/w/skills/a/SKILL.md']);
    test.git.unpushedPaths.mockRejectedValue(
      new Error('git diff exited 128: bad revision'),
    );

    const status = await test.read(EVERY_ENTRY);

    expect(status.clones[0].fetchFailed).toBe(false);
    expect(status.clones[0].files[A.id].uncommitted).toBe(true);
    expect(test.git.upstreamBlobs).not.toHaveBeenCalled();
    expect(test.logged).toEqual([expect.stringContaining('/Users/u/dev/m')]);
  });

  it('readPluginStatus_TwoClones_OrderOfFirstEntry', async () => {
    const test = await setUp();
    const other = entry({
      id: '/Users/u/dev/n/plugins/x/skills/c/SKILL.md',
      root: '/Users/u/dev/n',
      meta: { installed: [] },
    });

    const status = await test.read([A, other, B]);

    expect(status.clones.map((clone) => clone.root)).toEqual([
      ROOT,
      '/Users/u/dev/n',
    ]);
  });

  it('readPluginStatus_ScopeIsRoot_PathspecDot', async () => {
    const test = await setUp();
    const atRoot = entry({ id: `${ROOT}/a.md`, meta: { installed: [] } });
    const below = entry({ id: `${ROOT}/x/b.md`, meta: { installed: [] } });

    await test.read([atRoot, below]);

    expect(test.git.changedPaths).toHaveBeenCalledWith(ROOT, '.');
  });
});
