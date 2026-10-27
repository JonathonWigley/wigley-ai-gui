import { describe, expect, it } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { createMemoryFiles } from '../../../shared/memory-files';
import { emptyDraft } from '../draft';
import { addDriveActions } from './drive-actions';
import { createDraftStore } from './draft-store';

const PNG = new Uint8Array([137, 80, 78, 71, 1]);

function setUp() {
  const data = createMemoryFiles();
  const store = createDraftStore(data, () => undefined);
  const drive = fakeDriveHost();
  const actions = addDriveActions(drive.host, { store, data });
  return { data, store, drive, actions };
}

describe('notes drive actions', () => {
  it('draft_ListsDataFilesSortedWithoutFolders', async () => {
    const { data, store, drive } = setUp();
    await store.addImage(PNG);
    await store.saveMarkup(1, '{}');
    await data.makeFolder('empty');

    const { draft, files } = (await drive.run('draft')) as {
      draft: unknown;
      files: string[];
    };

    expect(draft).toEqual(await store.draft());
    expect(files).toEqual([
      'draft.json',
      'images/1.markup.json',
      'images/1.png',
    ]);
  });

  it('discard_ClearsDraftAndItsImages', async () => {
    const { data, store, drive } = setUp();
    await store.addImage(PNG);

    expect(await drive.run('discard')).toEqual({ draft: emptyDraft(2) });
    expect(await data.list('images')).toEqual([]);
  });

  it('dispose_RemovesBothActions', () => {
    const { drive, actions } = setUp();

    actions.dispose();

    expect([...drive.actions.keys()]).toEqual([]);
  });
});
