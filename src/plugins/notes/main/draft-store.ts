import { type Files, isMissingFile } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { NoteDraft, NoteFields, NoteImage } from '../contract';
import {
  emptyDraft,
  parseDraft,
  withFields,
  withImageAdded,
  withImageRemoved,
  withMarkup,
} from '../draft';

const DRAFT_FILE = 'draft.json';

// The kept draft in notes' data folder: `draft.json`, and each image as
// `images/<id>.png` with its markup beside it as `images/<id>.markup.json`.
// Every call runs after the one before it settles. An image file is written
// before the `draft.json` that names it, and trashed after the `draft.json`
// that drops it.
export interface DraftStore {
  // The saved draft; a fresh one when `draft.json` is missing or unreadable.
  draft(): Promise<NoteDraft>;
  saveFields(fields: NoteFields): Promise<void>;
  // Each of these throws `No image <id> in the draft` for an id it lacks.
  image(id: number): Promise<Uint8Array>;
  // The image's markup JSON; null when it has none.
  markup(id: number): Promise<string | null>;
  saveMarkup(id: number, json: string): Promise<NoteDraft>;
  removeImage(id: number): Promise<NoteDraft>;
  addImage(png: Uint8Array): Promise<NoteDraft>;
  // Starts a fresh draft that keeps the image ids counting, and trashes the
  // old draft's images. Resolves to the fresh draft even when `draft.json`
  // cannot be written, logging the failure.
  clear(): Promise<NoteDraft>;
}

function imagePath(id: number): string {
  return `images/${String(id)}.png`;
}

function markupPath(id: number): string {
  return `images/${String(id)}.markup.json`;
}

function imageOf(draft: NoteDraft, id: number): NoteImage {
  const image = draft.images.find((candidate) => candidate.id === id);
  if (image === undefined) {
    throw new Error(`No image ${String(id)} in the draft`);
  }
  return image;
}

async function readDraft(files: Files, log: Log): Promise<NoteDraft> {
  let text: string;
  try {
    text = await files.read(DRAFT_FILE);
  } catch (error) {
    if (isMissingFile(error)) {
      return emptyDraft(1);
    }
    throw error;
  }
  const draft = parseDraft(text);
  if (draft === null) {
    log('notes', `${DRAFT_FILE} unreadable; starting a fresh draft`);
    return emptyDraft(1);
  }
  return draft;
}

function writeDraft(files: Files, draft: NoteDraft): Promise<void> {
  return files.write(DRAFT_FILE, JSON.stringify(draft, null, 2));
}

// Trashes `image`'s PNG and, when it has one, its markup, logging each file
// that stays.
async function trashImage(
  files: Files,
  log: Log,
  image: NoteImage,
): Promise<void> {
  const paths = image.hasMarkup
    ? [imagePath(image.id), markupPath(image.id)]
    : [imagePath(image.id)];
  for (const path of paths) {
    try {
      await files.trash(path);
    } catch (error) {
      log('notes', `${path} not removed: ${errorText(error)}`);
    }
  }
}

// `files` is notes' data folder. The draft is read once and kept in memory.
export function createDraftStore(files: Files, log: Log): DraftStore {
  let kept: NoteDraft | null = null;
  let last: Promise<unknown> = Promise.resolve();

  function queued<T>(run: () => Promise<T>): Promise<T> {
    const result = last.then(run);
    last = result.catch(() => undefined);
    return result;
  }

  async function current(): Promise<NoteDraft> {
    kept ??= await readDraft(files, log);
    return kept;
  }

  return {
    draft: () => queued(current),
    saveFields: (fields) =>
      queued(async () => {
        const next = withFields(await current(), fields);
        await writeDraft(files, next);
        kept = next;
      }),
    image: (id) =>
      queued(async () => {
        imageOf(await current(), id);
        return files.readBytes(imagePath(id));
      }),
    markup: (id) =>
      queued(async () => {
        const image = imageOf(await current(), id);
        return image.hasMarkup ? files.read(markupPath(id)) : null;
      }),
    saveMarkup: (id, json) =>
      queued(async () => {
        const next = withMarkup(await current(), id);
        await files.write(markupPath(id), json);
        await writeDraft(files, next);
        kept = next;
        return next;
      }),
    removeImage: (id) =>
      queued(async () => {
        const draft = await current();
        const image = imageOf(draft, id);
        const next = withImageRemoved(draft, id);
        await writeDraft(files, next);
        kept = next;
        await trashImage(files, log, image);
        return next;
      }),
    addImage: (png) =>
      queued(async () => {
        const { draft: next, id } = withImageAdded(await current());
        await files.writeBytes(imagePath(id), png);
        await writeDraft(files, next);
        kept = next;
        return next;
      }),
    clear: () =>
      queued(async () => {
        const old = await current();
        const next = emptyDraft(old.nextImageId);
        kept = next;
        try {
          await writeDraft(files, next);
        } catch (error) {
          log('notes', `draft not cleared: ${errorText(error)}`);
          return next;
        }
        for (const image of old.images) {
          await trashImage(files, log, image);
        }
        return next;
      }),
  };
}
