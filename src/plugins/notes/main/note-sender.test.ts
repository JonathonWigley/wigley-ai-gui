import { describe, expect, it } from 'vitest';
import type { ImageEncoder } from '../../../contracts/images';
import { MAX_IMAGE_BASE64 } from '../../../shared/image-types';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { SHRINK_REFUSED } from '../../../shared/shrink-image';
import type { BacklogWriteResult, NoteTarget } from '../../backlog/contract';
import type { LaunchRequest } from '../../chat/contract';
import type { FollowupRequest, NoteFields, NoteSession } from '../contract';
import { emptyDraft, fieldsOf, parseDraft } from '../draft';
import { createDraftStore } from './draft-store';
import { createNoteSender } from './note-sender';

const HOME = '/home/me';
const ROOT = '/home/me/repo/docs/features';
const BRIEF = 'Fix this.';
const PNG_A = new Uint8Array([1, 1, 1]);
const PNG_B = new Uint8Array([2, 2, 2]);
const CREATE: FollowupRequest = { type: 'create' };
// One byte more than the most whose base64 text fits the cap.
const OVER_CAP_PNG = new Uint8Array((MAX_IMAGE_BASE64 / 4) * 3 + 1);
const SHRUNK_PNG = new Uint8Array([7, 7, 7]);

// Re-encodes every image as `encoded`, recording the scale of each call.
function fakeEncoder(encoded: Uint8Array): ImageEncoder & { scales: number[] } {
  const scales: number[] = [];
  return {
    scales,
    encode(_image, scale) {
      scales.push(scale);
      return Promise.resolve(encoded);
    },
  };
}

const SESSION: NoteSession = {
  sessionId: 's1',
  harness: 'claude',
  hostSessionId: 'abc123',
  projectDir: '/home/me/repo',
};

interface FiledNote {
  homeRoot: string;
  target: NoteTarget;
  text: string;
  images: readonly Uint8Array[];
}

// A sender over a memory-files store whose draft holds `fields`, with fakes
// that record each `fileNote` and `launch` call. `owners` maps a session id to
// the chat profile that owns it.
async function setUp(options: {
  fields?: Partial<NoteFields>;
  images?: Uint8Array[];
  encoder?: ImageEncoder;
  fileNote?: () => Promise<BacklogWriteResult>;
  launch?: () => Promise<string>;
  profiles?: string[];
  owners?: Record<string, string>;
}) {
  const files = createMemoryFiles();
  const store = createDraftStore(files, () => undefined);
  await store.saveFields({
    ...fieldsOf(emptyDraft(1)),
    target: ROOT,
    title: '  Fix the gap  ',
    body: 'The gap is wide. Shrink it.',
    fresh: false,
    ...options.fields,
  });
  for (const image of options.images ?? []) {
    await store.addImage(image);
  }
  const filed: FiledNote[] = [];
  const launched: LaunchRequest[] = [];
  const sender = createNoteSender({
    store,
    images: options.encoder ?? fakeEncoder(new Uint8Array()),
    backlog: {
      fileNote(homeRoot, target, text, images) {
        filed.push({ homeRoot, target, text, images });
        return (
          options.fileNote?.() ??
          Promise.resolve({ type: 'applied', text: '', line: 1 })
        );
      },
    },
    chat: {
      launch(request) {
        launched.push(request);
        return options.launch?.() ?? Promise.resolve('row-1');
      },
      profileNames: () => options.profiles ?? ['work', 'personal'],
      profileOf: (sessionId) => options.owners?.[sessionId] ?? null,
    },
    launchBrief: () => BRIEF,
    paths: posixPaths,
    homeDir: Promise.resolve(HOME),
    log: () => undefined,
  });
  const saved = async () => parseDraft(await files.read('draft.json'));
  return { store, sender, filed, launched, saved };
}

function refusedWith(reason: string) {
  return async (): Promise<BacklogWriteResult> => ({ type: 'refused', reason });
}

describe('toSession', () => {
  it('toSession_SessionChatOwns_LaunchesUnderItsProfile', async () => {
    const note = await setUp({
      fields: { session: SESSION },
      owners: { s1: 'personal' },
    });

    await note.sender.toSession('/home/me/repo', []);

    expect(note.launched.map((request) => request.profile)).toEqual([
      'personal',
    ]);
  });

  it('toSession_SessionChatDoesNotOwn_LaunchesUnderFirstProfile', async () => {
    const note = await setUp({ fields: { session: SESSION } });

    await note.sender.toSession('/home/me/repo', []);

    expect(note.launched.map((request) => request.profile)).toEqual(['work']);
  });

  it('toSession_NoProfiles_Refuses', async () => {
    const note = await setUp({ profiles: [] });

    const result = await note.sender.toSession('/home/me/repo', []);

    expect(result).toEqual({ type: 'refused', reason: 'Chat has no profiles' });
    expect(note.launched).toEqual([]);
  });

  it('toSession_Launched_SendsLaunchTextAndBase64Pngs', async () => {
    const note = await setUp({
      fields: { session: SESSION },
      images: [PNG_A],
    });

    const result = await note.sender.toSession('/home/me/repo', [null]);

    expect(note.launched).toEqual([
      {
        projectDir: '/home/me/repo',
        profile: 'work',
        message: {
          text: expect.any(String),
          images: [{ mediaType: 'image/png', data: 'AQEB' }],
        },
      },
    ]);
    const text = note.launched[0].message.text;
    const parts = [BRIEF, 'Fix the gap', 'Shrink it.', 'abc123', '~/repo'];
    for (const part of parts) {
      expect(text).toContain(part);
    }
    expect(result).toEqual({
      type: 'sent',
      draft: emptyDraft(2),
      toast: 'Session started in ~/repo',
    });
  });

  it.each([
    { kind: 'capture', stored: OVER_CAP_PNG, flattened: [null] },
    { kind: 'markup image', stored: PNG_A, flattened: [OVER_CAP_PNG] },
  ])(
    'toSession_ImageOverCap_SendsItShrunk: $kind',
    async ({ stored, flattened }) => {
      const encoder = fakeEncoder(SHRUNK_PNG);
      const note = await setUp({ images: [stored], encoder });

      await note.sender.toSession('/home/me/repo', flattened);

      expect(encoder.scales).toEqual([0.75]);
      expect(note.launched.map((request) => request.message.images)).toEqual([
        [{ mediaType: 'image/png', data: 'BwcH' }],
      ]);
    },
  );

  it('toSession_ImageWillNotShrinkUnderCap_RefusesAndKeepsDraft', async () => {
    const note = await setUp({
      images: [PNG_A, OVER_CAP_PNG],
      encoder: fakeEncoder(OVER_CAP_PNG),
    });

    const result = await note.sender.toSession('/home/me/repo', [null, null]);

    expect(result).toEqual({ type: 'refused', reason: SHRINK_REFUSED });
    expect(note.launched).toEqual([]);
    expect((await note.saved())?.images).toHaveLength(2);
  });

  it('toSession_LaunchRejects_KeepsDraftAndPassesText', async () => {
    const note = await setUp({
      images: [PNG_A],
      launch: () =>
        Promise.reject(new Error('Images over 5 MB cannot be attached')),
    });

    const result = await note.sender.toSession('/home/me/repo', [null]);

    expect(result).toEqual({
      type: 'refused',
      reason: 'Images over 5 MB cannot be attached',
    });
    expect((await note.saved())?.images).toEqual([{ id: 1, hasMarkup: false }]);
  });
});

describe('toFollowup', () => {
  it('toFollowup_BacklogRefuses_KeepsDraft', async () => {
    const note = await setUp({
      images: [PNG_A],
      fileNote: refusedWith('outside the index'),
    });

    const result = await note.sender.toFollowup(CREATE, [null]);

    expect(result).toEqual({ type: 'refused', reason: 'outside the index' });
    const saved = await note.saved();
    expect(saved?.title).toBe('  Fix the gap  ');
    expect(saved?.images).toEqual([{ id: 1, hasMarkup: false }]);
  });

  it('toFollowup_FlattenedAndStored_SendsEachInStripOrder', async () => {
    const note = await setUp({ images: [PNG_A, PNG_B] });
    await note.store.saveMarkup(1, '{}');
    const flattenedA = new Uint8Array([9, 9]);

    await note.sender.toFollowup(CREATE, [flattenedA, null]);

    expect(note.filed.map((call) => call.images)).toEqual([
      [flattenedA, PNG_B],
    ]);
  });

  it.each([
    { kind: 'capture', stored: OVER_CAP_PNG, flattened: [null] },
    { kind: 'markup image', stored: PNG_A, flattened: [OVER_CAP_PNG] },
  ])(
    'toFollowup_ImageOverCap_FilesItUnshrunk: $kind',
    async ({ stored, flattened }) => {
      const encoder = fakeEncoder(SHRUNK_PNG);
      const note = await setUp({ images: [stored], encoder });

      const result = await note.sender.toFollowup(CREATE, flattened);

      expect(encoder.scales).toEqual([]);
      expect(result.type).toBe('sent');
      expect(note.filed).toHaveLength(1);
      const [filed] = note.filed[0].images;
      expect(filed.byteLength).toBe(OVER_CAP_PNG.byteLength);
    },
  );

  it('toFollowup_SendRefusal_CallsNeitherExport', async () => {
    const note = await setUp({ fields: { target: null } });

    const followup = await note.sender.toFollowup(CREATE, []);
    const session = await note.sender.toSession('/home/me/repo', []);

    expect(followup).toEqual({
      type: 'refused',
      reason: 'Pick a target first',
    });
    expect(session).toEqual({ type: 'refused', reason: 'Pick a target first' });
    expect(note.filed).toEqual([]);
    expect(note.launched).toEqual([]);
  });

  it('toFollowup_Create_CarriesTrimmedTitleAndFirstSentence', async () => {
    const note = await setUp({ fields: { tags: ['ui'] } });

    await note.sender.toFollowup(CREATE, []);

    expect(note.filed.map((call) => [call.homeRoot, call.target])).toEqual([
      [
        ROOT,
        {
          type: 'create',
          title: 'Fix the gap',
          oneLine: 'The gap is wide.',
          tags: ['ui'],
        },
      ],
    ]);
  });

  it('toFollowup_Applied_ClearsDraftAndToasts', async () => {
    const note = await setUp({ images: [PNG_A] });

    const result = await note.sender.toFollowup(CREATE, [null]);

    expect(result).toEqual({
      type: 'sent',
      draft: emptyDraft(2),
      toast: 'Follow-up added: Fix the gap',
    });
    expect(await note.saved()).toEqual(emptyDraft(2));
  });

  it('toFollowup_AppendApplied_ToastsTheItem', async () => {
    const note = await setUp({});

    const result = await note.sender.toFollowup(
      { type: 'append', path: `${ROOT}/followups.md`, title: 'Old item' },
      [],
    );

    expect(note.filed.map((call) => call.target)).toEqual([
      { type: 'append', path: `${ROOT}/followups.md`, title: 'Old item' },
    ]);
    expect(result).toMatchObject({ type: 'sent', toast: 'Added to Old item' });
  });

  it('toFollowup_TitleTaken_Refuses', async () => {
    const note = await setUp({
      fileNote: async () => ({ type: 'titleTaken', title: 'Fix the gap' }),
    });

    const result = await note.sender.toFollowup(CREATE, []);

    expect(result).toEqual({
      type: 'refused',
      reason: 'A follow-up named Fix the gap already exists',
    });
  });

  it('toFollowup_Missing_Refuses', async () => {
    const note = await setUp({
      fileNote: async () => ({ type: 'missing', title: 'Old item' }),
    });

    const result = await note.sender.toFollowup(
      { type: 'append', path: `${ROOT}/followups.md`, title: 'Old item' },
      [],
    );

    expect(result).toEqual({
      type: 'refused',
      reason: 'No follow-up named Old item',
    });
  });

  it('toFollowup_ChangedOnDisk_RefusesAndKeepsDraft', async () => {
    const note = await setUp({
      fileNote: async () => ({
        type: 'changed',
        title: 'Old item',
        item: { title: 'Old item', oneLine: '', tags: [], body: 'edited' },
      }),
    });

    const result = await note.sender.toFollowup(
      { type: 'append', path: `${ROOT}/followups.md`, title: 'Old item' },
      [],
    );

    expect(result).toEqual({
      type: 'refused',
      reason: 'Old item changed on disk; send again',
    });
    expect((await note.saved())?.title).toBe('  Fix the gap  ');
  });

  it('toFollowup_FileNoteRejects_RefusesWithItsText', async () => {
    const note = await setUp({
      fileNote: () => Promise.reject(new Error('disk full')),
    });

    const result = await note.sender.toFollowup(CREATE, []);

    expect(result).toEqual({ type: 'refused', reason: 'disk full' });
  });

  it('toFollowup_LengthMismatch_Throws', async () => {
    const note = await setUp({ images: [PNG_A] });

    await expect(note.sender.toFollowup(CREATE, [])).rejects.toThrow(
      /\b0\b.*\b1\b/,
    );
  });
});
