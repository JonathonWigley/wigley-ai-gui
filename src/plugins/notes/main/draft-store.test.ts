import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { NoteFields } from '../contract';
import { emptyDraft, fieldsOf, parseDraft } from '../draft';
import { createDraftStore } from './draft-store';

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

// `failing.write` and `failing.trash` make the store's next writes or trashes
// reject with `disk full`.
function setUp() {
  const files = createMemoryFiles();
  const failing = { write: false, trash: false };
  const storeFiles: Files = {
    ...files,
    write: (path, text) =>
      failing.write
        ? Promise.reject(new Error('disk full'))
        : files.write(path, text),
    trash: (path) =>
      failing.trash
        ? Promise.reject(new Error('disk full'))
        : files.trash(path),
  };
  const logged: string[] = [];
  const store = createDraftStore(storeFiles, (message) => logged.push(message));
  return { files, failing, logged, store };
}

function fieldsTitled(title: string): NoteFields {
  return { ...fieldsOf(emptyDraft(1)), title, fresh: false };
}

async function savedDraft(files: ReturnType<typeof createMemoryFiles>) {
  return parseDraft(await files.read('draft.json'));
}

describe('createDraftStore', () => {
  it('draft_NoFile_GivesEmptyDraft', async () => {
    const { store } = setUp();

    expect(await store.draft()).toEqual(emptyDraft(1));
  });

  it('draft_BadJson_LogsAndGivesEmptyDraft', async () => {
    const { files, logged, store } = setUp();
    await files.write('draft.json', '{ not json');

    expect(await store.draft()).toEqual(emptyDraft(1));
    expect(logged).toEqual(['draft.json unreadable; starting a fresh draft']);
  });

  it('addImage_WritesPngAndListsIt', async () => {
    const { files, store } = setUp();

    await store.addImage(PNG);

    expect(files.bytesOf('images/1.png')).toEqual(PNG);
    expect((await savedDraft(files))?.images).toEqual([
      { id: 1, hasMarkup: false },
    ]);
  });

  it('removeImage_DropsItAndTrashesPng', async () => {
    const { files, store } = setUp();
    await store.addImage(PNG);

    await store.removeImage(1);

    expect((await savedDraft(files))?.images).toEqual([]);
    expect(await files.stat('images/1.png')).toBeNull();
  });

  it('removeImage_TrashFails_LogsAndStillDropsIt', async () => {
    const { files, failing, logged, store } = setUp();
    await store.addImage(PNG);
    failing.trash = true;

    const draft = await store.removeImage(1);

    expect(draft.images).toEqual([]);
    expect((await savedDraft(files))?.images).toEqual([]);
    expect(logged).toEqual([
      expect.stringMatching(/images\/1\.png.*disk full/),
    ]);
  });

  it('saveMarkup_WritesJsonVerbatimAndSetsHasMarkup', async () => {
    const { files, store } = setUp();
    await store.addImage(PNG);
    const json = '{"objects": [ ] }';

    await store.saveMarkup(1, json);

    expect(await files.read('images/1.markup.json')).toBe(json);
    expect(await store.markup(1)).toBe(json);
    expect((await savedDraft(files))?.images).toEqual([
      { id: 1, hasMarkup: true },
    ]);
  });

  it('markup_ImageWithNone_ReturnsNull', async () => {
    const { store } = setUp();
    await store.addImage(PNG);

    expect(await store.markup(1)).toBeNull();
  });

  it('image_UnknownId_Throws', async () => {
    const { store } = setUp();
    await store.addImage(PNG);

    await expect(store.image(7)).rejects.toThrow('7');
    await expect(store.markup(7)).rejects.toThrow('7');
  });

  it('clear_KeepsNextImageIdAndTrashesEveryImageFile', async () => {
    const { files, store } = setUp();
    await store.addImage(PNG);
    await store.addImage(PNG);
    await store.saveMarkup(2, '{}');

    const cleared = await store.clear();

    expect(cleared).toEqual(emptyDraft(3));
    expect(await savedDraft(files)).toEqual(emptyDraft(3));
    expect(await files.list('images')).toEqual([]);
  });

  it('clear_DraftWriteFails_LogsAndGivesFreshDraftKeepingImages', async () => {
    const { files, failing, logged, store } = setUp();
    await store.addImage(PNG);
    failing.write = true;

    const cleared = await store.clear();

    expect(cleared).toEqual(emptyDraft(2));
    expect(await store.draft()).toEqual(emptyDraft(2));
    expect(logged).toEqual([expect.stringContaining('disk full')]);
    expect(files.bytesOf('images/1.png')).toEqual(PNG);
  });

  it('saveFields_TwoAtOnce_LeavesTheSecond', async () => {
    const { files, store } = setUp();

    await Promise.all([
      store.saveFields(fieldsTitled('first')),
      store.saveFields(fieldsTitled('second')),
    ]);

    expect((await savedDraft(files))?.title).toBe('second');
  });

  it('draft_FreshStoreOverSameFiles_ReadsSavedDraft', async () => {
    const { files, store } = setUp();
    await store.saveFields(fieldsTitled('kept'));
    await store.addImage(PNG);

    const reloaded = createDraftStore(files, () => undefined);

    const draft = await reloaded.draft();
    expect(draft.title).toBe('kept');
    expect(draft.images).toEqual([{ id: 1, hasMarkup: false }]);
    expect(await reloaded.image(1)).toEqual(PNG);
  });
});
