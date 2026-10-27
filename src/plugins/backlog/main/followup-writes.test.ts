import { describe, expect, it } from 'vitest';
import {
  type FollowupDraft,
  newFollowupsFile,
  parseFollowups,
} from '../../../shared/followups/followup-file';
import type { WriteResult } from '../../docs/contract';
import { type FollowupWriteDeps, writeFollowupEdit } from './followup-writes';

const PATH = '/home/features/followups.md';

const FILE = [
  '# Follow-ups — r',
  '',
  '**Contents**',
  '',
  '- **Alpha** — first thing',
  '- **Beta** — second thing',
  '',
  '## Alpha',
  '',
  'Alpha body.',
  '',
  '## Beta',
  '',
  'Beta body.',
  '',
].join('\n');

function missingFile(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
}

// `readDoc` returns `disk` (missing while undefined); each `writeDoc` checks
// `expectedText` against `disk` unless `beforeWrite` changes it first, then
// writes. `writes` holds each write's text and expected text.
function fakeDocs(disk: string | undefined) {
  const state = {
    disk,
    beforeWrite: [] as (() => void)[],
    refusal: null as string | null,
    writes: [] as { text: string; expectedText: string | null }[],
  };
  const deps: FollowupWriteDeps = {
    readDoc: async (path) => {
      if (state.disk === undefined) {
        throw missingFile(path);
      }
      return state.disk;
    },
    writeDoc: async (_path, text, expectedText): Promise<WriteResult> => {
      state.beforeWrite.shift()?.();
      if (state.refusal !== null) {
        throw new Error(state.refusal);
      }
      state.writes.push({ text, expectedText });
      const diskText = state.disk ?? '';
      if (expectedText !== null && diskText !== expectedText) {
        return { type: 'changedOnDisk', diskText };
      }
      state.disk = text;
      return { type: 'written' };
    },
  };
  return { state, deps };
}

const DRAFT: FollowupDraft = {
  title: 'Gamma',
  oneLine: 'third thing',
  tags: ['agent-ready'],
  body: 'Gamma body.',
};

function titles(text: string | undefined): string[] {
  return parseFollowups(text ?? '').items.map((item) => item.title);
}

describe('writeFollowupEdit', () => {
  it('writeFollowupEdit_Create_AppliedAndWritten', async () => {
    const docs = fakeDocs(FILE);

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'create', draft: DRAFT },
      null,
    );

    expect(result.type).toBe('applied');
    expect(titles(docs.state.disk)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(docs.state.writes[0].expectedText).toBe(FILE);
  });

  it('writeFollowupEdit_DiskChangedOnce_EditLandsOnNewDiskText', async () => {
    const docs = fakeDocs(FILE);
    docs.state.beforeWrite.push(() => {
      docs.state.disk = FILE.replace(
        'Beta body.',
        'Beta body, edited by an agent.',
      );
    });

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'setTags', title: 'Alpha', tags: ['agent-ready'] },
      null,
    );

    expect(result.type).toBe('applied');
    const items = parseFollowups(docs.state.disk ?? '').items;
    expect(items[0].tags).toEqual(['agent-ready']);
    expect(items[1].body).toContain('edited by an agent');
  });

  it('writeFollowupEdit_DiskChangedTwice_Refused', async () => {
    const docs = fakeDocs(FILE);
    docs.state.beforeWrite.push(
      () => {
        docs.state.disk = `${FILE}\n`;
      },
      () => {
        docs.state.disk = `${FILE}\n\n`;
      },
    );

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'delete', title: 'Beta' },
      null,
    );

    expect(result).toEqual({
      type: 'refused',
      reason: `${PATH} keeps changing on disk; try again`,
    });
  });

  it('writeFollowupEdit_GuardRejects_RefusedWithItsText', async () => {
    const docs = fakeDocs(FILE);
    docs.state.refusal = 'Refused: outside every docs root';

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'delete', title: 'Beta' },
      null,
    );

    expect(result).toEqual({
      type: 'refused',
      reason: 'Refused: outside every docs root',
    });
  });

  it('writeFollowupEdit_MissingFileWithRepo_NewFileExpectsEmptyDisk', async () => {
    const docs = fakeDocs(undefined);

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'create', draft: DRAFT },
      'r',
    );

    expect(result.type).toBe('applied');
    expect(docs.state.writes[0].expectedText).toBe('');
    expect(
      docs.state.disk?.startsWith(newFollowupsFile('r').split('\n')[0]),
    ).toBe(true);
    expect(titles(docs.state.disk)).toEqual(['Gamma']);
  });

  it.each([
    { type: 'edit' as const, title: 'Alpha', draft: DRAFT },
    { type: 'setTags' as const, title: 'Alpha', tags: [] },
    { type: 'delete' as const, title: 'Alpha' },
  ])('writeFollowupEdit_MissingFileNoRepo_$type_Missing', async (edit) => {
    const docs = fakeDocs(undefined);

    const result = await writeFollowupEdit(docs.deps, PATH, edit, null);

    expect(result).toEqual({ type: 'missing', title: 'Alpha' });
    expect(docs.state.writes).toEqual([]);
  });

  it('writeFollowupEdit_TitleTaken_PassesThrough', async () => {
    const docs = fakeDocs(FILE);

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'create', draft: { ...DRAFT, title: 'Beta' } },
      null,
    );

    expect(result).toEqual({ type: 'titleTaken', title: 'Beta' });
    expect(docs.state.writes).toEqual([]);
  });
});
