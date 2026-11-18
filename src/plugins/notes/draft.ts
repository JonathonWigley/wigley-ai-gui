import {
  isJsonObject,
  isStringArray,
  type JsonObject,
} from '../../shared/json';
import type {
  NoteDraft,
  NoteFields,
  NoteImage,
  NoteSession,
  SendKind,
} from './contract';

// A draft no popup has opened, with no text, target, session or image.
export function emptyDraft(nextImageId: number): NoteDraft {
  return {
    target: null,
    targetPicked: false,
    title: '',
    body: '',
    tags: [],
    session: null,
    fresh: true,
    images: [],
    nextImageId,
  };
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

// undefined when `value` is neither null nor a session.
function parseSession(value: unknown): NoteSession | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isJsonObject(value)) {
    return undefined;
  }
  const { sessionId, harness, hostSessionId, projectDir } = value;
  const isSession =
    typeof sessionId === 'string' &&
    typeof hostSessionId === 'string' &&
    isStringOrNull(harness) &&
    isStringOrNull(projectDir);
  return isSession
    ? { sessionId, harness, hostSessionId, projectDir }
    : undefined;
}

function parseImage(value: unknown): NoteImage | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const { id, hasMarkup } = value;
  const isImage =
    isWholeNumber(id) && id >= 1 && typeof hasMarkup === 'boolean';
  return isImage ? { id, hasMarkup } : undefined;
}

function parseImages(value: unknown): NoteImage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const images = value.map(parseImage);
  return images.every((image): image is NoteImage => image !== undefined)
    ? images
    : undefined;
}

function parseDraftObject(record: JsonObject): NoteDraft | null {
  const { target, targetPicked, title, body, tags, fresh, nextImageId } =
    record;
  const session = parseSession(record.session);
  const images = parseImages(record.images);
  const hasFieldTypes =
    isStringOrNull(target) &&
    typeof targetPicked === 'boolean' &&
    typeof title === 'string' &&
    typeof body === 'string' &&
    isStringArray(tags) &&
    typeof fresh === 'boolean' &&
    isWholeNumber(nextImageId);
  if (!hasFieldTypes || session === undefined || images === undefined) {
    return null;
  }
  const isNextIdFree = images.every((image) => image.id < nextImageId);
  if (!isNextIdFree) {
    return null;
  }
  return {
    target,
    targetPicked,
    title,
    body,
    tags,
    session,
    fresh,
    images,
    nextImageId,
  };
}

// The draft `text` holds as JSON, keeping only `NoteDraft`'s fields; null when
// the text is not JSON or any field is missing or of the wrong type.
export function parseDraft(text: string): NoteDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isJsonObject(parsed) ? parseDraftObject(parsed) : null;
}

// `draft` with its page-edited fields replaced by `fields`; images kept.
export function withFields(draft: NoteDraft, fields: NoteFields): NoteDraft {
  return {
    ...pickFields(fields),
    images: draft.images,
    nextImageId: draft.nextImageId,
  };
}

// `draft` with one more image, no markup, at its end; `id` is that image's.
export function withImageAdded(draft: NoteDraft): {
  draft: NoteDraft;
  id: number;
} {
  const id = draft.nextImageId;
  return {
    draft: {
      ...draft,
      images: [...draft.images, { id, hasMarkup: false }],
      nextImageId: id + 1,
    },
    id,
  };
}

// The draft's image `id`. Throws when the draft holds no image `id`.
export function imageOf(draft: NoteDraft, id: number): NoteImage {
  const image = draft.images.find((candidate) => candidate.id === id);
  if (image === undefined) {
    throw new Error(`No image ${String(id)} in the draft`);
  }
  return image;
}

// `draft` without image `id`, and that image. Throws when the draft holds no
// image `id`.
export function withImageRemoved(
  draft: NoteDraft,
  id: number,
): { draft: NoteDraft; image: NoteImage } {
  const image = imageOf(draft, id);
  return {
    draft: {
      ...draft,
      images: draft.images.filter((kept) => kept !== image),
    },
    image,
  };
}

// `draft` with image `id` marked as having markup. Throws when the draft
// holds no image `id`.
export function withMarkup(draft: NoteDraft, id: number): NoteDraft {
  imageOf(draft, id);
  return {
    ...draft,
    images: draft.images.map((image) =>
      image.id === id ? { ...image, hasMarkup: true } : image,
    ),
  };
}

function pickFields(draft: NoteFields): NoteFields {
  return {
    target: draft.target,
    targetPicked: draft.targetPicked,
    title: draft.title,
    body: draft.body,
    tags: draft.tags,
    session: draft.session,
    fresh: draft.fresh,
  };
}

// The page-edited fields of `draft`, without its images.
export function fieldsOf(draft: NoteDraft): NoteFields {
  return pickFields(draft);
}

// Why the note cannot be sent as `kind`, or null when it can. An empty body
// still sends.
export function sendRefusal(draft: NoteFields, kind: SendKind): string | null {
  if (draft.target === null) {
    return 'Pick a target first';
  }
  if (kind === 'followup' && draft.title.trim() === '') {
    return 'A follow-up needs a title';
  }
  return null;
}
