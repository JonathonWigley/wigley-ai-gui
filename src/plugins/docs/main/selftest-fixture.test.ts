import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { IndexDocument } from '../contract';
import { parseIndexDocument } from '../index-document';
import { writeDocsFixture } from './selftest-fixture';

const HOME = '/home';
const LOAD_STATES = `${HOME}/.claude/load-states`;
const INDEX_FIXTURE = `${HOME}/.claude/plugins/cache/wigley-ai-marketplace/wigley/0.0.0/scripts/docs-index/index.fixture.json`;
const SESSION_FIXTURE = `${HOME}/.claude/plugins/cache/wigley-ai-marketplace/wigley/0.0.0/scripts/docs-index/session.fixture.json`;
const SYNCED_SKILL = `${HOME}/.claude/skills/synced/selftest-bucket/synced-demo/SKILL.md`;
const VENDOR_SKILL = `${HOME}/.claude/plugins/cache/vendor-market/vendor-plugin/2.0.0/skills/vendored/SKILL.md`;

const LOAD_STATE_DOCS = [
  {
    path: `${LOAD_STATES}/on-demand.md`,
    title: 'Load state on-demand',
    claude: { state: 'on-demand', reason: 'loads when invoked' },
  },
  {
    path: `${LOAD_STATES}/listed.md`,
    title: 'Load state listed',
    claude: { state: 'listed', reason: 'listed by name only' },
  },
  {
    path: `${LOAD_STATES}/shadowed.md`,
    title: 'Load state shadowed',
    claude: { state: 'shadowed', reason: 'a nearer file wins' },
  },
  {
    path: `${LOAD_STATES}/not-loaded.md`,
    title: 'Load state not-loaded',
    claude: { state: 'not-loaded', reason: 'not read at launch' },
  },
];

async function homeFiles() {
  const files = createMemoryFiles();
  await files.makeFolder(HOME);
  return files;
}

async function readIndex(
  files: ReturnType<typeof createMemoryFiles>,
): Promise<IndexDocument> {
  return JSON.parse(await files.read(INDEX_FIXTURE)) as IndexDocument;
}

const STAND_IN_SCRIPT = `${HOME}/.claude/plugins/cache/wigley-ai-marketplace/wigley/0.0.0/scripts/docs-index/docs_index.py`;

describe('writeDocsFixture', () => {
  it('GIVEN indexDelayMs 1500 WHEN the stand-in script is read back THEN it sleeps 1.5 seconds before answering', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, {
      loadStates: false,
      indexDelayMs: 1500,
    });

    expect(await files.read(STAND_IN_SCRIPT)).toContain('DELAY_SECONDS = 1.5');
  });

  it('GIVEN no indexDelayMs WHEN the stand-in script is read back THEN it sleeps 0 seconds', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: false });

    expect(await files.read(STAND_IN_SCRIPT)).toContain('DELAY_SECONDS = 0\n');
  });

  it('GIVEN loadStates on WHEN the index fixture is read back THEN it holds each load-state doc and the home context its Claude state', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: true });

    const index = await readIndex(files);
    const home = index.contexts.find((context) => context.folder === HOME);
    for (const doc of LOAD_STATE_DOCS) {
      expect(index.entries).toContainEqual(
        expect.objectContaining({
          path: doc.path,
          title: doc.title,
          kind: 'instructions',
          source: 'global',
        }),
      );
      expect(home?.states[doc.path]).toEqual({ claude: doc.claude });
      expect(await files.read(doc.path)).toBe(`# ${doc.title}\n`);
    }
  });

  it('GIVEN loadStates on WHEN the index fixture is parsed THEN the app reads it', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: true });

    const parsed = parseIndexDocument(await files.read(INDEX_FIXTURE));
    expect(parsed.ok || parsed.message).toBe(true);
  });

  it('GIVEN the fixture WHEN the index fixture is read back THEN each context has empty loadedPlugins', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: true });

    for (const context of (await readIndex(files)).contexts) {
      expect(context.loadedPlugins).toEqual({});
    }
  });

  it('GIVEN the fixture WHEN the index fixture is read back THEN it holds a synced skill and a third-party plugin skill, both owner third-party', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: false });

    const entries = (await readIndex(files)).entries;
    expect(entries).toContainEqual(
      expect.objectContaining({
        path: SYNCED_SKILL,
        kind: 'skill',
        source: 'global',
        owner: 'third-party',
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        path: VENDOR_SKILL,
        kind: 'skill',
        source: 'plugin',
        owner: 'third-party',
        plugin: 'vendor-plugin@vendor-market',
      }),
    );
    expect(await files.stat(SYNCED_SKILL)).not.toBeNull();
    expect(await files.stat(VENDOR_SKILL)).not.toBeNull();
  });

  it("GIVEN the fixture WHEN the index fixture is read back THEN the fixture plugin's entries are owner mine", async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: false });

    const pluginEntries = (await readIndex(files)).entries.filter(
      (entry) => entry.plugin === 'selftest-plugin@selftest-market',
    );
    expect(pluginEntries).not.toEqual([]);
    for (const entry of pluginEntries) {
      expect(entry.owner).toBe('mine');
    }
  });

  it('GIVEN the fixture WHEN the session fixture is read back THEN it lists the same four entries', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: false });

    const session = JSON.parse(
      await files.read(SESSION_FIXTURE),
    ) as IndexDocument;
    expect(session.entries.map((entry) => entry.path)).toEqual([
      `${HOME}/.claude/CLAUDE.md`,
      `${HOME}/.claude/rules/style.md`,
      `${HOME}/dev/selftest-repo/AGENTS.md`,
      `${HOME}/dev/selftest-repo/.claude/skills/demo/SKILL.md`,
    ]);
  });

  it('GIVEN the fixture WHEN the stand-in script is read back THEN a new rule entry is owned mine', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: false });

    expect(await files.read(STAND_IN_SCRIPT)).toContain('"owner": "mine"');
  });

  it('GIVEN the fixture WHEN the stand-in script is read back THEN a new rule entry is never loaded', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: false });

    expect(await files.read(STAND_IN_SCRIPT)).toContain('"lastLoaded": None');
  });

  it('GIVEN the fixture WHEN the index fixture is read back THEN the style rule alone carries a last-loaded time', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: false });

    const entries = (await readIndex(files)).entries;
    const styleRule = `${HOME}/.claude/rules/style.md`;
    expect(entries.find((entry) => entry.path === styleRule)?.lastLoaded).toBe(
      '2026-10-18T12:00:00.000Z',
    );
    const lastLoadedOfOthers = entries
      .filter((entry) => entry.path !== styleRule)
      .map((entry) => entry.lastLoaded);
    expect(lastLoadedOfOthers).not.toEqual([]);
    expect(lastLoadedOfOthers.every((lastLoaded) => lastLoaded === null)).toBe(
      true,
    );
  });

  it('GIVEN loadStates on then off WHEN the files are listed THEN no load-state doc remains on disk or in the index', async () => {
    const files = await homeFiles();
    await writeDocsFixture(files, HOME, posixPaths, { loadStates: true });

    await writeDocsFixture(files, HOME, posixPaths, { loadStates: false });

    expect(await files.list(LOAD_STATES, { recursive: true })).toEqual([]);
    const indexedPaths = (await readIndex(files)).entries.map(
      (entry) => entry.path,
    );
    for (const doc of LOAD_STATE_DOCS) {
      expect(indexedPaths).not.toContain(doc.path);
    }
  });
});
