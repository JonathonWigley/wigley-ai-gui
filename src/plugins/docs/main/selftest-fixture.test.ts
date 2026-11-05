import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { IndexDocument } from '../contract';
import { parseIndexDocument } from '../index-document';
import { buildWikiTree, type TreeNode } from '../tree';
import { parseWikiMain } from '../wiki-main';
import { WIKI_MAIN_TEXT, writeDocsFixture } from './selftest-fixture';

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

// The rows of `nodes` top to bottom, a group before its children.
function wikiRows(nodes: readonly TreeNode[]): unknown[] {
  return nodes.flatMap((node) => {
    switch (node.type) {
      case 'group':
        return [{ group: node.title }, ...wikiRows(node.children)];
      case 'wikiLink':
        return [
          {
            link: node.title,
            count: node.count,
            isDangling: node.isDangling,
          },
        ];
      case 'wikiLabel':
        return [{ label: node.title }];
      default:
        return [{ leaf: node.title }];
    }
  });
}

describe('writeDocsFixture', () => {
  it.each([
    { indexDelayMs: 1500, line: 'DELAY_SECONDS = 1.5\n' },
    { indexDelayMs: undefined, line: 'DELAY_SECONDS = 0\n' },
  ])(
    'the stand-in script for indexDelayMs $indexDelayMs holds $line',
    async ({ indexDelayMs, line }) => {
      const files = await homeFiles();

      await writeDocsFixture(files, HOME, posixPaths, {
        loadStates: false,
        indexDelayMs,
      });

      expect(await files.read(STAND_IN_SCRIPT)).toContain(line);
    },
  );

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

  it('GIVEN the fixture WHEN its Main.md builds the wiki tree THEN only Gone page dangles and each list row counts its docs', async () => {
    const files = await homeFiles();

    await writeDocsFixture(files, HOME, posixPaths);

    const tree = buildWikiTree(
      parseWikiMain(WIKI_MAIN_TEXT),
      (await readIndex(files)).entries,
      `${HOME}/wigley-agents/wiki`,
      HOME,
      posixPaths,
    );
    expect(wikiRows(tree)).toEqual([
      { group: 'Shelf one' },
      { label: 'Label one' },
      { leaf: 'Guide page' },
      { leaf: 'Commit page' },
      { link: 'Gone page', count: null, isDangling: true },
      { link: 'Fixture guides', count: 2, isDangling: false },
      { group: 'Shelf two' },
      { link: 'Every page', count: null, isDangling: false },
      { link: 'Vendor docs', count: 2, isDangling: false },
    ]);
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
