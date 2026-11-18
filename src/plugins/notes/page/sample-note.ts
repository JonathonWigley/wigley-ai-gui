import type {
  NoteDraft,
  NoteSendResult,
  NoteSession,
  NotesChannel,
} from '../contract';
import type { NoteDraftChannel } from './popup';

// The demo's note, before `session` is set.
export const SAMPLE_NOTE: NoteDraft = {
  target: null,
  targetPicked: false,
  title: 'Quest timer drifts',
  body: 'The daily quest timer shows one hour more after the device clock changes.',
  tags: ['bug'],
  session: null,
  fresh: false,
  images: [{ id: 1, hasMarkup: false }],
  nextImageId: 2,
};

const SENDS_NOTHING: NoteSendResult = {
  type: 'refused',
  reason: 'A sample note sends nothing.',
};

// `session` is the demo session the sample names; `drawImage` draws the
// sample's image as PNG bytes.
export interface SampleNoteDeps {
  session: NoteSession;
  drawImage(): Promise<Uint8Array>;
}

type SampleHandlers = {
  [K in keyof NotesChannel['invoke']]: (
    ...args: Parameters<NotesChannel['invoke'][K]>
  ) => Promise<Awaited<ReturnType<NotesChannel['invoke'][K]>>>;
};

// A note channel over `SAMPLE_NOTE` held in memory, which reaches no main
// handler: edits, images and markup change only the copy, discard resets it,
// every send is refused and a capture rejects.
export function createSampleNoteChannel(
  deps: SampleNoteDeps,
): NoteDraftChannel {
  const sample = (): NoteDraft => ({
    ...SAMPLE_NOTE,
    tags: [...SAMPLE_NOTE.tags],
    images: [...SAMPLE_NOTE.images],
    session: deps.session,
  });
  let draft = sample();
  // The images and markup added to the copy, by image id.
  const added = new Map<number, Uint8Array>();
  const markups = new Map<number, string>();
  const copy = (): NoteDraft => ({
    ...draft,
    tags: [...draft.tags],
    images: [...draft.images],
  });
  const handlers: SampleHandlers = {
    loadDraft: async () => copy(),
    saveDraft: async (fields) => {
      draft = { ...draft, ...fields, tags: [...fields.tags] };
    },
    image: async (id) => added.get(id) ?? deps.drawImage(),
    addImage: async (png) => {
      const id = draft.nextImageId;
      added.set(id, png);
      draft = {
        ...draft,
        images: [...draft.images, { id, hasMarkup: false }],
        nextImageId: id + 1,
      };
      return copy();
    },
    removeImage: async (id) => {
      added.delete(id);
      markups.delete(id);
      draft = {
        ...draft,
        images: draft.images.filter((image) => image.id !== id),
      };
      return copy();
    },
    markup: async (id) => markups.get(id) ?? null,
    saveMarkup: async (id, json) => {
      markups.set(id, json);
      draft = {
        ...draft,
        images: draft.images.map((image) =>
          image.id === id ? { ...image, hasMarkup: true } : image,
        ),
      };
      return copy();
    },
    capture: () => Promise.reject(new Error('A sample note captures nothing.')),
    discard: async () => {
      added.clear();
      markups.clear();
      draft = sample();
      return copy();
    },
    homes: async () => ({ homes: [], message: 'A sample note files nowhere.' }),
    tags: async () => ['bug', 'idea'],
    sendToFollowup: async () => SENDS_NOTHING,
    sendToSession: async () => SENDS_NOTHING,
  };
  return {
    invoke<K extends keyof NotesChannel['invoke'] & string>(
      method: K,
      ...args: Parameters<NotesChannel['invoke'][K]>
    ) {
      const handler = handlers[method] as (
        ...called: Parameters<NotesChannel['invoke'][K]>
      ) => Promise<Awaited<ReturnType<NotesChannel['invoke'][K]>>>;
      return handler(...args);
    },
  };
}
