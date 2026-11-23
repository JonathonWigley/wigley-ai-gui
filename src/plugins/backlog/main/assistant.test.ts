import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { ScopedAgentRecord } from '../../scoped-agents/contract';
import type { BacklogStaleness } from '../contract';
import { rowKey } from '../row-key';
import {
  assistantInstructions,
  createAssistantStore,
  sweepMessage,
} from './assistant';
import type { BacklogRow } from './rows';

const FILE = 'assistant.json';
const UNREADABLE = 'assistant.json unreadable; the assistant starts fresh';
const GLOBAL: ScopedAgentRecord = { sessionId: 'row-1', hostSessionId: 'h-1' };
const OTHER: ScopedAgentRecord = { sessionId: 'row-2', hostSessionId: 'h-2' };

// A store over memory plugin data holding `text` in assistant.json (no file
// when null); `logged` holds each log line.
async function storeOver(text: string | null) {
  const data = createMemoryFiles();
  if (text !== null) {
    await data.write(FILE, text);
  }
  const logged: string[] = [];
  const store = createAssistantStore(data, (line) => logged.push(line));
  return { data, store, logged };
}

function row(
  repo: string,
  title: string,
  fields: Partial<BacklogRow> = {},
): BacklogRow {
  return {
    key: rowKey(repo, title),
    repo,
    title,
    oneLine: `${title} gist`,
    tags: [],
    body: '',
    done: false,
    path: `/dev/${repo}/docs/features/followups.md`,
    line: 1,
    homeRoot: `/dev/${repo}/docs/features`,
    repoFolder: `/dev/${repo}`,
    ...fields,
  };
}

function staleness(
  level: BacklogStaleness['level'],
  commitsSince: number,
  gonePaths: string[],
): BacklogStaleness {
  return {
    writtenAt: '2026-10-01T10:00:00+00:00',
    commitsSince,
    lastCommit: null,
    namedPaths: gonePaths,
    gonePaths,
    level,
  };
}

const SWEEP_TAIL =
  "Fix the file: remove each item whose work has landed, rewrite each item the code has moved past, and keep the rest. Check every item against the code, not only the ones listed. Land the change per r's own rules. Then report each change: the item's title, whether you removed, rewrote or kept it, and why.";

describe('assistant store', () => {
  it('store_WriteReadEntries_RoundTrips', async () => {
    const { store } = await storeOver(null);

    await store.write('global', GLOBAL);

    expect(await store.read('global')).toEqual(GLOBAL);
    expect(await store.read('other')).toBeNull();
    expect(await store.entries()).toEqual([
      { scope: 'global', record: GLOBAL },
    ]);

    await store.write('global', null);

    expect(await store.read('global')).toBeNull();
    expect(await store.entries()).toEqual([]);
  });

  it.each([
    { name: 'not JSON', text: '{' },
    {
      name: 'a record of the wrong shape',
      text: '{ "global": { "sessionId": 1, "hostSessionId": "h" } }',
    },
  ])('store_FileUnreadable_LoggedAndEmpty ($name)', async ({ text }) => {
    const { store, logged } = await storeOver(text);

    const read = await store.read('global');
    const entries = await store.entries();

    expect(read).toBeNull();
    expect(entries).toEqual([]);
    expect(logged).toEqual([UNREADABLE, UNREADABLE]);
  });

  it('store_SupersededAndCheckAsk_NullAndResolves', async () => {
    const { store } = await storeOver(JSON.stringify({ global: GLOBAL }));

    expect(await store.superseded('global')).toBeNull();
    await expect(store.checkAsk('global')).resolves.toBeUndefined();
  });

  it('store_WritesOverlapping_RunInOrder', async () => {
    const { store, data } = await storeOver(null);

    const first = store.write('global', GLOBAL);
    const second = store.write('other', OTHER);
    await Promise.all([first, second]);

    expect(JSON.parse(await data.read(FILE))).toEqual({
      global: GLOBAL,
      other: OTHER,
    });
  });
});

describe('assistantInstructions', () => {
  it('assistantInstructions_NoExtra_NamesTheFormatSkill', () => {
    const text = assistantInstructions(null);

    expect(text).toContain('auri:backlog-format');
    expect(text).not.toContain('triage.md');
  });

  it('assistantInstructions_Extra_AppendedAfterABlankLine', () => {
    expect(assistantInstructions('Tag each item.')).toBe(
      `${assistantInstructions(null)}\n\nTag each item.`,
    );
  });
});

describe('sweepMessage', () => {
  it('sweepMessage_StaleAndMovedRows_ListedInRowOrder', () => {
    const rows = [
      row('r', 'Fresh one'),
      row('r', 'Moved one'),
      row('r', 'Done stale', { done: true }),
      row('r', 'Stale one'),
    ];
    const entries = {
      [rowKey('r', 'Fresh one')]: staleness('fresh', 0, []),
      [rowKey('r', 'Moved one')]: staleness('moved', 3, []),
      [rowKey('r', 'Done stale')]: staleness('stale', 1, ['src/old.ts']),
      [rowKey('r', 'Stale one')]: staleness('stale', 2, ['src/a.ts', 'b.md']),
    };

    const text = sweepMessage(
      'r',
      ['/dev/r/docs/features/followups.md', '/dev/r/docs/features/ui.md'],
      rows,
      entries,
    );

    expect(text).toBe(
      [
        "Sweep r's follow-ups for staleness.",
        '',
        'Files:',
        '- /dev/r/docs/features/followups.md',
        '- /dev/r/docs/features/ui.md',
        '',
        'Items Backlog reads as stale or moved:',
        '- Moved one: moved; 3 commits since it was written; gone: none',
        '- Stale one: stale; 2 commits since it was written; gone: src/a.ts, b.md',
        '',
        SWEEP_TAIL,
      ].join('\n'),
    );
  });

  it('sweepMessage_NoStaleRows_NoneLine', () => {
    const rows = [row('r', 'Fresh one'), row('r', 'Unread one')];
    const entries = { [rowKey('r', 'Fresh one')]: staleness('fresh', 0, []) };

    const text = sweepMessage(
      'r',
      ['/dev/r/docs/features/followups.md'],
      rows,
      entries,
    );

    expect(text).toContain(
      'Items Backlog reads as stale or moved:\nNone: check every item against the code anyway.\n\nFix the file:',
    );
  });
});
