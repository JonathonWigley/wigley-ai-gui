import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { IndexDocument } from '../contract';
import { parseIndexDocument } from '../index-document';
import { writeDocsFixture } from './selftest-fixture';

const HOME = '/home';
const LOAD_STATES = `${HOME}/.claude/load-states`;
const INDEX_FIXTURE = `${HOME}/.claude/plugins/cache/wigley-ai-marketplace/wigley/0.0.0/scripts/docs-index/index.fixture.json`;

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
