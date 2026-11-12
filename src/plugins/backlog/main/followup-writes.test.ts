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

// Alpha as FILE holds it.
const ALPHA: FollowupDraft = {
  title: 'Alpha',
  oneLine: 'first thing',
  tags: [],
  body: 'Alpha body.',
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
      {
        type: 'edit',
        title: 'Alpha',
        draft: { ...ALPHA, tags: ['agent-ready'] },
        baseline: ALPHA,
      },
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
      { type: 'create', draft: DRAFT },
      null,
    );

    expect(result).toEqual({
      type: 'refused',
      reason: expect.stringContaining(PATH),
    });
  });

  it('writeFollowupEdit_GuardRejects_RefusedWithItsText', async () => {
    const docs = fakeDocs(FILE);
    docs.state.refusal = 'Refused: outside every docs root';

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'create', draft: DRAFT },
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

  it('writeFollowupEdit_MissingFileNoRepo_EditMissing', async () => {
    const docs = fakeDocs(undefined);

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'edit', title: 'Alpha', draft: DRAFT, baseline: DRAFT },
      null,
    );

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

  it('writeFollowupEdit_EditMatchesBaseline_Applied', async () => {
    const docs = fakeDocs(FILE);

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      {
        type: 'edit',
        title: 'Alpha',
        draft: { ...ALPHA, body: 'New body.' },
        baseline: ALPHA,
      },
      null,
    );

    expect(result.type).toBe('applied');
    expect(parseFollowups(docs.state.disk ?? '').items[0].body).toBe(
      'New body.',
    );
  });

  it('writeFollowupEdit_ItemChangedSinceBaseline_ChangedAndNotWritten', async () => {
    const docs = fakeDocs(
      FILE.replace('Alpha body.', 'Alpha body, by an agent.'),
    );

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      {
        type: 'edit',
        title: 'Alpha',
        draft: { ...ALPHA, body: 'New body.' },
        baseline: ALPHA,
      },
      null,
    );

    expect(result).toEqual({
      type: 'changed',
      title: 'Alpha',
      item: { ...ALPHA, body: 'Alpha body, by an agent.' },
    });
    expect(docs.state.writes).toEqual([]);
  });

  it('writeFollowupEdit_SavedAgainOverTheChangedItem_Applied', async () => {
    const docs = fakeDocs(
      FILE.replace('Alpha body.', 'Alpha body, by an agent.'),
    );
    const draft = { ...ALPHA, body: 'New body.' };
    const first = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'edit', title: 'Alpha', draft, baseline: ALPHA },
      null,
    );
    if (first.type !== 'changed') {
      throw new Error(`expected changed, got ${first.type}`);
    }

    const second = await writeFollowupEdit(
      docs.deps,
      PATH,
      { type: 'edit', title: 'Alpha', draft, baseline: first.item },
      null,
    );

    expect(second.type).toBe('applied');
    expect(parseFollowups(docs.state.disk ?? '').items[0].body).toBe(
      'New body.',
    );
  });

  it('writeFollowupEdit_ItemChangedDuringWrite_Changed', async () => {
    const docs = fakeDocs(FILE);
    const agentText = FILE.replace(
      '- **Alpha** — first thing',
      '- **Alpha** — moved on',
    );
    docs.state.beforeWrite.push(() => {
      docs.state.disk = agentText;
    });

    const result = await writeFollowupEdit(
      docs.deps,
      PATH,
      {
        type: 'edit',
        title: 'Alpha',
        draft: { ...ALPHA, body: 'New body.' },
        baseline: ALPHA,
      },
      null,
    );

    expect(result).toEqual({
      type: 'changed',
      title: 'Alpha',
      item: { ...ALPHA, oneLine: 'moved on' },
    });
    expect(docs.state.disk).toBe(agentText);
  });
});
